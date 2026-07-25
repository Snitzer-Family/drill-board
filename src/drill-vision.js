// Image → drill DSL via the Claude API (vision), called directly from the
// browser with plain fetch — the app stays static and dependency-free. The
// user's API key lives in localStorage on their own device; use a spend-capped
// key. Framework-free like drill-format.js.

import DSL_REF from "../docs/drill-dsl.md?raw";
import { parseDrill, extractDrill } from "./drill-format.js";

export const ANTHROPIC_KEY_STORE = "drillboard:anthropic-key";

const API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-4-8";

const SYSTEM_PROMPT = `You transcribe photographed hockey drill diagrams (drill-book pages, whiteboards, hand sketches) into the DrillBoard drill DSL. The full DSL reference follows; obey it exactly.

${DSL_REF}

Transcription rules:
- Coordinates are real rink feet: x 0–200 (goal line to goal line is 17–183), y 0–85. Goal lines are at x=17 and x=183; nets sit on them at y=42.5. Blue lines are at x=75 and x=125, center ice at x=100.
- Choose "RINK full" or "RINK half" to match the diagram (half-ice drills are common in drill books).
- Use PIECE and PATH statements. Prefer simple L and Q segments — capture the drill's shape and flow, not every wiggle.
- Solid lines with arrowheads are skating routes (CARRY when the player has the puck). Dashed lines are passes: put a PASS leg on the route or use pass= on the puck. Heavy/zigzag lines ending at the net are shots: SHOT leg or shoot= on the puck.
- Give players short jersey labels matching the diagram (F1, D2, X, O...). Add cones, nets, and pucks where drawn. Add a goalie net piece with "goalie" if a goalie is shown.
- Use TITLE (and DESC if the page shows text describing the drill).
- Output ONLY one \`\`\`drill fenced code block. No prose before or after it.`;

// Decode, downscale (long edge ≤ maxEdge) and re-encode as JPEG base64.
// Always re-encodes regardless of input type, which also normalizes PNG and
// Safari-decoded HEIC. iOS camera captures arrive as JPEG; Safari transcodes
// HEIC library picks for file inputs — an undecodable file throws.
export async function prepareImage(file, { maxEdge = 1568, quality = 0.8 } = {}) {
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

// Transcribe an image into the DSL, with one repair round-trip if the first
// attempt has parse errors. Returns { text, drill, errors } — drill is the
// parseDrill result on success, null (with errors + raw text) on failure.
export async function drillFromImage({ apiKey, data, mediaType, onStatus, signal }) {
  const messages = [{
    role: "user",
    content: [
      { type: "image", source: { type: "base64", media_type: mediaType, data } },
      { type: "text", text: "Transcribe this hockey drill diagram into the drill DSL. Output only a ```drill fence." },
    ],
  }];
  const raw1 = await callClaude(apiKey, messages, signal);
  let r = parseDrill(extractDrill(raw1));
  if (!r.errors.length) return { text: raw1, drill: r, errors: [] };

  onStatus?.(`Fixing ${r.errors.length} parse error${r.errors.length === 1 ? "" : "s"}…`);
  messages.push({ role: "assistant", content: raw1 });
  messages.push({
    role: "user",
    content: "That drill has parse errors:\n" + r.errors.join("\n") +
      "\n\nOutput the complete corrected drill as a single ```drill fence. Fix only the errors; keep everything else.",
  });
  const raw2 = await callClaude(apiKey, messages, signal);
  r = parseDrill(extractDrill(raw2));
  return r.errors.length
    ? { text: extractDrill(raw2), drill: null, errors: r.errors }
    : { text: raw2, drill: r, errors: [] };
}
