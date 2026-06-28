import type { LoopFile } from "@loop-lang/parser";
import { FONTS, BASE_CSS, RENDERER_JS } from "./render.js";
import type { VizOptions } from "./render.js";

const LIVE_CSS = `
body.live{display:grid;grid-template-columns:1fr 300px;grid-template-rows:auto 1fr;height:100vh;overflow:hidden;}
body.live header{grid-column:1/-1;}
body.live main{overflow:auto;padding:12px 18px 60px;}
#lp-panel{background:var(--panel);border-left:1px solid var(--line);display:flex;flex-direction:column;overflow:hidden;}
#lp-panel section{padding:12px 14px;border-bottom:1px solid var(--line);flex-shrink:0;}
#lp-panel h3{margin:0 0 6px;font-family:"Saira Condensed",sans-serif;font-size:11px;letter-spacing:1.2px;text-transform:uppercase;color:var(--muted);}
#lp-step{font-size:13px;color:var(--fwd);font-family:"Space Mono",monospace;word-break:break-all;}
#lp-foreach-bar{height:4px;background:var(--line);border-radius:2px;margin-bottom:8px;}
#lp-foreach-fill{height:100%;background:var(--fwd);border-radius:2px;transition:width .3s;width:0%;}
#lp-foreach-list,#lp-flow-list{list-style:none;margin:0;padding:0;font-size:11px;font-family:"Space Mono",monospace;max-height:140px;overflow-y:auto;}
#lp-foreach-list li,#lp-flow-list li{padding:3px 0;border-bottom:1px solid var(--line);color:var(--muted);display:flex;gap:6px;align-items:center;}
#lp-foreach-list li.lp-active,#lp-flow-list li.lp-active{color:var(--fwd);}
#lp-foreach-list li.lp-done,#lp-flow-list li.lp-done{color:var(--stop);}
#lp-foreach-list li.lp-fail,#lp-flow-list li.lp-fail{color:var(--gate);}
#lp-log{flex:1;overflow:hidden;display:flex;flex-direction:column;min-height:0;}
#lp-log-wrap{overflow-y:auto;flex:1;}
#lp-log-list{list-style:none;margin:0;padding:0;font-size:11px;font-family:"Space Mono",monospace;}
#lp-log-list li{padding:2px 6px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
#lp-log-list li.lp-ev-enter{color:var(--fwd);}
#lp-log-list li.lp-ev-fail{color:var(--gate);}
#lp-log-list li.lp-ev-human{color:var(--reflect);}
[data-cyc].lp-active rect:first-of-type{stroke-width:3;filter:drop-shadow(0 0 10px currentColor);animation:lp-pulse 1.1s ease-in-out infinite;}
[data-cyc].lp-done{opacity:.38;}
[data-cyc].lp-fail rect:first-of-type{stroke:var(--gate)!important;}
@keyframes lp-pulse{0%,100%{opacity:1}50%{opacity:.5}}
[data-edge="reflect"].lp-fire{animation:firepulse .5s ease-out 3;}
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
${FONTS}
<style>${BASE_CSS}${LIVE_CSS}</style>
</head>
<body class="schematic live">
<header>
  <div class="wordmark">Loop</div>
  <div class="subtitle" id="src"></div>
  <div class="legend">
    <span><i class="fwd"></i>signal</span><span><i class="ref"></i>reflect</span>
    <span><i class="gat"></i>human gate</span><span><i class="stp"></i>done</span>
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
