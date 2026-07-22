// All app CSS. Layout/safe-area rules live here — small file, easy pushes.

export const STYLES = `
        .hd-root { position:fixed; inset:0; background:#0c1014; color:#e8edf2; overflow:hidden;
          --hd-b: var(--hd-safe-b, min(env(safe-area-inset-bottom, 0px), 34px));
          --hd-scrub: 0px;   /* reserved height for the timeline scrubber band (0 when hidden) */
          font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
        .hd-root.scrub-on { --hd-scrub: 44px; }
        /* the ice starts below the Dynamic Island / status bar and ends
           above the home-indicator band — iOS 26 standalone composites an
           opaque system bar there that web content cannot render under */
        .hd-stage { position:absolute; top:env(safe-area-inset-top, 0px);
          left:env(safe-area-inset-left, 0px); right:env(safe-area-inset-right, 0px);
          bottom:calc(54px + var(--hd-b) + var(--hd-scrub));
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
        .hd-fab.small { position:static; width:38px; height:38px; box-shadow:none; font-size:30px; line-height:1; }
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
        /* subtle "hide" button on the dock */
        .hd-fab.small.hd-playhide { width:30px; height:30px; background:transparent;
          border-color:transparent; box-shadow:none; color:#8b99a8; }
        /* collapsed play-dock tab: tucked to an edge, tap to bring the dock back */
        .hd-playtab { position:absolute; z-index:46; display:flex; align-items:center;
          justify-content:center; width:54px; height:26px; padding:0; color:#cdd8e2;
          background:rgba(23,29,37,.92); border:1px solid #33404f;
          box-shadow:0 4px 14px rgba(0,0,0,.45); backdrop-filter:blur(4px); cursor:pointer; }
        .hd-playtab.top { border-radius:0 0 13px 13px; border-top:none; }
        .hd-playtab.bottom { border-radius:13px 13px 0 0; }
        .hd-playtab.left { width:26px; height:54px; border-radius:0 13px 13px 0; border-left:none; }
        .hd-playtab.right { width:26px; height:54px; border-radius:13px 0 0 13px; border-right:none; }
        /* timeline scrubber — a thin strip above the menu bar; seek + drop notes */
        /* the scrubber sits in its own reserved band between the ice and the menu
           bar (see --hd-scrub on .hd-root) — it never overlaps the ice sheet */
        .hd-scrub { position:absolute; z-index:44; left:8px; right:8px;
          bottom:calc(54px + var(--hd-b) + 4px); height:36px;
          display:flex; align-items:center; gap:9px; padding:5px 10px;
          background:rgba(23,29,37,.84); border:1px solid #2c3846; border-radius:11px;
          box-shadow:0 3px 12px rgba(0,0,0,.4); backdrop-filter:blur(4px); }
        .hd-scrubtrack { position:relative; flex:1; min-width:0; height:22px; display:flex; align-items:center; }
        .hd-scrubtrack::before { content:""; position:absolute; left:0; right:0; top:50%;
          height:4px; margin-top:-2px; border-radius:2px; background:#3a4756; }
        .hd-tick { position:absolute; top:50%; width:2px; height:10px; margin-top:-5px;
          border-radius:1px; transform:translateX(-1px); pointer-events:none; z-index:1; }
        .hd-tick.wp { background:#6b7c8d; }
        .hd-tick.step { background:#e0a92e; height:15px; margin-top:-7.5px; width:2.5px; }
        .hd-scrubrange { position:relative; z-index:2; width:100%; margin:0; height:22px;
          background:transparent; -webkit-appearance:none; appearance:none; cursor:pointer; }
        .hd-scrubrange::-webkit-slider-runnable-track { height:4px; background:transparent; }
        .hd-scrubrange::-moz-range-track { height:4px; background:transparent; }
        .hd-scrubrange::-webkit-slider-thumb { -webkit-appearance:none; appearance:none;
          width:16px; height:16px; margin-top:-6px; border-radius:50%; background:#e8eef4;
          border:1px solid #1f4fa3; box-shadow:0 1px 3px rgba(0,0,0,.4); cursor:pointer; }
        .hd-scrubrange::-moz-range-thumb { width:16px; height:16px; border-radius:50%;
          background:#e8eef4; border:1px solid #1f4fa3; cursor:pointer; }
        .hd-scrubtime { flex:none; font-size:11px; color:#93a4b2; font-variant-numeric:tabular-nums; }
        .hd-scrubadd { flex:none; padding:5px 10px; font-size:12px; font-weight:700; color:#cdd8e2;
          background:#26313d; border:1px solid #3a4756; border-radius:8px; cursor:pointer; white-space:nowrap; }
        .hd-scrubadd:disabled { opacity:.4; cursor:default; }
        /* bottom menu bar — owns the chrome so the ice stays clear */
        .hd-bar { position:absolute; z-index:44; left:env(safe-area-inset-left, 0px);
          right:env(safe-area-inset-right, 0px); bottom:0;
          height:calc(54px + var(--hd-b)); padding:0 8px var(--hd-b);
          box-sizing:border-box; display:flex; align-items:center; gap:6px;
          background:#11161c; border-top:1px solid #2a3542; }
        .hd-barbtn { width:46px; height:40px; border-radius:10px; background:#1b232c;
          border:1px solid #33404f; color:#dbe4ec; font-size:17px; display:flex;
          align-items:center; justify-content:center; cursor:pointer; flex:none; }
        .hd-barbtn.on { background:#1f4fa3; border-color:#1f4fa3; }
        .hd-barbtn.draw-on { background:#b58900; border-color:#b58900; }
        .hd-barbtn small { font-size:10px; font-weight:800; letter-spacing:.05em; }
        /* play controls in the bar: desktop only (mobile uses the float dock) */
        .hd-barplay { display:none; font-size:25px; line-height:1; }
        .hd-barplay.play { background:#d7263d; border-color:#d7263d; color:#fff; }
        @media (pointer: fine) and (min-width: 760px) {
          .hd-playdock, .hd-playtab { display:none; }
          .hd-barplay { display:flex; }
          /* no floating top dock on desktop — pinned popups can ride the top edge */
          :root { --hd-pintop: 10px; }
        }
        /* landscape on a touch phone/tablet: vertical room is tight, so dock the
           play controls into the bottom bar instead of the floating top dock */
        @media (pointer: coarse) and (orientation: landscape) {
          .hd-playdock, .hd-playtab { display:none; }
          .hd-barplay { display:flex; }
          :root { --hd-pintop: 10px; }
        }
        .hd-barhint { flex:1 1 0; min-width:0; font-size:12px; color:#8b99a8; text-align:right;
          white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        /* the version never runs off the edge: vN stays put, only the build
           stamp truncates (ellipsis) when the bar is too narrow */
        .hd-ver { flex:0 1 auto; min-width:0; display:flex; align-items:baseline;
          justify-content:flex-end; overflow:hidden; font-size:10px; color:#5b6c7d;
          font-variant-numeric:tabular-nums; letter-spacing:.02em; }
        .hd-vernum { flex:0 0 auto; white-space:nowrap; }
        .hd-verstamp { flex:0 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
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
        /* icon-forward add-tool grid: the photo fills the tile, label underneath */
        .hd-toolgrid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:6px; }
        .hd-toolgrid.compact { grid-template-columns:repeat(4,minmax(0,1fr)); gap:5px; }
        .hd-tool { display:flex; flex-direction:column; align-items:center; justify-content:flex-end; gap:4px;
          padding:8px 5px 6px; border:1px solid #2c3846; background:#0e141c; color:#d3dce6;
          border-radius:10px; cursor:pointer; }
        .hd-tool .hd-toolimg { width:100%; height:46px; object-fit:contain; pointer-events:none;
          filter:drop-shadow(0 1px 2px rgba(0,0,0,.55)); }
        .hd-toolgrid.compact .hd-tool { padding:6px 4px 5px; }
        .hd-toolgrid.compact .hd-tool .hd-toolimg { height:34px; }
        .hd-tool .hd-toolglyph { height:46px; display:flex; align-items:center; justify-content:center; font-size:26px; }
        .hd-toolgrid.compact .hd-tool .hd-toolglyph { height:34px; font-size:20px; }
        .hd-tool span:last-child { font-size:10.5px; font-weight:600; line-height:1; text-align:center; }
        .hd-tool:active, .hd-tool.on { background:#1f4fa3; border-color:#1f4fa3; color:#fff; }
        .hd-note { font-size:11.5px; color:#7d8b99; line-height:1.5; }
        .hd-note code { color:#a8c3da; }
        /* hint text lives in the bottom bar */
        /* text sheet */
        .hd-sheet { position:absolute; inset:0; z-index:50; background:rgba(10,13,17,.96);
          display:flex; flex-direction:column; gap:10px; padding:16px;
          padding-top:calc(16px + env(safe-area-inset-top)); }
        .hd-ta { flex:1; min-height:120px; background:#0f141a; color:#cfe0ee; border:1px solid #2c3846;
          border-radius:8px; font-family:ui-monospace, monospace; font-size:12.5px; padding:8px; resize:none; }
        /* live markdown preview of the coaching notes */
        .hd-mdprev { background:#0f141a; border:1px solid #2c3846; border-radius:8px; padding:10px 12px;
          color:#dbe6f0; font-size:13px; line-height:1.5; max-height:34vh; overflow-y:auto; }
        .hd-mdprev h1,.hd-mdprev h2,.hd-mdprev h3,.hd-mdprev h4 { margin:8px 0 5px; color:#fff; line-height:1.2; }
        .hd-mdprev h1 { font-size:17px; } .hd-mdprev h2 { font-size:15px; } .hd-mdprev h3 { font-size:14px; }
        .hd-mdprev p { margin:6px 0; } .hd-mdprev ul,.hd-mdprev ol { margin:6px 0 6px 20px; }
        .hd-mdprev code { background:#1b232c; padding:1px 5px; border-radius:5px; font-size:12px; color:#a8c3da; }
        .hd-mdprev a { color:#6ea8ff; }
        .hd-err { color:#ff8d9c; font-size:12px; white-space:pre-wrap; }
        .hd-row { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
        .hd-btn { padding:9px 16px; font-size:13.5px; font-weight:600; border:1px solid #2c3846;
          background:#1b232c; color:#e8edf2; border-radius:8px; cursor:pointer; min-height:40px; }
        .hd-btn.primary { background:#d7263d; border-color:#d7263d; }
        /* presentation steps editor */
        .hd-steplist { flex:1; overflow-y:auto; display:flex; flex-direction:column; gap:7px; }
        .hd-stepitem { display:flex; flex-direction:column; gap:6px; }
        .hd-steprow { display:flex; align-items:center; gap:8px; }
        /* inline anchor editor revealed under a step when its chip is tapped */
        .hd-anchoredit { display:flex; align-items:center; gap:7px; flex-wrap:wrap;
          padding:8px 9px; margin-left:2px; background:#161d25; border:1px solid #263140;
          border-radius:8px; }
        .hd-seclabel { display:inline-flex; align-items:center; gap:4px; font-size:12.5px; color:#aeb9c6; }
        .hd-secinput { width:74px; flex:none; padding:6px 8px; font-variant-numeric:tabular-nums; }
        .hd-steptime { flex:none; width:42px; font-size:11px; color:#7d8b99;
          font-variant-numeric:tabular-nums; text-align:right; }
        /* per-step anchor chip: waypoint (blue) vs fixed-time (grey), warn if broken */
        .hd-anchorbtn { flex:none; max-width:104px; overflow:hidden; text-overflow:ellipsis;
          white-space:nowrap; padding:6px 8px; font-size:11px; font-weight:700; line-height:1;
          color:#aeb9c6; background:#232c36; border:1px solid #333f4c; border-radius:7px;
          cursor:pointer; font-variant-numeric:tabular-nums; }
        .hd-anchorbtn.wp { color:#cddffb; background:#1c2b45; border-color:#2c477a; }
        .hd-anchorbtn.bad { color:#ffb0ba; background:#3a2126; border-color:#6b2f38; }
        .hd-anchorbtn.open { box-shadow:0 0 0 1px #1f4fa3 inset; border-color:#1f4fa3; }
        /* presentation caption — floats over the ice; text on top, actions below so
           it reads cleanly on a narrow phone instead of squishing beside the button.
           Default spot is bottom-centre; a saved pos (inline style) overrides it. */
        .hd-preso { position:absolute; z-index:47; box-sizing:border-box; left:50%; transform:translateX(-50%);
          --cap-hw: min(170px, 35vw);   /* max half-width, for the on-screen clamp */
          bottom:calc(64px + var(--hd-b) + var(--hd-scrub)); width:max-content; max-width:min(340px, 70vw);
          display:flex; flex-direction:column; align-items:stretch; gap:9px; padding:12px 15px;
          background:rgba(17,22,28,.95); border:1px solid #3a4756; border-radius:13px;
          box-shadow:0 6px 22px rgba(0,0,0,.5); backdrop-filter:blur(5px); }
        .hd-preso-text { font-size:16px; font-weight:600; color:#eef4fa; line-height:1.35;
          white-space:pre-wrap; overflow-wrap:anywhere; }
        /* read mode: the whole caption is a tap target that advances the hold */
        .hd-preso.tap { cursor:pointer; gap:5px; -webkit-user-select:none; user-select:none; }
        .hd-preso-btn { flex:none; padding:8px 14px; font-size:13px; font-weight:700;
          background:#1f4fa3; border:1px solid #1f4fa3; color:#fff; border-radius:8px; cursor:pointer; }
        /* placement mode: the box is the SAME size the caption plays at (text-sized);
           the text is edited inline and the controls hang above it as tabs. */
        .hd-preso.placing { gap:5px; border-color:#3f6bbf; box-shadow:0 8px 26px rgba(0,0,0,.6); }
        .hd-preso-text[contenteditable] { outline:none; cursor:text; min-width:4.5em; }
        .hd-preso-text[contenteditable]:empty:before { content:attr(data-ph); color:#7d8b99; font-weight:500; }
        /* control tabs: sit just above the box's top edge like folder tabs */
        .hd-preso-tabs { position:absolute; left:8px; top:0; transform:translateY(-100%);
          display:flex; align-items:flex-end; gap:5px; }
        .hd-preso-tab { display:flex; align-items:center; gap:4px; height:26px; padding:0 10px;
          font-size:12px; font-weight:700; line-height:1; white-space:nowrap; cursor:pointer;
          color:#cdd8e2; background:rgba(26,33,41,.97); border:1px solid #3a4756; border-bottom:none;
          border-radius:9px 9px 0 0; -webkit-user-select:none; user-select:none; }
        .hd-preso-tab.move { cursor:grab; touch-action:none; color:#9fb0c2; }
        .hd-preso-tab.move:active { cursor:grabbing; }
        .hd-preso-tab.del { color:#ffb0ba; padding:0 9px; }
        .hd-preso-tab.done { color:#fff; background:#1f4fa3; border-color:#1f4fa3; }
        @media (pointer: fine) and (min-width: 760px) {
          .hd-preso { --cap-hw:min(310px, 30vw); max-width:min(620px, 60vw); gap:12px; padding:16px 20px; bottom:calc(74px + var(--hd-b) + var(--hd-scrub)); }
          .hd-preso-text { font-size:22px; }
          .hd-preso-btn { font-size:15px; padding:9px 16px; }
          .hd-preso.placing { gap:8px; }
          .hd-preso-tab { height:30px; font-size:13px; }
        }
        /* shared bits */
        .hd-swatch { width:24px; height:24px; border-radius:50%; border:2px solid transparent; cursor:pointer; }
        .hd-swatch.on { border-color:#ffd447; }
        .hd-input { background:#0f141a; border:1px solid #2c3846; color:#e8edf2; border-radius:8px;
          padding:7px 9px; font-size:14px; }
        .hd-x { background:none; border:none; color:#8b99a8; cursor:pointer;
          font-size:16px; padding:2px 5px; display:inline-flex; align-items:center; justify-content:center; }
        .hd-x:first-of-type { margin-left:auto; }
        .hd-grip { display:inline-flex; align-items:center; }
        input[type=range] { accent-color:#d7263d; height:30px; }
        .hd-pop.pinned { z-index:43; }   /* just under the play dock, never behind it */
        .hd-pop { position:absolute; z-index:20; box-sizing:border-box; width:256px; border:1px solid #33404f;
          border-radius:12px; padding:10px 12px; box-shadow:0 8px 24px rgba(0,0,0,.5);
          display:flex; flex-direction:column; gap:8px;
          max-height:calc(100% - 8px); overflow-y:auto; overscroll-behavior:contain;
          /* hide the native (flash-and-hide on iOS) bar — we draw our own thumb */
          scrollbar-width:none; -ms-overflow-style:none;
          /* solid fill via background-COLOR so it always covers the box (never
             scrolls, even on the iOS rubber-band overscroll). Only the fade
             covers + shadows are images: a soft scroll shadow that appears at an
             edge ONLY while there's more content that way — reinforces the thumb */
          background-color:#1a222c;
          background-image:
            linear-gradient(#1a222c 30%, rgba(26,34,44,0)),
            linear-gradient(rgba(26,34,44,0), #1a222c 72%),
            radial-gradient(farthest-side at 50% 0, rgba(0,0,0,.55), rgba(0,0,0,0)),
            radial-gradient(farthest-side at 50% 100%, rgba(0,0,0,.6), rgba(0,0,0,0));
          background-position:center top, center bottom, center top, center bottom;
          background-size:100% 30px, 100% 34px, 100% 13px, 100% 15px;
          background-repeat:no-repeat;
          background-attachment:local, local, scroll, scroll; }
        .hd-pop::-webkit-scrollbar { width:0; height:0; display:none; }
        /* custom always-visible scrollbar: a sticky rail pinned to the card's
           top edge; the thumb inside is sized/moved imperatively (works on iOS,
           which ignores ::-webkit-scrollbar for touch overflow) */
        .hd-sbrail { position:sticky; top:0; align-self:stretch; height:0; z-index:5;
          pointer-events:none; order:-1; }
        .hd-sbthumb { position:absolute; top:0; right:-9px; width:5px; border-radius:3px;
          background:#7d93aa; box-shadow:0 0 0 1px rgba(0,0,0,.35); opacity:0;
          transition:opacity .18s; will-change:transform,height; }
        .hd-pophead { display:flex; align-items:center; gap:6px; font-size:12px; font-weight:700;
          letter-spacing:.06em; text-transform:uppercase; color:#aab7c4;
          cursor:grab; touch-action:none; user-select:none; -webkit-user-select:none;
          margin:-10px -12px 0; padding:10px 12px 6px;
          position:sticky; top:-10px; z-index:2; background:#1a222c; }
        .hd-pophead:active { cursor:grabbing; }
        /* title: shrink + single-line (ellipsis) so it never spills to 2 rows */
        .hd-poptitle { flex:1 1 auto; min-width:0; white-space:nowrap; overflow:hidden;
          text-overflow:ellipsis; font-size:11px; letter-spacing:.03em; }
        /* resize handles: a bottom bar (height) + a bottom-right corner (both).
           Sticky so they ride the popup's visible bottom edge while it scrolls;
           margin-top:auto pins the bar to the bottom when the box is taller than
           its content. */
        .hd-resizebar { position:sticky; bottom:-4px; order:99; margin:4px -12px -4px;
          margin-top:auto; align-self:stretch; height:15px; z-index:6;
          pointer-events:none; display:flex; align-items:center; justify-content:center; }
        .hd-resize-h { pointer-events:auto; width:48px; height:15px; cursor:ns-resize;
          touch-action:none; display:flex; align-items:center; justify-content:center; }
        .hd-resize-h::before { content:""; width:40px; height:4px; border-radius:2px; background:#5b6c7d; }
        .hd-resize-h:active::before, .hd-resize-c:active::after { background:#9fb2c6; border-color:#9fb2c6; }
        .hd-resize-c { pointer-events:auto; position:absolute; right:0; bottom:0;
          width:22px; height:15px; cursor:nwse-resize; touch-action:none; }
        .hd-resize-c::after { content:""; position:absolute; right:5px; bottom:4px; width:7px; height:7px;
          border-right:2px solid #7d93aa; border-bottom:2px solid #7d93aa; }
        .hd-grip { color:#5b6c7d; font-size:13px; letter-spacing:0; }
        .hd-poprow { display:flex; align-items:center; gap:7px; flex-wrap:wrap; font-size:12.5px; color:#cdd8e2; }
        .hd-mini { padding:6px 10px; font-size:12.5px; border:1px solid #2c3846; background:#212b36;
          color:#dbe4ec; border-radius:7px; cursor:pointer; min-height:34px;
          display:inline-flex; align-items:center; justify-content:center; gap:5px; }
        .hd-item svg, .hd-mini svg, .hd-btn svg { flex:0 0 auto; }
        .hd-mini.on { background:#1f4fa3; border-color:#1f4fa3; color:#fff; }
        .hd-mini.danger { color:#ff8d9c; border-color:#4a2a30; }
        .hd-select { flex:1 1 auto; min-width:80px; padding:6px 8px; font-size:12.5px; border-radius:7px;
          border:1px solid #2c3846; background:#212b36; color:#dbe4ec; cursor:pointer;
          -webkit-appearance:none; appearance:none;
          background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path d='M1 1l4 4 4-4' stroke='%238b99a8' stroke-width='1.4' fill='none' stroke-linecap='round'/></svg>");
          background-repeat:no-repeat; background-position:right 8px center; padding-right:22px; }
        .hd-select.on { border-color:#1f4fa3; }
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
