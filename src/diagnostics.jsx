// Diagnostics — one surface, three tabs.
//
// It ships in the production build because the bugs it exists for happen on a
// phone, in standalone, against whatever is live: a drill that animates wrong,
// or ink that won't convert. The entry stays deliberate (menu -> About -> Open
// diagnostics, or #diag on the URL), so it costs a coach nothing.
//
//   Drill  — the timing plan, the possession ledger, and the two independent
//            answers to "who has the puck", side by side.
//   Pen    — what the sketch recogniser measured, and why it decided.
//   Layout — the viewport / safe-area / rect numbers, themed and closeable.
//
// This view NEVER re-renders from its parent. It takes a stable `feedRef` whose
// .current the app reassigns to a fresh thunk each render, and polls that at
// 5Hz. That is the whole reason it is memo()'d and lives in its own file — a
// 60fps RAF animator must not pay for a panel nobody has open. See the diagRef
// note in hockey-drill-animator.jsx.

import { useState, useRef, useEffect, useCallback, memo } from "react";
import { APP_VERSION, BUILD_STAMP, DSL_VERSION } from "./constants.js";
import { Icon } from "./icons.jsx";
// DIAG_TABS and hashDiag live in the pure module so the node suite can pin the
// hash regex against the share link's — see the note there.
import { DIAG_TABS } from "./diag-report.js";

// Clipboard, both ways round. The async API can hang forever when the document
// isn't focused, so the synchronous textarea path runs first and the feedback
// never waits on the promise. Lifted out of copyPenDiag, which learned this on
// an iPhone.
export function copyText(txt) {
  let ok = false;
  const ta = document.createElement("textarea");
  ta.value = txt;
  ta.style.cssText = "position:fixed;top:-1000px;left:0;opacity:0";
  document.body.appendChild(ta);
  ta.select();
  ta.setSelectionRange(0, txt.length);       // iOS needs the explicit range
  try { ok = document.execCommand("copy"); } catch { /* fall through */ }
  ta.remove();
  try { navigator.clipboard?.writeText?.(txt); } catch { /* best effort */ }
  return ok;
}

/* ---------------- layout probe ---------------- */
// Everything the old DiagPanel printed, plus what the layout bugs actually
// needed: the action bar's own scrollWidth vs clientWidth — bar-fit.mjs's
// single-line guarantee, now assertable on the real device instead of only in
// headless Chrome — the computed custom properties, and which width tier the JS
// believes it is in. Lives here rather than in diag-report.js because it is all
// DOM; the report module stays node-loadable.
export function layoutProbe(probeEl, drillVersion) {
  const vv = typeof window !== "undefined" ? window.visualViewport : null;
  const cs = probeEl ? getComputedStyle(probeEl) : null;
  const rootEl = document.querySelector(".hd-root");
  const rs = rootEl ? getComputedStyle(rootEl) : null;
  const rect = sel => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return {
      w: Math.round(b.width), h: Math.round(b.height),
      top: Math.round(b.top), bottom: Math.round(b.bottom),
      scrollW: el.scrollWidth, clientW: el.clientWidth,
    };
  };
  const cssVar = n => (rs ? rs.getPropertyValue(n).trim() : "");
  return {
    v: APP_VERSION, stamp: BUILD_STAMP,
    dsl: { drill: drillVersion ?? null, app: DSL_VERSION },
    standalone: navigator.standalone === true ||
      (typeof matchMedia === "function" && matchMedia("(display-mode: standalone)").matches),
    inner: [window.innerWidth, window.innerHeight],
    vv: vv ? [Math.round(vv.width), Math.round(vv.height), Math.round(vv.offsetTop)] : null,
    screen: [screen.width, screen.height],
    dpr: window.devicePixelRatio,
    // the hidden probe is the only way to read env() from JS
    safe: cs ? { top: cs.paddingTop, bottom: cs.paddingBottom } : null,
    // the `dense` CLASS, not the JS flag behind it: the stylesheet keys off the
    // class, so this is the answer that explains what you are looking at. The
    // roomy tier has no class (it only gates what the Edit bar inlines) and
    // rides in on the drill feed instead.
    dense: rootEl ? rootEl.classList.contains("dense") : null,
    vars: {
      "--hd-barh": cssVar("--hd-barh"), "--hd-b": cssVar("--hd-b"),
      "--hd-act": cssVar("--hd-act"), "--hd-menubar": cssVar("--hd-menubar"),
      "--hd-icegap": cssVar("--hd-icegap"), "--hd-menu-w": cssVar("--hd-menu-w"),
      "--hd-dock-w": cssVar("--hd-dock-w"),
    },
    rects: {
      root: rect(".hd-root"), stage: rect(".hd-stage"),
      ice: rect(".hd-canvas"), bar: rect(".hd-act"),
    },
    ua: navigator.userAgent,
  };
}

/* ---------------- small presentational pieces ---------------- */

function Row({ k, v, tone }) {
  return (
    <div className="hd-diagrow">
      <span className="hd-diagk">{k}</span>
      <span className={"hd-diagv" + (tone ? " " + tone : "")}>{v}</span>
    </div>
  );
}

function Sec({ id, title, open, toggle, children, count }) {
  const on = !!open[id];
  return (
    <div className="hd-diagsec">
      <button className="hd-diagsechead" onClick={() => toggle(id)} aria-expanded={on}>
        <Icon name={on ? "chevronDown" : "chevronRight"} size={13} />
        <span>{title}</span>
        {count != null && <small>{count}</small>}
      </button>
      {on && <div className="hd-diagsecbody">{children}</div>}
    </div>
  );
}

/* ---------------- drill ---------------- */

const f2 = n => (typeof n === "number" ? n.toFixed(2) : "—");
const f3 = n => (typeof n === "number" ? n.toFixed(3) : "—");
const pid = id => (id == null ? "—" : "#" + id);

// A transport of its own, not the player dock's — that one is hidden in some
// modes, and the frame-step is the point. "The puck leaves the blade at 3.43s
// but the plan's fly leg starts at 3.51s" is a sentence you can only write by
// stepping one frame at a time with the leg table next to you.
function Scrub({ clock, act }) {
  const seek = f => act.current && act.current.seek(Math.max(0, Math.min(1, f)));
  const step = ds => clock.total > 0 && seek(clock.animT + ds / clock.total);
  return (
    <div className="hd-diagscrub">
      <button className="hd-diagstep" title={clock.playing ? "Pause" : "Play"}
        onClick={() => act.current && act.current.play(!clock.playing)}>
        <Icon name={clock.playing ? "pause" : "play"} size={13} />
      </button>
      <button className="hd-diagstep" title="Back one frame" onClick={() => step(-1 / 30)}>-1f</button>
      <button className="hd-diagstep" title="On one frame" onClick={() => step(1 / 30)}>+1f</button>
      <input type="range" min="0" max="1" step="0.001" value={clock.animT}
        onChange={e => seek(+e.target.value)} aria-label="Playback position" />
      <span className="hd-diagt">{f3(clock.t)}s</span>
    </div>
  );
}

function DrillTab({ snap, open, toggle, act }) {
  if (!snap) return <div className="hd-diagnote">no feed — the board hasn't rendered yet.</div>;
  const D = snap;
  const legFlags = L => ["shot", "goal", "sauce", "rise", "rim", "chip", "back", "catch", "open"]
    .filter(k => L[k]).join(" ");
  return (
    <>
      <div className={"hd-diagbanner " + D.health.level}>{D.health.msg}</div>
      <Scrub clock={D.clock} act={act} />
      <Row k="clock" v={`${f2(D.clock.t)} / ${f2(D.clock.total)}s · drill ${f2(D.clock.drill)} + hold ${f2(D.clock.hold)}`} />
      <Row k="run" v={`${D.clock.playing ? "playing" : "paused"} · ${D.clock.mode} · pace ${f2(D.plan.pace)} · seed ${D.plan.seed}`} />
      <Row k="plan" v={`cache ${D.plan.cache} · sig ${f2(D.plan.sig)} · ${D.plan.realisticShots ? "realistic" : "intent"} shots · detail ${D.plan.detail ? "on" : "off"}`} />
      {/* the two ways what PLAYS differs from what you authored */}
      {(D.resolved.nearestRebound || D.resolved.forkPlayers > 0) && (
        <Row k="resolved" tone="warn"
          v={[D.resolved.forkPlayers > 0 && `${D.resolved.forkPlayers} branching, ${D.resolved.branchesTaken} taken`,
            D.resolved.nearestRebound && "nearest puck re-bound"].filter(Boolean).join(" · ")} />
      )}

      {/* The headline. Two independent answers to "who has the puck": the plan's
          ride leg, and the blade the renderer actually put it on. */}
      {D.agreement.length > 0 && <div className="hd-diagsublab">puck vs blade</div>}
      {D.agreement.map(a => (
        <Row key={a.puck} k={"puck " + pid(a.puck)} tone={a.agree ? "ok" : "bad"}
          v={a.agree
            ? `${a.legType}${a.planHolder != null ? " " + pid(a.planHolder) : ""} · blade ${pid(a.bladeId)}${a.d != null ? ` @${f2(a.d)}ft` : ""} ok`
            : `WRONG STICK — plan says ${a.legType}${a.planHolder != null ? " " + pid(a.planHolder) : " (loose)"}, blade says ${pid(a.bladeId)}${a.d != null ? ` @${f2(a.d)}ft` : ""}`} />
      ))}

      {/* possession.js proves these unviable; nothing else in the app says so */}
      {D.faults.length > 0 && <div className="hd-diagsublab">transfer faults</div>}
      {D.faults.map(f => (
        <div key={f.key} className="hd-diagfault">
          <div className="hd-diagv bad">{f.label}: {f.verdict}</div>
          <div className="hd-diagwhy">{f.why}</div>
        </div>
      ))}

      <Sec id="pucks" title="Puck timelines" open={open} toggle={toggle} count={D.pucks.length}>
        {D.pucks.map(p => (
          <div key={p.id} className="hd-diagblock">
            <div className="hd-diagv">{pid(p.id)} · final {pid(p.final)}{p.rel != null ? ` · releases ${f2(p.rel)}s` : ""}{p.inGoal ? " · IN GOAL" : ""}</div>
            {p.legs.map((L, i) => (
              <div key={i} className={"hd-diagleg" + (i === p.activeLeg ? " on" : "")}>
                {String(i).padStart(2, " ")} {L.type.padEnd(5, " ")} {f2(L.t0)}
                {L.t1 != null ? `→${f2(L.t1)}` : ""}
                {L.id != null ? ` ${pid(L.id)}` : ""}{L.by != null ? ` by${pid(L.by)}` : ""}
                {legFlags(L) ? " " + legFlags(L) : ""}
              </div>
            ))}
          </div>
        ))}
      </Sec>

      <Sec id="players" title="Player timing" open={open} toggle={toggle} count={D.players.length}>
        {D.players.map(p => (
          <div key={p.id} className="hd-diagblock">
            <div className="hd-diagv">
              {pid(p.id)}{p.label ? " " + p.label : ""} · {f2(p.time)}s · {p.hand}
              {p.speed !== 1 ? ` · ×${p.speed}` : ""}{p.defense ? " · defense" : ""}
            </div>
            <div className="hd-diagwhy">
              at {f2(p.at.x)},{f2(p.at.y)} a{f2(p.at.a)}
              {p.at.aStep != null && Math.abs(p.at.aStep - p.at.a) > 0.5 ? ` (aStep ${f2(p.at.aStep)})` : ""}
              {p.at.v != null ? ` v${f2(p.at.v)}` : ""}
              {p.startWait ? ` · waits ${f2(p.startWait)}s` : ""}
              {p.warp ? ` · warp ×${f2(p.warp.f)} to leg ${p.warp.upto}` : ""}
              {p.hold ? ` · holds ${f2(p.hold.dur)}s at leg ${p.hold.seg}` : ""}
              {p.opens ? ` · ${p.opens} open-up` : ""}{p.pivots ? " · pivots" : ""}
              {p.branches.length ? ` · branch ${p.branches.join(",")}` : ""}
            </div>
            {p.legs.map(s => (
              <div key={s.i} className="hd-diagleg">
                {String(s.i).padStart(2, " ")} {s.mode.padEnd(6, " ")} {s.dir}
                {s.rate !== 1 ? ` rate${s.rate}` : ""}{s.stop ? ` stop${s.stop}` : ""}
                {s.t != null ? ` → ${f2(s.t)}s` : ""}
              </div>
            ))}
          </div>
        ))}
      </Sec>

      <Sec id="board" title="Board" open={open} toggle={toggle}>
        <Row k="rink" v={`${D.board.rink} · zoom ${f2(D.board.view.s)} pan ${f2(D.board.view.tx)},${f2(D.board.view.ty)}`} />
        <Row k="pieces" v={Object.entries(D.board.counts).map(([k, n]) => `${n} ${k}`).join(" · ") || "empty"} />
        <Row k="flags" v={["dense", "roomy", "whiteboard", "presentation", "collisions", "realisticShots", "detail"]
          .filter(k => D.board[k]).join(" ") || "none"} />
      </Sec>

      <Sec id="solved" title="Solved branches" open={open} toggle={toggle}>
        <div className="hd-diagpre">{JSON.stringify(D.solved, null, 1)}</div>
      </Sec>

      <div className="hd-diagnote">
        Copy JSON also carries the possession ledger, the full warp / hold / pivot
        tables and the drill&rsquo;s DSL — everything needed to reproduce this.
      </div>
    </>
  );
}

function LayoutTab({ snap, open, toggle }) {
  if (!snap) return <div className="hd-diagnote">measuring…</div>;
  const L = snap;
  const bar = L.rects.bar;
  // the invariant bar-fit.mjs asserts, stated where a screenshot can carry it
  const barFits = !bar || bar.scrollW <= bar.clientW;
  return (
    <>
      <div className={"hd-diagbanner " + (barFits ? "ok" : "bad")}>
        {barFits ? "action bar fits on one line" : `ACTION BAR OVERFLOWS — scrollW ${bar.scrollW} > clientW ${bar.clientW}`}
      </div>
      <Row k="version" v={`v${L.v} · ${L.stamp}`} />
      <Row k="dsl" v={`drill ${L.dsl.drill ?? "?"} / app ${L.dsl.app}`} />
      <Row k="mode" v={L.standalone ? "standalone" : "browser"} />
      <Row k="tier" v={`${L.dense ? "dense" : "compact"} @ ${L.inner[0]}px (DENSE_MIN 700 · ROOMY_MIN 1000)`} />
      <Row k="inner" v={`${L.inner[0]}×${L.inner[1]} @${L.dpr}x`} />
      <Row k="visualVp" v={L.vv ? `${L.vv[0]}×${L.vv[1]} ot${L.vv[2]}` : "n/a"} />
      <Row k="screen" v={`${L.screen[0]}×${L.screen[1]}`} />
      <Row k="safe" v={L.safe ? `t${L.safe.top} b${L.safe.bottom}` : "?"} />
      <Sec id="vars" title="Custom properties" open={open} toggle={toggle}>
        {Object.entries(L.vars).map(([k, v]) => <Row key={k} k={k} v={v || "—"} />)}
      </Sec>
      <Sec id="rects" title="Element rects" open={open} toggle={toggle}>
        {Object.entries(L.rects).map(([k, r]) => (
          <Row key={k} k={k}
            v={r ? `${r.w}×${r.h}  top${r.top} bot${r.bottom}  scrollW${r.scrollW}/${r.clientW}` : "n/a"} />
        ))}
      </Sec>
      <Sec id="ua" title="User agent" open={open} toggle={toggle}>
        <div className="hd-diagpre">{L.ua}</div>
      </Sec>
    </>
  );
}

/* ---------------- the view ---------------- */

function DiagView({ diag, setDiag, feedRef, actRef, drillVersion, flash }) {
  const { tab, dock } = diag;
  const probeRef = useRef(null);
  const [snap, setSnap] = useState(null);
  const [open, setOpen] = useState({});
  const toggle = useCallback(id => setOpen(o => ({ ...o, [id]: !o[id] })), []);

  // The one place a payload is ever built. The thunk is re-read from the ref on
  // every tick rather than captured, which is the bug the old DiagPanel had:
  // its interval closed over drillVersion once and never saw it change again.
  useEffect(() => {
    const tick = () => setSnap(tab === "layout"
      ? layoutProbe(probeRef.current, drillVersion)
      : (feedRef && feedRef.current ? feedRef.current(tab) : null));
    tick();
    const id = setInterval(tick, 200);
    return () => clearInterval(id);
  }, [tab, drillVersion, feedRef]);

  const close = () => setDiag(null);
  const setTab = t => setDiag(d => ({ ...d, tab: t }));
  const swapDock = () => setDiag(d => ({ ...d, dock: d.dock === "full" ? "half" : "full" }));
  const copyJson = () => {
    const txt = JSON.stringify(snap ?? {}, null, 1);
    flash(copyText(txt) ? "Diagnostics copied — paste them to Claude"
      : "Copied (if the paste is empty, screenshot this instead)");
  };

  return (
    <>
      <div ref={probeRef} style={{ position: "fixed", visibility: "hidden",
        paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }} />
      <div className={"hd-diag" + (dock === "full" ? " full" : "")}>
        <div className="hd-diaghead">
          <div className="hd-diagtabs">
            {DIAG_TABS.map(([k, label]) => (
              <button key={k} className={"hd-diagtab" + (k === tab ? " on" : "")}
                onClick={() => setTab(k)}>{label}</button>
            ))}
          </div>
          <button className="hd-diagx" onClick={swapDock}
            title={dock === "full" ? "Shrink to a drawer" : "Fill the screen"}>
            <Icon name={dock === "full" ? "restore" : "expand"} size={15} />
          </button>
          <button className="hd-diagx" onClick={close} title="Close diagnostics">
            <Icon name="close" size={15} />
          </button>
        </div>
        <div className="hd-diagbody">
          {tab === "layout" && <LayoutTab snap={snap} open={open} toggle={toggle} />}
          {tab === "drill" && <DrillTab snap={snap} open={open} toggle={toggle} act={actRef} />}
          {tab === "pen" && <div className="hd-diagnote">The pen report lands here next.</div>}
        </div>
        <div className="hd-diagfoot">
          <button className="hd-mini" onClick={copyJson}>Copy JSON</button>
          <button className="hd-mini" onClick={close} style={{ marginLeft: "auto" }}>Done</button>
        </div>
      </div>
    </>
  );
}

export default memo(DiagView);
