// Image → drill DSL via the Claude API (vision), called directly from the
// browser with plain fetch — the app stays static and dependency-free. The
// user's API key lives in localStorage on their own device; use a spend-capped
// key.
//
// Reliability design: the model is never asked to do rink geometry. It reports
// landmarks + the drill in IMAGE PIXEL coordinates (vision models are pixel-
// accurate but poor at mental rotation/unit conversion); drill-fit.js fits the
// orientation + scale deterministically and rewrites the coordinates. A final
// visual verify pass renders the result and asks the model to compare it with
// the photo.

import DSL_REF from "../docs/drill-dsl.md?raw";
import { parseDrill, extractDrill } from "./drill-format.js";
import { fitTransform, transformDsl } from "./drill-fit.js";
import { drillSvg } from "./drill-svg.js";

export const ANTHROPIC_KEY_STORE = "drillboard:anthropic-key";

const API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-4-8";

const SYSTEM_PROMPT = `You transcribe photographed hockey drill diagrams (drill-book pages, whiteboards, hand sketches) into the DrillBoard drill DSL. The full DSL reference follows; obey its syntax exactly.

${DSL_REF}

CRITICAL — coordinates: diagrams are photographed in arbitrary orientations, so do NOT attempt to convert positions into rink feet. Every coordinate you write (PIECE positions, PATH/BRANCH points, MARK points, STEP pos=) must be an IMAGE PIXEL coordinate of the supplied photo: origin at the top-left, x right, y down. The app converts pixels to rink feet from your landmark report.

Work in this order:
1. ORIENT FIRST. Before transcribing anything, identify the rink markings in the photo and establish the orientation: which line is the goal line, which is the blue line, where the faceoff dots and circles are, and which way the play attacks. This becomes the json block.
2. COUNT EVERYTHING. Count the players of each colour (bench rows and the coach included), the dashed pass arrows, and the shot arrows. Record the totals in the json block's "counts" — the app rejects a drill whose piece and arrow totals disagree with your own counts, so count from the photo, not from what you've written.
3. PLACE EACH PIECE BY LOOKING AT IT. Read every piece's pixel position individually from the photo — its own center, one at a time. Use the landmarks as measuring sticks to cross-check (a player drawn ON a dot gets that dot's pixels; one drawn beside a circle stays beside it), but never round a position toward a landmark, a row, or a grid the photo doesn't show. Positions are used verbatim. Every counted player must appear as a PIECE — a passing chain with three players has three player pieces even if two overlap visually.

FAITHFUL RECREATION is the goal — an exact copy of the diagram. The same pieces, in the same places, with the same colours and the same labels. Never add a piece the photo doesn't show. Never drop one it does show. Never substitute colours (use a colour only where the diagram shows it). Never invent labels. Never tidy the layout. When fidelity and tidiness conflict, choose fidelity.

Output exactly two fenced blocks, nothing else:

1. A \`\`\`json fence:
{
  "rink": "half" | "full",            // what the diagram shows (zone/half-ice → "half")
  "attack": "up" | "down" | "left" | "right",  // direction TOWARD the attacking net IN THE PHOTO
  "landmarks": [ { "feature": "...", "x": <px>, "y": <px> }, ... ],
  "counts": { "players": <n>, "passes": <n>, "shots": <n> }  // from the PHOTO. players = marks that become PIECE player lines: skaters, bench players, and the coach — NOT the goalie (a goalie is the "goalie" flag on the net piece, never a player). passes = dashed pass arrows; shots = shot arrows.
}
Report every rink marking you can identify. Allowed features: goal_line, blue_line, center_line, center_dot, center_circle, net, crease, endzone_dot, endzone_circle, neutral_dot. For lines, give the midpoint of the visible painted segment; for circles, the center. Landmark accuracy matters more than quantity — only report marks you can actually see.

2. A \`\`\`drill fence with the complete drill, all coordinates in image pixels.

Transcription rules:
- Use PIECE and PATH statements. Prefer simple L and Q segments — capture the drill's shape and flow, not every wiggle.
- Solid lines with arrowheads are skating routes (CARRY when the player has the puck). Dashed lines are passes (pass= on the puck, or a PASS leg). Heavy/zigzag lines ending at the net are shots (shoot= or a SHOT leg).
- Wire every line to its pieces. A line belongs to a specific piece: it starts AT that piece's position and ends exactly AT the receiving piece, the net, or its visible arrowhead — reuse those pieces' own pixel coordinates as the endpoints. No line may run off the ice or dangle in space. If you cannot tell what a line connects, omit it rather than guess.
- A chain of dashed arrows is ONE puck moving — exactly one puck in play, owned by the first passer; every other player in the chain has NO puck. The app draws pass and shot lines itself from the puck chain: you never draw them. Worked example — X1 passes to X2, X2 passes to X3, X3 shoots, all standing still (pixel coords as usual):
  PIECE X1 player 400 900 X
  PIECE X2 player 520 1100 X
  PIECE X3 player 560 800 X
  PIECE N1 net 600 300 goalie
  PIECE K1 puck 400 900 on=X1 pass=0:X2 pass=0:X3 shoot=0>N1
  (pass=0 / shoot=0 release from the carrier's standing spot; use a waypoint index instead of 0 only when the carrier skates first.)
- Never transcribe watermarks, logos, page borders, bench areas outside the boards, or the rink outline itself as drill content.
- A shaded/highlighted area is a coaching zone: outline it with a MARK statement in a matching colour (e.g. MARK Z1 #e8c547 0.6 dashed x1,y1 x2,y1 x2,y2 x1,y2 x1,y1 — pixel coords like everything else). MARK is ONLY for shaded/highlighted zones — NEVER for arrows, passes, shots, or player movement; any arrow in the diagram must become drill logic (a PATH, pass=, or shoot=), never ink. Small black rings at a zone's corners are tires, NOT cones — cones are only open triangles/wedges.
- Labels come from the diagram: keep the letters it actually shows (X, O, F1...). The app displays a player's id when it has no label, so for players drawn WITHOUT a letter, give the whole group its team letter as the label (all X's are labelled X; a plain-circle team is all O) — NEVER invent numbering like B1/R2/TL1. Piece ids just need to be unique (X1, X2… with label X is correct).
- Faceoff circles are your rulers for placement: a piece on a dot gets the dot's exact pixels; on a circle's edge sits ON the drawn circle; a piece outside or below a circle must land clearly outside it. Re-check each piece against the nearest circle or dot before writing its position.
- Give players short jersey labels matching the diagram (F1, D2, X, O...). Plain filled circles in a team colour with no letter are still players of that team.
- Player colors: if the diagram is drawn in color, give each player its drawn color as a hex modifier — use the app palette: red #d7263d, blue #1f4fa3, green #1f8a4c, orange #e0731d, black #22262b, purple #7a3fa8. With X-and-O (or F-and-D) conventions and no color, make one group red and the other blue #1f4fa3.
- A coach mark (CO, C, or a coach symbol) is a PLAYER in black: PIECE <id> player <x> <y> #22262b CO.
- A pile of pucks (a scattering of small filled dots next to each other) → place 2–4 puck pieces clustered at that spot, one per visible dot up to 4.
- Use the right on-ice tool for what's drawn: small open triangles/wedges = cone; black circles WITH a hole (rings) = tire; a long low pad/barrier = bumper; a dummy/cutout defender = deker; a rebounder/passing board = passer; a lone stick on the ice = stick; free-floating text = a label piece. A drawn goalie is "goalie" on the net piece.
- Do NOT use face= or ~deg aim modifiers (they are angles in the photo's frame and cannot be converted).
- Use TITLE (and DESC if the page shows text describing the drill).`;

// Decode, downscale (long edge ≤ maxEdge) and re-encode as JPEG base64.
// Always re-encodes regardless of input type, which also normalizes PNG and
// Safari-decoded HEIC. iOS camera captures arrive as JPEG; Safari transcodes
// HEIC library picks for file inputs — an undecodable file throws. 2200px
// keeps landmark/dot placement pixel-accurate (Opus 4.8 accepts up to 2576px).
export async function prepareImage(file, { maxEdge = 2200, quality = 0.8 } = {}) {
  let bmp = null, url = null;
  try {
    try {
      bmp = await createImageBitmap(file);
    } catch {
      url = URL.createObjectURL(file);
      bmp = await new Promise((res, rej) => {
        const img = new Image();
        img.onload = () => res(img);
        img.onerror = rej;
        img.src = url;
      });
    }
  } catch {
    throw new Error("Couldn't read that image — try a JPEG or a screenshot.");
  } finally {
    if (url) URL.revokeObjectURL(url);
  }
  const w = bmp.naturalWidth || bmp.width, h = bmp.naturalHeight || bmp.height;
  if (!w || !h) throw new Error("Couldn't read that image — try a JPEG or a screenshot.");
  const scale = Math.min(1, maxEdge / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement("canvas");
  canvas.width = cw; canvas.height = ch;
  canvas.getContext("2d").drawImage(bmp, 0, 0, cw, ch);
  if (bmp.close) bmp.close();
  const dataUrl = canvas.toDataURL("image/jpeg", quality);
  return { data: dataUrl.slice(dataUrl.indexOf(",") + 1), mediaType: "image/jpeg" };
}

async function callClaude(apiKey, messages, signal) {
  const res = await fetch(API_URL, {
    method: "POST",
    signal,
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
      // required for CORS when calling the API from a browser
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 12000,
      thinking: { type: "adaptive" },
      system: SYSTEM_PROMPT,
      messages,
    }),
  });
  if (!res.ok) {
    let msg = `Claude API error (${res.status})`;
    try { msg = (await res.json())?.error?.message || msg; } catch { /* keep default */ }
    if (res.status === 401) msg = "API key rejected — you'll be asked for a new one.";
    else if (res.status === 429) msg = "Rate limited by the Claude API — wait a minute and retry.";
    else if (res.status === 529) msg = "Claude API is overloaded — try again shortly.";
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  const body = await res.json();
  if (body.stop_reason === "refusal") throw new Error("Claude declined to transcribe this image.");
  if (body.stop_reason === "max_tokens") throw new Error("Response was cut off — try a simpler or clearer photo.");
  // adaptive thinking emits `thinking` blocks — keep only the text blocks
  return (body.content || []).filter(b => b.type === "text").map(b => b.text).join("");
}

// pull the ```json orientation/landmark block out of a response
function extractMeta(text) {
  const m = /```json[^\n]*\r?\n([\s\S]*?)```/i.exec(text);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

// render a (rink-feet) DSL to a JPEG base64 via the app's own SVG renderer,
// for the visual verify pass — same rasterizing approach as exportImage
async function renderDsl(dsl, width = 1200) {
  const svgText = drillSvg(dsl);
  const vbm = /viewBox="([\d.\s-]+)"/.exec(svgText);
  const [, , vw, vh] = (vbm ? vbm[1].split(/\s+/) : [0, 0, 200, 85]).map(Number);
  const H = Math.round(width * (vh / vw));
  const svg = svgText.replace("<svg ", `<svg width="${width}" height="${H}" `);
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i); i.onerror = rej; i.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = H;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#eef5f9"; ctx.fillRect(0, 0, width, H);
    ctx.drawImage(img, 0, 0, width, H);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    return dataUrl.slice(dataUrl.indexOf(",") + 1);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// fit + transform one model response; returns {dsl, drill, errors, meta}
// where dsl is rink-feet text (best effort even when parse errors remain) —
// or throws when the landmarks can't orient the diagram at all.
function toRinkDsl(raw) {
  const meta = extractMeta(raw) || {};
  const fit = fitTransform(meta.landmarks, { attack: meta.attack, rink: meta.rink });
  if (fit.error) throw new Error(`Couldn't orient the diagram — ${fit.error}.`);
  const dsl = transformDsl(extractDrill(raw), fit.map);
  const r = parseDrill(dsl);
  return { dsl, drill: r.errors.length ? null : r, errors: r.errors, meta };
}

// hold the drill to the model's own photo counts (players / passes / shots) —
// a dropped chain receiver shows up here as a hard mismatch we can bounce back
function countMismatches(drill, meta) {
  const c = meta?.counts;
  if (!drill || !c) return [];
  const players = drill.pieces.filter(p => p.kind === "player").length;
  // the model often counts the goalie among "players", but a goalie is the
  // goalie flag on a net piece — accept either tally so that difference can
  // never trigger a bounce (which is how a phantom 7th skater got invented)
  const goalies = drill.pieces.filter(p => p.kind === "net" && p.goalie).length;
  const pucks = drill.pieces.filter(p => p.kind === "puck");
  const passes = pucks.reduce((a, p) => a + (p.transfers || []).filter(t => t.kind === "pass").length, 0);
  const shots = pucks.reduce((a, p) => a + (p.terminals || []).filter(t => t.kind === "shot").length, 0);
  const out = [];
  if (Number.isFinite(c.players) && players !== c.players && players + goalies !== c.players)
    out.push(`you counted ${c.players} players in the photo but the drill has ${players} player pieces (note: the goalie is the goalie flag on the net piece, not a player piece — do not count or add it as a player)`);
  if (Number.isFinite(c.passes) && passes !== c.passes) out.push(`you counted ${c.passes} pass arrows but the drill has ${passes} pass= entries`);
  if (Number.isFinite(c.shots) && shots !== c.shots) out.push(`you counted ${c.shots} shot arrows but the drill has ${shots} shots`);
  return out;
}

// Transcribe an image into the DSL: pixel-space extraction → deterministic
// orientation fit → one syntax-repair round-trip if needed → visual verify
// pass (render the result, let the model compare it with the photo).
// Returns { text, drill, errors } — text is rink-feet DSL for the editor.
export async function drillFromImage({ apiKey, data, mediaType, onStatus, signal }) {
  const messages = [{
    role: "user",
    content: [
      { type: "image", source: { type: "base64", media_type: mediaType, data } },
      { type: "text", text: "Transcribe this hockey drill diagram. Remember: all coordinates in image pixels, and report the landmarks + attack direction in the ```json block first." },
    ],
  }];
  let raw = await callClaude(apiKey, messages, signal);
  messages.push({ role: "assistant", content: raw });

  // syntax repair happens in the model's own pixel frame, before transforming
  let px = parseDrill(extractDrill(raw));
  if (px.errors.length) {
    onStatus?.(`Fixing ${px.errors.length} parse error${px.errors.length === 1 ? "" : "s"}…`);
    messages.push({
      role: "user",
      content: "That drill has parse errors:\n" + px.errors.join("\n") +
        "\n\nOutput the corrected ```json and ```drill blocks in full (still image-pixel coordinates). Fix only the errors; keep everything else.",
    });
    raw = await callClaude(apiKey, messages, signal);
    messages.push({ role: "assistant", content: raw });
  }

  let best = toRinkDsl(raw);
  if (!best.drill) return { text: best.dsl, drill: null, errors: best.errors };

  // hold the drill to the model's own counts — a dropped player or pass hop
  // is a deterministic mismatch, worth one corrective round-trip
  const mism = countMismatches(best.drill, best.meta);
  if (mism.length) {
    onStatus?.("Reconciling the piece count…");
    messages.push({
      role: "user",
      content: "Your drill disagrees with your own photo counts: " + mism.join("; ") +
        ". Recount from the PHOTO. If the drill is missing a piece that is visible in the photo, add it exactly where the photo shows it. If your earlier count was wrong, correct the counts instead — NEVER invent a piece, colour, or label that is not visible in the photo just to satisfy a number. Output corrected ```json and ```drill blocks in full (image-pixel coordinates).",
    });
    const raw2 = await callClaude(apiKey, messages, signal);
    messages.push({ role: "assistant", content: raw2 });
    try {
      const fixed = toRinkDsl(raw2);
      if (fixed.drill) best = fixed;
    } catch { /* keep the pre-reconcile result */ }
  }

  // visual verify: show the model our rendering next to its memory of the
  // photo; side-by-side comparison catches what absolute mapping missed
  try {
    onStatus?.("Double-checking against the photo…");
    const render = await renderDsl(best.dsl);
    messages.push({
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: render } },
        { type: "text", text: "This is your transcription rendered on the DrillBoard rink (your pixel coordinates were converted programmatically from your landmark report). Compare it with the original photo and check specifically: (1) every pass/shot connects the SAME two pieces as the photo, in the same order; (2) no route or pass runs off the ice or crosses the rink where the photo shows no such line; (3) each piece sits on/off the same landmark (dot, circle edge, crease) as in the photo; (4) piece counts, kinds, and colours match; (5) exactly ONE puck is in play (on the first passer) and there is no MARK ink other than shaded-zone outlines — any arrow drawn as ink must be rewritten as pass=/shoot=/PATH; (6) COUNT the players in the photo and in the rendering — the numbers must match (the goalie is part of the net, not a player), and every hop of the passing chain must have its receiver present on the ice. If anything is misplaced, missing, or wrong, output corrected ```json and ```drill blocks in full — still in ORIGINAL PHOTO pixel coordinates. If it is faithful, reply with exactly OK." },
      ],
    });
    const check = await callClaude(apiKey, messages, signal);
    if (/```drill/i.test(check)) {
      const fixed = toRinkDsl(check);
      if (fixed.drill) best = fixed;
    }
  } catch (err) {
    if (err?.name === "AbortError") throw err;
    // verify is best-effort — a failure here never discards a good result
  }
  return { text: best.dsl, drill: best.drill, errors: best.errors };
}
