// Diagnostics payload builders.
//
// Pure ESM — no React, no DOM, no timing internals. The app samples the live
// values (which means touching the SVG, since every leg time comes off
// getTotalLength) and hands them in; everything INTERPRETIVE happens here, so
// `node tests/diag-report.mjs` can pin it. That split is the same one
// possession.js and route-dir.js already make.
//
// The judgements worth testing are: when a plan/renderer disagreement is real
// rather than a catch frame, what a viability verdict means in words, and
// whether a payload survives JSON.

/* ---------------- the URL flag ---------------- */

export const DIAG_TABS = [["drill", "Drill"], ["pen", "Pen"], ["layout", "Layout"]];

// `#diag` / `#diag=pen` is an independent key on the SAME hash the share link
// uses, and neither may capture the other: base64url excludes `#` and `&`, and
// `#d=`'s capture stops at a `&`, so `linkDrill` needs no change. The lookahead
// is what keeps `#diagram` out. Lives here, not in the view, so the node suite
// can pin both regexes against one table — the failure mode if either drifts is
// a recipient opening a share link and seeing the wrong drill.
export function hashDiag(hash) {
  const m = /[#&]diag(?:=([a-z]+))?(?=&|$)/.exec(hash || "");
  if (!m) return null;
  const tab = DIAG_TABS.some(([k]) => k === m[1]) ? m[1] : "drill";
  // the drill tab wants the board visible behind it; the other two are reading
  return { tab, dock: tab === "drill" ? "half" : "full" };
}

/* ---------------- JSON safety ---------------- */

// Timing genuinely produces Infinity (an unreached release time, a puck that
// never enters a zone), and `pivots` holds Maps. Either one turns a copied
// payload into `null` or `{}` with no warning, so sanitize on the way out.
export function jsonSafe(v, seen = new WeakSet(), depth = 0) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v == null || typeof v !== "object") {
    return typeof v === "function" || typeof v === "symbol" ? undefined : v;
  }
  if (depth > 12) return "[deep]";
  if (seen.has(v)) return "[cycle]";
  seen.add(v);
  let out;
  if (Array.isArray(v)) out = v.map(x => jsonSafe(x, seen, depth + 1));
  else if (v instanceof Map) {
    out = {};
    v.forEach((val, k) => { out[String(k)] = jsonSafe(val, seen, depth + 1); });
  } else if (v instanceof Set) out = [...v].map(x => jsonSafe(x, seen, depth + 1));
  else {
    out = {};
    for (const k of Object.keys(v)) {
      const s = jsonSafe(v[k], seen, depth + 1);
      if (s !== undefined) out[k] = s;
    }
  }
  seen.delete(v);
  return out;
}

const r2 = n => (typeof n === "number" && Number.isFinite(n) ? Math.round(n * 100) / 100 : null);
const r3 = n => (typeof n === "number" && Number.isFinite(n) ? Math.round(n * 1000) / 1000 : null);

/* ---------------- who has the puck ---------------- */

// The app answers "who has the puck" TWICE, independently: the plan says
// `ride:<player>`, and the renderer re-attaches to the nearest blade within
// 2.2ft. When those disagree you get a puck on the wrong stick — but the naive
// comparison fires constantly, because a handover legitimately has them
// disagree for a few frames. Three things make it legitimate:
//   * the plan has the puck in the air (the renderer already stands down)
//   * a catch approach is easing it onto a blade
//   * the active leg isn't a ride or a rest, so nobody is claiming to hold it
// Outside those, a mismatch is a real defect. Returns null for "no row" rather
// than a row flagged fine, so a quiet drill shows a short list.
export function bladeAgreement(p) {
  if (p.inFlight) return null;
  if (p.approachId != null) return null;
  if (p.legType !== "ride" && p.legType !== "rest") return null;
  const planHolder = p.legType === "ride" ? (p.legId ?? null) : null;
  const bladeId = p.blade ? p.blade.id : null;
  return {
    puck: p.puck, legType: p.legType, planHolder, bladeId,
    d: p.blade ? r2(p.blade.d) : null,
    agree: planHolder === bladeId,
  };
}

export const agreementRows = probes =>
  (probes || []).map(bladeAgreement).filter(Boolean);

/* ---------------- why a puck won't move ---------------- */

// possession.js proves, per authored action, whether it can ever fire. That
// verdict is the single most direct answer to "why isn't this pass happening",
// and it is currently invisible. Worst first: a release that can't happen makes
// every later verdict on that chain moot.
const FAULT_ORDER = ["no-release", "no-fire", "self-pass", "no-catch"];
export const FAULT_WHY = {
  "no-release": "the releaser never has the puck on any run that reaches here",
  "no-fire": "the shooter never has the puck at that waypoint",
  "self-pass": "a pass to yourself with no give-and-go via, or no target at all",
  "no-catch": "it releases, but the catch conditions can never co-occur with it",
};

const nameOf = (pieces, id) => {
  const p = (pieces || []).find(q => q.id === id);
  if (!p) return id == null ? "—" : `#${id}`;
  return (p.label ? `${p.label}#${p.id}` : `${p.kind}#${p.id}`);
};
const refOf = r => (r ? `@${r}` : "");

// viability keys are `t:<puckId>:<transferIdx>` / `x:<puckId>:<terminalIdx>`
export function viabilityFaults(pieces, viability) {
  const out = [];
  for (const [key, verdict] of Object.entries(viability || {})) {
    if (verdict === "ok") continue;
    const [tag, puckId, idxS] = key.split(":");
    const idx = +idxS;
    const puck = (pieces || []).find(q => String(q.id) === puckId);
    let what = tag === "t" ? `hop ${idx + 1}` : `terminal ${idx + 1}`;
    if (puck) {
      const a = tag === "t" ? (puck.transfers || [])[idx] : (puck.terminals || [])[idx];
      if (a) {
        // an unpinned `by` is inferred from the chain rather than authored, so
        // name nobody instead of naming a dash
        const by = a.by ? nameOf(pieces, a.by) + " " : "";
        what = tag === "t"
          ? `hop ${idx + 1} (${a.kind} ${by}→ ${nameOf(pieces, a.to)}${refOf(a.atRef)})`
          : `terminal ${idx + 1} (${a.kind}${by ? " by " + by.trim() : ""}${refOf(a.ref)})`;
      }
    }
    out.push({
      key, verdict,
      label: `puck ${nameOf(pieces, puck ? puck.id : puckId)} ${what}`,
      why: FAULT_WHY[verdict] || "unviable",
    });
  }
  return out.sort((a, b) => FAULT_ORDER.indexOf(a.verdict) - FAULT_ORDER.indexOf(b.verdict));
}

/* ---------------- is the plan even real ---------------- */

// `sig` is the sum of every route segment's getTotalLength. Zero means the SVG
// paths aren't mounted and EVERY leg time is 0 — but a board with no routed
// players legitimately sums to zero, so the flag needs both halves or it cries
// wolf on an empty rink.
export function planHealth(h) {
  const notes = [];
  if (h.sig === 0 && h.routedPlayers > 0)
    notes.push({ level: "bad", msg: "PATHS NOT MOUNTED — sig 0 with routed players, so every leg time is 0" });
  else if (h.segsMounted < h.segsExpected)
    notes.push({ level: "warn", msg: `segs ${h.segsMounted}/${h.segsExpected} mounted` });
  if (h.faults > 0)
    notes.push({ level: "warn", msg: `${h.faults} transfer ${h.faults === 1 ? "fault" : "faults"}` });
  const bad = notes.find(n => n.level === "bad");
  const warn = notes.find(n => n.level === "warn");
  return {
    level: bad ? "bad" : warn ? "warn" : "ok",
    msg: (bad || warn || { msg: `plan ok — segs ${h.segsMounted}/${h.segsExpected}, no transfer faults` }).msg,
    notes,
  };
}

/* ---------------- pen ---------------- */

// One readable line per decision. `ops` and `trace` come from the same
// classifyPenGroup call, so a stroke's fate and the numbers behind it are the
// same story — until now the op list was the only output and a symbol that lost
// to a guard was indistinguishable from one that scored badly.
export function penVerdicts(ops, trace, longs) {
  const syms = (trace && trace.syms) || [];
  const lg = (longs || (trace && trace.longs) || []);
  const key = a => (a || []).slice().sort((x, y) => x - y).join(",");
  return (ops || []).map(o => {
    const srcs = o.srcs || [];
    const label = srcs.length ? "s" + srcs.join(",s") : "—";
    // match on the exact stroke set the reader was handed, not on order: a
    // dense board reads the same strokes several times over
    const rec = syms.find(s => key(s.srcs) === key(srcs));
    let detail = "";
    if (rec && rec.result) {
      detail = `${rec.path} ${rec.result.score.toFixed(2)}`;
      if (rec.result.second) detail += ` · 2nd ${rec.result.second}`;
    } else if (rec && rec.reject === "guard" && rec.blockedTop) {
      // the answer to "why didn't my D convert" — it wasn't the score
      detail = `top ${rec.blockedTop} ${(rec.scored[rec.blockedTop] || 0).toFixed(2)}, blocked by its guard`;
    } else if (rec && rec.reject === "threshold" && (rec.rankedAllowed || []).length) {
      const [s, v] = rec.rankedAllowed[0];
      detail = `best ${s} ${v.toFixed(2)} < accept ${rec.accept}`;
    } else if (rec && rec.reject === "no-cloud") {
      detail = "zero-length ink";
    } else if (o.op === "mark" && srcs.length === 1) {
      // never read as a symbol at all — it went down the long pipeline
      const L = lg.find(x => x.idx === srcs[0]);
      if (L) detail = `long stroke: ${L.skater ? "skater " + L.skater : "no skater in reach"}`
        + `${L.net ? `, net ${L.net}` : ""}, straightness ${L.straight.toFixed(2)}`;
    }
    return { op: o.op, sym: o.sym || null, srcs, label, detail };
  });
}

// Emit a paste-ready case for tests/sketch-recognize.mjs out of real captured
// ink. Hand-transcribing a clipboard dump is how every REAL fixture in that
// file got there, and the [[x,y]] → [{x,y}] adapter got written out ten times
// doing it. Points round to 1dp, matching those fixtures — that IS the capture
// resolution, and denser numbers would imply a precision the pen never had.
//
// The assertion pins what the classifier does TODAY. If what you just drew was
// the bug, change the expectation by hand: the point is to make real ink cheap
// to keep, not to bless the answer.
export function toFixture(d, name = "capture", v = "") {
  if (!d || !(d.strokes || []).length) return "";
  const r1 = n => Math.round(n * 10) / 10;
  const r4 = n => Math.round(n * 10000) / 10000;
  const c = d.ctx || {};
  const fx = r4(c.pxFtX ?? c.pxFt ?? 0), fy = r4(c.pxFtY ?? c.pxFt ?? 0);
  const parts = [];
  if (fx > 0 && fy > 0) parts.push(fx === fy ? `pxFt: ${fx}` : `pxFtX: ${fx}, pxFtY: ${fy}`);
  const pl = (c.players || []).map(p => ({
    id: p.id, x: r1(p.x), y: r1(p.y),
    ...(p.hasPath && p.end ? { hasPath: true, end: { x: r1(p.end.x), y: r1(p.end.y) } } : {}),
  }));
  if (pl.length) parts.push("players: " + JSON.stringify(pl));
  const nt = (c.nets || []).map(n => ({ id: n.id, x: r1(n.x), y: r1(n.y) }));
  if (nt.length) parts.push("nets: " + JSON.stringify(nt));
  const rows = d.strokes
    .map(s => "    [" + (s.pts || []).map(p => `[${r1(p.x)},${r1(p.y)}]`).join(",") + "],")
    .join("\n");
  const want = JSON.stringify((d.ops || []).map(o => o.op));
  const safe = String(name).replace(/'/g, "");
  return `// ${safe}${v ? ` — captured on v${v}` : ""}, ${d.strokes.length} stroke${d.strokes.length === 1 ? "" : "s"}\n`
    + `{\n  const CTX = { ${parts.join(", ")} };\n  const S = [\n${rows}\n  ].map(a => stroke(P(a)));\n`
    + `  T('${safe}', kinds(classifyPenGroup(S, CTX)), ${want});\n}\n`;
}

// The Pen tab's payload. `d` is a burst ({strokes, ctx}) plus the ops and trace
// from ONE classifyPenGroup call over it.
export function penReport(d, v = "") {
  const c = (d && d.ctx) || {};
  return jsonSafe({
    tab: "pen",
    source: d.source || "last burst",
    strokeCount: (d.strokes || []).length,
    px: { x: c.pxFtX ?? c.pxFt ?? null, y: c.pxFtY ?? c.pxFt ?? null },
    board: { players: (c.players || []).length, nets: (c.nets || []).length },
    units: d.trace ? d.trace.units : null,
    verdicts: penVerdicts(d.ops, d.trace),
    ops: (d.ops || []).map(o => ({ op: o.op, sym: o.sym, srcs: o.srcs })),
    trace: d.trace || null,
    fixture: toFixture(d, d.name || "captured ink", v),
    strokes: (d.strokes || []).map(s => (s.pts || []).map(p => [p.x, p.y])),
  });
}

/* ---------------- the report ---------------- */

// `input` is everything the app sampled this tick. Nothing here reaches back
// into the app — which is what makes the whole thing testable from node.
export function drillReport(input) {
  const {
    t, animT, drillTime, totalTime, playing, mode, pace, seed,
    plan, cacheHit, segs, pieces, ledger, solved, probes,
    players, pucks, board, dsl, resolved,
  } = input;

  const faults = viabilityFaults(pieces, ledger && ledger.viability);
  const routedPlayers = (pieces || []).filter(p => p.kind === "player" && (p.path || []).length).length;
  const health = planHealth({
    sig: plan ? plan.sig : 0, routedPlayers,
    segsMounted: segs ? segs.mounted : 0, segsExpected: segs ? segs.expected : 0,
    faults: faults.length,
  });

  return jsonSafe({
    tab: "drill",
    health,
    clock: {
      t: r3(t), animT: r3(animT), drill: r2(drillTime), hold: r2(totalTime - drillTime),
      total: r2(totalTime), playing: !!playing, mode,
    },
    plan: {
      pace: r2(pace), seed, sig: r2(plan ? plan.sig : null), cache: cacheHit ? "hit" : "rebuilt",
      realisticShots: plan ? !!plan.real : null, detail: plan ? !!plan.det : null,
      odds: plan ? plan.odds : null,
    },
    agreement: agreementRows(probes),
    faults,
    pucks,
    players,
    solved: solved || null,
    resolved,
    board,
    ledger: ledger ? { stints: ledger.stints, loose: ledger.loose } : null,
    warp: plan ? plan.warp : null,
    holds: plan ? plan.holds : null,
    startWait: plan ? plan.startWait : null,
    trigPause: plan ? plan.trigPause : null,
    opens: plan ? plan.opens : null,
    pivots: plan ? plan.pivots : null,
    dsl,
  });
}
