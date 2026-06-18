import { RENDERER_JS, BASE_CSS, FONTS } from "@loop/viz";

const INITIAL = [
  'loop "fix billing apostrophe bug":',
  "  goal: settings save when the company name has an apostrophe",
  '  done when the test "billing.spec.ts::apostrophe" passes',
  "",
  "  look at: billing/form.tsx, api/settings.ts, and the last failure",
  "  allow edits automatically, but ask me before migrations or pushes",
  "",
  "  each cycle: plan, then act, then observe",
  "  when it fails: reflect on which layer broke, then plan again",
  "  also: polish the code, run a security check",
  '  after 6 tries: stop and warn "thrashing"',
].join("\n");

const STUDIO_CSS = `
body.studio{background:var(--bg);color:var(--ink);font-family:"Space Mono",ui-monospace,monospace;display:flex;flex-direction:column;height:100vh;overflow:hidden;}
.bar{display:flex;align-items:center;gap:14px;padding:12px 18px;border-bottom:1px solid var(--line);}
.bar .wordmark{font-family:"Saira Condensed",sans-serif;font-weight:800;font-size:22px;letter-spacing:2px;text-transform:uppercase;background:linear-gradient(92deg,var(--fwd),var(--reflect));-webkit-background-clip:text;background-clip:text;color:transparent;}
.bar .wordmark::before{content:"↻ ";-webkit-text-fill-color:var(--reflect);}
.bar .tag{color:var(--muted);font-size:11px;letter-spacing:.5px;}
.bar .spacer{flex:1;}
button.run{font-family:"Space Mono";font-weight:700;font-size:13px;color:#06231c;background:var(--stop);border:0;border-radius:7px;padding:8px 16px;cursor:pointer;letter-spacing:.5px;}
button.run:disabled{opacity:.5;cursor:default;}
.cols{flex:1;display:grid;grid-template-columns:300px 380px 1fr;min-height:0;}
.pane{display:flex;flex-direction:column;min-height:0;border-right:1px solid var(--line);}
.pane h2{font-family:"Saira Condensed",sans-serif;font-weight:700;font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:var(--muted);margin:0;padding:11px 14px;border-bottom:1px solid var(--line);}
#log{flex:1;overflow:auto;padding:12px 14px;font-size:12px;line-height:1.55;}
#log .u{color:var(--fwd);} #log .a{color:var(--muted);} #log .ev{color:var(--reflect);white-space:pre-wrap;}
.chatbox{display:flex;gap:6px;padding:10px;border-top:1px solid var(--line);}
.chatbox input{flex:1;background:var(--node);border:1px solid var(--line);color:var(--ink);border-radius:7px;padding:9px 11px;font-family:inherit;font-size:12.5px;}
.chatbox button{background:var(--fwd);color:#04231f;border:0;border-radius:7px;padding:0 14px;font-family:inherit;font-weight:700;cursor:pointer;}
#editor{flex:1;background:transparent;color:var(--ink);border:0;outline:0;resize:none;padding:14px;font-family:"Space Mono",monospace;font-size:13px;line-height:1.6;tab-size:2;}
#err{color:#ff6b6b;font-size:11.5px;padding:8px 14px;border-top:1px solid var(--line);min-height:18px;}
#err.ok{color:var(--stop);}
#graphpane{background-image:linear-gradient(var(--grid) 1px,transparent 1px),linear-gradient(90deg,var(--grid) 1px,transparent 1px);background-size:28px 28px;}
#graph{flex:1;overflow:auto;padding:16px;}
.trace{border-top:1px solid var(--line);max-height:150px;overflow:auto;padding:8px 14px;font-size:11px;color:var(--muted);}
.trace .now{color:var(--stop);}
`;

/** The studio's single-page editor. Chat + editable .loop + live graph, all bound to the IR. */
export function editorHtml(): string {
  const client = CLIENT_JS.replace("__INITIAL__", JSON.stringify(INITIAL));
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Loop Studio</title>
${FONTS}
<style>${BASE_CSS}${STUDIO_CSS}</style>
</head>
<body class="studio">
<div class="bar">
  <div class="wordmark">Loop Studio</div>
  <div class="tag">chat &middot; .loop &middot; graph &mdash; one source of truth</div>
  <div class="spacer"></div>
  <span class="tag" id="status"></span>
  <button class="run" id="run">▶ Run</button>
</div>
<div class="cols">
  <section class="pane">
    <h2>Chat</h2>
    <div id="log"><div class="a">Describe a flow in plain English &mdash; I'll write the .loop and draw it.</div></div>
    <form class="chatbox" id="chatform">
      <input id="intent" placeholder="e.g. fix the auth test, gate the deploy" autocomplete="off" />
      <button type="submit">Send</button>
    </form>
  </section>
  <section class="pane">
    <h2>.loop</h2>
    <textarea id="editor" spellcheck="false"></textarea>
    <div id="err"></div>
  </section>
  <section class="pane" id="graphpane" style="border-right:0">
    <h2>Graph</h2>
    <div id="graph"></div>
    <div class="trace" id="trace" style="display:none"></div>
  </section>
</div>
<script>${RENDERER_JS}</script>
<script>${client}</script>
</body></html>`;
}

// Plain JS, no backticks / template literals (keeps it embeddable in the TS template above).
const CLIENT_JS = `
var ta=document.getElementById("editor"),graph=document.getElementById("graph"),err=document.getElementById("err");
var log=document.getElementById("log"),status=document.getElementById("status"),runBtn=document.getElementById("run");
var trace=document.getElementById("trace");
ta.value=__INITIAL__;
var t=null;
function logLine(cls,txt){var d=document.createElement("div");d.className=cls;d.textContent=txt;log.appendChild(d);log.scrollTop=log.scrollHeight;}
function parseNow(){
  fetch("/api/parse",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({source:ta.value})})
  .then(function(r){return r.json();}).then(function(res){
    if(res.ok){err.className="ok";err.textContent="\\u2713 parsed";LoopViz.render(graph,res.spec);}
    else{err.className="";err.textContent="parse error"+(res.line?(" (line "+res.line+")"):"")+": "+res.error;}
  });
}
ta.addEventListener("input",function(){clearTimeout(t);t=setTimeout(parseNow,350);});
document.getElementById("chatform").addEventListener("submit",function(e){
  e.preventDefault();var inp=document.getElementById("intent");var intent=inp.value.trim();if(!intent)return;
  logLine("u","you: "+intent);inp.value="";status.textContent="generating\\u2026";
  fetch("/api/generate",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({intent:intent})})
  .then(function(r){return r.json();}).then(function(res){
    status.textContent="";
    if(res.ok){ta.value=res.source;LoopViz.render(graph,res.spec);err.className="ok";err.textContent="\\u2713 generated in "+res.attempts+" attempt(s)";logLine("a","loop: drafted a flow ("+res.spec.definitions.length+" def) \\u2192 see .loop + graph");}
    else{logLine("a","loop: couldn't generate \\u2014 "+res.error);}
  });
});
function clearActive(){var n=graph.querySelectorAll("[data-cyc]");for(var i=0;i<n.length;i++)n[i].classList.remove("active");}
function highlight(ev){
  if(ev.type==="node-enter"){clearActive();var el=graph.querySelector('[data-cyc="'+ev.node+'"]');if(el)el.classList.add("active");}
  else if(ev.type==="loop-back"){var e=graph.querySelector('[data-edge="reflect"]');if(e){e.classList.remove("fire");void e.offsetWidth;e.classList.add("fire");}}
  else if(ev.type==="stop"||ev.type==="loop-end"){clearActive();}
}
function fmt(ev){
  if(ev.type==="node-enter")return "\\u00B7 "+ev.node+" (try "+ev.attempt+")";
  if(ev.type==="observe")return "= "+(ev.passed?"PASS":"fail");
  if(ev.type==="reflect")return "~ reflect";
  if(ev.type==="loop-back")return "\\u21BA back to "+ev.to;
  if(ev.type==="human")return "? human "+ev.kind+": "+(ev.answer||"");
  if(ev.type==="stop")return "\\u25FC stop ("+ev.reason+")"+(ev.warn?(" \\u26A0 "+ev.warn):"");
  if(ev.type==="loop-end")return ev.satisfied?"\\u2713 satisfied":"\\u2717 not satisfied";
  if(ev.type==="stage-start")return "\\u25A0 stage "+ev.name;
  return null;
}
function traceLine(txt){trace.style.display="block";var d=document.createElement("div");d.textContent=txt;trace.appendChild(d);trace.scrollTop=trace.scrollHeight;}
function runLoop(){
  runBtn.disabled=true;status.textContent="running\\u2026";trace.innerHTML="";trace.style.display="block";
  fetch("/api/run",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({source:ta.value})})
  .then(function(resp){
    var reader=resp.body.getReader(),dec=new TextDecoder(),buf="";
    function pump(){return reader.read().then(function(r){
      if(r.done){runBtn.disabled=false;status.textContent="";return;}
      buf+=dec.decode(r.value,{stream:true});var parts=buf.split("\\n\\n");buf=parts.pop();
      for(var i=0;i<parts.length;i++){var line=parts[i];
        if(line.indexOf("event: end")>=0){runBtn.disabled=false;status.textContent="done";clearActive();continue;}
        if(line.indexOf("event: error")>=0){var m=line.indexOf("data: ");if(m>=0){var er=JSON.parse(line.slice(m+6));traceLine("\\u2717 "+er.message);}runBtn.disabled=false;continue;}
        var d=line.indexOf("data: ");if(d<0)continue;var ev;try{ev=JSON.parse(line.slice(d+6));}catch(e){continue;}
        highlight(ev);var f=fmt(ev);if(f)traceLine(f);
      }
      return pump();
    });}
    return pump();
  }).catch(function(e){runBtn.disabled=false;status.textContent="";traceLine("\\u2717 "+e.message);});
}
runBtn.addEventListener("click",runLoop);
parseNow();
`;
