import type { LoopFile } from "@loop/parser";

export interface VizOptions {
  /** Heading shown in the wordmark (e.g. the source file name). */
  title?: string;
}

/**
 * Render a parsed Loop file as a self-contained HTML control-loop schematic.
 * plan -> act -> observe is a forward signal path; reflect-on-failure is a glowing
 * feedback arc — the loop's anatomy made visible.
 */
export function renderHtml(file: LoopFile, opts: VizOptions = {}): string {
  const body = `<script>
${RENDERER_JS}
var SPEC = ${embed(file)};
var TITLE = ${embed(opts.title ?? "loop")};
document.getElementById("src").textContent = TITLE + " · " + (SPEC.definitions.length) + " definition(s)";
LoopViz.render(document.getElementById("stage"), SPEC);
</script>`;
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Loop · schematic</title>
${FONTS}
<style>${BASE_CSS}${SCHEMATIC_CSS}</style>
</head>
<body class="schematic">
<header>
  <div class="wordmark">Loop</div>
  <div class="subtitle" id="src"></div>
  <div class="legend">
    <span><i class="fwd"></i>signal</span><span><i class="ref"></i>reflect</span>
    <span><i class="gat"></i>human gate</span><span><i class="stp"></i>done</span>
  </div>
</header>
<main><div id="stage"></div></main>
${body}
</body></html>`;
}

/** Serialize for safe embedding inside an inline <script> (neutralize </script> + line seps). */
function embed(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

export const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com" /><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin /><link href="https://fonts.googleapis.com/css2?family=Saira+Condensed:wght@600;700;800&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet" />`;

/** Palette + primitives shared by the standalone schematic and the studio. */
export const BASE_CSS = `
:root{--bg:#0a0e13;--panel:#0d141b;--grid:rgba(80,150,170,.055);--ink:#cdd8e4;--muted:#647889;--line:#28353f;--fwd:#37d4c4;--reflect:#ffb454;--stop:#5fd38a;--gate:#ff84b8;--node:#101a23;--node-br:#2b3a47;}
*{box-sizing:border-box;}html,body{margin:0;height:100%;}
.nlabel{font-family:"Saira Condensed",sans-serif;font-weight:700;letter-spacing:1.2px;}
.sub{fill:var(--muted);font-size:10.5px;}
.panel-title{font-family:"Saira Condensed",sans-serif;font-weight:700;fill:var(--ink);letter-spacing:.6px;}
.panel-goal{fill:var(--muted);font-size:11.5px;}
.chip{font-size:10px;}
.reflect-flow{stroke-dasharray:7 6;animation:march 1.1s linear infinite;}
.fwd-flow{stroke-dasharray:3 7;animation:march 1.4s linear infinite;}
@keyframes march{to{stroke-dashoffset:-52;}}
[data-cyc].active rect:first-of-type{stroke-width:2.6;filter:drop-shadow(0 0 7px currentColor);}
[data-edge].fire{animation:firepulse .5s ease-out 3;}
@keyframes firepulse{50%{stroke-width:5;opacity:1;}}
`;

const SCHEMATIC_CSS = `
body.schematic{background-color:var(--bg);background-image:linear-gradient(var(--grid) 1px,transparent 1px),linear-gradient(90deg,var(--grid) 1px,transparent 1px),radial-gradient(1200px 700px at 70% -10%,rgba(55,212,196,.06),transparent 60%);background-size:28px 28px,28px 28px,100% 100%;color:var(--ink);font-family:"Space Mono",ui-monospace,monospace;-webkit-font-smoothing:antialiased;}
.schematic header{display:flex;align-items:baseline;gap:16px;padding:26px 34px 14px;border-bottom:1px solid var(--line);}
.wordmark{font-family:"Saira Condensed",sans-serif;font-weight:800;font-size:30px;letter-spacing:2px;text-transform:uppercase;background:linear-gradient(92deg,var(--fwd),var(--reflect));-webkit-background-clip:text;background-clip:text;color:transparent;}
.wordmark::before{content:"↻ ";-webkit-text-fill-color:var(--reflect);}
.subtitle{color:var(--muted);font-size:12.5px;letter-spacing:.5px;}
.legend{margin-left:auto;display:flex;gap:16px;font-size:11px;color:var(--muted);}
.legend i{display:inline-block;width:22px;height:0;vertical-align:middle;margin-right:6px;}
.legend .fwd{border-top:2px solid var(--fwd);}.legend .ref{border-top:2px dashed var(--reflect);}
.legend .gat{border-top:2px solid var(--gate);}.legend .stp{border-top:2px solid var(--stop);}
.schematic main{padding:12px 18px 60px;overflow:auto;}svg{display:block;}
`;

/**
 * The in-browser graph engine, as a string so the studio can include the exact same
 * code. Exposes a global `LoopViz.render(containerEl, spec)`. Cycle nodes carry
 * data-cyc="plan|act|observe" and the back-edge data-edge="reflect" so a live run can
 * highlight them. Plain JS (no template literals) to stay embeddable.
 */
export const RENDERER_JS = `var LoopViz=(function(){
var NW=128,NH=52,GAP=78,DIP=84,ROWGAP=56;
var COL={plan:"#8ab4d6",act:"#37d4c4",observe:"#9a8cff"};
function esc(s){return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}
function attr(o){var s="";for(var k in o){s+=" "+k+'="'+o[k]+'"';}return s;}
function E(t,o,i){return "<"+t+attr(o||{})+">"+(i||"")+"</"+t+">";}
function V(t,o){return "<"+t+attr(o||{})+"/>";}
function trunc(s,n){return s.length>n?s.slice(0,n-1)+"\\u2026":s;}
function node(x,y,label,accent,dataCyc){
  var g="";
  g+=V("rect",{x:x,y:y,width:NW,height:NH,rx:9,fill:"var(--node)",stroke:accent,"stroke-width":1.4});
  g+=V("rect",{x:x,y:y,width:4,height:NH,rx:2,fill:accent});
  g+=E("text",{x:x+NW/2,y:y+NH/2+1,"text-anchor":"middle","dominant-baseline":"middle",class:"nlabel",fill:"var(--ink)","font-size":15},esc(label));
  return E("g",dataCyc?{"data-cyc":dataCyc,style:"color:"+accent}:{},g);
}
function fwd(x1,y,x2){
  return V("line",{x1:x1,y1:y,x2:x2-7,y2:y,stroke:"var(--fwd)","stroke-width":1.8,class:"fwd-flow"})
   +V("path",{d:"M "+(x2-7)+" "+(y-4)+" L "+x2+" "+y+" L "+(x2-7)+" "+(y+4)+" Z",fill:"var(--fwd)"});
}
function backEdge(xF,xT,yB,label,sub){
  var dy=yB+DIP,d="M "+xF+" "+yB+" C "+xF+" "+dy+" "+xT+" "+dy+" "+xT+" "+(yB+8),mx=(xF+xT)/2;
  var g=V("path",{d:d,fill:"none",stroke:"var(--reflect)","stroke-width":7,opacity:.18,filter:"url(#glow)"})
   +V("path",{d:d,fill:"none",stroke:"var(--reflect)","stroke-width":2.2,class:"reflect-flow"})
   +V("path",{d:"M "+(xT-5)+" "+(yB+10)+" L "+xT+" "+yB+" L "+(xT+5)+" "+(yB+10)+" Z",fill:"var(--reflect)"})
   +E("text",{x:mx,y:dy-8,"text-anchor":"middle",class:"nlabel",fill:"var(--reflect)","font-size":13},esc(label));
  if(sub)g+=E("text",{x:mx,y:dy+10,"text-anchor":"middle",class:"sub"},esc(sub));
  return E("g",{"data-edge":"reflect"},g);
}
function diamond(cx,cy,label){var r=13;
  return V("path",{d:"M "+cx+" "+(cy-r)+" L "+(cx+r)+" "+cy+" L "+cx+" "+(cy+r)+" L "+(cx-r)+" "+cy+" Z",fill:"var(--node)",stroke:"var(--gate)","stroke-width":1.5})
   +E("text",{x:cx+r+7,y:cy+4,class:"nlabel",fill:"var(--gate)","font-size":12},esc(label));
}
function chip(x,y,text,color){var w=7.2*text.length+14;
  return [V("rect",{x:x,y:y,width:w,height:17,rx:8.5,fill:"none",stroke:color,"stroke-width":1})
   +E("text",{x:x+w/2,y:y+12,"text-anchor":"middle",class:"chip",fill:color},esc(text)),w];
}
function doneLabel(dw){if(!dw)return "awaiting human";if(dw.type==="test")return "test "+dw.target;if(dw.type==="command")return (dw.expect==="empty"?"empty: ":"")+dw.command;return "human: "+(dw.description||"");}
function loopRow(loop,ox,oy){
  var s="",cyc=loop.cycle&&loop.cycle.length?loop.cycle:["plan","act","observe"],xs=[],i;
  for(i=0;i<cyc.length;i++)xs.push(ox+i*(NW+GAP));
  var midY=oy+NH/2;
  for(i=0;i<cyc.length-1;i++)s+=fwd(xs[i]+NW,midY,xs[i+1]);
  var stopX=ox+cyc.length*(NW+GAP);
  s+=fwd(xs[cyc.length-1]+NW,midY,stopX);
  s+=E("text",{x:(xs[cyc.length-1]+NW+stopX)/2,y:midY-9,"text-anchor":"middle",class:"sub",fill:"var(--stop)"},"goal met");
  s+=node(stopX,oy,"stop","var(--stop)");
  s+=E("text",{x:stopX+NW/2,y:oy+NH+15,"text-anchor":"middle",class:"sub"},esc(trunc("done when "+doneLabel(loop.doneWhen),24)));
  for(i=0;i<cyc.length;i++)s+=node(xs[i],oy,cyc[i],COL[cyc[i]]||"var(--node-br)",cyc[i]);
  var ai=cyc.indexOf("act");
  if(ai>=0&&loop.policy){var px=xs[ai],py=oy+NH+12,a;
    if(loop.policy.auto)for(a=0;a<loop.policy.auto.length;a++){var c1=chip(px,py,loop.policy.auto[a]+" auto","var(--fwd)");s+=c1[0];px+=c1[1]+5;}
    if(loop.policy.confirm)for(a=0;a<loop.policy.confirm.length;a++){var c2=chip(px,py,"ask "+loop.policy.confirm[a],"var(--gate)");s+=c2[0];px+=c2[1]+5;}
  }
  if(loop.humanPlan)s+=E("text",{x:xs[0]+NW/2,y:oy-10,"text-anchor":"middle",class:"nlabel",fill:"var(--gate)","font-size":11},"\\u25C7 human plans");
  if(loop.humanReviewBeforeStop)s+=diamond(stopX-GAP/2,midY,"review");
  var hasRef=(loop.transitions||[]).some(function(t){return t.on==="fail"&&(t.do||[]).some(function(d){return d.action==="reflect"||d.action==="plan";});});
  var thr=(loop.transitions||[]).find(function(t){return t.on==="attempts";});
  if(hasRef)s+=backEdge(xs[cyc.length-1]+NW/2,xs[0]+NW/2,oy+NH,"reflect \\u2192 replan",thr?("\\u2264 "+thr.threshold+" tries"):null);
  var width=stopX+NW+40;
  if(loop.also&&loop.also.length){var ax=stopX+NW+64,ay=oy-8,m;
    s+=E("text",{x:ax,y:ay-6,class:"sub",fill:"var(--fwd)"},"also");
    for(m=0;m<loop.also.length;m++){var ry=ay+m*30;
      s+=V("path",{d:"M "+(stopX+NW)+" "+midY+" C "+(stopX+NW+30)+" "+midY+" "+(ax-14)+" "+(ry+13)+" "+ax+" "+(ry+13),fill:"none",stroke:"var(--fwd)","stroke-width":1,"stroke-dasharray":"3 4",opacity:.7});
      s+=V("rect",{x:ax,y:ry,width:172,height:26,rx:6,fill:"var(--node)",stroke:"var(--line)"});
      s+=E("text",{x:ax+10,y:ry+17,class:"chip",fill:"var(--ink)"},esc(loop.also[m]));
    }
    width=Math.max(width,ax+172+30);
  }
  return {svg:s,width:width,bottom:oy+NH+(hasRef?DIP+26:34)};
}
function panel(def,oy){
  var s="",ox=60,top=oy+46,width=0,bottom=top,name=def.name||"loop";
  if(def.kind==="pipeline"){
    s+=E("text",{x:34,y:oy+18,class:"panel-title","font-size":18},esc("\\u25A3 "+name));
    var cy=top,prev=null,i;
    for(i=0;i<def.stages.length;i++){var st=def.stages[i];
      s+=E("text",{x:34,y:cy+NH/2+4,class:"nlabel",fill:"var(--muted)","font-size":12},esc(st.name));
      if(st.gate){s+=diamond(60+NW+GAP/2,cy-ROWGAP/2-4,"gate");s+=E("text",{x:60+NW+GAP/2+22,y:cy-ROWGAP/2+10,class:"sub"},esc(st.gate.message));}
      var r=loopRow(st.loop,200,cy);s+=r.svg;width=Math.max(width,r.width);bottom=r.bottom;
      if(prev!=null)s+=V("line",{x1:300,y1:prev,x2:300,y2:cy-6,stroke:"var(--line)","stroke-width":1.4,"stroke-dasharray":"2 4"});
      prev=r.bottom-20;cy=r.bottom+ROWGAP+24;
    }
    bottom=cy;
  }else{
    s+=E("text",{x:34,y:oy+18,class:"panel-title","font-size":18},esc("\\u21BB "+name));
    if(def.goal)s+=E("text",{x:34,y:oy+36,class:"panel-goal"},esc(def.goal));
    var rr=loopRow(def,ox,top+8);s+=rr.svg;width=rr.width;bottom=rr.bottom;
  }
  return {svg:s,width:Math.max(width,760),bottom:bottom+40};
}
function render(container,spec){
  var defs=(spec&&spec.definitions)||[],parts=[],y=20,maxW=760,i;
  for(i=0;i<defs.length;i++){var p=panel(defs[i],y);parts.push(p.svg);maxW=Math.max(maxW,p.width);y=p.bottom;}
  var defsSvg=E("defs",{},'<filter id="glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3.2"/></filter>');
  container.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" width="'+maxW+'" height="'+y+'" viewBox="0 0 '+maxW+' '+y+'">'+defsSvg+parts.join("")+'</svg>';
}
return {render:render};
})();`;
