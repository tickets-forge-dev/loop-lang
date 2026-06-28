import type { LoopFile } from "@loop-lang/parser";
import { BASE_CSS, RENDERER_JS } from "./render.js";
import type { VizOptions } from "./render.js";

// Linear-style dark restyle. Self-contained chrome (header/legend/body) because the
// standalone schematic's chrome CSS isn't exported — and this is the slicker look anyway:
// flat near-black, system sans (offline-safe, no serif fallback), one muted accent, calm
// motion. Overrides the BASE_CSS :root palette and neon glows.
const SANS = `-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,Helvetica,Arial,sans-serif`;
const MONO = `ui-monospace,"SF Mono",SFMono-Regular,Menlo,Consolas,monospace`;
const LIVE_CSS = `
:root{--bg:#08090a;--panel:#0c0d0f;--node:#15161a;--node-br:#2a2b30;--ink:#f7f8f8;--muted:#878a92;--line:#1d1e22;--fwd:#5e6ad2;--reflect:#8d7ee6;--stop:#4cb782;--gate:#d39a52;}
*{box-sizing:border-box;}
html,body{margin:0;height:100%;}
body.live{display:grid;grid-template-columns:minmax(0,1fr) 300px;grid-template-rows:auto 1fr;height:100vh;overflow:hidden;background:var(--bg);color:var(--ink);font-family:${SANS};-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;}
body.live header{grid-column:1/-1;display:flex;align-items:center;gap:14px;padding:12px 20px;border-bottom:1px solid var(--line);background:var(--panel);}
.wordmark{display:flex;align-items:center;gap:9px;font-family:${SANS};font-size:14px;font-weight:600;letter-spacing:-.01em;color:var(--ink);background:none;-webkit-text-fill-color:var(--ink);text-transform:none;}
.wordmark::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--fwd);box-shadow:0 0 0 3px rgba(94,106,210,.16);}
.subtitle{font-size:12px;color:var(--muted);letter-spacing:-.01em;}
.legend{margin-left:auto;display:flex;gap:18px;font-size:11px;color:var(--muted);}
.legend span{display:inline-flex;align-items:center;gap:7px;}
.legend i{display:inline-block;width:15px;height:0;border-top:2px solid currentColor;}
.legend .fwd{color:var(--fwd);}.legend .ref{color:var(--reflect);}.legend .ref{border-top-style:dashed;}
.legend .gat{color:var(--gate);}.legend .stp{color:var(--stop);}
body.live main{overflow:auto;padding:20px 22px 60px;}
svg{display:block;}
.nlabel,.panel-title{font-family:${SANS}!important;font-weight:600;letter-spacing:-.01em;}
.sub,.chip{font-family:${SANS}!important;}
.fwd-flow{animation-duration:2.6s;}
.reflect-flow{animation-duration:1.8s;}
[data-cyc].lp-active rect:first-of-type{stroke:var(--fwd);stroke-width:1.7;filter:none;animation:lp-ring 1.5s ease-in-out infinite;}
[data-cyc].lp-done{opacity:.4;}
[data-cyc].lp-fail rect:first-of-type{stroke:var(--gate)!important;}
@keyframes lp-ring{0%,100%{opacity:1}50%{opacity:.5}}
[data-edge="reflect"].lp-fire{animation:lp-ring .5s ease-out 3;}
#lp-panel{background:var(--panel);border-left:1px solid var(--line);display:flex;flex-direction:column;overflow:hidden;}
#lp-panel section{padding:14px 16px;border-bottom:1px solid var(--line);flex-shrink:0;}
#lp-panel h3{margin:0 0 8px;font-family:${SANS};font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);}
#lp-step{font-size:12.5px;color:var(--ink);font-family:${MONO};word-break:break-all;line-height:1.5;}
#lp-foreach-bar{height:5px;background:var(--line);border-radius:3px;margin-bottom:10px;overflow:hidden;}
#lp-foreach-fill{height:100%;background:var(--fwd);border-radius:3px;transition:width .35s ease;width:0%;}
#lp-foreach-list,#lp-flow-list{list-style:none;margin:0;padding:0;font-size:12px;font-family:${SANS};max-height:150px;overflow-y:auto;}
#lp-foreach-list li,#lp-flow-list li{padding:4px 0;color:var(--muted);display:flex;gap:8px;align-items:center;letter-spacing:-.01em;}
#lp-foreach-list li span:first-child,#lp-flow-list li span:first-child{font-family:${MONO};font-size:11px;width:12px;text-align:center;flex-shrink:0;}
#lp-foreach-list li.lp-active,#lp-flow-list li.lp-active{color:var(--ink);}
#lp-foreach-list li.lp-done,#lp-flow-list li.lp-done{color:var(--stop);}
#lp-foreach-list li.lp-fail,#lp-flow-list li.lp-fail{color:var(--gate);}
#lp-log{flex:1;overflow:hidden;display:flex;flex-direction:column;min-height:0;}
#lp-log-wrap{overflow-y:auto;flex:1;margin:0 -16px;padding:0 16px;}
#lp-log-list{list-style:none;margin:0;padding:0;font-size:11px;font-family:${MONO};}
#lp-log-list li{padding:2.5px 0;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;letter-spacing:-.02em;}
#lp-log-list li.lp-ev-enter{color:var(--ink);}
#lp-log-list li.lp-ev-fail{color:var(--gate);}
#lp-log-list li.lp-ev-human{color:var(--reflect);}
::-webkit-scrollbar{width:8px;height:8px;}::-webkit-scrollbar-thumb{background:var(--line);border-radius:4px;}::-webkit-scrollbar-track{background:transparent;}
`;

// ponytail: plain-var JS to stay embeddable alongside RENDERER_JS
const LIVE_JS = `(function(){
var es=new EventSource('/events');
es.onmessage=function(ev){try{handle(JSON.parse(ev.data));}catch(_){}};
function q(s){return document.querySelector(s);}
function qa(s){return Array.prototype.slice.call(document.querySelectorAll(s));}
function setStep(t){var el=q('#lp-step');if(el)el.textContent=t;}
function log(txt,cls){
  var ul=q('#lp-log-list');if(!ul)return;
  var li=document.createElement('li');li.textContent=txt;
  if(cls)li.className=cls;
  ul.insertBefore(li,ul.firstChild);
  if(ul.children.length>80)ul.removeChild(ul.lastChild);
}
function clearCyc(node){qa('[data-cyc="'+node+'"]').forEach(function(n){n.classList.remove('lp-active','lp-done','lp-fail');});}
function handle(e){
  switch(e.type){
    case 'node-enter':
      clearCyc(e.node);
      qa('[data-cyc="'+e.node+'"]').forEach(function(n){n.classList.add('lp-active');});
      setStep(e.node+' \xb7 cycle '+e.attempt);
      log('\\u2192 '+e.node+' (try '+e.attempt+')','lp-ev-enter');
      break;
    case 'node-exit':
      qa('[data-cyc="'+e.node+'"]').forEach(function(n){
        n.classList.remove('lp-active');
        n.classList.add(e.ok?'lp-done':'lp-fail');
      });
      if(!e.ok)log('\\u2717 '+e.node+' failed','lp-ev-fail');
      break;
    case 'loop-back':
      var arc=q('[data-edge="reflect"]');
      if(arc){arc.classList.remove('lp-fire');void arc.offsetWidth;arc.classList.add('lp-fire');}
      log('\\u21ba back to '+e.to);
      break;
    case 'foreach-start':{
      var sec=q('#lp-foreach');if(sec)sec.style.display='';
      var ul=q('#lp-foreach-list');if(!ul)break;while(ul.firstChild)ul.removeChild(ul.firstChild);
      for(var i=0;i<e.count;i++){
        var li=document.createElement('li');li.id='lp-fi-'+i;
        var badge=document.createElement('span');badge.textContent='\\u25cb';li.appendChild(badge);
        var lbl=document.createElement('span');lbl.textContent=e.var+' '+(i+1)+'/'+e.count;li.appendChild(lbl);
        ul.appendChild(li);
      }
      log('for each '+e.var+' ('+e.count+' items)');
      break;}
    case 'foreach-item-start':{
      qa('#lp-foreach-list li').forEach(function(l){l.classList.remove('lp-active');});
      var fi=q('#lp-fi-'+e.index);
      if(fi){fi.classList.add('lp-active');if(fi.firstChild)fi.firstChild.textContent='\\u25b6';}
      var fill=q('#lp-foreach-fill');if(fill)fill.style.width=(e.index/e.total*100)+'%';
      setStep(e.var+' '+(e.index+1)+'/'+e.total);
      log('\\u2022 item '+(e.index+1)+'/'+e.total,'lp-ev-enter');
      break;}
    case 'foreach-item-end':{
      var fi2=q('#lp-fi-'+e.index);
      if(fi2){
        fi2.classList.remove('lp-active');
        fi2.classList.add(e.satisfied?'lp-done':'lp-fail');
        if(fi2.firstChild)fi2.firstChild.textContent=e.satisfied?'\\u2713':'\\u2717';
      }
      var fill2=q('#lp-foreach-fill');
      if(fill2)fill2.style.width=(Math.round((e.index+1)/e.total*10000)/100)+'%';
      break;}
    case 'flow-start':{
      var fls=q('#lp-flow');if(fls)fls.style.display='';
      log('\\u2192 flow "'+e.name+'"');
      break;}
    case 'flow-step-start':{
      var flsec=q('#lp-flow');if(flsec)flsec.style.display='';
      qa('#lp-flow-list li').forEach(function(l){l.classList.remove('lp-active');});
      var safeName=e.name.split('"').join('\\\\"');
      var fli=q('[data-lp-step="'+safeName+'"]');
      if(fli)fli.classList.add('lp-active');
      log('\\u25b8 '+e.name,'lp-ev-enter');
      break;}
    case 'flow-step-end':{
      var safeName2=e.name.split('"').join('\\\\"');
      var fli2=q('[data-lp-step="'+safeName2+'"]');
      if(fli2){fli2.classList.remove('lp-active');fli2.classList.add(e.satisfied?'lp-done':'lp-fail');}
      break;}
    case 'stage-start':
      setStep('stage: '+e.name);
      log('\\u25a0 stage "'+e.name+'"','lp-ev-enter');
      break;
    case 'human':
      log('? '+e.kind+': '+e.prompt,'lp-ev-human');
      break;
    case 'reflect':
      log('~ reflect: '+e.text.split('\\n')[0].slice(0,60));
      break;
    case 'observe':
      log('= '+(e.passed?'PASS':'fail')+(e.output?' \\u2014 '+e.output.split('\\n')[0].slice(0,50):''),e.passed?undefined:'lp-ev-fail');
      break;
    case 'stop':
      setStep((e.reason==='done'?'\\u2713 done':'\\u25fc '+e.reason)+(e.warn?' \\u2014 '+e.warn:''));
      log('\\u25fc stop ('+e.reason+')');
      break;
    case 'loop-end':
      if(e.satisfied)qa('[data-cyc]').forEach(function(n){n.classList.remove('lp-active');});
      break;
    case 'pipeline-start':
      log('\\u25b6 pipeline "'+e.name+'"','lp-ev-enter');
      break;
    case 'git':
      log('\\u2387 git '+e.action+': '+e.detail);
      break;
  }
}
})();`;

/** Safe JSON embed: neutralizes </script> injection, line/para separators. */
function embedJson(value: unknown): string {
  const LS = String.fromCharCode(0x2028);
  const PS = String.fromCharCode(0x2029);
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .split(LS).join("\\u2028")
    .split(PS).join("\\u2029");
}

export function renderLiveHtml(file: LoopFile, opts: VizOptions = {}): string {
  const title = opts.title ?? "loop";

  // Pre-populate flow-step list items for known flow definitions
  let flowStepItems = "";
  for (const def of file.definitions) {
    if (def.kind === "flow") {
      for (const step of def.steps) {
        const safe = step.name
          .replace(/&/g, "&amp;")
          .replace(/"/g, "&quot;")
          .replace(/</g, "&lt;");
        flowStepItems += `<li data-lp-step="${safe}"><span>&#9675;</span><span>${safe}</span></li>`;
      }
    }
  }

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Loop &#xb7; live &#xb7; ${title}</title>
<style>${BASE_CSS}${LIVE_CSS}</style>
</head>
<body class="schematic live">
<header>
  <div class="wordmark">Loop</div>
  <div class="subtitle" id="src"></div>
  <div class="legend">
    <span><i class="fwd"></i>signal</span><span><i class="ref"></i>reflect</span>
    <span><i class="gat"></i>gate</span><span><i class="stp"></i>done</span>
  </div>
</header>
<main><div id="stage"></div></main>
<div id="lp-panel">
  <section>
    <h3>Current</h3>
    <div id="lp-step">starting&#x2026;</div>
  </section>
  <section id="lp-foreach" style="display:none">
    <h3>Progress</h3>
    <div id="lp-foreach-bar"><div id="lp-foreach-fill"></div></div>
    <ul id="lp-foreach-list"></ul>
  </section>
  <section id="lp-flow" style="display:none">
    <h3>Flow steps</h3>
    <ul id="lp-flow-list">${flowStepItems}</ul>
  </section>
  <section id="lp-log">
    <h3>Log</h3>
    <div id="lp-log-wrap"><ul id="lp-log-list"></ul></div>
  </section>
</div>
<script>
${RENDERER_JS}
var SPEC=${embedJson(file)};
var TITLE=${embedJson(title)};
document.getElementById("src").textContent=TITLE+" \xb7 "+SPEC.definitions.length+" definition(s)";
LoopViz.render(document.getElementById("stage"),SPEC);
${LIVE_JS}
</script>
</body></html>`;
}
