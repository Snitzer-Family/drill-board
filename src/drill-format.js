// Drill text format: parser and serializer. See the DSL spec in App header.
import { VIEWS } from "./constants.js";

/* ---------------- text format ---------------- */

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
    const line = raw.replace(/#(?!([0-9a-fA-F]{3}){1,2}\b).*$/, "").trim();
    if (!line) return;
    const tok = line.split(/[\s,]+/);
    const cmd = tok[0].toUpperCase();
    try {
      if (cmd === "RINK") {
        const m = (tok[1] || "").toLowerCase();
        if (!VIEWS[m]) throw new Error(`unknown rink "${tok[1]}"`);
        rink = m;
      } else if (cmd === "PIECE") {
        const [, id, kind, xs, ys, ...rest] = tok;
        const x = parseFloat(xs), y = parseFloat(ys);
        if (!id || !["player", "puck", "cone", "net", "bumper", "deker"].includes(kind) || isNaN(x) || isNaN(y))
          throw new Error("PIECE needs: id kind x y");
        let color = kind === "cone" ? "#e0731d" : kind === "puck" ? "#14171a" : kind === "net" ? "#c81e33"
          : kind === "bumper" ? "#4d6fa6" : kind === "deker" ? "#c79a4e" : "#d7263d";
        let label = kind === "player" ? id : "";
        let speed = 1, hand = "R", carrier = null, facing = 0, shotAt = null, pickup = null;
        let net = null, holdLine = false, goalie = false, defense = false;
        const transfers = [];
        rest.forEach(r => {
          if (r.startsWith("#")) color = r;
          else if (r.includes("=")) {
            const [k, v] = r.split("=");
            const key = k.toLowerCase();
            if (key === "speed") {
              const n = parseFloat(v);
              if (!isNaN(n) && n > 0) speed = n;
            } else if (key === "hand") hand = v.toUpperCase() === "L" ? "L" : "R";
            else if (key === "on") carrier = v;
            else if (key === "pass") {
              const m2 = /^(\d+):([^@\s]+)(?:@(\d+))?$/.exec(v);
              if (m2) transfers.push({ at: parseInt(m2[1], 10) - 1, to: m2[2],
                recvAt: m2[3] ? parseInt(m2[3], 10) - 1 : null, kind: "pass" });
            } else if (key === "rebound") {
              // shot whose carom is collected by a player: shoot at <pt>, they
              // gather at their @<pt> (else route end / where they stand)
              const m4 = /^(\d+):([^@\s]+)(?:@(\d+))?$/.exec(v);
              if (m4) transfers.push({ at: parseInt(m4[1], 10) - 1, to: m4[2],
                recvAt: m4[3] ? parseInt(m4[3], 10) - 1 : null, kind: "shot" });
            } else if (key === "shoot") {
              const n = parseInt(v, 10);
              if (!isNaN(n)) shotAt = n - 1;
            } else if (key === "pickup") {
              const m3 = /^([^@\s]+)@(\d+)$/.exec(v);
              if (m3) pickup = { to: m3[1], at: parseInt(m3[2], 10) - 1 };
            } else if (key === "net") {
              net = v;                                   // a net piece id (or left/right for legacy)
            } else if (key === "hold") {
              if (v.toLowerCase() === "line") holdLine = true;
            } else if (key === "face") {
              const n = parseFloat(v);
              if (!isNaN(n)) facing = n;
            }
          } else if (r === "goalie") goalie = true;
          else if (r === "defense") defense = true;
          else label = r;
        });
        const p = { id, kind, x, y, color, label, speed, hand, carrier, facing, transfers, shotAt, pickup, net, holdLine, goalie, defense, path: [] };
        pieces.push(p); byId[id] = p;
      } else if (cmd === "PATH") {
        const id = tok[1];
        const p = byId[id];
        if (!p) throw new Error(`PATH for unknown piece "${id}"`);
        let j = 2, mode = "carry", dir = "fwd", stop = 0, rate = 1, name = null;
        const num = () => { const v = parseFloat(tok[j++]); if (isNaN(v)) throw new Error("bad number in PATH"); return v; };
        const push = seg => {
          p.path.push({ ...seg, mode, dir, stop, rate, ...(name ? { name } : {}) });
          mode = "carry"; dir = "fwd"; stop = 0; rate = 1; name = null;
        };
        while (j < tok.length) {
          const t = tok[j++].toUpperCase();
          if (t === "CARRY" || t === "PASS" || t === "SHOT") { mode = t.toLowerCase(); continue; }
          if (t === "FWD" || t === "BWD") { dir = t.toLowerCase(); continue; }
          if (t === "STOP") { stop = num(); continue; }
          if (t === "RATE") { rate = Math.max(0.1, num()); continue; }
          if (t === "NAME") { name = (tok[j++] || "").replace(/_/g, " ").trim() || null; continue; }
          if (t === "L") push({ type: "L", x: num(), y: num() });
          else if (t === "Q") push({ type: "Q", cx: num(), cy: num(), x: num(), y: num() });
          else if (t === "C") push({ type: "C", c1x: num(), c1y: num(), c2x: num(), c2y: num(), x: num(), y: num() });
          else throw new Error(`unknown token "${t}" (use L Q C, PASS SHOT CARRY, FWD BWD, STOP n, RATE n)`);
        }
      } else throw new Error(`unknown command "${tok[0]}"`);
    } catch (e) { errors.push(`line ${i + 1}: ${e.message}`); }
  });
  return { rink, pieces, errors, title, desc };
}

const f1 = n => (Math.round(n * 10) / 10).toString();
const f2 = n => (Math.round(n * 100) / 100).toString();

function segToStr(s) {
  let pre = "";
  if (s.name) pre += `NAME ${String(s.name).trim().replace(/\s+/g, "_")} `;
  if (s.stop > 0) pre += `STOP ${f1(s.stop)} `;
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
    const lbl = p.kind === "player" && p.label ? " " + p.label : "";
    const spd = p.speed && p.speed !== 1 ? ` speed=${f2(p.speed)}` : "";
    const hnd = p.kind === "player" && p.hand === "L" ? " hand=L" : "";
    const car = p.kind === "puck" && p.carrier ? ` on=${p.carrier}` : "";
    const gp = p.kind === "puck" && !p.carrier && p.pickup ? ` pickup=${p.pickup.to}@${p.pickup.at + 1}` : "";
    // chain transfers in order: pass= for passes, rebound= for shot handoffs
    const pas = p.kind === "puck" && (p.carrier || p.pickup) && p.transfers && p.transfers.length
      ? p.transfers.map(t => (t.kind === "shot" ? " rebound=" : " pass=")
          + `${t.at + 1}:${t.to}${t.recvAt != null ? "@" + (t.recvAt + 1) : ""}`).join("")
      : "";
    const sht = p.kind === "puck" && (p.carrier || p.pickup) && p.shotAt != null ? ` shoot=${p.shotAt + 1}` : "";
    const hasShot = p.kind === "puck" && (p.shotAt != null || (p.transfers || []).some(t => t.kind === "shot"));
    const nt = hasShot && p.net ? ` net=${p.net}` : "";
    const rotatable = p.kind === "net" || p.kind === "bumper" || p.kind === "deker" || (p.kind === "player" && !p.path.length);
    const fac = rotatable && p.facing ? ` face=${f1(p.facing)}` : "";
    const hld = p.kind === "player" && p.holdLine ? " hold=line" : "";
    const gl = p.kind === "net" && p.goalie ? " goalie" : "";
    const df = p.kind === "player" && p.defense ? " defense" : "";
    out.push(`PIECE ${p.id} ${p.kind} ${f1(p.x)} ${f1(p.y)} ${p.color}${lbl}${hnd}${car}${gp}${pas}${sht}${nt}${hld}${fac}${gl}${df}${spd}`);
    if (p.path.length) out.push(`PATH ${p.id} ${p.path.map(segToStr).join(" ")}`);
  });
  return out.join("\n") + "\n";
}

