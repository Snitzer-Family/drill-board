import React from "react";
import { createRoot } from "react-dom/client";
import DrillAnimator from "./hockey-drill-animator.jsx";

// A render crash used to blank the whole app to the dark background ("black
// screen") with no way back. This boundary shows the error + a recovery path
// (and, since the autosaved board is what's reloaded on boot, an option to reset
// it) so a bad state can't permanently brick the app.
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err, info) { console.error("DrillBoard crashed:", err, info); }
  render() {
    if (!this.state.err) return this.props.children;
    const e = this.state.err;
    const msg = (e && (e.stack || e.message)) || String(e);
    const btn = { background: "#1c2530", color: "#e8eef5", border: "1px solid #33414f",
      borderRadius: 8, padding: "9px 15px", fontSize: 14, cursor: "pointer" };
    return (
      <div style={{ position: "fixed", inset: 0, background: "#0b0f14", color: "#e8eef5",
        font: "13px ui-monospace, monospace", padding: "20px", overflow: "auto", WebkitOverflowScrolling: "touch" }}>
        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 10, color: "#ff6b6b" }}>DrillBoard hit an error</div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
          <button style={btn} onClick={() => this.setState({ err: null })}>Try again</button>
          <button style={btn} onClick={() => { try { localStorage.removeItem("drillboard:autosave"); } catch { /* ignore */ } location.reload(); }}>
            Reset drill &amp; reload
          </button>
        </div>
        <div style={{ whiteSpace: "pre-wrap", opacity: 0.85 }}>{msg}</div>
      </div>
    );
  }
}

createRoot(document.getElementById("root")).render(
  <ErrorBoundary><DrillAnimator /></ErrorBoundary>
);
