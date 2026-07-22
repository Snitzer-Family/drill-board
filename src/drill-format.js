// Drill text format: parser and serializer. See the DSL spec in App header.
import { VIEWS } from "./constants.js";

/* ---------------- text format ---------------- */

// Pull the drill DSL out of a markdown ```drill fenced block, so a drill pasted
// from a note or webpage round-trips. Returns the text unchanged if no fence.
export function extractDrill(text) {
  const m = /```drill[^\n]*\r?\n([\s\S]*?)```/i.exec(text);
  return m ? m[1].replace(/\s+$/, "") : text;
}

export function parseDrill(text) {
  const pieces = [];
  const byId = {};
  let rink = "full";
  let title = "", desc = "";
  const errors = [];
  text.split(/\r?\n/).forEach((raw, i) => {
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
      if (cmd === "RINK") {
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
        let speed = 1, hand = "R", carrier = null, facing = 0, shotAt = null, pickup = null, rimAt = null, chipAt = null, chipAim = null, rimAim = null, chipDist = null, rimDist = null;
        let net = null, holdLine = false, goalie = false, defense = false, wait = null, group = null, crease = false;
        let cues = [];                                    // light: cue timeline (colour:duration steps)
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
              // pass=<pt>:<to>[@<recvPt>][^<passer>][!] — a ^passer makes it a
              // give-and-go bounced off that passer; a trailing ! is a sauce
              // (raised) pass that arcs over ice obstacles
              const m2 = /^(\d+):([^@\s^!]+)(?:@(\d+))?(?:\^([^!\s]+))?(!)?$/.exec(v);
              if (m2) transfers.push({ at: parseInt(m2[1], 10) - 1, to: m2[2],
                recvAt: m2[3] ? parseInt(m2[3], 10) - 1 : null, kind: "pass",
                ...(m2[4] ? { via: m2[4] } : {}), ...(m2[5] ? { sauce: true } : {}) });
            } else if (key === "rebound") {
              // shot whose carom is collected by a player: shoot at <pt>, they
              // gather at their @<pt> (else route end / where they stand)
              // rebound=<pt>:<to>[@<recvPt>][>net] — >net gives this rebound shot its own target
              const m4 = /^(\d+):([^@\s>]+)(?:@(\d+))?(?:>(\S+))?$/.exec(v);
              if (m4) transfers.push({ at: parseInt(m4[1], 10) - 1, to: m4[2],
                recvAt: m4[3] ? parseInt(m4[3], 10) - 1 : null, kind: "shot",
                ...(m4[4] ? { net: m4[4] } : {}) });
            } else if (key === "shoot") {
              const n = parseInt(v, 10);
              if (!isNaN(n)) shotAt = n - 1;
            } else if (key === "rim" || key === "chip") {
              // rim=<pt> / chip=<pt> is a terminal release into space; a handle
              // sets its direction (~<deg>) and distance (*<ft>). The player-handoff
              // form rim=<pt>:<player>[@<pt>] carries to a collector instead.
              const m5 = /^(\d+)(?::([^@\s~*]+)(?:@(\d+))?)?(?:~(-?\d+(?:\.\d+)?))?(?:\*(\d+(?:\.\d+)?))?$/.exec(v);
              if (m5) {
                const aim = m5[4] != null ? parseFloat(m5[4]) : null;
                const dist = m5[5] != null ? parseFloat(m5[5]) : null;
                if (m5[2]) transfers.push({ at: parseInt(m5[1], 10) - 1, to: m5[2],
                  recvAt: m5[3] ? parseInt(m5[3], 10) - 1 : null, kind: key, ...(aim != null ? { aim } : {}) });
                else if (key === "rim") { rimAt = parseInt(m5[1], 10) - 1; rimAim = aim; rimDist = dist; }
                else { chipAt = parseInt(m5[1], 10) - 1; chipAim = aim; chipDist = dist; }
              }
            } else if (key === "pickup") {
              // pickup=<player>@<pt>[*] — trailing * = a live "nearest loose puck"
              // collect that re-resolves at play time instead of a fixed puck
              const m3 = /^([^@\s]+)@(\d+)(\*)?$/.exec(v);
              if (m3) pickup = { to: m3[1], at: parseInt(m3[2], 10) - 1, ...(m3[3] ? { nearest: true } : {}) };
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
            } else if (key === "group") group = v.replace(/_/g, " ").trim() || null;   // named group membership
          } else if (r === "goalie") goalie = true;
          else if (r === "crease") crease = true;
          else if (r === "defense") defense = true;
          else label = r;
        });
        const p = { id, kind, x, y, color, label, text, size, speed, hand, carrier, facing, transfers, shotAt, pickup, rimAt, chipAt, chipAim, rimAim, chipDist, rimDist, net, holdLine, goalie, defense, wait, group, crease, cues, path: [] };
        pieces.push(p); byId[id] = p;
      } else if (cmd === "PATH") {
        const id = tok[1];
        const p = byId[id];
        if (!p) throw new Error(`PATH for unknown piece "${id}"`);
        let j = 2, mode = "carry", dir = "fwd", stop = 0, rate = 1, name = null, waitOn = null, jump = false;
        let dsc = null, dmode = null, dsize = null, dox = null, doy = null;   // waypoint description/label
        const num = () => { const v = parseFloat(tok[j++]); if (isNaN(v)) throw new Error("bad number in PATH"); return v; };
        const push = seg => {
          p.path.push({ ...seg, mode, dir, stop, rate, ...(name ? { name } : {}), ...(waitOn ? { waitOn } : {}), ...(jump ? { jump: true } : {}),
            ...(dsc ? { desc: dsc } : {}), ...(dmode ? { dmode } : {}), ...(dsize != null ? { dsize } : {}),
            ...(dox != null ? { dox, doy } : {}) });
          mode = "carry"; dir = "fwd"; stop = 0; rate = 1; name = null; waitOn = null; jump = false;
          dsc = null; dmode = null; dsize = null; dox = null; doy = null;
        };
        while (j < tok.length) {
          const t = tok[j++].toUpperCase();
          if (t === "CARRY" || t === "PASS" || t === "SHOT") { mode = t.toLowerCase(); continue; }
          if (t === "FWD" || t === "BWD") { dir = t.toLowerCase(); continue; }
          if (t === "STOP") { stop = num(); continue; }
          if (t === "JUMP") { jump = true; continue; }
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
      } else throw new Error(`unknown command "${tok[0]}"`);
    } catch (e) { errors.push(`line ${i + 1}: ${e.message}`); }
  });
  return { rink, pieces, errors, title, desc };
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

export function serializeDrill(rink, pieces, title = "", desc = "") {
  const out = [`RINK ${rink}`];
  if (title && title.trim()) out.push(`TITLE ${title.trim()}`);
  if (desc && desc.trim()) out.push(`DESC ${desc.trim()}`);
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
    const gp = p.kind === "puck" && !p.carrier && p.pickup ? ` pickup=${p.pickup.to}@${p.pickup.at + 1}${p.pickup.nearest ? "*" : ""}` : "";
    // chain transfers in order: pass= passes, rebound= shot handoffs, rim=/chip= board plays.
    // Only the VALID prefix is saved: an impossible step (an actor that never has
    // the puck) and everything after it is dropped, and the intended-actor tags
    // (`by` / `termBy`) are editor-only, not part of the DSL.
    const kw = t => t.kind === "shot" ? "rebound" : t.kind === "rim" ? "rim" : t.kind === "chip" ? "chip" : "pass";
    let vts = [], lastCarrier = (p.carrier || (p.pickup && p.pickup.to)) || null;
    if (p.kind === "puck") for (const t of (p.transfers || [])) { if (t.by && t.by !== lastCarrier) break; vts.push(t); lastCarrier = t.to; }
    const head = p.kind === "puck" && (p.carrier || p.pickup);
    const pas = head && vts.length
      ? vts.map(t => ` ${kw(t)}=${t.at + 1}:${t.to}${t.recvAt != null ? "@" + (t.recvAt + 1) : ""}${t.via ? "^" + t.via : ""}${t.sauce ? "!" : ""}${t.kind === "shot" && t.net ? ">" + t.net : ""}${(t.kind === "chip" || t.kind === "rim") && t.aim != null ? "~" + f1(t.aim) : ""}`).join("")
      : "";
    const termOk = !p.termBy || p.termBy === lastCarrier;
    const sht = head && termOk && p.shotAt != null ? ` shoot=${p.shotAt + 1}` : "";
    const rmT = head && termOk && p.rimAt != null ? ` rim=${p.rimAt + 1}${p.rimAim != null ? "~" + f1(p.rimAim) : ""}${p.rimDist != null ? "*" + f1(p.rimDist) : ""}` : "";
    const chT = head && termOk && p.chipAt != null ? ` chip=${p.chipAt + 1}${p.chipAim != null ? "~" + f1(p.chipAim) : ""}${p.chipDist != null ? "*" + f1(p.chipDist) : ""}` : "";
    const hasShot = p.kind === "puck" && ((termOk && p.shotAt != null) || vts.some(t => t.kind === "shot"));
    const nt = hasShot && p.net ? ` net=${p.net}` : "";
    const rotatable = p.kind === "net" || p.kind === "bumper" || p.kind === "deker" || p.kind === "passer" || p.kind === "stick" || (p.kind === "player" && !p.path.length);
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
    const cue = p.kind === "light" && (p.cues || []).length
      ? ` cues=${p.cues.map(c => `${String(c.color || "").replace("#", "")}:${f1(c.dur || 0)}`).join(";")}` : "";
    out.push(`PIECE ${p.id} ${p.kind} ${f1(p.x)} ${f1(p.y)} ${p.color}${lbl}${hnd}${car}${gp}${pas}${sht}${rmT}${chT}${nt}${hld}${wt}${fac}${gl}${crs}${df}${siz}${grp}${cue}${spd}`);
    if (p.path.length) out.push(`PATH ${p.id} ${p.path.map(segToStr).join(" ")}`);
  });
  return out.join("\n") + "\n";
}

