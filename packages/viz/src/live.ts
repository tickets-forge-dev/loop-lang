import type { LoopFile } from "@loop-lang/parser";
import type { VizOptions } from "./render.js";

// The live dashboard renders the user's ACTUAL .loop as a turn-by-turn "route" (Waze-style):
// the real structure of THIS file — pipeline stages, flow steps, or for-each sprint items —
// with a clear "you are here", the steps ahead, and human gates flagged. Driven live by the
// event stream. Self-contained: Linear-dark chrome, system fonts (offline-safe), no SVG.
const SANS = `-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,Helvetica,Arial,sans-serif`;
const MONO = `ui-monospace,"SF Mono",SFMono-Regular,Menlo,Consolas,monospace`;

const LIVE_CSS = `
:root{--bg:#08090a;--panel:#0c0d0f;--card:#101116;--ink:#f7f8f8;--muted:#878a92;--faint:#5a5d66;--line:#1d1e22;--fwd:#5e6ad2;--reflect:#8d7ee6;--stop:#4cb782;--gate:#e0a35e;--fail:#e5564d;}
*{box-sizing:border-box;}
html,body{margin:0;height:100%;}
body{display:grid;grid-template-columns:minmax(0,1fr) 290px;grid-template-rows:auto 1fr;height:100vh;overflow:hidden;background:var(--bg);color:var(--ink);font-family:${SANS};-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;font-size:14px;}
header{grid-column:1/-1;display:flex;align-items:center;gap:12px;padding:12px 20px;border-bottom:1px solid var(--line);background:var(--panel);}
.wordmark{display:flex;align-items:center;gap:9px;font-size:14px;font-weight:600;letter-spacing:-.01em;}
.wordmark::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--fwd);box-shadow:0 0 0 3px rgba(94,106,210,.16);}
.subtitle{font-size:12px;color:var(--muted);}
.status{margin-left:auto;font-size:12px;color:var(--muted);display:flex;align-items:center;gap:7px;}
.status .dot{width:7px;height:7px;border-radius:50%;background:var(--faint);}
.status.live .dot{background:var(--stop);box-shadow:0 0 0 3px rgba(76,183,130,.16);}
.status.done .dot{background:var(--stop);}.status.fail .dot{background:var(--fail);}

main{overflow-y:auto;padding:0;}
/* Waze "now" banner */
#now{position:sticky;top:0;z-index:5;background:linear-gradient(180deg,var(--panel),rgba(12,13,15,.86));backdrop-filter:blur(6px);border-bottom:1px solid var(--line);padding:16px 24px;}
#now-kicker{font-size:10.5px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);}
#now-step{font-size:21px;font-weight:600;letter-spacing:-.02em;margin-top:3px;line-height:1.2;}
#now-next{font-size:12.5px;color:var(--muted);margin-top:6px;}
#now-next b{color:var(--ink);font-weight:500;}
#now.human{background:linear-gradient(180deg,rgba(224,163,94,.14),rgba(12,13,15,.9));border-bottom-color:var(--gate);}
#now-human{display:none;margin-top:10px;padding:9px 12px;border:1px solid var(--gate);border-radius:8px;background:rgba(224,163,94,.08);font-size:13px;color:var(--ink);}
#now.human #now-human{display:block;}
#now-human b{color:var(--gate);}

/* route */
#route{padding:18px 24px 80px;}
.def{margin-bottom:26px;}
.def-head{display:flex;align-items:baseline;gap:10px;margin-bottom:14px;}
.def-name{font-size:14px;font-weight:600;letter-spacing:-.01em;}
.def-kind{font-size:11px;color:var(--muted);font-family:${MONO};}
.legs,.items{list-style:none;margin:0;padding:0;}
.leg{position:relative;padding:0 0 4px 30px;}
.leg::before{content:"";position:absolute;left:8px;top:20px;bottom:-4px;width:2px;background:var(--line);}
.leg:last-child::before{display:none;}
.node{position:absolute;left:0;top:5px;width:18px;height:18px;border-radius:50%;border:2px solid var(--line);background:var(--bg);display:flex;align-items:center;justify-content:center;font-size:10px;font-family:${MONO};color:var(--faint);z-index:1;}
.leg.current>.node{border-color:var(--fwd);background:var(--fwd);color:#fff;box-shadow:0 0 0 4px rgba(94,106,210,.18);animation:pulse 1.6s ease-in-out infinite;}
.leg.done>.node{border-color:var(--stop);color:var(--stop);}
.leg.fail>.node{border-color:var(--fail);color:var(--fail);}
.leg.human>.node{border-color:var(--gate);background:var(--gate);color:#fff;box-shadow:0 0 0 4px rgba(224,163,94,.2);animation:pulse 1.2s ease-in-out infinite;}
@keyframes pulse{0%,100%{box-shadow:0 0 0 4px rgba(94,106,210,.18);}50%{box-shadow:0 0 0 7px rgba(94,106,210,.05);}}
.leg-card{padding:6px 0 14px;}
.leg-title{font-size:14px;font-weight:500;letter-spacing:-.01em;display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
.leg.upcoming .leg-title{color:var(--muted);}
.leg.current .leg-title{color:var(--ink);}
.leg.done .leg-title{color:var(--muted);}
.you{font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--fwd);border:1px solid var(--fwd);border-radius:5px;padding:1px 6px;}
.badge{font-size:11px;border-radius:5px;padding:1px 7px;border:1px solid var(--line);color:var(--muted);font-weight:500;}
.badge.gate{border-color:var(--gate);color:var(--gate);}
.leg-meta{font-size:12px;color:var(--muted);margin-top:5px;line-height:1.5;}
.leg-meta code{font-family:${MONO};font-size:11px;color:var(--ink);background:var(--card);padding:1px 5px;border-radius:4px;}
.leg-meta .k{color:var(--faint);}
/* micro cycle tracker — only on the active leg/item */
.cyc{display:none;gap:6px;margin-top:9px;align-items:center;font-family:${MONO};font-size:11px;}
.leg.current>.leg-card .cyc,.item.current>.cyc{display:flex;}
.cyc span{color:var(--faint);padding:2px 8px;border:1px solid var(--line);border-radius:5px;}
.cyc span.on{color:#fff;background:var(--fwd);border-color:var(--fwd);}
.cyc span.ok{color:var(--stop);border-color:var(--stop);}
.cyc .sep{border:0;padding:0;color:var(--faint);}
/* for-each items */
.items{margin:10px 0 0;}
.item{position:relative;padding:0 0 2px 26px;min-height:24px;}
.item::before{content:"";position:absolute;left:7px;top:18px;bottom:-2px;width:2px;background:var(--line);}
.item:last-child::before{display:none;}
.item>.node{width:16px;height:16px;top:3px;font-size:9px;}
.item.current>.node{border-color:var(--fwd);background:var(--fwd);color:#fff;box-shadow:0 0 0 3px rgba(94,106,210,.2);}
.item.done>.node{border-color:var(--stop);color:var(--stop);}
.item.fail>.node{border-color:var(--fail);color:var(--fail);}
.item-title{font-size:13px;color:var(--muted);padding:1px 0 8px;letter-spacing:-.01em;}
.item.current>.item-title{color:var(--ink);font-weight:500;}
.item.done>.item-title{color:var(--muted);}
.item-count{font-size:11px;color:var(--faint);font-family:${MONO};margin-left:6px;}

/* right log panel */
#side{background:var(--panel);border-left:1px solid var(--line);display:flex;flex-direction:column;overflow:hidden;}
#side h3{margin:0;padding:13px 16px 9px;font-size:10.5px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);border-bottom:1px solid var(--line);}
#log-wrap{overflow-y:auto;flex:1;padding:8px 16px;}
#log{list-style:none;margin:0;padding:0;font-family:${MONO};font-size:11px;}
#log li{padding:2.5px 0;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;letter-spacing:-.02em;}
#log li.enter{color:var(--ink);}#log li.fail{color:var(--fail);}#log li.human{color:var(--gate);}#log li.done{color:var(--stop);}
::-webkit-scrollbar{width:9px;height:9px;}::-webkit-scrollbar-thumb{background:var(--line);border-radius:5px;}::-webkit-scrollbar-track{background:transparent;}
`;

// Page script: builds the route from SPEC, then mutates it from the live event stream.
// Plain ES5-ish (no template literals) so it embeds cleanly.
const APP_JS = `(function(){
function q(s,r){return (r||document).querySelector(s);}
function qa(s,r){return Array.prototype.slice.call((r||document).querySelectorAll(s));}
function el(tag,cls,txt){var e=document.createElement(tag);if(cls)e.className=cls;if(txt!=null)e.textContent=txt;return e;}
function esc(s){return String(s==null?"":s);}

function doneLabel(dw){
  if(!dw)return "you confirm";
  if(dw.type==="test")return "test "+dw.target;
  if(dw.type==="command")return (dw.expect==="empty"?"empty: ":"")+dw.command;
  if(dw.type==="skill")return "skill "+dw.skill+(dw.minScore!=null?" \\u2265"+dw.minScore:"");
  if(dw.type==="human")return "you confirm"+(dw.description?': "'+dw.description+'"':"");
  return "you confirm";
}
function cycTracker(cycle){
  var steps=(cycle&&cycle.length)?cycle:["plan","act","observe"];
  var box=el("div","cyc");
  for(var i=0;i<steps.length;i++){
    if(i)box.appendChild(el("span","sep","\\u00b7"));
    box.appendChild(el("span",null,steps[i])).setAttribute("data-cyc",steps[i]);
  }
  return box;
}
function gateBadges(loop,title){
  if(loop&&loop.humanPlan)title.appendChild(el("span","badge gate","\\uD83D\\uDC64 you approve plan"));
  if(loop&&loop.humanReviewBeforeStop)title.appendChild(el("span","badge gate","\\uD83D\\uDC64 you review before stop"));
}

// leg builder for a loop body (used by pipeline stages and standalone loops)
function legBody(loop){
  var card=el("div","leg-card");
  if(loop&&loop.goal){var g=el("div","leg-meta");g.appendChild(el("span","k","goal "));g.appendChild(document.createTextNode(loop.goal));card.appendChild(g);}
  var d=el("div","leg-meta");d.appendChild(el("span","k","done when "));
  var code=el("code",null,doneLabel(loop&&loop.doneWhen));d.appendChild(code);card.appendChild(d);
  card.appendChild(cycTracker(loop&&loop.cycle));
  return card;
}
function node(glyph){var n=el("span","node",glyph||"");return n;}

function buildRoute(spec){
  var root=q("#route");
  var defs=(spec&&spec.definitions)||[];
  for(var di=0;di<defs.length;di++){
    var def=defs[di];
    var sec=el("section","def");
    var head=el("div","def-head");
    var kindLabel=def.kind==="pipeline"?("pipeline \\u00b7 "+(def.stages||[]).length+" stages")
      :def.kind==="flow"?("flow \\u00b7 "+(def.steps||[]).length+" steps"):"loop";
    head.appendChild(el("div","def-name",def.name||def.kind));
    head.appendChild(el("div","def-kind",kindLabel));
    sec.appendChild(head);
    var legs=el("ol","legs");

    if(def.kind==="pipeline"){
      var stages=def.stages||[];
      for(var si=0;si<stages.length;si++){
        var st=stages[si];
        var li=el("li","leg upcoming");li.setAttribute("data-leg","stage:"+st.name);
        li.appendChild(node(String(si+1)));
        var card=legBody(st.loop);
        var title=el("div","leg-title");title.appendChild(document.createTextNode((si+1)+". "+st.name));
        if(st.gate)title.appendChild(el("span","badge gate","\\uD83D\\uDC64 "+(st.gate.message||"approval")));
        gateBadges(st.loop,title);
        card.insertBefore(title,card.firstChild);
        li.appendChild(card);
        legs.appendChild(li);
      }
    }else if(def.kind==="flow"){
      var steps=def.steps||[];
      for(var fi=0;fi<steps.length;fi++){
        var step=steps[fi];
        if(step.forEach){
          var li2=el("li","leg upcoming");li2.setAttribute("data-leg","step:"+step.name);li2.setAttribute("data-foreach",step.forEach.var);
          li2.appendChild(node("\\u27f3"));
          var card2=el("div","leg-card");
          var t2=el("div","leg-title");
          t2.appendChild(document.createTextNode("for each "+step.forEach.var+" in "+step.forEach.source));
          t2.appendChild(el("span","item-count","","")).setAttribute("data-count","");
          card2.appendChild(t2);
          var m2=el("div","leg-meta");m2.appendChild(el("span","k","template "));m2.appendChild(el("code",null,step.ref));card2.appendChild(m2);
          card2.appendChild(el("ol","items")).setAttribute("data-items",step.forEach.var);
          li2.appendChild(card2);legs.appendChild(li2);
        }else{
          var li3=el("li","leg upcoming");li3.setAttribute("data-leg","step:"+step.name);
          li3.appendChild(node(String(fi+1)));
          var card3=el("div","leg-card");
          var t3=el("div","leg-title");t3.appendChild(document.createTextNode((fi+1)+". "+step.name));
          if(step.gate)t3.appendChild(el("span","badge gate","\\uD83D\\uDC64 "+(step.gate.message||"approval")));
          card3.appendChild(t3);
          var m3=el("div","leg-meta");m3.appendChild(el("span","k","runs "));m3.appendChild(el("code",null,step.ref));card3.appendChild(m3);
          li3.appendChild(card3);legs.appendChild(li3);
        }
      }
    }else{ // standalone loop
      var li4=el("li","leg upcoming");li4.setAttribute("data-leg","loop:"+(def.name||""));
      li4.appendChild(node("\\u21bb"));
      var card4=legBody(def);
      var t4=el("div","leg-title");t4.appendChild(document.createTextNode(def.name||"loop"));
      gateBadges(def,t4);
      card4.insertBefore(t4,card4.firstChild);
      li4.appendChild(card4);legs.appendChild(li4);
    }
    sec.appendChild(legs);
    root.appendChild(sec);
  }
}

// ---- live state ----
var currentLeg=null,currentItem=null;
function nowEl(){return currentItem||currentLeg;}
function setStatus(cls,txt){var s=q("#status");s.className="status"+(cls?" "+cls:"");q("#status-txt").textContent=txt;}
function logLine(txt,cls){var ul=q("#log");var li=el("li",cls,txt);ul.insertBefore(li,ul.firstChild);if(ul.children.length>120)ul.removeChild(ul.lastChild);}
function legTitleText(leg){var t=q(".leg-title",leg)||q(".item-title",leg);return t?t.textContent.trim():"";}

function setNow(stepLabel,scopeLeg){
  q("#now-step").textContent=stepLabel;
  // next = following sibling legs in the same list
  var nexts=[];
  var ref=scopeLeg||currentLeg;
  if(ref){var n=ref.nextElementSibling;var c=0;while(n&&c<3){nexts.push(legTitleText(n).replace(/\\s+/g," "));n=n.nextElementSibling;c++;}}
  var box=q("#now-next");
  if(nexts.length){box.innerHTML="";box.appendChild(document.createTextNode("next: "));var b=el("b",null,nexts[0]);box.appendChild(b);if(nexts.length>1)box.appendChild(document.createTextNode(" \\u2192 "+nexts.slice(1).join(" \\u2192 ")));}
  else{box.textContent="last step";}
}
function markCurrentLeg(leg){
  if(!leg)return;
  if(currentLeg&&currentLeg!==leg){currentLeg.classList.remove("current","human");if(!currentLeg.classList.contains("fail"))currentLeg.classList.add("done");currentLeg.classList.remove("upcoming");}
  leg.classList.remove("upcoming","done");leg.classList.add("current");
  currentLeg=leg;currentItem=null;
  leg.scrollIntoView({block:"center",behavior:"smooth"});
}
function resetCyc(scope){qa("[data-cyc]",scope).forEach(function(s){s.classList.remove("on","ok");});}

function handle(e){
  switch(e.type){
    case "pipeline-start": logLine("\\u25a3 pipeline \\""+e.name+"\\"","enter");setStatus("live","running");break;
    case "flow-start": logLine("\\u2192 flow \\""+e.name+"\\"","enter");setStatus("live","running");break;
    case "loop-start": setStatus("live","running");if(e.name)logLine("\\u21bb loop \\""+e.name+"\\"","enter");break;

    case "stage-start":{
      var leg=q('[data-leg="stage:'+cssEsc(e.name)+'"]');markCurrentLeg(leg);clearHuman();
      setNow(e.name,leg);logLine("\\u25a0 stage \\""+e.name+"\\"","enter");break;}
    case "stage-end":{
      var leg2=q('[data-leg="stage:'+cssEsc(e.name)+'"]');if(leg2){leg2.classList.remove("current","human","upcoming");leg2.classList.add(e.satisfied?"done":"fail");}
      logLine("\\u25a0 "+e.name+(e.satisfied?" \\u2713":" \\u2717"),e.satisfied?"done":"fail");break;}

    case "flow-step-start":{
      var fleg=q('[data-leg="step:'+cssEsc(e.name)+'"]');markCurrentLeg(fleg);clearHuman();
      setNow(e.name,fleg);logLine("\\u25b8 "+e.name,"enter");break;}
    case "flow-step-end":{
      var fleg2=q('[data-leg="step:'+cssEsc(e.name)+'"]');if(fleg2){fleg2.classList.remove("current","human","upcoming");fleg2.classList.add(e.satisfied?"done":"fail");}
      break;}

    case "foreach-start":{
      var host=q('[data-items="'+cssEsc(e["var"])+'"]');
      var legHost=q('[data-foreach="'+cssEsc(e["var"])+'"]');
      if(legHost){markCurrentLeg(legHost);var cnt=q("[data-count]",legHost);if(cnt)cnt.textContent="0/"+e.count;}
      if(host){while(host.firstChild)host.removeChild(host.firstChild);
        var labels=e.labels||[];
        for(var i=0;i<e.count;i++){
          var it=el("li","item upcoming");it.setAttribute("data-item",String(i));
          it.appendChild(node(String(i+1)));
          it.appendChild(el("div","item-title",labels[i]||(e["var"]+" "+(i+1))));
          it.appendChild(cycTracker());
          host.appendChild(it);
        }
      }
      logLine("for each "+e["var"]+" ("+e.count+")","enter");break;}
    case "foreach-item-start":{
      var items=qa('[data-items="'+cssEsc(e["var"])+'"] > .item');
      items.forEach(function(x){x.classList.remove("current");});
      var it2=items[e.index];
      if(it2){it2.classList.remove("upcoming");it2.classList.add("current");currentItem=it2;resetCyc(it2);it2.scrollIntoView({block:"center",behavior:"smooth"});}
      var lh=q('[data-foreach="'+cssEsc(e["var"])+'"]');if(lh){var c2=q("[data-count]",lh);if(c2)c2.textContent=(e.index+1)+"/"+e.total;}
      q("#now-step").textContent=(it2?legTitleText(it2):e["var"]+" "+(e.index+1))+"  ("+(e.index+1)+"/"+e.total+")";
      // "next" = the remaining stories in this sprint
      var rest=[];for(var ri=e.index+1;ri<items.length&&rest.length<3;ri++)rest.push(legTitleText(items[ri]));
      var nb=q("#now-next");
      if(rest.length){nb.innerHTML="";nb.appendChild(document.createTextNode("next: "));nb.appendChild(el("b",null,rest[0]));if(rest.length>1)nb.appendChild(document.createTextNode(" \\u2192 "+rest.slice(1).join(" \\u2192 ")));}
      else nb.textContent="last item";
      logLine("\\u2022 "+e["var"]+" "+(e.index+1)+"/"+e.total,"enter");break;}
    case "foreach-item-end":{
      var items2=qa('[data-items="'+cssEsc(e["var"])+'"] > .item');
      var it3=items2[e.index];if(it3){it3.classList.remove("current","upcoming");it3.classList.add(e.satisfied?"done":"fail");var nd=q(".node",it3);if(nd)nd.textContent=e.satisfied?"\\u2713":"\\u2717";}
      currentItem=null;break;}

    case "node-enter":{
      var scope=nowEl();if(scope){resetCyc(scope);var s=q('[data-cyc="'+e.node+'"]',scope);if(s)s.classList.add("on");}
      q("#now-step").textContent=(currentItem?legTitleText(currentItem)+" \\u2192 ":"")+e.node;
      logLine("\\u2192 "+e.node+" (try "+e.attempt+")","enter");break;}
    case "node-exit":{
      var scope2=nowEl();if(scope2){var s2=q('[data-cyc="'+e.node+'"]',scope2);if(s2){s2.classList.remove("on");s2.classList.add(e.ok?"ok":"");}}
      if(!e.ok)logLine("\\u2717 "+e.node,"fail");break;}
    case "loop-back":{var scope3=nowEl();if(scope3)resetCyc(scope3);logLine("\\u21ba reflect \\u2192 replan");break;}

    case "human":{
      var ne=nowEl();if(ne)ne.classList.add("human");
      showHuman(e.kind,e.prompt);logLine("\\uD83D\\uDC64 "+e.kind+": "+e.prompt,"human");break;}
    case "observe": logLine("= "+(e.passed?"PASS":"fail")+(e.output?" \\u2014 "+e.output.split("\\n")[0].slice(0,46):""),e.passed?"done":"fail");break;
    case "reflect": logLine("~ "+e.text.split("\\n")[0].slice(0,54));break;
    case "stop": setStatus(e.reason==="done"?"done":"fail",e.reason==="done"?"done":e.reason);logLine("\\u25fc stop ("+e.reason+")"+(e.warn?" \\u2014 "+e.warn:""));break;
    case "loop-end": if(currentLeg&&!currentLeg.classList.contains("fail")){/* keep */}break;
    case "pipeline-end": case "flow-end": setStatus(e.satisfied?"done":"fail",e.satisfied?"done":"stopped");if(currentLeg){currentLeg.classList.remove("current","human");currentLeg.classList.add(e.satisfied?"done":"fail");}clearHuman();break;
  }
}
function cssEsc(s){return String(s).split('"').join('\\\\"');}
function showHuman(kind,prompt){q("#now").classList.add("human");var h=q("#now-human");h.innerHTML="";var b=el("b",null,"\\uD83D\\uDC64 needs you \\u00b7 ");h.appendChild(b);h.appendChild(document.createTextNode(prompt||kind));}
function clearHuman(){q("#now").classList.remove("human");}

// boot
buildRoute(window.__SPEC__);
q("#src").textContent=window.__TITLE__+" \\u00b7 "+((window.__SPEC__.definitions||[]).length)+" definition(s)";
var es=new EventSource("/events");
es.onmessage=function(ev){try{handle(JSON.parse(ev.data));}catch(_){}};
})();`;

/** Escape a string for safe interpolation into HTML text / attributes. */
function htmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/** Safe JSON embed: neutralizes </script> and line/para separators inside an inline script. */
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
  const safeTitle = htmlEscape(title);

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Loop &#xb7; live &#xb7; ${safeTitle}</title>
<style>${LIVE_CSS}</style>
</head>
<body>
<header>
  <div class="wordmark">Loop</div>
  <div class="subtitle" id="src"></div>
  <div class="status" id="status"><span class="dot"></span><span id="status-txt">waiting</span></div>
</header>
<main>
  <div id="now">
    <div id="now-kicker">Now</div>
    <div id="now-step">waiting to start&#x2026;</div>
    <div id="now-next"></div>
    <div id="now-human"></div>
  </div>
  <div id="route"></div>
</main>
<aside id="side">
  <h3>Activity</h3>
  <div id="log-wrap"><ul id="log"></ul></div>
</aside>
<script>
window.__SPEC__=${embedJson(file)};
window.__TITLE__=${embedJson(title)};
${APP_JS}
</script>
</body></html>`;
}
