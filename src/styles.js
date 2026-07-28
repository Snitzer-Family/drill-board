// All app CSS. Layout/safe-area rules live here — small file, easy pushes.
//
// Colours are ALL semantic tokens from src/theme.js (--db-*), never literals:
// the token blocks are emitted into index.html at build time, so they're live
// before this stylesheet — which React injects — ever mounts. Adding a raw hex
// here fails tests/theme-contrast.mjs; pick the token that means what you want,
// or add one to theme.js if nothing fits.
//
// Geometry vars stay --hd-*; only colour is --db-*.
//
// STYLES is a template literal, so a backtick anywhere in here — including in a
// comment, quoting a property name — ends the string and the file stops parsing.
// The build error then points at the NEXT stray character rather than the
// backtick, and if dist/ doesn't exist yet the copy-preview plugin's ENOENT
// masks it entirely. tests/theme-contrast.mjs pins this; keep prose plain.

export const STYLES = `
        /* Scoped box-sizing reset. The app has no global reset, so by default a
           padded element's stated width/height is its CONTENT box and it renders
           bigger than it says. That produced three separate bugs: the player bar
           said 40px and rendered 50 (its reserved band overlapped the ice), the
           pen palette computed 96px and rendered 102 (same), and .hd-menu said 230px
           and rendered 256 (the JS centring it on 230 put every panel 13px off
           its button). Each was found by measuring, never by reading the CSS.
           Scoped to .hd-root rather than * so nothing outside the app shifts. */
        .hd-root, .hd-root *, .hd-root *::before, .hd-root *::after { box-sizing:border-box; }
        .hd-root { position:fixed; inset:0; background:var(--db-surface-app); color:var(--db-text); overflow:hidden;
          --hd-b: var(--hd-safe-b, min(env(safe-area-inset-bottom, 0px), 34px));
          /* breathing room between the bottom boards and the action bar.
             The band used to be exactly the bar's height, which left the rink
             edge sitting ~4px off the scrubber — they read as one stuck object. */
          --hd-icegap: 10px;
          /* The action bar's height — ONE number for every mode. The pen palette
             and the player bar are alternate CONTENTS of the same element now,
             so they cannot drift apart; they used to be 50 and 54, which read as
             a jump when you switched tools in landscape. It is border-box, so
             this is the rendered height, not a content box to add padding to. */
          --hd-barh: 54px;
          /* The height the bottom MENU bar claims from the layout. A variable
             so presentation can hand it back to the ice — the bar keeps its own
             height (it slides away rather than shrinking), this is only what
             everything else has to keep clear of. */
          --hd-menubar: 54px;
          /* The reserved band the ice gives up to the bar. Derived from the SAME
             --hd-barh that the bar's own height property uses, so they can never
             disagree. There used to be a second variable for a two-row palette
             (--hd-barh2, "measured 102px") and reading either height off the CSS
             by hand was wrong twice; .hd-act's flex-wrap:nowrap now makes a
             second row impossible, so one variable is enough. */
          --hd-act: calc(4px + var(--hd-barh) + var(--hd-icegap));
          /* corner-menu width. The anchoring JS needs this number too, so it is
             asserted against MENU_W in hockey-drill-animator.jsx by the tests —
             if they disagree the menus centre on the wrong spot. */
          --hd-menu-w: 230px;
          --hd-pintop: 10px; /* no floating top dock any more — popups can ride the top edge */
          --hd-dock-w: min(320px, 34vw);   /* width of the docked editing sidebar (desktop) */
          /* the interface typeface, set as a var by the app so one assignment
             reaches every panel and popup. The fallback after the first comma
             is what renders if the var is ever missing. */
          font-family: var(--hd-font, system-ui, -apple-system, "Segoe UI", sans-serif); }
        /* The band = the bar's 4px offset above the menu bar + the bar's REAL
           rendered height + the clearance. An old version hardcoded 48px on the
           assumption that .hd-scrub was its stated height:40px, but it isn't
           border-box — padding and border made it 50 — so the band was 6px SHORT
           and the bar overlapped the ice. That is why the formula above reads
           --hd-barh rather than any literal.
           The band is present in every mode; only these two states drop it. */
        .hd-root.act-off { --hd-act: 0px; }
        /* Presentation: the EDITOR chrome goes and the transport stays. While
           you're showing a drill to a room you still need play, pause and the
           scrubber; what you don't need is Menu, Rink, the mode switch and
           Undo/Redo. So the menu bar slides away and hands its 54px to the ice.
           Revealing it again OVERLAYS — the bar comes up and the transport
           rides above it, but the ice does not move. Re-reserving the space
           would resize the rink every time the chrome came and went, and a
           drill that resizes mid-presentation is the jump this whole layout
           exists to prevent. */
        .hd-root.preso-full { --hd-menubar: 0px; }
        .hd-root.preso-full .hd-bar {
          transform:translateY(100%); transition:transform .22s ease; }
        .hd-root.preso-full.bar-up .hd-bar { transform:none; }
        /* the transport steps up out of the revealed bar's way rather than
           being covered by it — chrome moving is fine, the ice moving is not */
        .hd-root.preso-full .hd-act { transition:transform .22s ease; }
        .hd-root.preso-full.bar-up .hd-act { transform:translateY(calc(-54px - var(--hd-b))); }
        @media (prefers-reduced-motion: reduce) {
          .hd-root.preso-full .hd-bar, .hd-root.preso-full .hd-act { transition:none; }
        }
        /* A still pointer fades out during a presentation, the way a video
           player's does — otherwise a forgotten cursor sits over the ice for a
           whole run-through. !important because the per-piece grab cursors and
           the draw-mode cursor both set their own, and this has to beat them:
           the pointer is idle, so nothing it might be hovering matters. */
        .hd-root.cursor-idle, .hd-root.cursor-idle * { cursor:none !important; }
        /* editing sidebar docked: shrink the ice to the left of it (the stage's
           ResizeObserver re-fits the rink automatically) */
        .hd-root.dock-open .hd-stage { right:calc(env(safe-area-inset-right, 0px) + var(--hd-dock-w)); }
        /* the ice starts below the Dynamic Island / status bar and ends
           above the home-indicator band — iOS 26 standalone composites an
           opaque system bar there that web content cannot render under */
        .hd-stage { position:absolute; top:env(safe-area-inset-top, 0px);
          left:env(safe-area-inset-left, 0px); right:env(safe-area-inset-right, 0px);
          bottom:calc(var(--hd-menubar) + var(--hd-b) + var(--hd-act));
          display:flex; align-items:center; justify-content:center; }
        /* Desktop: the ice shows what the pointer will DO. The !important beats
           the per-piece grab cursors, which is right — in draw mode nothing on
           the ice is grabbable anyway. Hotspot sits on the nib / rubbing edge.
           The cursor art is a fixed data-URI: a cursor image can't take var(),
           and white-on-black reads against both a light and a dark rink. */
        .hd-root.draw-cursor .hd-canvas, .hd-root.draw-cursor .hd-canvas * {
          cursor: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24'%3E%3Cpath d='M3.5 20.5l1.1-4 11-11 2.9 2.9-11 11z' fill='%23fff' stroke='%23111' stroke-width='1.5' stroke-linejoin='round'/%3E%3Cpath d='M14.1 6.9l2.9 2.9' stroke='%23111' stroke-width='1.5'/%3E%3C/svg%3E") 3 21, crosshair !important; }
        .hd-root.erase-cursor .hd-canvas, .hd-root.erase-cursor .hd-canvas * {
          cursor: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24'%3E%3Cpath d='M3.5 16.2l8.3-8.3 6 6-4.3 4.3H6.2z' fill='%23fff' stroke='%23111' stroke-width='1.5' stroke-linejoin='round'/%3E%3Cpath d='M8.6 11.1l6 6' stroke='%23111' stroke-width='1.5'/%3E%3C/svg%3E") 4 17, cell !important; }
        .hd-canvas { position:relative; }
        .hd-canvas svg.hd-ice { width:100%; height:100%; display:block; }
        .hd-stage, .hd-canvas, .hd-canvas svg, .hd-canvas svg * { touch-action:none;
          -webkit-user-select:none; user-select:none; -webkit-touch-callout:none; }
        /* ---- the action bar ----------------------------------------------
           ONE strip above the menu bar whose CONTENTS change with what you're
           doing: the pen palette while sketching (.draw), transport + seek
           scrubber while playing (.play). It used to be two separate elements
           at two different heights fighting for the same slot, so the ice jogged
           when you switched between them. It sits in its own reserved band
           (--hd-act) and never overlaps the ice sheet. */
        .hd-act { position:absolute; z-index:44; left:8px; right:8px;
          bottom:calc(var(--hd-menubar) + var(--hd-b) + 4px);
          box-sizing:border-box; height:var(--hd-barh);
          display:flex; align-items:center; gap:6px; padding:4px 8px;
          /* The single-line guarantee: content can never spill onto a second row
             the way the old palette did (which is what --hd-barh2 existed to
             reserve space for), so the bar's height is always --hd-barh and the
             band that reserves it can never be short.
             Deliberately NOT overflow:hidden — the size/style popovers are
             children of this bar and spring UPWARD out of its box, so clipping
             here would make them invisible. Too-wide contents therefore spill
             past the rounded edge, which looks obviously broken; the real guard
             is the measured scrollWidth <= clientWidth check in bar-fit.mjs. */
          flex-wrap:nowrap;
          background:var(--db-fx-glass); border:1px solid var(--db-border); border-radius:12px;
          box-shadow:var(--db-fx-shadow); backdrop-filter:blur(4px); }
        /* the pen palette centres its two groups; the player bar is left-fed */
        .hd-act.draw { justify-content:center; gap:4px; padding:5px 7px; }
        .hd-act.edit { gap:4px; padding:5px 7px; }
        /* the bar's one flexible child: it soaks up the slack and ellipses, so a
           long hint can never push a control off the end of the line */
        .hd-acthint { flex:1 1 0; min-width:0; font-size:12px; color:var(--db-text-muted);
          text-align:right; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        /* transport buttons */
        .hd-scrubbtn { flex:none; width:32px; height:32px; border-radius:9px; background:var(--db-surface-raised);
          border:1px solid var(--db-border-strong); color:var(--db-text-soft); display:flex; align-items:center;
          justify-content:center; cursor:pointer; }
        .hd-scrubbtn.on { background:var(--db-accent); border-color:var(--db-accent); color:var(--db-text-on-accent); }
        /* "lines while playing" — the glyph IS the answer rather than a symbol
           standing for it: a solid route line over a dashed puck path, each lit
           or dimmed to match what will actually be drawn. Four states read at a
           glance without a label, which is what the bar has room for. */
        .hd-scrubbtn.rv { flex-direction:column; gap:4px; }
        .hd-rvline { width:15px; height:0; border-top:2px solid currentColor;
          opacity:.2; transition:opacity .12s; }
        .hd-rvpuck { display:flex; align-items:center; gap:2px; opacity:.2; transition:opacity .12s; }
        .hd-rvpuck::before { content:""; width:9px; height:0; border-top:2px dashed currentColor; }
        .hd-rvpuck::after { content:""; width:4px; height:4px; border-radius:50%; background:currentColor; }
        .hd-rvline.on, .hd-rvpuck.on { opacity:1; }
        /* speed reads out its own multiple, so it needs no icon and no label
           next to it. Tabular figures keep the glyph from shifting as it
           cycles, and it lights only when it is NOT 1x — a drill running at
           normal pace should look like nothing special is set. */
        .hd-scrubbtn.spd { font-size:12.5px; font-weight:650; letter-spacing:-.02em;
          font-variant-numeric:tabular-nums; }
        /* the transport's three clusters: what the clock is doing, how the ice
           looks while it runs, and the two that are not playback at all. On a
           phone the grouping is spacing only — a hairline pair costs ~26px and
           the scrub track has no width to give at 375. */
        .hd-scrubgrp { flex:none; display:flex; align-items:center; gap:6px; }
        .hd-scrubsep { flex:none; width:1px; height:26px; background:var(--db-border-strong); margin:0 3px; }
        .hd-root:not(.dense) .hd-scrubsep { display:none; }
        .hd-root:not(.dense) .hd-scrubgrp + .hd-scrubgrp { margin-left:4px; }
        .hd-scrubbtn:disabled { opacity:.4; cursor:default; }
        /* the play button is the one piece of chrome wearing a DOMAIN colour —
           hockey red — so it keeps its own token rather than the accent */
        .hd-scrubbtn.play { width:34px; height:34px; border-radius:50%;
          background:var(--db-brand-red); border-color:var(--db-brand-red);
          color:var(--db-text-on-accent); margin-right:2px; }
        /* ---- pen palette (the .hd-act.draw contents) ---- */
        /* two groups — the pen's own settings, then what happens to the board.
           Both stay on the single line at every width: the narrow layout swaps
           ink/size/style for one popover button rather than wrapping. */
        .hd-pengroup { display:flex; align-items:center; gap:4px; flex-wrap:nowrap; }
        .hd-pensep { flex:none; width:1px; height:26px; background:var(--db-border-strong); margin:0 3px; }
        .hd-penspacer { flex:1 1 auto; min-width:0; display:flex; align-items:center;
          overflow:hidden; padding:0 4px; }
        /* labelled tool: icon over a caption, like the bottom bar */
        .hd-pentool { flex:none; min-width:44px; height:42px; padding:3px 5px 2px;
          display:flex; flex-direction:column; align-items:center; justify-content:center; gap:2px;
          border-radius:9px; background:var(--db-surface-raised); border:1px solid var(--db-border-strong); color:var(--db-text-soft);
          cursor:pointer; font-size:8.5px; font-weight:700; letter-spacing:.03em;
          text-transform:uppercase; line-height:1; }
        /* a two-word caption stays on ONE line — wrapping would blow the
           chip's fixed 42px height and with it the bar's single-line promise */
        .hd-pentool > span:last-child { opacity:.75; white-space:nowrap; }
        /* a piece sprite used as a bar chip's icon. .hd-toolimg is sized for the
           big grid tiles (46px tall, full width); inside a 42px-tall bar button
           it has to come down to icon scale. */
        .hd-pentool .hd-toolimg { width:24px; height:20px; flex:none; }
        .hd-actglyph { font-size:17px; line-height:1; }
        /* what the bar is currently acting ON — a piece id, or the size of a
           box-selection. Reads as a label, not a button, so it must not look
           tappable; it shrinks before any control does. */
        .hd-selchip { flex:0 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis;
          white-space:nowrap; padding:0 7px; font-size:11.5px; font-weight:700;
          letter-spacing:.02em; color:var(--db-text); }
        /* naming a box-selection, inline on the bar (it used to be a hand-rolled
           input in the floating toolbar, with its own hardcoded colours) */
        .hd-groupname { flex:0 1 96px; min-width:64px; padding:6px 8px; font-size:12px;
          border-radius:7px; border:1px solid var(--db-border-strong);
          background:var(--db-surface-sunken); color:var(--db-text); }
        .hd-pentool.on { background:var(--db-accent); border-color:var(--db-accent); color:var(--db-text-on-accent); }
        .hd-pentool.on > span:last-child { opacity:1; }
        .hd-pentool.danger { color:var(--db-danger); }
        /* Compact layout — a narrow phone can't fit every control at full size.
           Keyed on the .dense class the app writes from one matchMedia query,
           NOT on a media query of its own: the same breakpoint also decides
           which controls REACT renders (compact swaps the ink / size / style
           trio for one popover), and a stylesheet can't do that. One source of
           truth, so the two halves can't disagree about which layout is live. */
        .hd-root:not(.dense) .hd-act { gap:3px; }
        /* the bottom bar is the tightest strip in the app at 375px — Menu, Rink,
           the three-way mode switch and Undo/Redo all have to fit and still
           leave the version watermark legible, since that is how a deploy gets
           verified. Measured, not derived: see bar-fit.mjs. */
        .hd-root:not(.dense) .hd-bar { gap:4px; padding:0 6px var(--hd-b); }
        .hd-root:not(.dense) .hd-barbtn { width:44px; }
        .hd-root:not(.dense) .hd-mode { --mw:40px; }
        .hd-root:not(.dense) .hd-act.draw { padding:5px 5px; }
        .hd-root:not(.dense) .hd-pentool { min-width:40px; padding:3px 3px 2px; }
        .hd-root:not(.dense) .hd-penswatch { width:24px; height:24px; }
        .hd-root:not(.dense) .hd-peninks { gap:3px; }
        .hd-root:not(.dense) .hd-pensep { margin:0 1px; }
        /* size / style popovers spring upward from their own button */
        .hd-penwrap { position:relative; display:flex; }
        .hd-penpop { position:absolute; bottom:calc(100% + 6px); left:50%; transform:translateX(-50%);
          display:flex; flex-direction:column; align-items:center; gap:4px; padding:8px 6px;
          background:var(--db-surface-panel); border:1px solid var(--db-border-strong); border-radius:10px;
          box-shadow:var(--db-fx-shadow-lg); z-index:46; }
        /* the compact "Ink" popover stacks all three line settings — colour,
           thickness, style — under one button. Its swatches are the only thing
           in a popover that wraps, so they get their own grid. */
        .hd-penpop .hd-inkgrid { display:grid; grid-template-columns:repeat(4, auto); gap:6px; }
        /* The add-group popovers reuse .hd-toolgrid, which sizes its columns in
           1fr — fine inside a menu panel that has a width, but this popover is a
           shrink-to-fit column flexbox, so 1fr resolved to ZERO and every tile
           stacked in a 10px stripe. Fixed columns instead, so the popover takes
           its width from the grid rather than the other way round.
           The selector carries .compact because the base .hd-toolgrid.compact
           rule is equally specific and declared later — a looser one loses. */
        .hd-penpop .hd-toolgrid.compact { grid-template-columns:repeat(4, 66px); }
        .hd-penpop .hd-toolgrid.compact .hd-tool .hd-toolimg { height:30px; }
        /* …and on a narrow screen that grid is wider than the button it hangs
           off, so centring on the button pushes it past the screen edge. Anchor
           it to the BAR instead — the same answer the corner menus reach below
           this breakpoint, and it cannot clip wherever the button sits.
           position:static on the wrap is what re-points the popover's containing
           block at .hd-act, so its bottom:100% then measures the bar. */
        .hd-root:not(.dense) .hd-act .hd-penwrap { position:static; }
        .hd-root:not(.dense) .hd-act .hd-penpop.grid { left:8px; right:8px; transform:none; }
        /* …but a NARROW popover must still point at the button that opened it.
           position:static above re-points the containing block at the bar, so
           the base left:50% centres these on the BAR — which put the play bar's
           folded loop/presentation/caption menu 162px away from the button at
           the far right, floating over the middle of the transport. It is only
           116px wide, so it cannot clip: anchor it to the bar's right edge,
           where its button lives. */
        .hd-root:not(.dense) .hd-act .hd-penpop.more { left:auto; right:8px; transform:none; }
        .hd-penpop .hd-penrule { width:100%; height:1px; background:var(--db-border-strong); margin:2px 0; }
        .hd-penpoptip { font-size:10px; font-weight:700; color:var(--db-text-muted); }
        /* Vertical range: the modern property first, then the WebKit one older
           iOS needs. Selector is deliberately specific — the global
           input[type=range] rule below outranks a lone class and would pin the
           height back to 30px. */
        .hd-penpop input.hd-penrange { writing-mode:vertical-rl; direction:rtl;
          -webkit-appearance:slider-vertical; appearance:slider-vertical;
          width:26px; height:150px; accent-color:var(--db-accent); }
        .hd-penpop.menu { padding:5px; }
        .hd-penopt { display:flex; align-items:center; gap:8px; width:104px; padding:7px 9px;
          border-radius:8px; background:transparent; border:1px solid transparent; color:var(--db-text-soft);
          font-size:11px; font-weight:600; cursor:pointer; text-align:left; }
        .hd-penopt.on { background:var(--db-accent); border-color:var(--db-accent); color:var(--db-text-on-accent); }
        .hd-penopt .hd-penstyle { flex:none; }
        /* Inks as squares. The round chips read as PIECES — a puck, a player
           dot — which is what round means everywhere else on this board; a
           square says "a colour", the way a paint well does. */
        .hd-peninks { display:flex; align-items:center; gap:4px; }
        .hd-penswatch { flex:none; width:27px; height:27px; border-radius:5px;
          border:1px solid var(--db-border-strong); cursor:pointer; padding:0; }
        /* same "this one is selected" token as .hd-swatch.on — one meaning, one colour */
        .hd-penswatch.on { outline:2px solid var(--db-ui-select); outline-offset:2px; }
        /* Thickness and style previews follow the BUTTON's colour, never the
           ink — black ink on a dark bar would make them vanish, and these need
           to stay readable whatever you're drawing with. */
        .hd-penwdot { display:block; width:16px; border-radius:2px; background:currentColor; }
        /* line-style preview drawn with borders in the button's colour */
        .hd-penstyle { display:block; width:18px; height:0; border-top:2.5px solid currentColor; }
        .hd-penstyle.dashed { border-top-style:dashed; }
        .hd-penstyle.dotted { border-top-style:dotted; }
        .hd-penstyle.wavy { border-top:none; height:8px;
          background:radial-gradient(circle at 3px 6px, transparent 2.4px, currentColor 2.4px 3.4px, transparent 3.5px),
                     radial-gradient(circle at 9px 2px, transparent 2.4px, currentColor 2.4px 3.4px, transparent 3.5px);
          background-size:12px 8px; background-repeat:repeat-x; }
        .hd-scrubtrack { position:relative; flex:1; min-width:0; height:22px; display:flex; align-items:center; margin:0 4px; }
        .hd-scrubtrack::before { content:""; position:absolute; left:0; right:0; top:50%;
          height:4px; margin-top:-2px; border-radius:2px; background:var(--db-track); }
        .hd-tick { position:absolute; top:50%; width:2px; height:10px; margin-top:-5px;
          border-radius:1px; transform:translateX(-1px); pointer-events:none; z-index:1; }
        .hd-tick.wp { background:var(--db-text-muted); }
        .hd-tick.step { background:var(--db-warn); height:15px; margin-top:-7.5px; width:2.5px; }
        .hd-scrubrange { position:relative; z-index:2; width:100%; margin:0; height:22px;
          background:transparent; -webkit-appearance:none; appearance:none; cursor:pointer; }
        .hd-scrubrange::-webkit-slider-runnable-track { height:4px; background:transparent; }
        .hd-scrubrange::-moz-range-track { height:4px; background:transparent; }
        .hd-scrubrange::-webkit-slider-thumb { -webkit-appearance:none; appearance:none;
          width:20px; height:20px; margin-top:-8px; border-radius:50%; background:var(--db-track-thumb);
          border:1px solid var(--db-accent); box-shadow:var(--db-fx-shadow); cursor:pointer; }
        .hd-scrubrange::-moz-range-thumb { width:20px; height:20px; border-radius:50%;
          background:var(--db-track-thumb); border:1px solid var(--db-accent); cursor:pointer; }
        .hd-scrubtime { flex:none; font-size:11px; color:var(--db-text-muted); font-variant-numeric:tabular-nums; }
        /* bottom menu bar — owns the chrome so the ice stays clear */
        .hd-bar { position:absolute; z-index:44; left:env(safe-area-inset-left, 0px);
          right:env(safe-area-inset-right, 0px); bottom:0;
          height:calc(54px + var(--hd-b)); padding:0 8px var(--hd-b);
          box-sizing:border-box; display:flex; align-items:center; gap:6px;
          /* explicit, same reason as .hd-act: this bar's height is baked into
             .hd-stage's bottom offset, so a wrapped second row would sit on
             the ice with nothing reserved for it */
          flex-wrap:nowrap;
          background:var(--db-surface-bar); border-top:1px solid var(--db-border); }
        .hd-barbtn { width:50px; height:44px; border-radius:10px; background:var(--db-surface-raised);
          border:1px solid var(--db-border-strong); color:var(--db-text-soft); font-size:17px; display:flex;
          flex-direction:column; gap:2px; align-items:center; justify-content:center;
          cursor:pointer; flex:none; }
        .hd-barbtn.on { background:var(--db-accent); border-color:var(--db-accent); color:var(--db-text-on-accent); }
        .hd-barbtn small { font-size:10px; font-weight:800; letter-spacing:.05em; }
        /* DRAW · EDIT · PLAY as ONE control: a knob slides to the live flow, so
           the mode reads as a position rather than three independent lights.
           --mw ties the knob's travel to the cell width — the compact override
           below only has to change that one number.
           border-box on all three parts, deliberately: the app has no global
           reset, and when a two-position ancestor of this control was
           content-box each cell measured --mw PLUS its padding while the knob
           only travelled --mw, so it stopped short and dragged the labels off
           centre. */
        /* Shared by the bottom bar's DRAW/EDIT/PLAY switch and the draw bar's
           pen segment. The mode switch keeps its own class names because the
           browser suites select .hd-modeopt.draw by name; the two share these
           rules rather than a second copy of the knob maths. */
        .hd-mode, .hd-modeknob, .hd-modeopt,
        .hd-seg, .hd-segknob, .hd-segopt { box-sizing:border-box; }
        .hd-mode, .hd-seg { --mw:44px; position:relative; flex:none; display:flex; height:44px;
          padding:3px; border-radius:10px; background:var(--db-surface-sunken);
          border:1px solid var(--db-border-strong); }
        .hd-modeknob, .hd-segknob { position:absolute; top:3px; bottom:3px; left:3px; width:var(--mw);
          border-radius:8px; background:var(--db-accent); transition:transform .16s ease;
          pointer-events:none; }
        .hd-mode.edit .hd-modeknob { transform:translateX(var(--mw)); }
        .hd-mode.play .hd-modeknob { transform:translateX(calc(var(--mw) * 2)); }
        .hd-modeopt, .hd-segopt { position:relative; z-index:1; flex:none; width:var(--mw);
          display:flex; flex-direction:column; align-items:center; justify-content:center; gap:2px;
          padding:2px; background:none; border:none; color:var(--db-text-muted); cursor:pointer; }
        /* Match on the cell's OWN class, never its position: the knob is a
           sibling too, so :nth-child counts it and lights the wrong cell. */
        .hd-mode.draw .hd-modeopt.draw,
        .hd-mode.edit .hd-modeopt.edit,
        .hd-mode.play .hd-modeopt.play { color:var(--db-text-on-accent); }
        /* the knob is what shows "you are here", so a dimmed PLAY cell must not
           also dim the knob sitting under it */
        .hd-modeopt:disabled, .hd-segopt:disabled { opacity:.4; cursor:default; }
        /* the pen segment: what the pen does with your ink. Sized to sit level
           with the .hd-pentool buttons beside it (42px), with cells wide enough
           for a word rather than a four-letter caption. */
        .hd-penseg { --mw:52px; height:42px; }
        .hd-penseg .hd-segopt { font-size:8.5px; font-weight:700; letter-spacing:.03em; }
        .hd-penseg.sketch .hd-segknob { transform:none; }
        .hd-penseg.manual .hd-segknob { transform:translateX(var(--mw)); }
        .hd-penseg.auto .hd-segknob { transform:translateX(calc(var(--mw) * 2)); }
        .hd-penseg.sketch .hd-segopt.sketch,
        .hd-penseg.manual .hd-segopt.manual,
        .hd-penseg.auto .hd-segopt.auto { color:var(--db-text-on-accent); }
        /* what the pen will do, in words, in the bar's flexible slack */
        .hd-pensays { flex:1 1 auto; min-width:0; font-size:11.5px; color:var(--db-text-muted);
          white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        /* caption under each bar icon — tooltips don't exist on touch */
        .hd-blbl { font-size:8.5px; font-weight:700; letter-spacing:.05em; line-height:1;
          text-transform:uppercase; opacity:.8; white-space:nowrap; }
        /* the bar's one flexible child: what you're DOING sits left of it,
           where things LIVE sits right of it */
        .hd-barspacer { flex:1 1 auto; min-width:0; }
        /* The version row at the foot of the menu — the watermark left the
           bottom bar so that bar could be controls only. The build stamp is
           what you check after a deploy, so it keeps its tabular figures and
           truncates from the stamp end, never from vN. */
        .hd-verrow { font-variant-numeric:tabular-nums; letter-spacing:.02em; }
        .hd-vernum { flex:0 0 auto; white-space:nowrap; font-weight:700; }
        .hd-verstamp { flex:0 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis;
          white-space:nowrap; font-size:11px; color:var(--db-text-faint); }
        /* corner menus — same scroll-shadow cue as .hd-pop: a soft edge shadow
           appears only while more content lies that way (iOS hides the native
           bar for touch overflow, so without this a long menu reads as complete).
           The gradients fade to --db-surface-panel-0, NOT the transparent
           keyword: Safari interpolates that through premultiplied black and
           hazes the fade edge. */
        /* border-box so --hd-menu-w IS the rendered width: with the default
           content-box the 12px padding and 1px border made a "230px" menu
           actually 256px, and the JS that centres it on 230 put every panel
           13px off its button. */
        .hd-menu { position:absolute; z-index:45; box-sizing:border-box;
          border:1px solid var(--db-border-strong);
          border-radius:12px; padding:10px 12px; box-shadow:var(--db-fx-shadow-lg);
          /* clears the action bar as well as the menu bar. Some of these panels
             are now opened from a button ON the action bar (Add, in Edit), and
             anchoring only to the menu bar's height dropped the panel straight
             over the button that opened it. */
          bottom:calc(var(--hd-menubar) + 8px + var(--hd-b) + var(--hd-act));
          left:calc(10px + env(safe-area-inset-left, 0px));
          display:flex; flex-direction:column; gap:8px; width:var(--hd-menu-w);
          /* Never let the panel climb past the status bar. 70vh alone doesn't
             know about the notch or about how much the bars below have already
             taken, so on a short screen (a phone in landscape especially) the
             top of the list ended up above the safe area and simply couldn't be
             read. This is the height actually available over the bars. */
          max-height:min(70vh, calc(100vh - var(--hd-menubar) - 8px - var(--hd-b)
            - var(--hd-act) - env(safe-area-inset-top, 0px) - 10px));
          overflow-y:auto;
          scrollbar-width:none; -ms-overflow-style:none;
          background-color:var(--db-surface-panel);
          background-image:
            linear-gradient(var(--db-surface-panel) 30%, var(--db-surface-panel-0)),
            linear-gradient(var(--db-surface-panel-0), var(--db-surface-panel) 72%),
            radial-gradient(farthest-side at 50% 0, var(--db-fx-edge), var(--db-fx-edge-0)),
            radial-gradient(farthest-side at 50% 100%, var(--db-fx-edge), var(--db-fx-edge-0));
          background-position:center top, center bottom, center top, center bottom;
          background-size:100% 30px, 100% 34px, 100% 13px, 100% 15px;
          background-repeat:no-repeat;
          background-attachment:local, local, scroll, scroll; }
        .hd-menu::-webkit-scrollbar { width:0; height:0; display:none; }
        /* All four corner menus anchor the SAME way — they used to have three
           different rules plus one JS override, so which button you tapped had
           no relation to where the panel appeared (Tune's opened under Menu).
           Wide: the animator measures the button and centres the panel over it
           (inline left), clamped to the viewport.
           Narrow: no inline left is written at all, and this rule stretches the
           panel to the bottom bar's own insets — one position for all four, it
           can never clip, and the extra width suits the long labels. The
           breakpoint matches the pen palette's, so a device doesn't change
           personality between the two. */
        @media (max-width: 699px) {
          .hd-menu { left:calc(8px + env(safe-area-inset-left, 0px));
            right:calc(8px + env(safe-area-inset-right, 0px)); width:auto; }
        }
        .hd-mh { font-size:11px; letter-spacing:.12em; text-transform:uppercase; color:var(--db-text-muted); }
        /* ---- a settings row ----------------------------------------------
           Title, a line saying what the setting actually does, then its
           control. Everything in the prefs panel takes this shape so a reader
           can scan titles and only drop into the prose for the ones they don't
           already know — which is most of them, since several change how the
           simulation behaves rather than how it looks. */
        .hd-pref { display:flex; flex-direction:column; gap:2px; width:100%;
          padding:9px 10px; border-radius:9px; text-align:left;
          background:var(--db-surface-raised); border:1px solid var(--db-border); }
        /* the whole row is the target for a toggle — 44pt-ish rather than the
           30px the switch alone would give, which matters with gloves on */
        .hd-pref.toggle { cursor:pointer; }
        .hd-pref.dim { opacity:.5; }
        .hd-prefhead { display:flex; align-items:center; gap:10px; min-height:22px; }
        .hd-preftitle { flex:1 1 auto; min-width:0; font-size:13.5px; font-weight:650;
          color:var(--db-text); line-height:1.25; }
        .hd-prefdesc { font-size:11.5px; line-height:1.45; color:var(--db-text-muted); }
        .hd-prefctl { margin-top:6px; }
        .hd-pills { display:flex; flex-wrap:wrap; gap:4px; justify-content:flex-end; }
        /* a section heading inside the panel, with air above it */
        .hd-prefsec { margin-top:6px; color:var(--db-text-faint); }
        /* the settings sheet's scrolling body. max-width caps the MEASURE —
           prose set the full width of a desktop is hard to track back to the
           start of the next line, and these are paragraphs now, not labels. */
        .hd-prefbody { flex:1; min-height:0; overflow-y:auto; overscroll-behavior:contain;
          display:flex; flex-direction:column; gap:8px;
          width:100%; max-width:560px; margin:0 auto; padding-right:2px; }
        .hd-prefwarn { font-size:11.5px; line-height:1.5; color:var(--db-warn);
          padding:7px 9px; border-radius:8px;
          background:var(--db-surface-sunken); border:1px solid var(--db-border); }
        .hd-item { display:flex; align-items:center; gap:8px; padding:9px 10px; font-size:14px;
          border:1px solid var(--db-border); background:var(--db-surface-raised); color:var(--db-text-soft); border-radius:8px;
          cursor:pointer; text-align:left; }
        .hd-item.on { background:var(--db-accent); border-color:var(--db-accent); color:var(--db-text-on-accent); }
        .hd-item.danger { color:var(--db-danger); border-color:var(--db-danger-border); }
        /* menu-item grammar: a trailing chevron marks rows that open another
           surface; a mini switch marks toggles (state without filling the row) */
        .hd-chev { margin-left:auto; color:var(--db-text-faint); display:inline-flex; }
        .hd-sw { margin-left:auto; flex:none; width:30px; height:18px; border-radius:9px;
          background:var(--db-track); position:relative; transition:background .15s; }
        .hd-sw::after { content:""; position:absolute; top:2px; left:2px; width:14px; height:14px;
          border-radius:50%; background:var(--db-track-thumb); transition:transform .15s, background .15s; }
        .hd-sw.on { background:var(--db-accent); }
        .hd-sw.on::after { transform:translateX(12px); background:var(--db-track-thumb); }
        /* icon-forward add-tool grid: the photo fills the tile, label underneath */
        .hd-toolgrid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:6px; }
        .hd-toolgrid.compact { grid-template-columns:repeat(4,minmax(0,1fr)); gap:5px; }
        .hd-tool { display:flex; flex-direction:column; align-items:center; justify-content:flex-end; gap:4px;
          padding:8px 5px 6px; border:1px solid var(--db-border); background:var(--db-surface-sunken); color:var(--db-text-soft);
          border-radius:10px; cursor:pointer; }
        .hd-tool .hd-toolimg { width:100%; height:46px; object-fit:contain; pointer-events:none;
          filter:drop-shadow(0 1px 2px var(--db-fx-edge)); }
        .hd-toolgrid.compact .hd-tool { padding:6px 4px 5px; }
        .hd-toolgrid.compact .hd-tool .hd-toolimg { height:34px; }
        .hd-tool .hd-toolglyph { height:46px; display:flex; align-items:center; justify-content:center; font-size:26px; }
        .hd-toolgrid.compact .hd-tool .hd-toolglyph { height:34px; font-size:20px; }
        .hd-tool span:last-child { font-size:10.5px; font-weight:600; line-height:1; text-align:center; }
        .hd-tool:active, .hd-tool.on { background:var(--db-accent); border-color:var(--db-accent); color:var(--db-text-on-accent); }
        .hd-note { font-size:11.5px; color:var(--db-text-muted); line-height:1.5; }
        .hd-note code { color:var(--db-text-soft); }
        /* hint text lives in the bottom bar */
        /* text sheet */
        .hd-sheet { position:absolute; inset:0; z-index:50; background:var(--db-fx-scrim);
          display:flex; flex-direction:column; gap:10px; padding:16px;
          padding-top:calc(16px + env(safe-area-inset-top)); }
        /* tool-swap mini buttons in the piece popup */
        .hd-swapbtn { padding:4px 7px; }
        .hd-swapbtn .hd-toolimg { width:24px; height:19px; display:block; pointer-events:none; }
        /* photo-import busy spinner */
        .hd-spinner { width:34px; height:34px; border-radius:50%; border:3px solid var(--db-border);
          border-top-color:var(--db-info); animation:hd-spin 0.9s linear infinite; }
        @keyframes hd-spin { to { transform:rotate(360deg); } }
        .hd-ta { flex:1; min-height:120px; background:var(--db-surface-sunken); color:var(--db-text-soft); border:1px solid var(--db-border);
          border-radius:8px; font-family:ui-monospace, monospace; font-size:12.5px; padding:8px; resize:none; }
        /* live markdown preview of the coaching notes */
        .hd-mdprev { background:var(--db-surface-sunken); border:1px solid var(--db-border); border-radius:8px; padding:10px 12px;
          color:var(--db-text-soft); font-size:13px; line-height:1.5; max-height:34vh; overflow-y:auto; }
        .hd-mdprev h1,.hd-mdprev h2,.hd-mdprev h3,.hd-mdprev h4 { margin:8px 0 5px; color:var(--db-text); line-height:1.2; }
        .hd-mdprev h1 { font-size:17px; } .hd-mdprev h2 { font-size:15px; } .hd-mdprev h3 { font-size:14px; }
        .hd-mdprev p { margin:6px 0; } .hd-mdprev ul,.hd-mdprev ol { margin:6px 0 6px 20px; }
        .hd-mdprev code { background:var(--db-surface-raised); padding:1px 5px; border-radius:5px; font-size:12px; color:var(--db-text-soft); }
        .hd-mdprev a { color:var(--db-info); }
        .hd-err { color:var(--db-danger); font-size:12px; white-space:pre-wrap; }
        .hd-row { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
        /* inline-flex so an icon and its label sit on one line — as a plain
           block the Icon's display:block pushed the text onto a second row */
        .hd-btn { display:inline-flex; align-items:center; justify-content:center; gap:6px;
          padding:9px 16px; font-size:13.5px; font-weight:600; border:1px solid var(--db-border);
          background:var(--db-surface-raised); color:var(--db-text); border-radius:8px; cursor:pointer; min-height:40px; }
        .hd-btn.primary { background:var(--db-accent); border-color:var(--db-accent); color:var(--db-text-on-accent); }
        .hd-btn.danger { color:var(--db-danger); border-color:var(--db-danger-border); }
        /* A button that LEAVES the surface you're on. Kept apart from whatever
           sits beside it — margin-left:auto throws it to the far end of the row
           — and filled, so it can't be confused with the actions next to it. A
           mis-tap here abandons what you were doing, so proximity is the risk,
           not visibility. */
        .hd-btn.exit { margin-left:auto; min-width:92px; font-weight:700;
          background:var(--db-accent); border-color:var(--db-accent); color:var(--db-text-on-accent); }
        /* the same idea on the action bar: an exit chip sits clear of the run of
           controls, with a rule between it and them */
        .hd-pentool.exit { margin-left:8px; border-color:var(--db-focus); color:var(--db-focus); }
        /* presentation steps editor */
        .hd-steplist { flex:1; overflow-y:auto; display:flex; flex-direction:column; gap:7px; }
        .hd-stepitem { display:flex; flex-direction:column; gap:6px; }
        .hd-steprow { display:flex; align-items:center; gap:8px; }
        /* inline anchor editor revealed under a step when its chip is tapped */
        .hd-anchoredit { display:flex; align-items:center; gap:7px; flex-wrap:wrap;
          padding:8px 9px; margin-left:2px; background:var(--db-surface-sunken); border:1px solid var(--db-border);
          border-radius:8px; }
        .hd-seclabel { display:inline-flex; align-items:center; gap:4px; font-size:12.5px; color:var(--db-text-soft); }
        .hd-secinput { width:74px; flex:none; padding:6px 8px; font-variant-numeric:tabular-nums; }
        .hd-steptime { flex:none; width:42px; font-size:11px; color:var(--db-text-muted);
          font-variant-numeric:tabular-nums; text-align:right; }
        /* per-step anchor chip: waypoint (blue) vs fixed-time (grey), warn if broken */
        .hd-anchorbtn { flex:none; max-width:104px; overflow:hidden; text-overflow:ellipsis;
          white-space:nowrap; padding:6px 8px; font-size:11px; font-weight:700; line-height:1;
          color:var(--db-text-soft); background:var(--db-surface-raised); border:1px solid var(--db-border-strong); border-radius:7px;
          cursor:pointer; font-variant-numeric:tabular-nums; }
        .hd-anchorbtn.wp { color:var(--db-info); background:var(--db-info-bg); border-color:var(--db-info-border); }
        .hd-anchorbtn.bad { color:var(--db-danger); background:var(--db-danger-bg); border-color:var(--db-danger-border); }
        .hd-anchorbtn.open { box-shadow:0 0 0 1px var(--db-accent) inset; border-color:var(--db-accent); }
        /* presentation caption — floats over the ice; text on top, actions below so
           it reads cleanly on a narrow phone instead of squishing beside the button.
           Default spot is bottom-centre; a saved pos (inline style) overrides it. */
        .hd-preso { position:absolute; z-index:47; box-sizing:border-box; left:50%; transform:translateX(-50%);
          --cap-hw: min(170px, 35vw);   /* max half-width, for the on-screen clamp */
          bottom:calc(var(--hd-menubar) + 10px + var(--hd-b) + var(--hd-act)); width:max-content; max-width:min(340px, 70vw);
          display:flex; flex-direction:column; align-items:stretch; gap:9px; padding:12px 15px;
          background:var(--db-fx-glass); border:1px solid var(--db-border-strong); border-radius:13px;
          box-shadow:var(--db-fx-shadow-lg); backdrop-filter:blur(5px); }
        .hd-preso-text { font-size:16px; font-weight:600; color:var(--db-text); line-height:1.35;
          white-space:pre-wrap; overflow-wrap:anywhere; }
        /* read mode: the whole caption is a tap target that advances the hold */
        .hd-preso.tap { cursor:pointer; gap:5px; -webkit-user-select:none; user-select:none; }
        .hd-preso-btn { flex:none; padding:8px 14px; font-size:13px; font-weight:700;
          background:var(--db-accent); border:1px solid var(--db-accent); color:var(--db-text-on-accent); border-radius:8px; cursor:pointer; }
        /* placement mode: the box is the SAME size the caption plays at (text-sized);
           the text is edited inline and the controls hang above it as tabs. */
        .hd-preso.placing { gap:5px; border-color:var(--db-focus); box-shadow:var(--db-fx-shadow-lg); }
        .hd-preso-text[contenteditable] { outline:none; cursor:text; min-width:4.5em; }
        .hd-preso-text[contenteditable]:empty:before { content:attr(data-ph); color:var(--db-text-muted); font-weight:500; }
        /* control tabs: sit just above the box's top edge like folder tabs */
        .hd-preso-tabs { position:absolute; left:8px; top:0; transform:translateY(-100%);
          display:flex; align-items:flex-end; gap:5px; }
        .hd-preso-tab { display:flex; align-items:center; gap:4px; height:26px; padding:0 10px;
          font-size:12px; font-weight:700; line-height:1; white-space:nowrap; cursor:pointer;
          color:var(--db-text-soft); background:var(--db-surface-panel); border:1px solid var(--db-border-strong); border-bottom:none;
          border-radius:9px 9px 0 0; -webkit-user-select:none; user-select:none; }
        .hd-preso-tab.move { cursor:grab; touch-action:none; color:var(--db-text-muted); }
        .hd-preso-tab.move:active { cursor:grabbing; }
        .hd-preso-tab.del { color:var(--db-danger); padding:0 9px; }
        .hd-preso-tab.done { color:var(--db-text-on-accent); background:var(--db-accent); border-color:var(--db-accent); }
        @media (pointer: fine) and (min-width: 760px) {
          .hd-preso { --cap-hw:min(310px, 30vw); max-width:min(620px, 60vw); gap:12px; padding:16px 20px; bottom:calc(var(--hd-menubar) + 20px + var(--hd-b) + var(--hd-act)); }
          .hd-preso-text { font-size:22px; }
          .hd-preso-btn { font-size:15px; padding:9px 16px; }
          .hd-preso.placing { gap:8px; }
          .hd-preso-tab { height:30px; font-size:13px; }
        }
        /* Pointer feedback. Gated on (hover: hover) and (pointer: fine) — NOT
           just a width breakpoint. iOS synthesises a hover on tap and leaves it
           stuck on the last-tapped control until you tap elsewhere, so an
           ungated :hover would leave buttons lit on the bench phone, which is
           the primary platform.

           One filter covers every control whatever it's filled with — default
           chip, accent-filled .on state, danger text, a raw colour swatch —
           because a background-colour hover would need a variant per fill. The
           filter's DIRECTION flips per theme (--db-fx-hover): on a light UI
           "lighter" is invisible, so light darkens and dark lightens.

           This sits before :active deliberately: same specificity, so source
           order decides, and a press should beat a hover. */
        @media (hover: hover) and (pointer: fine) {
          .hd-barbtn:hover:not(:disabled), .hd-scrubbtn:hover:not(:disabled),
          .hd-item:hover:not(:disabled), .hd-mini:hover:not(:disabled),
          .hd-btn:hover:not(:disabled), .hd-stepper button:hover:not(:disabled),
          .hd-x:hover:not(:disabled), .hd-anchorbtn:hover:not(:disabled),
          .hd-select:hover:not(:disabled), .hd-tool:hover:not(:disabled),
          .hd-pentool:hover:not(:disabled), .hd-penopt:hover:not(:disabled),
          .hd-mode:hover, .hd-preso-btn:hover, .hd-preso-tab:hover,
          .hd-resize-h:hover::before, .hd-resize-c:hover::after {
            filter:var(--db-fx-hover); }
          /* colour chips say what they are, so tinting them would misrepresent
             the swatch you're about to pick — grow instead */
          .hd-swatch:hover, .hd-penswatch:hover { transform:scale(1.14); }
          .hd-swatch, .hd-penswatch { transition:transform .12s ease; }
          /* fields read better with a firmer edge than a wash */
          .hd-input:hover, .hd-ta:hover, .hd-secinput:hover, .hd-select:hover {
            border-color:var(--db-border-strong); }
          /* the row is the target, but the switch is what changes — nudge it too */
          .hd-item:hover .hd-sw { filter:var(--db-fx-hover); }
          /* not a button, but it IS draggable */
          .hd-pophead:hover { filter:var(--db-fx-hover); }
        }
        /* pressed feedback — every tappable control confirms the touch itself,
           not just its end state (bench use: gloves, glances) */
        .hd-barbtn:active, .hd-scrubbtn:active:not(:disabled), .hd-item:active,
        .hd-mini:active, .hd-btn:active, .hd-stepper button:active,
        .hd-x:active, .hd-anchorbtn:active, .hd-select:active {
          filter:brightness(1.35); transform:scale(.96); }
        /* menus/popups ease in instead of popping */
        @keyframes hd-fadein { from { opacity:0; transform:translateY(5px); } }
        .hd-menu, .hd-pop:not(.pinned) { animation:hd-fadein .13s ease-out; }
        /* disabled is one look everywhere (individual buttons don't restyle it) */
        button:disabled { opacity:.4; cursor:default; }
        button:disabled:active { filter:none; transform:none; }
        /* keyboard focus (projector/desktop use — Space/Esc already work).
           :where() keeps this at zero specificity — don't "simplify" the
           selector or every focus ring gets outranked by the component rules. */
        :where(button, input, select, textarea, [contenteditable]):focus-visible {
          outline:2px solid var(--db-focus); outline-offset:1px; }
        /* invisible hit-area extension: visual sizes stay, touch targets reach
           ~44pt (bar/transport buttons sit below Apple's minimum otherwise) */
        .hd-barbtn, .hd-scrubbtn, .hd-stepper button, .hd-x, .hd-swatch { position:relative; }
        .hd-barbtn::after { content:""; position:absolute; inset:-3px; border-radius:12px; }
        .hd-scrubbtn::after { content:""; position:absolute; inset:-5px; border-radius:12px; }
        .hd-stepper button::after { content:""; position:absolute; inset:-4px 0; }
        .hd-x::after { content:""; position:absolute; inset:-5px -3px; }
        .hd-swatch::after { content:""; position:absolute; inset:-4px; border-radius:50%; }
        /* shared bits */
        .hd-swatch { box-sizing:border-box; width:24px; height:24px; border-radius:50%; border:2px solid transparent;
          cursor:pointer; flex:0 0 auto; }
        /* --db-ui-select, NOT the on-ice selection amber: this ring sits on a
           panel, and light mode needs it dark enough to read against white */
        .hd-swatch.on { border-color:var(--db-ui-select); }
        .hd-input { background:var(--db-surface-sunken); border:1px solid var(--db-border); color:var(--db-text); border-radius:8px;
          padding:7px 9px; font-size:14px; }
        .hd-x { background:none; border:none; color:var(--db-text-muted); cursor:pointer;
          font-size:16px; padding:2px 5px; display:inline-flex; align-items:center; justify-content:center; }
        .hd-x:first-of-type { margin-left:auto; }
        /* An active toggle (pinned / docked). Colour ALONE was too weak to read
           on the light theme — its "on" teal and its resting grey are both
           mid-dark, so a pinned panel looked unpinned. The icons now differ in
           silhouette too (pinOff/pinOn, sidebar/sidebarOn); this adds the
           pressed-chip fill, so the state survives a glance from any of three
           cues rather than one. */
        .hd-x.on { color:var(--db-focus); background:var(--db-info-bg);
          border-radius:6px; box-shadow:inset 0 0 0 1px var(--db-info-border); }
        .hd-grip { display:inline-flex; align-items:center; }
        input[type=range] { accent-color:var(--db-accent); height:30px; }
        .hd-pop.pinned { z-index:43; }   /* just under the play dock, never behind it */
        /* docked editing sidebar: a fixed full-height column on the right edge,
           square outer corners, shadow only on its inner (left) edge */
        .hd-pop.pinned.dock { position:fixed; top:env(safe-area-inset-top, 0px); right:0;
          bottom:calc(var(--hd-menubar) + var(--hd-b) + var(--hd-act));
          width:var(--hd-dock-w); max-height:none; height:auto;
          border-radius:0; border-top:none; border-right:none; border-bottom:none;
          box-shadow:-8px 0 24px var(--db-fx-edge); }
        .hd-pop.pinned.dock .hd-pophead { cursor:default; }
        /* wide enough that labeled control rows and a full swatch row (None +
           7 swatches) fit on one line; capped for narrow phones */
        .hd-pop { position:absolute; z-index:20; box-sizing:border-box;
          width:min(312px, calc(100vw - 12px)); border:1px solid var(--db-border-strong);
          border-radius:12px; padding:10px 12px; box-shadow:var(--db-fx-shadow-lg);
          display:flex; flex-direction:column; gap:8px;
          max-height:calc(100% - 8px); overflow-y:auto; overscroll-behavior:contain;
          /* hide the native (flash-and-hide on iOS) bar — we draw our own thumb */
          scrollbar-width:none; -ms-overflow-style:none;
          /* solid fill via background-COLOR so it always covers the box (never
             scrolls, even on the iOS rubber-band overscroll). Only the fade
             covers + shadows are images: a soft scroll shadow that appears at an
             edge ONLY while there's more content that way — reinforces the thumb */
          background-color:var(--db-surface-panel);
          background-image:
            linear-gradient(var(--db-surface-panel) 30%, var(--db-surface-panel-0)),
            linear-gradient(var(--db-surface-panel-0), var(--db-surface-panel) 72%),
            radial-gradient(farthest-side at 50% 0, var(--db-fx-edge), var(--db-fx-edge-0)),
            radial-gradient(farthest-side at 50% 100%, var(--db-fx-edge), var(--db-fx-edge-0));
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
          background:var(--db-text-muted); box-shadow:0 0 0 1px var(--db-fx-edge); opacity:0;
          transition:opacity .18s; will-change:transform,height; }
        .hd-pophead { display:flex; align-items:center; gap:7px; font-size:12px; font-weight:700;
          letter-spacing:.06em; text-transform:uppercase; color:var(--db-text-soft);
          cursor:grab; touch-action:none; user-select:none; -webkit-user-select:none;
          margin:-10px -12px 0; padding:10px 12px 6px;
          position:sticky; top:-10px; z-index:2; background:var(--db-surface-panel); }
        .hd-pophead:active { cursor:grabbing; }
        /* title: shrink + single-line (ellipsis) so it never spills to 2 rows */
        .hd-poptitle { flex:1 1 auto; min-width:0; white-space:nowrap; overflow:hidden;
          text-overflow:ellipsis; font-size:12px; letter-spacing:0; text-transform:none; }
        /* resize handles: a bottom bar (height) + a bottom-right corner (both).
           Sticky so they ride the popup's visible bottom edge while it scrolls;
           margin-top:auto pins the bar to the bottom when the box is taller than
           its content. */
        .hd-resizebar { position:sticky; bottom:-4px; order:99; margin:4px -12px -4px;
          margin-top:auto; align-self:stretch; height:15px; z-index:6;
          pointer-events:none; display:flex; align-items:center; justify-content:center; }
        .hd-resize-h { pointer-events:auto; width:48px; height:15px; cursor:ns-resize;
          touch-action:none; display:flex; align-items:center; justify-content:center; }
        .hd-resize-h::before { content:""; width:40px; height:4px; border-radius:2px; background:var(--db-text-muted); }
        .hd-resize-h:active::before, .hd-resize-c:active::after { background:var(--db-text-soft); border-color:var(--db-text-soft); }
        .hd-resize-c { pointer-events:auto; position:absolute; right:0; bottom:0;
          width:22px; height:15px; cursor:nwse-resize; touch-action:none; }
        .hd-resize-c::after { content:""; position:absolute; right:5px; bottom:4px; width:7px; height:7px;
          border-right:2px solid var(--db-text-muted); border-bottom:2px solid var(--db-text-muted); }
        .hd-grip { color:var(--db-text-faint); font-size:13px; letter-spacing:0; }
        .hd-poprow { display:flex; align-items:center; gap:7px; flex-wrap:wrap; font-size:12.5px; color:var(--db-text-soft); }
        /* labeled field — the one consistent shape for every popup setting:
           an uppercase title, an optional instruction under it, then the control
           row. Adjacent fields get a hairline divider so groups read distinctly. */
        .hd-field { display:flex; flex-direction:column; gap:5px; }
        .hd-field + .hd-field { border-top:1px solid var(--db-border-hair); padding-top:9px; }
        .hd-sectitle { font-size:10.5px; font-weight:700; letter-spacing:.07em;
          text-transform:uppercase; color:var(--db-text-muted); }
        .hd-sechint { font-size:11.5px; color:var(--db-text-muted); line-height:1.4; }
        .hd-field .hd-poprow { gap:6px; }
        .hd-mini { padding:6px 10px; font-size:12.5px; border:1px solid var(--db-border); background:var(--db-surface-raised);
          color:var(--db-text-soft); border-radius:7px; cursor:pointer; min-height:34px;
          display:inline-flex; align-items:center; justify-content:center; gap:5px; }
        .hd-item svg, .hd-mini svg, .hd-btn svg { flex:0 0 auto; }
        .hd-mini.on { background:var(--db-accent); border-color:var(--db-accent); color:var(--db-text-on-accent); }
        /* icon + caption mini-button: tooltips don't exist on touch.
           Kept narrow so a 4-up row (curve shapes) fits the popup width. */
        .hd-mini.iconlbl { flex-direction:column; gap:2px; padding:4px 7px; }
        .hd-mini.iconlbl small { font-size:8px; font-weight:700; letter-spacing:.04em;
          text-transform:uppercase; line-height:1; opacity:.8; }
        .hd-mini.danger { color:var(--db-danger); border-color:var(--db-danger-border); }
        /* The chevron is a data-URI, and a URL can't interpolate var(). It's a
           graphical object at the 3:1 bar rather than text, so ONE fixed neutral
           serves both themes (3.8:1 on the light chip, 3.3:1 on the dark one)
           instead of dragging a component rule into the theme layer. */
        .hd-select { flex:1 1 auto; min-width:80px; padding:6px 8px; font-size:12.5px; border-radius:7px;
          border:1px solid var(--db-border); background:var(--db-surface-raised); color:var(--db-text-soft); cursor:pointer;
          -webkit-appearance:none; appearance:none;
          background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path d='M1 1l4 4 4-4' stroke='%236b7a8a' stroke-width='1.4' fill='none' stroke-linecap='round'/></svg>");
          background-repeat:no-repeat; background-position:right 8px center; padding-right:22px; }
        .hd-select.on { border-color:var(--db-accent); }
        /* ---- the puck-actions editor (a waypoint's ordered step list) ----
           This was ~14 inline colour literals — a dark card, dark dropdowns and
           grey label text baked in — so on a light theme it rendered as a black
           box full of black dropdowns. Tokens now, which also brings it under
           the no-raw-hex guard that only reads THIS file. */
        .hd-actions { margin:6px 0; padding:7px 8px; border-radius:8px;
          background:var(--db-surface-sunken); border:1px solid var(--db-border-hair); }
        .hd-actions.locked { opacity:.5; pointer-events:none; }
        /* one step. The left stripe says what the puck DOES at a glance; the
           step also names its type in the dropdown beside it, so the stripe is
           a scanning aid rather than the only signal. */
        .hd-step { margin:5px 0; padding:5px 7px 5px 8px; border-radius:8px;
          background:var(--db-surface-panel); border:1px solid var(--db-border);
          border-left:3px solid var(--db-act-gain); }
        .hd-step.pass  { border-left-color:var(--db-act-pass); }
        .hd-step.shoot { border-left-color:var(--db-act-shot); }
        .hd-step.chip, .hd-step.rim { border-left-color:var(--db-act-loose); }
        .hd-step.warn { opacity:.7; }
        .hd-steplbl { flex:none; min-width:46px; font-size:11.5px; font-weight:700; color:var(--db-text-muted); }
        /* a step's own ✕ sits tight to it rather than wearing full button padding */
        .hd-step .hd-mini.hd-stepx { padding:3px 8px; min-height:0; }
        .hd-stepwarn { font-size:10.5px; color:var(--db-warn); }
        .hd-stephint { font-size:10.5px; color:var(--db-text-muted); }
        /* a divider inside a panel — e.g. above Menu's destructive Clear all */
        .hd-rule { height:1px; margin:4px 0; background:var(--db-border); }
        .hd-stepper { display:inline-flex; align-items:center; gap:2px;
          background:var(--db-surface-sunken); border:1px solid var(--db-border); border-radius:7px; overflow:hidden; }
        .hd-stepper button { width:32px; min-height:32px; border:none; background:var(--db-surface-raised); color:var(--db-text);
          font-size:16px; cursor:pointer; }
        .hd-stepper span { min-width:44px; text-align:center; font-size:13px; font-variant-numeric:tabular-nums; }
        /* empty-board coaching hint — floats over the ice, never intercepts taps */
        .hd-emptyhint { position:absolute; z-index:12; left:50%; top:38%; transform:translate(-50%,-50%);
          max-width:min(340px, 78vw); padding:14px 18px; text-align:center; pointer-events:none;
          background:var(--db-fx-glass); border:1px solid var(--db-border-strong); border-radius:13px;
          box-shadow:var(--db-fx-shadow-lg); color:var(--db-text-soft); font-size:13.5px; line-height:1.55; }
        .hd-emptyhint b { color:var(--db-text); }
        /* the phone's hint line: over the ice just above the action bar, where
           it has the width the bar couldn't give it. Never intercepts taps. */
        .hd-floathint { position:absolute; z-index:43; left:50%; transform:translateX(-50%);
          bottom:calc(var(--hd-menubar) + var(--hd-b) + var(--hd-act) + 6px);
          max-width:calc(100vw - 24px); padding:6px 12px; pointer-events:none;
          white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
          font-size:12px; color:var(--db-text-soft);
          background:var(--db-fx-glass); border:1px solid var(--db-border);
          border-radius:999px; box-shadow:var(--db-fx-shadow); backdrop-filter:blur(4px); }
        .hd-emptyhint .hd-ehsub { display:block; margin-top:4px; font-size:12px; color:var(--db-text-muted); }
        /* the loupe shows magnified ICE, so its backdrop is the ice token — it
           must match RinkMarkings' fill exactly or a wrong-shade rim shows at
           the corners where the rink rect doesn't reach */
        .hd-loupe { position:absolute; z-index:30; width:118px; height:118px; border-radius:50%;
          border:2px solid var(--db-border-strong); box-shadow:var(--db-fx-shadow-lg), 0 0 0 1px var(--db-fx-edge);
          overflow:hidden; pointer-events:none; background:var(--db-ice); }
        .hd-loupe svg { width:100%; height:100%; display:block; }
      `;
