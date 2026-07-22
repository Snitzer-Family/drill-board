// Build a standalone, LIVE "drill card" HTML page: the rink diagram is drawn
// from the DSL by src/drill-svg.js, and an editable textarea redraws it as you
// type. The parser + boards + renderer are bundled inline (imports/exports
// stripped) so the page is fully self-contained (no build step, no CDN).
//   node scripts/build-drill-preview.mjs [initial.md] [out.html]
import { readFileSync, writeFileSync } from "fs";
import { extractDrill } from "../src/drill-format.js";
import { DSL_VERSION } from "../src/constants.js";

const src = process.argv[2] || "docs/example-drill.md";
const out = process.argv[3] || "docs/example-drill-preview.html";
const read = p => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ---- inline bundle: constants(VIEWS) + boards + drill-format + drill-svg ----
const strip = c => c.replace(/^\s*import\s.*$/gm, "").replace(/^export\s+/gm, "");
const bundle = [
  `const VIEWS = { full:[0,0,200,85], half:[100,0,100,85], quarter:[100,0,100,42.5] };\nconst RINK = { W:200, H:85 };\nconst DSL_VERSION = ${DSL_VERSION};`,
  strip(read("src/boards.js")),
  `const boards = { isInside, clampInside, contain, tangentToward, edgeDist, pointAt, project, rimPath, rimAround, rimTo, slide, slideTo, PERIM };`,
  strip(read("src/geometry.js")),
  strip(read("src/net-collide.js")),
  strip(read("src/drill-format.js")),
  strip(read("src/md.js")),
  // drill-svg.js self-declares `const VIEWS` for standalone use; drop it here so
  // it doesn't collide with the bundle's own VIEWS (above).
  strip(read("src/drill-svg.js")).replace(/^const VIEWS = \{[^}]*\};.*$/m, ""),
].join("\n\n");

const initial = extractDrill(read(src));

const CSS = `
  :root{--ice:#eef5f9;--panel:#fff;--ink:#14202b;--muted:#5c6b78;--line:#d6e2ea;--hair:#e4edf3;--red:#d7263d;--blue:#1f4fa3;--surface:#f6fafd;--mark:#cf3346;--mark-blue:#2f5fb0;--puck:#14171a;--code-bg:#0f1a23;--code-ink:#d9e6f0;--code-dim:#7e93a4;--shadow:0 1px 2px rgba(20,32,43,.06),0 12px 34px -14px rgba(20,32,43,.28);--font-display:800 1em/1 "Helvetica Neue",Helvetica,Arial,sans-serif;--font-body:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;--font-mono:ui-monospace,"SF Mono","JetBrains Mono",Menlo,Consolas,monospace}
  @media (prefers-color-scheme:dark){:root{--ice:#0d151c;--panel:#131f28;--ink:#e8eff5;--muted:#93a4b2;--line:#26343f;--hair:#1c2831;--red:#ff5a6a;--blue:#5f92e2;--surface:#16232d;--mark:#e2475a;--mark-blue:#4f7fd6;--puck:#cdd8e2;--code-bg:#0a1219;--code-ink:#d3e2ee;--code-dim:#6f8496;--shadow:0 1px 2px rgba(0,0,0,.4),0 18px 44px -18px rgba(0,0,0,.7)}}
  :root[data-theme="light"]{--ice:#eef5f9;--panel:#fff;--ink:#14202b;--muted:#5c6b78;--line:#d6e2ea;--hair:#e4edf3;--red:#d7263d;--blue:#1f4fa3;--surface:#f6fafd;--mark:#cf3346;--mark-blue:#2f5fb0;--puck:#14171a;--code-bg:#0f1a23;--code-ink:#d9e6f0;--code-dim:#7e93a4;--shadow:0 1px 2px rgba(20,32,43,.06),0 12px 34px -14px rgba(20,32,43,.28)}
  :root[data-theme="dark"]{--ice:#0d151c;--panel:#131f28;--ink:#e8eff5;--muted:#93a4b2;--line:#26343f;--hair:#1c2831;--red:#ff5a6a;--blue:#5f92e2;--surface:#16232d;--mark:#e2475a;--mark-blue:#4f7fd6;--puck:#cdd8e2;--code-bg:#0a1219;--code-ink:#d3e2ee;--code-dim:#6f8496;--shadow:0 1px 2px rgba(0,0,0,.4),0 18px 44px -18px rgba(0,0,0,.7)}
  *{box-sizing:border-box}
  body{margin:0;background:var(--ice);color:var(--ink);font-family:var(--font-body);line-height:1.6;-webkit-font-smoothing:antialiased}
  .wrap{max-width:940px;margin:0 auto;padding:clamp(28px,5vw,64px) clamp(18px,4vw,40px) 80px}
  .eyebrow{display:inline-flex;align-items:center;gap:8px;font:700 12px/1 var(--font-body);letter-spacing:.16em;text-transform:uppercase;color:var(--muted)}
  .eyebrow .rule{width:26px;height:2px;background:var(--red);border-radius:2px}
  .topbar{display:flex;align-items:center;justify-content:space-between;gap:12px}
  .copybtn{display:inline-flex;align-items:center;gap:7px;font:600 13px/1 var(--font-body);color:var(--ink);background:var(--panel);border:1px solid var(--line);border-radius:9px;padding:9px 14px;cursor:pointer;box-shadow:var(--shadow);white-space:nowrap}
  .copybtn:hover{border-color:var(--red)}
  .copybtn:focus-visible{outline:2px solid var(--red);outline-offset:2px}
  .copybtn.done{color:#2f9e57;border-color:#2f9e57}
  .copybtn svg{width:15px;height:15px;flex:none}
  h1{font:var(--font-display);font-size:clamp(32px,6vw,56px);letter-spacing:-.01em;text-transform:uppercase;text-wrap:balance;margin:16px 0 0;line-height:1}
  .lede{max-width:62ch;margin:14px 0 0;font-size:clamp(16px,2.4vw,19px)}
  .card{margin-top:clamp(26px,4vw,40px);background:var(--panel);border:1px solid var(--line);border-radius:16px;box-shadow:var(--shadow);overflow:hidden}
  .card-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:16px 20px;border-bottom:1px solid var(--hair)}
  .card-head .t{font:700 13px/1 var(--font-body);letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}
  .card-head .meta{font:500 13px/1 var(--font-mono);color:var(--muted);font-variant-numeric:tabular-nums}
  .rinkbox{padding:clamp(14px,3vw,26px)}
  svg.rink{display:block;width:100%;height:auto}
  .legend{display:flex;flex-wrap:wrap;gap:8px 20px;padding:4px 22px 20px;font:500 13px/1.2 var(--font-body);color:var(--muted)}
  .legend span{display:inline-flex;align-items:center;gap:8px}
  .legend .dot{width:12px;height:12px;border-radius:50%;flex:none}
  .legend .dash{width:20px;height:0;border-top:2px dashed var(--puck);flex:none}
  .legend .solid{width:20px;height:0;border-top:2.5px solid var(--red);flex:none}
  .edit{margin-top:42px}
  .edit-h{display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap}
  .edit-h h2{margin:0;font:700 13px/1 var(--font-body);letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
  .edit-h .hint{font-size:13px;color:var(--muted)}
  textarea{width:100%;min-height:230px;margin-top:12px;resize:vertical;background:var(--code-bg);color:var(--code-ink);border:1px solid var(--line);border-radius:14px;padding:16px 18px;font:500 13.5px/1.65 var(--font-mono);tab-size:2;box-shadow:var(--shadow)}
  textarea:focus{outline:2px solid var(--red);outline-offset:2px}
  .err{margin-top:10px;min-height:1.3em;color:#e2475a;font:500 13px/1.5 var(--font-mono);white-space:pre-wrap}
  .foot{margin-top:36px;padding-top:18px;border-top:1px solid var(--line);color:var(--muted);font-size:14px}
  .foot code{font-family:var(--font-mono);color:var(--ink)}
  .sec{margin-top:clamp(24px,4vw,38px)}
  .sec-h{font:700 13px/1 var(--font-body);letter-spacing:.14em;text-transform:uppercase;color:var(--muted);margin:0 0 12px}
  .notes h1{font-size:24px;text-transform:none;letter-spacing:0;margin:16px 0 8px;line-height:1.15}
  .notes h2,.notes h3{text-transform:none;letter-spacing:0;font-size:18px;margin:14px 0 6px}
  .notes p{margin:8px 0}.notes ul,.notes ol{margin:8px 0 8px 24px}.notes li{margin:4px 0}
  .notes code,.steps code{background:var(--surface);border:1px solid var(--hair);padding:1px 6px;border-radius:6px;font:500 13px var(--font-mono)}
  .notes a,.steps a{color:var(--red)}
  table.inv{border-collapse:collapse;min-width:min(340px,100%)}
  table.inv th,table.inv td{border:1px solid var(--line);padding:8px 16px;text-align:left}
  table.inv th{background:var(--surface);font:700 12px/1 var(--font-body);letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
  table.inv td:last-child,table.inv th:last-child{text-align:right;font-variant-numeric:tabular-nums;width:70px}
  ol.steps{margin:0;padding-left:24px}ol.steps li{margin:7px 0;padding-left:4px}
  @media print{
    :root{--ice:#fff;--panel:#fff;--ink:#111;--muted:#555;--line:#bbb;--hair:#ddd;--surface:#f4f4f4;--shadow:none}
    body{background:#fff}
    .wrap{max-width:none;padding:0}
    .topbar button,#print,.edit,.foot{display:none!important}
    .card,.sec{page-break-inside:avoid;box-shadow:none}
    .card{margin-top:14px}
  }`;

const html = `<meta charset="utf-8">
<title>DrillBoard · live drill card</title>
<style>${CSS}</style>
<div class="wrap">
  <header>
    <div class="topbar">
      <span class="eyebrow"><span class="rule"></span>DrillBoard · Live drill card</span>
      <span style="display:inline-flex;gap:8px">
      <button id="print" class="copybtn" type="button" title="Print this drill sheet">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
        <span>Print</span>
      </button>
      <button id="copy" class="copybtn" type="button" title="Copy a link that reopens this exact drill">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>
        <span class="lbl">Copy link</span>
      </button>
      </span>
    </div>
    <h1 id="title">Drill</h1>
    <p class="lede" id="lede"></p>
  </header>
  <section class="card" aria-label="Rink diagram">
    <div class="card-head"><span class="t">Full sheet</span><span class="meta" id="meta">rendered from the DSL</span></div>
    <div class="rinkbox" id="diagram"></div>
    <div class="legend" id="legend"></div>
  </section>
  <section class="sec notes" id="notes-sec" hidden><div class="sec-h">Notes</div><div class="notes" id="notes"></div></section>
  <section class="sec" id="inv-sec" hidden><div class="sec-h">What you need</div><div id="inventory"></div></section>
  <section class="sec" id="steps-sec" hidden><div class="sec-h">Steps</div><div id="steps"></div></section>
  <section class="edit">
    <div class="edit-h"><h2>Edit the drill</h2><span class="hint">the rink redraws as you type</span></div>
    <textarea id="dsl" spellcheck="false" autocomplete="off" autocapitalize="off">${esc(initial)}</textarea>
    <div class="err" id="err"></div>
  </section>
  <p class="foot">Drawn live by the DSL-to-SVG renderer (<code>src/drill-svg.js</code>). Paste any <code>drill</code> block above. See <code>docs/drill-dsl.md</code> for the format.</p>
</div>
<script>
${bundle}
(function(){
  var ta=document.getElementById('dsl'),dia=document.getElementById('diagram'),err=document.getElementById('err'),
      title=document.getElementById('title'),lede=document.getElementById('lede'),leg=document.getElementById('legend'),meta=document.getElementById('meta'),
      copy=document.getElementById('copy'),printBtn=document.getElementById('print'),
      notesEl=document.getElementById('notes'),notesSec=document.getElementById('notes-sec'),
      invEl=document.getElementById('inventory'),invSec=document.getElementById('inv-sec'),
      stepsEl=document.getElementById('steps'),stepsSec=document.getElementById('steps-sec');
  function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
  // URL-safe base64 of UTF-8 text, for sharing the current drill in the link.
  function enc(s){try{return btoa(unescape(encodeURIComponent(s))).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');}catch(e){return '';}}
  function dec(s){try{s=s.replace(/-/g,'+').replace(/_/g,'/');return decodeURIComponent(escape(atob(s)));}catch(e){return null;}}
  function syncHash(){ try{ history.replaceState(null,'','#d='+enc(ta.value)); }catch(e){} }
  function render(){
    var dsl=extractDrill(ta.value),r;
    try{ r=parseDrill(dsl); dia.innerHTML=drillSvg(dsl); }
    catch(e){ err.textContent=String(e&&e.message||e); return; }
    err.textContent=r.errors.length?r.errors.join('  \\u00b7  '):'';
    title.textContent=r.title||'Drill'; lede.textContent=r.desc||'';
    var players=r.pieces.filter(function(p){return p.kind==='player';});
    var L=players.map(function(p){return '<span><span class="dot" style="background:'+p.color+'"></span>'+esc(p.id)+(p.defense?' \\u2014 auto-D':'')+'</span>';});
    r.pieces.filter(function(p){return p.kind==='net';}).forEach(function(p){L.push('<span><span class="dot" style="background:'+(p.goalie?'#2f9e57':p.color)+'"></span>'+esc(p.id)+(p.goalie?' \\u2014 net + goalie':' \\u2014 net')+'</span>');});
    L.push('<span><span class="solid"></span>skating route</span>','<span><span class="dash"></span>puck path</span>');
    leg.innerHTML=L.join('');
    meta.textContent=players.length+' skater'+(players.length===1?'':'s')+' \\u00b7 live';
    // coaching notes (markdown)
    if(r.notes&&r.notes.trim()){ notesEl.innerHTML=mdBlock(r.notes); notesSec.hidden=false; } else { notesEl.innerHTML=''; notesSec.hidden=true; }
    // inventory / recipe table
    var rows=deriveInventory(r.pieces,r.items).filter(function(x){return !x.hide;});
    if(rows.length){
      invEl.innerHTML='<table class="inv"><thead><tr><th>Item</th><th>Qty</th></tr></thead><tbody>'+
        rows.map(function(x){return '<tr><td>'+esc(x.label)+'</td><td>'+x.count+'</td></tr>';}).join('')+'</tbody></table>';
      invSec.hidden=false;
    } else { invEl.innerHTML=''; invSec.hidden=true; }
    // authored presentation steps → numbered list (markdown inline)
    var st=(r.steps||[]).filter(function(s){return (s.text||'').trim();});
    if(st.length){ stepsEl.innerHTML='<ol class="steps">'+st.map(function(s){return '<li>'+mdInline(esc(s.text))+'</li>';}).join('')+'</ol>'; stepsSec.hidden=false; }
    else { stepsEl.innerHTML=''; stepsSec.hidden=true; }
    syncHash();
  }
  // A shared link carries the drill in #d=… — prefer it over the built-in default.
  if(location.hash.indexOf('#d=')===0){ var d=dec(location.hash.slice(3)); if(d!=null) ta.value=d; }
  function fallbackCopy(text){ var t=document.createElement('textarea'); t.value=text; t.setAttribute('readonly',''); t.style.position='fixed'; t.style.top='-1000px'; document.body.appendChild(t); t.select(); try{document.execCommand('copy');}catch(e){} document.body.removeChild(t); }
  copy.addEventListener('click',function(){
    syncHash();
    var url=location.href, lbl=copy.querySelector('.lbl');
    function done(){ copy.classList.add('done'); lbl.textContent='Link copied'; setTimeout(function(){ copy.classList.remove('done'); lbl.textContent='Copy link'; },1600); }
    if(navigator.clipboard&&navigator.clipboard.writeText){ navigator.clipboard.writeText(url).then(done,function(){ fallbackCopy(url); done(); }); }
    else { fallbackCopy(url); done(); }
  });
  printBtn.addEventListener('click',function(){ window.print(); });
  ta.addEventListener('input',render); render();
})();
</script>
`;

writeFileSync(out, html);
console.log("wrote", out, `(${(html.length / 1024).toFixed(1)} kB)`);
