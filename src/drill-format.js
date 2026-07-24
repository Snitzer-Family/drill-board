// Drill text format: parser and serializer. See the DSL spec in App header.
import { VIEWS, DSL_VERSION } from "./constants.js";

// A puck-action index may be qualified by the branch route it lives on. On the wire
// the qualifier is the branch colour-path (hex, no #) then '.', e.g. `shoot=2ea043.3`,
// `pass=2ea043.2:F2@e5342b.1`; unqualified = the base route. ('.' not '#', since '#'
// starts a comment.) In memory the ref keeps a # on each part ("#2ea043/#e5342b").
const memToWireRef = m => m ? String(m).split("/").map(h => h.replace(/^#/, "")).join("/") : "";
const wireToMemRef = w => w ? "#" + String(w).split("/").map(h => h.replace(/^#/, "")).join("/#") : null;
const ixRef = (at, ref) => (ref ? memToWireRef(ref) + "." : "") + (at + 1);   // 1-based, optional ref prefix

/* ---------------- inventory ---------------- */

// Canonical inventory rows (a "recipe" of what a drill needs), in display order.
// A goalie is a person, so goalie-flagged nets/tires are counted under `goalie`
// (NOT under net/tire) — the one non-obvious rule. `label`/`mark` are excluded.
export const INV_KINDS = ["player", "goalie", "puck", "cone", "net", "tire", "stick", "bumper", "deker", "passer", "light"];
const INV_LABELS = {
  player: "Players", goalie: "Goalies", puck: "Pucks", cone: "Cones", net: "Nets",
  tire: "Tires", stick: "Sticks", bumper: "Bumpers", deker: "Deker gates", passer: "Rebounders", light: "Lights",
};

// Merge auto-counted pieces with stored ITEM overrides into display rows:
//   { key, label, custom, autoCount, count, hide }
// autoCount is the count on the ice; count is what's shown (an override or the
// auto count); hide drops the row from the printed table only.
export function deriveInventory(pieces, items = []) {
  const isGoalie = p => (p.kind === "net" || p.kind === "tire") && p.goalie;
  const auto = {};
  (pieces || []).forEach(p => {
    if (p.kind === "label" || p.kind === "mark") return;
    const k = isGoalie(p) ? "goalie" : p.kind;
    if (!INV_KINDS.includes(k)) return;
    auto[k] = (auto[k] || 0) + 1;
  });
  const ov = k => (items || []).find(it => !it.custom && it.key === k);
  const rows = INV_KINDS.filter(k => auto[k] || ov(k)).map(k => {
    const o = ov(k) || {};
    return { key: k, label: o.label || INV_LABELS[k], custom: false,
      autoCount: auto[k] || 0, count: o.count != null ? o.count : (auto[k] || 0), hide: !!o.hide };
  });
  // label is the raw user text (may be empty while editing — the `key` is the
  // internal id, NEVER shown as a fallback, so clearing the field stays cleared)
  const custom = (items || []).filter(it => it.custom).map(it => ({
    key: it.key, label: it.label || "", custom: true,
    autoCount: null, count: it.count != null ? it.count : 0, hide: !!it.hide }));
  return [...rows, ...custom];
}

/* ---------------- text format ---------------- */

// Pull the drill DSL out of a markdown ```drill fenced block, so a drill pasted
// from a note or webpage round-trips. Returns the text unchanged if no fence.
export function extractDrill(text) {
  const m = /```drill[^\n]*\r?\n([\s\S]*?)```/i.exec(text);
  return m ? m[1].replace(/\s+$/, "") : text;
}

// parse a run of PATH/FORK route tokens (starting at tok[j]) into a segment array.
// Shared by PATH (base routes) and FORK (light-reaction continuations).
function parseSegments(tok, j, unq) {
  const segs = [];
  let mode = "carry", dir = "fwd", stop = 0, rate = 1, name = null, waitOn = null, jump = false, join = null, endStop = false;
  let dsc = null, dmode = null, dsize = null, dox = null, doy = null;
  const num = () => { const v = parseFloat(tok[j++]); if (isNaN(v)) throw new Error("bad number in PATH"); return v; };
  const push = seg => {
    segs.push({ ...seg, mode, dir, stop, rate, ...(name ? { name } : {}), ...(waitOn ? { waitOn } : {}), ...(jump ? { jump: true } : {}),
      ...(join ? { join } : {}), ...(endStop ? { endStop: true } : {}), ...(dsc ? { desc: dsc } : {}), ...(dmode ? { dmode } : {}), ...(dsize != null ? { dsize } : {}),
      ...(dox != null ? { dox, doy } : {}) });
    mode = "carry"; dir = "fwd"; stop = 0; rate = 1; name = null; waitOn = null; jump = false; join = null; endStop = false;
    dsc = null; dmode = null; dsize = null; dox = null; doy = null;
  };
  while (j < tok.length) {
    const t = tok[j++].toUpperCase();
    if (t === "CARRY" || t === "PASS" || t === "SHOT") { mode = t.toLowerCase(); continue; }
    if (t === "FWD" || t === "BWD") { dir = t.toLowerCase(); continue; }
    if (t === "STOP") { stop = num(); continue; }
    if (t === "JUMP") { jump = true; continue; }
    if (t === "JOIN") { const v = (tok[j++] || "").toLowerCase(); join = (v === "smooth" || v === "sym") ? v : null; continue; }
    if (t === "ENDSTOP") { endStop = true; continue; }
    if (t === "WAIT") { const on = tok[j++]; const at = parseInt(tok[j++], 10); waitOn = { on, at: (isNaN(at) ? 1 : at) - 1, mode: "waypoint" }; continue; }
    // WACT <player> <pt> — pause until that player releases the puck at <pt> (0 = any action)
    if (t === "WACT") { const on = tok[j++]; const at = parseInt(tok[j++], 10); waitOn = { on, at: (isNaN(at) || at === 0) ? null : at - 1, mode: "action" }; continue; }
    if (t === "RATE") { rate = Math.max(0.1, num()); continue; }
    if (t === "NAME") { name = (tok[j++] || "").replace(/_/g, " ").trim() || null; continue; }
    if (t === "DESC") { dsc = unq(tok[j++]) || null; continue; }        // "free text" description
    if (t === "SHOW") { const m = (tok[j++] || "").toLowerCase(); dmode = ["auto", "preso", "label"].includes(m) ? m : null; continue; }
    if (t === "SIZE") { dsize = Math.max(0.2, num()); continue; }
    if (t === "OFF") { dox = num(); doy = num(); continue; }            // label offset from the waypoint
    if (t === "L") push({ type: "L", x: num(), y: num() });
    else if (t === "Q") push({ type: "Q", cx: num(), cy: num(), x: num(), y: num() });
    else if (t === "C") push({ type: "C", c1x: num(), c1y: num(), c2x: num(), c2y: num(), x: num(), y: num() });
    else throw new Error(`unknown token "${t}" (use L Q C, PASS SHOT CARRY, FWD BWD, STOP n, RATE n)`);
  }
  return segs;
}

export function parseDrill(text) {
  const pieces = [];
  const byId = {};
  let rink = "full";
  let title = "", desc = "";
  // presentation steps: authored narration beats, each anchored to an absolute
  // time (at=) or a player's waypoint activation (on=<id>:<pt>). See serializeDrill.
  const steps = [];
  // the DSL schema version the drill declares (a `DSL <n>` header). Absent → treat
  // as the current version (no back-compat gating yet); a reader may branch on it.
  let dslVersion = DSL_VERSION;
  // coaching writeup: a multi-line markdown NOTES … END NOTES block, captured
  // verbatim (see serializeDrill). `items` holds inventory overrides / custom
  // gear rows; auto counts derive from the pieces at render time.
  let notes = null, capturingNotes = false;
  const noteBuf = [];
  const items = [];
  const errors = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    // NOTES block capture mode: pipe-prefixed body lines are taken verbatim
    // (no comment-strip / tokenize) until a bare `END NOTES`. The `| ` prefix on
    // every body line means a coach's own `END NOTES` line can never terminate it.
    if (capturingNotes) {
      if (raw.trim() === "END NOTES") { notes = noteBuf.join("\n"); capturingNotes = false; }
      else { const m = /^\|( (.*))?$/.exec(raw); noteBuf.push(m ? (m[2] || "") : raw); }
      return;
    }
    if (/^\s*NOTES\s*$/.test(raw)) { capturingNotes = true; noteBuf.length = 0; return; }
    // TITLE/DESC take the whole rest of the line (may contain spaces or #)
    const meta = /^\s*(title|desc)\b\s*(.*)$/i.exec(raw);
    if (meta) { if (meta[1].toLowerCase() === "title") title = meta[2].trim(); else desc = meta[2].trim(); return; }
    // pull "quoted strings" out first (label / description text) so their spaces,
    // commas and #s survive comment-stripping and tokenizing; restore via unq()
    const quotes = [];
    const protectedRaw = raw.replace(/"([^"]*)"/g, (_, s) => `${quotes.push(s.trim()) - 1}`);
    const line = protectedRaw.replace(/#(?!([0-9a-fA-F]{3}){1,2}\b).*$/, "").trim();
    if (!line) return;
    const tok = line.split(/[\s,]+/);
    const unq = t => { const m = /^(\d+)$/.exec(t || ""); return m ? quotes[+m[1]] : t; };
    const quoted = t => /^\d+$/.test(t || "");
    const cmd = tok[0].toUpperCase();
    try {
      if (cmd === "DSL") {
        const n = parseInt(tok[1], 10);
        if (isNaN(n) || n < 1) throw new Error(`DSL needs a version number, got "${tok[1] || ""}"`);
        dslVersion = n;
      } else if (cmd === "RINK") {
        const m = (tok[1] || "").toLowerCase();
        if (!VIEWS[m]) throw new Error(`unknown rink "${tok[1]}"`);
        rink = m;
      } else if (cmd === "PIECE") {
        const [, id, kind, xs, ys, ...rest] = tok;
        const x = parseFloat(xs), y = parseFloat(ys);
        if (!id || !["player", "puck", "cone", "net", "bumper", "deker", "passer", "label", "tire", "stick", "light"].includes(kind) || isNaN(x) || isNaN(y))
          throw new Error("PIECE needs: id kind x y");
        let color = kind === "cone" ? "#e0731d" : kind === "puck" ? "#14171a" : kind === "net" ? "#c81e33"
          : kind === "bumper" ? "#1b1e22" : kind === "deker" ? "#c79a4e" : kind === "passer" ? "#57636f"
          : kind === "label" ? "#14202b" : kind === "tire" ? "#1c1c1e" : kind === "stick" ? "#20242a" : kind === "light" ? "#2ea043" : "#d7263d";
        let label = kind === "player" ? id : "";
        let text = "", size = 1;                          // label piece: text + font scale
        let speed = 1, hand = "R", carrier = null, facing = 0, shotAt = null, pickup = null, rimAt = null, chipAt = null, chipAim = null, rimAim = null, chipDist = null, rimDist = null, shotRef = null, rimRef = null, chipRef = null;
        const xterms = [];                                      // overflow same-kind branch terminals
        let net = null, holdLine = false, goalie = false, defense = false, wait = null, group = null, crease = false;
        let cues = [], rand = true, lmode = null, alwaysColor = null;   // light: cue timeline + route mode
        let lightId = null;                               // player: designated reaction light to read (else nearest)
        const transfers = [];
        rest.forEach(r => {
          if (quoted(r)) { text = unq(r); }              // a "quoted string" → label text
          else if (r.startsWith("#")) color = r;
          else if (r.includes("=")) {
            const [k, v] = r.split("=");
            const key = k.toLowerCase();
            if (key === "speed") {
              const n = parseFloat(v);
              if (!isNaN(n) && n > 0) speed = n;
            } else if (key === "size") {
              const n = parseFloat(v);
              if (!isNaN(n) && n > 0) size = n;
            } else if (key === "hand") hand = v.toUpperCase() === "L" ? "L" : "R";
            else if (key === "on") carrier = v;
            else if (key === "pass") {
              // pass=[<ref>.]<pt>:<to>[@[<ref>.]<recvPt>][^<passer>][!] — an optional
              // <ref># qualifies a release/reception on a branch route; a ^passer makes
              // it a give-and-go; a trailing ! is a sauce (raised) pass
              const m2 = /^(?:([0-9a-fA-F/]+)\.)?(\d+):([^@\s^!]+)(?:@(?:([0-9a-fA-F/]+)\.)?(\d+))?(?:\^([^!\s]+))?(!)?$/.exec(v);
              if (m2) transfers.push({ at: parseInt(m2[2], 10) - 1, to: m2[3],
                recvAt: m2[4] || m2[5] ? parseInt(m2[5], 10) - 1 : null, kind: "pass",
                ...(m2[1] ? { atRef: wireToMemRef(m2[1]) } : {}), ...(m2[4] ? { recvRef: wireToMemRef(m2[4]) } : {}),
                ...(m2[6] ? { via: m2[6] } : {}), ...(m2[7] ? { sauce: true } : {}) });
            } else if (key === "rebound") {
              // shot whose carom is collected by a player: shoot at <pt>, they
              // gather at their @<pt> (else route end / where they stand)
              // rebound=[<ref>.]<pt>:<to>[@[<ref>.]<recvPt>][>net] — >net gives this rebound its own target
              const m4 = /^(?:([0-9a-fA-F/]+)\.)?(\d+):([^@\s>]+)(?:@(?:([0-9a-fA-F/]+)\.)?(\d+))?(?:>(\S+))?$/.exec(v);
              if (m4) transfers.push({ at: parseInt(m4[2], 10) - 1, to: m4[3],
                recvAt: m4[4] || m4[5] ? parseInt(m4[5], 10) - 1 : null, kind: "shot",
                ...(m4[1] ? { atRef: wireToMemRef(m4[1]) } : {}), ...(m4[4] ? { recvRef: wireToMemRef(m4[4]) } : {}),
                ...(m4[6] ? { net: m4[6] } : {}) });
            } else if (key === "shoot") {
              // shoot=[<ref>.]<pt>[>net] — a terminal shot; a second same-kind terminal
              // on another branch overflows into xterms[] (the first fills the scalar)
              const ms = /^(?:([0-9a-fA-F/]+)\.)?(\d+)(?:>(\S+))?$/.exec(v);
              if (ms) {
                const at = parseInt(ms[2], 10) - 1, ref = ms[1] ? wireToMemRef(ms[1]) : null;
                if (shotAt == null) { shotAt = at; shotRef = ref; if (ms[3]) net = ms[3]; }
                else xterms.push({ kind: "shot", at, ref: ref || "", ...(ms[3] ? { net: ms[3] } : {}) });
              }
            } else if (key === "rim" || key === "chip") {
              // rim=[<ref>.]<pt> / chip=… is a terminal release into space; a handle
              // sets its direction (~<deg>) and distance (*<ft>). The player-handoff
              // form rim=[<ref>.]<pt>:<player>[@[<ref>.]<pt>] carries to a collector instead.
              const m5 = /^(?:([0-9a-fA-F/]+)\.)?(\d+)(?::([^@\s~*]+)(?:@(?:([0-9a-fA-F/]+)\.)?(\d+))?)?(?:~(-?\d+(?:\.\d+)?))?(?:\*(\d+(?:\.\d+)?))?$/.exec(v);
              if (m5) {
                const aim = m5[6] != null ? parseFloat(m5[6]) : null;
                const dist = m5[7] != null ? parseFloat(m5[7]) : null;
                const at = parseInt(m5[2], 10) - 1, ref = m5[1] ? wireToMemRef(m5[1]) : null;
                if (m5[3]) transfers.push({ at, to: m5[3],
                  recvAt: m5[4] || m5[5] ? parseInt(m5[5], 10) - 1 : null, kind: key,
                  ...(ref ? { atRef: ref } : {}), ...(m5[4] ? { recvRef: wireToMemRef(m5[4]) } : {}), ...(aim != null ? { aim } : {}) });
                else if (key === "rim") { if (rimAt == null) { rimAt = at; rimAim = aim; rimDist = dist; rimRef = ref; } else xterms.push({ kind: "rim", at, ref: ref || "", aim, dist }); }
                else { if (chipAt == null) { chipAt = at; chipAim = aim; chipDist = dist; chipRef = ref; } else xterms.push({ kind: "chip", at, ref: ref || "", aim, dist }); }
              }
            } else if (key === "pickup") {
              // pickup=<player>@[<ref>.]<pt>[*] — trailing * = a live "nearest loose puck"
              // collect that re-resolves at play time instead of a fixed puck
              const m3 = /^([^@\s]+)@(?:([0-9a-fA-F/]+)\.)?(\d+)(\*)?$/.exec(v);
              if (m3) pickup = { to: m3[1], at: parseInt(m3[3], 10) - 1, ...(m3[2] ? { atRef: wireToMemRef(m3[2]) } : {}), ...(m3[4] ? { nearest: true } : {}) };
            } else if (key === "net") {
              net = v;                                   // a net piece id (or left/right for legacy)
            } else if (key === "hold") {
              if (v.toLowerCase() === "line") holdLine = true;
            } else if (key === "wait" || key === "act") {
              // wait=<player>[@<pt>] — hold until that player REACHES point <pt>.
              // act=<player>[@<pt>] — hold until that player RELEASES the puck
              // (pass/chip/rim/shot) at <pt>; no @<pt> = at any of their actions.
              const mw = /^([^@\s]+)(?:@(\d+))?$/.exec(v);
              if (mw) wait = { on: mw[1], mode: key === "act" ? "action" : "waypoint",
                at: mw[2] ? parseInt(mw[2], 10) - 1 : (key === "act" ? null : 0) };
            } else if (key === "face") {
              const n = parseFloat(v);
              if (!isNaN(n)) facing = n;
            } else if (key === "cues") {
              // cues=<hex>:<dur>;<hex>:<dur>… — a light's colour timeline. Hex has
              // no leading # (commas/# are stripped by tokenizing), so ; separates.
              v.split(";").forEach(seg => {
                const m6 = /^([0-9a-fA-F]{3,6}):(\d+(?:\.\d+)?)$/.exec(seg);
                if (m6) cues.push({ color: "#" + m6[1], dur: parseFloat(m6[2]) });
              });
            } else if (key === "rand") { rand = !/^(off|0|false|no)$/i.test(v); }   // legacy: reactive on/off → mode
            else if (key === "mode") {
              // light route mode: reactive (default) | sequence | random | always[:<hex>]
              // — how a "read the light" fork chooses its route. always:<hex> designates
              // the one cue colour whose route always runs.
              const [mm, hex] = v.split(":");
              const mk = (mm || "").toLowerCase();
              if (["reactive", "sequence", "random", "always"].includes(mk)) lmode = mk;
              if (hex && /^[0-9a-fA-F]{3,6}$/.test(hex)) alwaysColor = "#" + hex;
            } else if (key === "always") { if (/^#?[0-9a-fA-F]{3,6}$/.test(v)) alwaysColor = "#" + v.replace(/^#/, ""); }
            else if (key === "light") lightId = v;         // player: designated reaction light to read
            else if (key === "group") group = v.replace(/_/g, " ").trim() || null;   // named group membership
          } else if (r === "goalie") goalie = true;
          else if (r === "crease") crease = true;
          else if (r === "defense") defense = true;
          else label = r;
        });
        const mode = lmode || (rand === false ? "sequence" : "reactive");   // legacy rand=off → sequence
        const p = { id, kind, x, y, color, label, text, size, speed, hand, carrier, facing, transfers, shotAt, pickup, rimAt, chipAt, chipAim, rimAim, chipDist, rimDist, ...(shotRef ? { shotRef } : {}), ...(rimRef ? { rimRef } : {}), ...(chipRef ? { chipRef } : {}), ...(xterms.length ? { xterms } : {}), net, holdLine, goalie, defense, wait, group, crease, cues, mode, alwaysColor, lightId, forks: [], path: [] };
        pieces.push(p); byId[id] = p;
      } else if (cmd === "PATH") {
        const id = tok[1];
        const p = byId[id];
        if (!p) throw new Error(`PATH for unknown piece "${id}"`);
        p.path = parseSegments(tok, 2, unq);
      } else if (cmd === "FORK" || cmd === "BRANCH") {
        // BRANCH <player> <ref> [at=<pt>] [<action>[:target]] <segments…> — a
        // conditional route continuation ("multiple routes off one waypoint").
        // `ref` is a slash-path of cue colours (hex, no leading #): "green" is a
        // top-level branch, "green/red" the red branch chained off the green (skate)
        // one. Optional `at=<pt>` (1-based) is the parent waypoint the branch departs
        // from (default = parent route end). An optional action says what the player
        // does at its end: skate (default) / shoot[:net] / chip / rim / pass:to.
        // FORK is the legacy keyword — read identically so old drills still load.
        const id = tok[1], col = tok[2];
        const p = byId[id];
        if (!p) throw new Error(`${cmd} for unknown piece "${id}"`);
        const refParts = String(col || "").split("/");
        if (!refParts.every(h => /^[0-9a-fA-F]{3,6}$/.test(h))) throw new Error(`${cmd} needs: id colour[/colour…] segments`);
        let j = 3, action = "skate", net = null, to = null, at = null, cond = null;
        const atm = /^at=(\d+)$/i.exec(tok[j] || "");
        if (atm) { at = parseInt(atm[1], 10) - 1; j++; }
        // optional selection condition (default = light cue matching the ref colour):
        // rand[=weight] · seq=<n> · always · if=<hex> (explicit light cue colour)
        let cm; const ct = tok[j] || "";
        if (/^rand(=[\d.]+)?$/i.test(ct)) { cond = { type: "random", ...(ct.includes("=") ? { weight: parseFloat(ct.split("=")[1]) } : {}) }; j++; }
        else if ((cm = /^seq=(\d+)$/i.exec(ct))) { cond = { type: "sequence", ord: parseInt(cm[1], 10) }; j++; }
        else if (/^always$/i.test(ct)) { cond = { type: "always" }; j++; }
        else if ((cm = /^if=([0-9a-fA-F]{3,6})$/i.exec(ct))) { cond = { type: "light", color: "#" + cm[1] }; j++; }
        const am = /^(skate|shoot|chip|rim|pass)(?::(\S+))?$/i.exec(tok[j] || "");
        if (am) { action = am[1].toLowerCase(); if (action === "shoot") net = am[2] || null; else if (action === "pass") to = am[2] || null; j++; }
        // navigate/create the parent chain (parents are emitted before children), add leaf
        let list = (p.forks = p.forks || []);
        for (let k = 0; k < refParts.length - 1; k++) {
          const c = "#" + refParts[k];
          let node = list.find(f => f.color.toLowerCase() === c.toLowerCase());
          if (!node) { node = { color: c, action: "skate", forks: [], path: [] }; list.push(node); }
          list = (node.forks = node.forks || []);
        }
        list.push({ color: "#" + refParts[refParts.length - 1], action,
          ...(net ? { net } : {}), ...(to ? { to } : {}), ...(at != null ? { at } : {}),
          ...(cond ? { cond } : {}), forks: [], path: parseSegments(tok, j, unq) });
      } else if (cmd === "MARK") {
        // MARK <id> <color> <width> <style> x1,y1 x2,y2 ...  (a freehand ink annotation)
        const mid = tok[1], mcol = tok[2] || "#ffd447", mw = parseFloat(tok[3]) || 1.1, mst = (tok[4] || "solid").toLowerCase();
        const nums = tok.slice(5).map(Number).filter(n => !isNaN(n));
        const pts = [];
        for (let k = 0; k + 1 < nums.length; k += 2) pts.push({ x: nums[k], y: nums[k + 1] });
        if (mid && pts.length >= 2) {
          const m = { id: mid, kind: "mark", color: mcol, width: mw, style: ["dashed", "dotted", "wavy"].includes(mst) ? mst : "solid", x: pts[0].x, y: pts[0].y, pts, path: [] };
          pieces.push(m); byId[mid] = m;
        }
      } else if (cmd === "STEP") {
        // STEP at=<seconds> "text"   OR   STEP on=<pieceId>:<pt> "text"
        // waypoint number is 1-based on the wire, stored 0-based as wp. Optional
        // pos=<x>:<y> is the caption's saved spot in RINK FEET (x 0..200, y 0..85),
        // so it holds the same ice area across portrait/landscape.
        let at = null, on = null, txt = "", pos = null;
        const clampX = n => Math.max(0, Math.min(200, n)), clampY = n => Math.max(0, Math.min(85, n));
        tok.slice(1).forEach(r => {
          if (quoted(r)) txt = unq(r);
          else if (/^at=/i.test(r)) { const n = parseFloat(r.slice(3)); if (!isNaN(n)) at = Math.max(0, n); }
          else if (/^on=/i.test(r)) { const m = /^([^:]+):(\d+)$/.exec(r.slice(3)); if (m) on = { piece: m[1], wp: parseInt(m[2], 10) - 1 }; }
          else if (/^pos=/i.test(r)) { const m = /^(-?\d*\.?\d+):(-?\d*\.?\d+)$/.exec(r.slice(4)); if (m) pos = { x: clampX(parseFloat(m[1])), y: clampY(parseFloat(m[2])) }; }
        });
        const anchor = on ? { on } : at != null ? { at } : null;
        if (anchor) steps.push({ text: txt, ...anchor, ...(pos ? { pos } : {}) });
      } else if (cmd === "ITEM") {
        // ITEM <key> [count=<n>] [hide] ["Label"] — an inventory row. A canonical
        // <key> overrides/hides its auto-derived row; any other key is a custom
        // off-ice gear row (whistles, pinnies, water) carrying its own label.
        const key = tok[1];
        let count = null, hide = false, label = "";
        tok.slice(2).forEach(r => {
          if (quoted(r)) label = unq(r);
          else if (/^count=/i.test(r)) { const n = parseInt(r.slice(6), 10); if (!isNaN(n) && n >= 0) count = n; }
          else if (r.toLowerCase() === "hide") hide = true;
        });
        if (key) items.push({ key, ...(count != null ? { count } : {}), ...(hide ? { hide: true } : {}),
          ...(label ? { label } : {}), ...(INV_KINDS.includes(key) ? {} : { custom: true }) });
      } else throw new Error(`unknown command "${tok[0]}"`);
    } catch (e) { errors.push(`line ${i + 1}: ${e.message}`); }
  });
  if (capturingNotes) notes = noteBuf.join("\n");   // unterminated NOTES: flush what we have
  return { rink, pieces, errors, title, desc, dslVersion, steps, notes: notes || "", items };
}

const f1 = n => (Math.round(n * 10) / 10).toString();
const f2 = n => (Math.round(n * 100) / 100).toString();

const qesc = t => `"${String(t).replace(/"/g, "")}"`;   // label/description text as a quoted string

function segToStr(s) {
  let pre = "";
  if (s.name) pre += `NAME ${String(s.name).trim().replace(/\s+/g, "_")} `;
  if (s.desc) {
    pre += `DESC ${qesc(s.desc)} `;
    if (s.dmode && s.dmode !== "auto") pre += `SHOW ${s.dmode} `;
    if (s.dmode === "label") {
      if (s.dsize && s.dsize !== 1) pre += `SIZE ${f2(s.dsize)} `;
      pre += `OFF ${f1(s.dox || 0)},${f1(s.doy != null ? s.doy : -5)} `;
    }
  }
  if (s.stop > 0) pre += `STOP ${f1(s.stop)} `;
  if (s.jump) pre += "JUMP ";
  if (s.join === "smooth" || s.join === "sym") pre += `JOIN ${s.join} `;
  if (s.endStop) pre += "ENDSTOP ";
  if (s.waitOn && s.waitOn.on) pre += s.waitOn.mode === "action"
    ? `WACT ${s.waitOn.on} ${s.waitOn.at != null ? s.waitOn.at + 1 : 0} `
    : `WAIT ${s.waitOn.on} ${(s.waitOn.at ?? 0) + 1} `;
  if (s.rate && s.rate !== 1) pre += `RATE ${f2(s.rate)} `;
  if (s.dir === "bwd") pre += "BWD ";
  if (s.mode && s.mode !== "carry") pre += s.mode.toUpperCase() + " ";
  if (s.type === "L") return `${pre}L ${f1(s.x)},${f1(s.y)}`;
  if (s.type === "Q") return `${pre}Q ${f1(s.cx)},${f1(s.cy)} ${f1(s.x)},${f1(s.y)}`;
  return `${pre}C ${f1(s.c1x)},${f1(s.c1y)} ${f1(s.c2x)},${f1(s.c2y)} ${f1(s.x)},${f1(s.y)}`;
}

export function serializeDrill(rink, pieces, title = "", desc = "", steps = [], notes = "", items = []) {
  // stamp the schema version that wrote this text (first line, so a reader can
  // branch before parsing the body). Always the current DSL_VERSION on save.
  const out = [`DSL ${DSL_VERSION}`, `RINK ${rink}`];
  if (title && title.trim()) out.push(`TITLE ${title.trim()}`);
  if (desc && desc.trim()) out.push(`DESC ${desc.trim()}`);
  // coaching writeup: pipe-prefix every body line so nothing in the markdown
  // (blank lines, a literal `END NOTES`) can collide with the terminator.
  if (notes && notes.trim()) {
    out.push("NOTES");
    notes.replace(/\r\n?/g, "\n").split("\n").forEach(l => out.push(l === "" ? "|" : "| " + l));
    out.push("END NOTES");
  }
  out.push("");
  pieces.forEach(p => {
    if (p.kind === "label") {
      const sz = p.size && p.size !== 1 ? ` size=${f2(p.size)}` : "";
      out.push(`PIECE ${p.id} label ${f1(p.x)} ${f1(p.y)} ${p.color}${sz} ${qesc(p.text || "")}`);
      return;
    }
    if (p.kind === "mark") {
      out.push(`MARK ${p.id} ${p.color} ${f2(p.width || 1.1)} ${p.style || "solid"} ${(p.pts || []).map(q => `${f1(q.x)},${f1(q.y)}`).join(" ")}`);
      return;
    }
    const lbl = p.label ? " " + String(p.label).replace(/[\s,]+/g, "_") : "";
    const spd = p.speed && p.speed !== 1 ? ` speed=${f2(p.speed)}` : "";
    const hnd = p.kind === "player" && p.hand === "L" ? " hand=L" : "";
    const car = p.kind === "puck" && p.carrier ? ` on=${p.carrier}` : "";
    const gp = p.kind === "puck" && !p.carrier && p.pickup ? ` pickup=${p.pickup.to}@${ixRef(p.pickup.at, p.pickup.atRef)}${p.pickup.nearest ? "*" : ""}` : "";
    // chain transfers in order: pass= passes, rebound= shot handoffs, rim=/chip= board plays.
    // Only the VALID prefix is saved: an impossible step (an actor that never has
    // the puck) and everything after it is dropped, and the intended-actor tags
    // (`by` / `termBy`) are editor-only, not part of the DSL.
    const kw = t => t.kind === "shot" ? "rebound" : t.kind === "rim" ? "rim" : t.kind === "chip" ? "chip" : "pass";
    let vts = [], lastCarrier = (p.carrier || (p.pickup && p.pickup.to)) || null;
    if (p.kind === "puck") for (const t of (p.transfers || [])) { if (t.by && t.by !== lastCarrier) break; vts.push(t); lastCarrier = t.to; }
    const head = p.kind === "puck" && (p.carrier || p.pickup);
    const pas = head && vts.length
      ? vts.map(t => ` ${kw(t)}=${ixRef(t.at, t.atRef)}:${t.to}${t.recvAt != null ? "@" + ixRef(t.recvAt, t.recvRef) : ""}${t.via ? "^" + t.via : ""}${t.sauce ? "!" : ""}${t.kind === "shot" && t.net ? ">" + t.net : ""}${(t.kind === "chip" || t.kind === "rim") && t.aim != null ? "~" + f1(t.aim) : ""}`).join("")
      : "";
    const termOk = !p.termBy || p.termBy === lastCarrier;
    const sht = head && termOk && p.shotAt != null ? ` shoot=${ixRef(p.shotAt, p.shotRef)}` : "";
    const rmT = head && termOk && p.rimAt != null ? ` rim=${ixRef(p.rimAt, p.rimRef)}${p.rimAim != null ? "~" + f1(p.rimAim) : ""}${p.rimDist != null ? "*" + f1(p.rimDist) : ""}` : "";
    const chT = head && termOk && p.chipAt != null ? ` chip=${ixRef(p.chipAt, p.chipRef)}${p.chipAim != null ? "~" + f1(p.chipAim) : ""}${p.chipDist != null ? "*" + f1(p.chipDist) : ""}` : "";
    // overflow same-kind branch terminals (each its own token; shots carry their own >net)
    const xts = head && termOk && (p.xterms || []).length
      ? (p.xterms || []).map(t => t.kind === "shot" ? ` shoot=${ixRef(t.at, t.ref)}${t.net ? ">" + t.net : ""}`
          : ` ${t.kind}=${ixRef(t.at, t.ref)}${t.aim != null ? "~" + f1(t.aim) : ""}${t.dist != null ? "*" + f1(t.dist) : ""}`).join("")
      : "";
    const hasShot = p.kind === "puck" && ((termOk && p.shotAt != null) || vts.some(t => t.kind === "shot"));
    const nt = hasShot && p.net ? ` net=${p.net}` : "";
    const rotatable = p.kind === "net" || p.kind === "bumper" || p.kind === "deker" || p.kind === "passer" || p.kind === "stick" || p.kind === "light" || (p.kind === "player" && !p.path.length);
    const fac = rotatable && p.facing ? ` face=${f1(p.facing)}` : "";
    const hld = p.kind === "player" && p.holdLine ? " hold=line" : "";
    const wt = p.kind === "player" && p.wait && p.wait.on
      ? (p.wait.mode === "action"
          ? ` act=${p.wait.on}${p.wait.at != null ? "@" + (p.wait.at + 1) : ""}`
          : ` wait=${p.wait.on}@${(p.wait.at ?? 0) + 1}`)
      : "";
    const gl = (p.kind === "net" || p.kind === "tire") && p.goalie ? " goalie" : "";
    const crs = p.kind === "net" && p.crease ? " crease" : "";
    const df = p.kind === "player" && p.defense ? " defense" : "";
    const siz = (p.kind === "net" || p.kind === "tire") && p.size && p.size !== 1 ? ` size=${f2(p.size)}` : "";
    const grp = p.group ? ` group=${String(p.group).trim().replace(/\s+/g, "_")}` : "";
    // player: the reaction light it's designated to read (else nearest is used)
    const lgt = p.kind === "player" && p.lightId ? ` light=${p.lightId}` : "";
    const cue = p.kind === "light" && (p.cues || []).length
      ? ` cues=${p.cues.map(c => `${String(c.color || "").replace("#", "")}:${f1(c.dur || 0)}`).join(";")}` : "";
    // lights are reactive (shuffle + loop) by default; note any other route mode.
    // always:<hex> carries the designated cue colour whose route always runs.
    const lm = p.kind === "light" ? (p.mode || (p.rand === false ? "sequence" : "reactive")) : null;
    const rnd = lm && lm !== "reactive"
      ? (lm === "always"
          ? ` mode=always${p.alwaysColor || (p.cues && p.cues[0] && p.cues[0].color) ? ":" + String(p.alwaysColor || p.cues[0].color).replace("#", "") : ""}`
          : ` mode=${lm}`)
      : "";
    out.push(`PIECE ${p.id} ${p.kind} ${f1(p.x)} ${f1(p.y)} ${p.color}${lbl}${hnd}${car}${gp}${pas}${sht}${rmT}${chT}${xts}${nt}${hld}${wt}${fac}${gl}${crs}${df}${siz}${grp}${lgt}${cue}${rnd}${spd}`);
    if (p.path.length) out.push(`PATH ${p.id} ${p.path.map(segToStr).join(" ")}`);
    // route branches (players): one conditional continuation per cue colour, with
    // the action the player performs at its end (skate default → omitted). Branches
    // nest — a skate branch can chain another — so the colour ref is a slash-path
    // (parent/child) and the whole tree is emitted, parents before children. An
    // `at=<pt>` records a branch that departs before the parent route's end.
    const emitBranches = (branches, prefix) => (branches || []).forEach(f => {
      if (!f.path || !f.path.length) return;
      const ref = (prefix ? prefix + "/" : "") + String(f.color || "").replace("#", "");
      const at = typeof f.at === "number" ? ` at=${f.at + 1}` : "";
      // selection condition — omit for a plain light cue matching the ref colour (the
      // default), so legacy reaction branches round-trip unchanged
      const c = f.cond;
      const hex = s => String(s || "").replace("#", "").toLowerCase();
      const cond = !c ? ""
        : c.type === "random" ? ` rand${c.weight != null && c.weight !== 1 ? "=" + c.weight : ""}`
        : c.type === "sequence" ? ` seq=${c.ord ?? 0}`
        : c.type === "always" ? " always"
        : (c.type === "light" && hex(c.color) && hex(c.color) !== hex(f.color)) ? ` if=${hex(c.color)}`
        : "";
      const act = f.action && f.action !== "skate"
        ? " " + f.action + (f.action === "shoot" && f.net ? ":" + f.net : f.action === "pass" && f.to ? ":" + f.to : "")
        : "";
      out.push(`BRANCH ${p.id} ${ref}${at}${cond}${act} ${f.path.map(segToStr).join(" ")}`);
      emitBranches(f.forks, ref);
    });
    emitBranches(p.forks, "");
  });
  // presentation steps (authored narration), each anchored to a time or a waypoint
  (steps || []).forEach(s => {
    const anchor = s.on ? `on=${s.on.piece}:${s.on.wp + 1}` : `at=${f2(s.at || 0)}`;
    const pos = s.pos ? ` pos=${f1(s.pos.x)}:${f1(s.pos.y)}` : "";
    out.push(`STEP ${anchor}${pos} ${qesc(s.text || "")}`);
  });
  // inventory: only rows the coach touched (overrides / hides / custom gear) are
  // written; a pristine drill emits none and the table stays fully auto-derived.
  (items || []).forEach(it => {
    const parts = [`ITEM ${it.key}`];
    if (it.count != null) parts.push(`count=${it.count}`);
    if (it.hide) parts.push("hide");
    if (it.label) parts.push(qesc(it.label));
    out.push(parts.join(" "));
  });
  return out.join("\n") + "\n";
}

