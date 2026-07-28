import React from "react";
import { createRoot } from "react-dom/client";
import DrillAnimator from "./hockey-drill-animator.jsx";
import { stashAutosave } from "./storage.js";

// A render crash used to blank the whole app to the dark background ("black
// screen") with no way back. This boundary shows the error + a recovery path
// (and, since the autosaved board is what's reloaded on boot, an option to reset
// it) so a bad state can't permanently brick the app.
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err, info) { console.error("Coach.Vision Board crashed:", err, info); }
  render() {
    if (!this.state.err) return this.props.children;
    const e = this.state.err;
    const msg = (e && (e.stack || e.message)) || String(e);
    // This renders OUTSIDE .hd-root, so styles.js never reaches it — but the
    // tokens are declared on :root by index.html, so var() resolves here and
    // the crash screen themes along with everything else.
    const btn = { background: "var(--db-surface-raised)", color: "var(--db-text)",
      border: "1px solid var(--db-border-strong)",
      borderRadius: 8, padding: "9px 15px", fontSize: 14, cursor: "pointer" };
    return (
      <div style={{ position: "fixed", inset: 0, background: "var(--db-surface-app)", color: "var(--db-text)",
        font: "13px ui-monospace, monospace", padding: "20px", overflow: "auto", WebkitOverflowScrolling: "touch" }}>
        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 10, color: "var(--db-danger)" }}>The board hit an error</div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
          <button style={btn} onClick={() => this.setState({ err: null })}>Try again</button>
          {/* The board is STASHED, not deleted. It still has to leave the
              autosave slot — a poisoned board would just re-crash on boot — but
              this used to be an unrecoverable delete, and it's the button a
              coach taps at the rink with no idea it costs them the session's
              work. ☰ → "Restore last board" brings it back. */}
          <button style={btn} onClick={() => { stashAutosave(); location.reload(); }}>
            Reset drill &amp; reload
          </button>
          <div style={{ flexBasis: "100%", fontSize: 12, opacity: 0.7 }}>
            Your board is kept — reopen the app and choose ☰ → Restore last board.
          </div>
        </div>
        <div style={{ whiteSpace: "pre-wrap", opacity: 0.85 }}>{msg}</div>
      </div>
    );
  }
}

createRoot(document.getElementById("root")).render(
  <ErrorBoundary><DrillAnimator /></ErrorBoundary>
);
