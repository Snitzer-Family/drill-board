// All app CSS. Layout/safe-area rules live here — small file, easy pushes.

export const STYLES = `
        .hd-root { position:fixed; inset:0; background:#0c1014; color:#e8edf2; overflow:hidden;
          --hd-b: var(--hd-safe-b, min(env(safe-area-inset-bottom, 0px), 34px));
          font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
        /* the ice starts below the Dynamic Island / status bar and ends
           above the home-indicator band — iOS 26 standalone composites an
           opaque system bar there that web content cannot render under */
        .hd-stage { position:absolute; top:env(safe-area-inset-top, 0px);
          left:env(safe-area-inset-left, 0px); right:env(safe-area-inset-right, 0px);
          bottom:calc(54px + var(--hd-b));
          display:flex; align-items:center; justify-content:center; }
        .hd-canvas { position:relative; }
        .hd-canvas svg.hd-ice { width:100%; height:100%; display:block; }
        .hd-stage, .hd-canvas, .hd-canvas svg, .hd-canvas svg * { touch-action:none;
          -webkit-user-select:none; user-select:none; -webkit-touch-callout:none; }
        /* floating controls */
        .hd-fab { position:absolute; z-index:40; width:46px; height:46px; border-radius:50%;
          background:rgba(23,29,37,.88); border:1px solid #33404f; color:#dbe4ec;
          font-size:18px; display:flex; align-items:center; justify-content:center;
          cursor:pointer; box-shadow:0 4px 14px rgba(0,0,0,.45); backdrop-filter:blur(4px); }
        .hd-fab.on { background:#1f4fa3; border-color:#1f4fa3; }
        .hd-fab.draw-on { background:#b58900; border-color:#b58900; }
        .hd-fab.play { background:#d7263d; border-color:#d7263d; color:#fff; }
        .hd-fab small { font-size:10px; font-weight:800; letter-spacing:.05em; }
        .hd-fab.small { position:static; width:38px; height:38px; box-shadow:none; font-size:16px; }
        /* the mobile play/pause is enlarged for an easy thumb target */
        .hd-playdock .hd-fab.play { width:54px; height:54px; font-size:22px; }
        /* draggable play dock — floats over the ice, movable by its grip */
        .hd-playdock { position:absolute; z-index:46; top:max(10px, env(safe-area-inset-top));
          left:50%; transform:translateX(-50%);
          display:flex; align-items:center; gap:6px; padding:4px 6px 4px 8px;
          background:rgba(23,29,37,.9); border:1px solid #33404f; border-radius:999px;
          box-shadow:0 4px 14px rgba(0,0,0,.45); backdrop-filter:blur(4px); touch-action:none; }
        .hd-playdock .hd-grip { cursor:grab; padding:6px 4px; font-size:15px; }
        .hd-playdock .hd-grip:active { cursor:grabbing; }
        /* bottom menu bar — owns the chrome so the ice stays clear */
        .hd-bar { position:absolute; z-index:44; left:env(safe-area-inset-left, 0px);
          right:env(safe-area-inset-right, 0px); bottom:0;
          height:calc(54px + var(--hd-b)); padding:0 10px var(--hd-b);
          box-sizing:border-box; display:flex; align-items:center; gap:8px;
          background:#11161c; border-top:1px solid #2a3542; }
        .hd-barbtn { width:46px; height:40px; border-radius:10px; background:#1b232c;
          border:1px solid #33404f; color:#dbe4ec; font-size:17px; display:flex;
          align-items:center; justify-content:center; cursor:pointer; flex:none; }
        .hd-barbtn.on { background:#1f4fa3; border-color:#1f4fa3; }
        .hd-barbtn.draw-on { background:#b58900; border-color:#b58900; }
        .hd-barbtn small { font-size:10px; font-weight:800; letter-spacing:.05em; }
        /* play controls in the bar: desktop only (mobile uses the float dock) */
        .hd-barplay { display:none; }
        .hd-barplay.play { background:#d7263d; border-color:#d7263d; color:#fff; }
        @media (pointer: fine) and (min-width: 760px) {
          .hd-playdock { display:none; }
          .hd-barplay { display:flex; }
        }
        .hd-barhint { flex:1; min-width:0; font-size:12px; color:#8b99a8; text-align:right;
          white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .hd-ver { flex:none; font-size:10px; color:#5b6c7d; white-space:nowrap;
          font-variant-numeric:tabular-nums; letter-spacing:.02em; }
        /* corner menus */
        .hd-menu { position:absolute; z-index:45; background:#1a222c; border:1px solid #33404f;
          border-radius:12px; padding:10px 12px; box-shadow:0 8px 24px rgba(0,0,0,.5);
          display:flex; flex-direction:column; gap:8px; width:230px; max-height:70vh; overflow-y:auto; }
        .hd-menu.tl { bottom:calc(62px + var(--hd-b)); left:calc(10px + env(safe-area-inset-left)); }
        .hd-menu.bl { bottom:calc(62px + var(--hd-b)); left:calc(66px + env(safe-area-inset-left)); }
        .hd-menu.br { bottom:calc(62px + var(--hd-b)); right:calc(10px + env(safe-area-inset-right)); }
        .hd-mh { font-size:11px; letter-spacing:.12em; text-transform:uppercase; color:#8b99a8; }
        .hd-item { display:flex; align-items:center; gap:8px; padding:9px 10px; font-size:14px;
          border:1px solid #2c3846; background:#212b36; color:#dbe4ec; border-radius:8px;
          cursor:pointer; text-align:left; }
        .hd-item.on { background:#1f4fa3; border-color:#1f4fa3; color:#fff; }
        .hd-item.danger { color:#ff8d9c; border-color:#4a2a30; }
        .hd-note { font-size:11.5px; color:#7d8b99; line-height:1.5; }
        .hd-note code { color:#a8c3da; }
        /* hint text lives in the bottom bar */
        /* text sheet */
        .hd-sheet { position:absolute; inset:0; z-index:50; background:rgba(10,13,17,.96);
          display:flex; flex-direction:column; gap:10px; padding:16px;
          padding-top:calc(16px + env(safe-area-inset-top)); }
        .hd-ta { flex:1; min-height:120px; background:#0f141a; color:#cfe0ee; border:1px solid #2c3846;
          border-radius:8px; font-family:ui-monospace, monospace; font-size:12.5px; padding:8px; resize:none; }
        .hd-err { color:#ff8d9c; font-size:12px; white-space:pre-wrap; }
        .hd-row { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
        .hd-btn { padding:9px 16px; font-size:13.5px; font-weight:600; border:1px solid #2c3846;
          background:#1b232c; color:#e8edf2; border-radius:8px; cursor:pointer; min-height:40px; }
        .hd-btn.primary { background:#d7263d; border-color:#d7263d; }
        /* presentation steps editor */
        .hd-steplist { flex:1; overflow-y:auto; display:flex; flex-direction:column; gap:7px; }
        .hd-steprow { display:flex; align-items:center; gap:8px; }
        .hd-steptime { flex:none; width:42px; font-size:11px; color:#7d8b99;
          font-variant-numeric:tabular-nums; text-align:right; }
        /* presentation caption — floats above the bottom bar during a hold */
        .hd-preso { position:absolute; z-index:47; left:50%; transform:translateX(-50%);
          bottom:calc(64px + var(--hd-b)); max-width:min(560px, 92vw);
          display:flex; align-items:center; gap:12px; padding:11px 14px;
          background:rgba(17,22,28,.94); border:1px solid #3a4756; border-radius:12px;
          box-shadow:0 6px 22px rgba(0,0,0,.5); backdrop-filter:blur(5px); }
        .hd-preso-text { font-size:15px; font-weight:600; color:#eef4fa; line-height:1.3; }
        .hd-preso-btn { flex:none; padding:7px 12px; font-size:12.5px; font-weight:700;
          background:#1f4fa3; border:1px solid #1f4fa3; color:#fff; border-radius:8px; cursor:pointer; }
        @media (pointer: fine) and (min-width: 760px) {
          .hd-preso { max-width:min(760px, 80vw); gap:18px; padding:16px 22px; bottom:calc(74px + var(--hd-b)); }
          .hd-preso-text { font-size:24px; }
          .hd-preso-btn { font-size:15px; padding:9px 16px; }
        }
        /* shared bits */
        .hd-swatch { width:24px; height:24px; border-radius:50%; border:2px solid transparent; cursor:pointer; }
        .hd-swatch.on { border-color:#ffd447; }
        .hd-input { background:#0f141a; border:1px solid #2c3846; color:#e8edf2; border-radius:8px;
          padding:7px 9px; font-size:14px; }
        .hd-x { margin-left:auto; background:none; border:none; color:#8b99a8; cursor:pointer;
          font-size:16px; padding:2px 6px; }
        input[type=range] { accent-color:#d7263d; height:30px; }
        .hd-pop { position:absolute; z-index:20; width:220px; background:#1a222c; border:1px solid #33404f;
          border-radius:12px; padding:10px 12px; box-shadow:0 8px 24px rgba(0,0,0,.5);
          display:flex; flex-direction:column; gap:8px;
          max-height:calc(100% - 8px); overflow-y:auto; overscroll-behavior:contain; }
        .hd-pophead { display:flex; align-items:center; gap:6px; font-size:12px; font-weight:700;
          letter-spacing:.06em; text-transform:uppercase; color:#aab7c4;
          cursor:grab; touch-action:none; user-select:none; -webkit-user-select:none;
          margin:-10px -12px 0; padding:10px 12px 6px; }
        .hd-pophead:active { cursor:grabbing; }
        .hd-grip { color:#5b6c7d; font-size:13px; letter-spacing:0; }
        .hd-poprow { display:flex; align-items:center; gap:7px; flex-wrap:wrap; font-size:12.5px; color:#cdd8e2; }
        .hd-mini { padding:6px 10px; font-size:12.5px; border:1px solid #2c3846; background:#212b36;
          color:#dbe4ec; border-radius:7px; cursor:pointer; min-height:34px; }
        .hd-mini.on { background:#1f4fa3; border-color:#1f4fa3; color:#fff; }
        .hd-mini.danger { color:#ff8d9c; border-color:#4a2a30; }
        .hd-stepper { display:inline-flex; align-items:center; gap:2px;
          background:#0f141a; border:1px solid #2c3846; border-radius:7px; overflow:hidden; }
        .hd-stepper button { width:32px; min-height:32px; border:none; background:#212b36; color:#e8edf2;
          font-size:16px; cursor:pointer; }
        .hd-stepper span { min-width:44px; text-align:center; font-size:13px; font-variant-numeric:tabular-nums; }
        .hd-loupe { position:absolute; z-index:30; width:118px; height:118px; border-radius:50%;
          border:2px solid #3b4a5a; box-shadow:0 6px 18px rgba(0,0,0,.55), 0 0 0 1px rgba(0,0,0,.6);
          overflow:hidden; pointer-events:none; background:#f5fafd; }
        .hd-loupe svg { width:100%; height:100%; display:block; }
      `;
