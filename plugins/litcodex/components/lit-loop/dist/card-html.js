// src/card-html.ts — the LIT card: one self-contained HTML page for the Codex desktop app (MCP App).
//
// Inline CSS and script only; no network, fonts or images. It draws the status from `lit_card_status`
// (activation, workflow map, live step, context and quota use) in the LIT look: the pink-to-flame LIT
// pill, lowercase stage words with ✓ or ·, rails that run flame → pink → accent, the current stage as
// an accent pill with dark ink, and the running tool with its time.
//
// The host reports how it shows the card. Inline (in the thread) gets the compact card and tells the
// host its height through `notifyIntrinsicHeight`, because the host sizes inline frames from that; the
// side pane arrives as `fullscreen` and gets a vertical timeline with the use bars at the bottom. The
// card drew in a proportional face inside the app, so it pins its monospace face. Light and dark follow the
// host theme. It polls every 1.5 s while visible and working, slows down when idle and stops while
// hidden. It talks to the host through `window.openai` when present, else MCP Apps postMessage JSON-RPC.
//
// Every LIT turn opens a fresh card next to the newest turn. A card learns its own opening time once, from
// the tool result that created it; each poll names the thread's newest card. When that is a later card,
// this one folds into a single quiet line with its final state, stops every timer and never polls again.
// Usage bars stay in the calm accent until 70 % (amber) and 90 % (red); pink and flame are for LIT marks.
//
// A side discipline started over paused work adds one row under the map: the paused frames with their stage
// and gauge, the running frame after ▶, and the way back (`lit continue`). A gauge is drawn only when both counts are
// real; a frame with no total gets its known facts in words and, while it runs, a moving pulse bar. The lit-adhd brief
// alone gets the rainbow look: a drifting rainbow border and pill, hue-cycling gauges (each cell of a gauge, stage word or use bar in its own hue, even at a low fill) and a four-star sparkle trail.
// Every motion is slow (a 9 to 14 s linear pass of a gradient or a 12 s hue turn; each 9 px star fades once in 5.6 s,
// staggered 1.4 s apart), so no 1 s window holds more than a fraction of one luminance change, against a limit of
// three opposing 10 % swings over a large area; nothing blinks or strobes, and under
// prefers-reduced-motion everything stands still as a static gradient. The idle card offers `lit adhd` as the way back.
export const CARD_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>LIT</title>
<style>
:root{color-scheme:dark;--bg:#10141c;--bg2:#0d1118;--ink:#e6edf3;--dim:#7d8590;--faint:#30363d;--rail:#3a434e;--flame:#ff6337;--pink:#ff2d95;--acc:#5fd7ff;--accfill:#5fd7ff;--green:#6bdb8f;--amber:#ffaf3c;--red:#ff5f5f;--pillink:#0b0f14;
--mono:"SF Mono",SFMono-Regular,ui-monospace,Menlo,Monaco,Consolas,"Liberation Mono",monospace}
:root.light{color-scheme:light;--bg:#ffffff;--bg2:#fafbfd;--ink:#1b1f27;--dim:#5f6672;--faint:#dde2e8;--rail:#cfd6de;--flame:#bd3f0b;--pink:#c0186b;--acc:#006f99;--green:#17783f;--amber:#9a5b00;--red:#c42f2f}
*{box-sizing:border-box}
html,body{margin:0;background:transparent}
body{color:var(--ink);font-size:12.5px;line-height:1.55;font-weight:500;-webkit-font-smoothing:antialiased}
.lc,.lc *{font-family:var(--mono)!important}
.lc{position:relative;border-radius:14px;padding:11px 14px 10px;margin:1px;
background:radial-gradient(110% 120% at 0% 0%,color-mix(in srgb,var(--pink) 8%,var(--bg)),var(--bg) 55%,var(--bg2));
border:1px solid color-mix(in srgb,var(--acc) 55%,transparent);box-shadow:0 0 0 1px color-mix(in srgb,var(--acc) 8%,transparent),0 10px 30px -18px color-mix(in srgb,var(--acc) 50%,transparent);animation:breathe 4.8s ease-in-out infinite}
.lc.is-done{border-color:color-mix(in srgb,var(--green) 55%,transparent);box-shadow:0 0 0 1px color-mix(in srgb,var(--green) 8%,transparent);animation:none}
.lc.is-idle{border-color:color-mix(in srgb,var(--dim) 40%,transparent);box-shadow:none;animation:none}
@keyframes breathe{0%,100%{border-color:color-mix(in srgb,var(--acc) 38%,transparent)}50%{border-color:color-mix(in srgb,var(--acc) 80%,transparent)}}
.head{display:flex;align-items:center;gap:7px;white-space:nowrap;min-height:22px}
.brand{position:relative;overflow:hidden;display:inline-flex;align-items:center;gap:3px;padding:1px 9px 1px 7px;border-radius:999px;background:linear-gradient(90deg,#ff2d95,#ff6337);color:#0b0f14;font-weight:800;letter-spacing:.03em;box-shadow:0 0 16px -6px rgba(255,45,149,.6)}
.j{display:inline-block;flex:0 0 auto;width:3px;height:3px;border-radius:50%;background:var(--rail)}
.name{font-weight:700;overflow:hidden;text-overflow:ellipsis}.acc{color:var(--acc)}.dim{color:var(--dim)}.ok{color:var(--green)}
.right{margin-left:auto;font-weight:700;letter-spacing:.04em;display:inline-flex;align-items:center;gap:6px}
.dot{width:6px;height:6px;border-radius:50%;background:var(--acc);box-shadow:0 0 7px var(--acc);animation:pulse 1.6s ease-in-out infinite}
@keyframes pulse{50%{opacity:.35}}
.map{display:flex;align-items:center;gap:7px;margin:9px 0 6px;white-space:nowrap;overflow:hidden}
.st em{font-style:normal;margin-left:3px}.st.todo{color:var(--dim)}.st.done{font-weight:600}
.rail{position:relative;display:inline-block;height:2px;border-radius:2px;flex:1 1 12px;max-width:56px;min-width:10px;background:var(--rail)}
.rail.lead{overflow:hidden}.headfill{position:absolute;inset:0;width:40%;background:linear-gradient(90deg,var(--acc),transparent)}
.comet{position:absolute;top:50%;width:5px;height:5px;margin-top:-2.5px;border-radius:50%;background:#fff;box-shadow:0 0 7px 2px var(--acc);animation:comet 2.4s linear infinite}
:root.light .comet{background:var(--accfill);box-shadow:0 0 5px 1px var(--accfill)}
@keyframes comet{0%{left:-8%;opacity:0}15%,85%{opacity:1}100%{left:100%;opacity:0}}
.nowpill{position:relative;overflow:hidden;display:inline-flex;gap:6px;align-items:center;padding:0 9px;border-radius:999px;background:var(--accfill);color:var(--pillink);font-weight:800;box-shadow:0 0 14px -4px color-mix(in srgb,var(--accfill) 80%,transparent)}
.brand::after,.nowpill::after{content:"";position:absolute;inset:0;background:linear-gradient(100deg,transparent 30%,rgba(255,255,255,.7) 50%,transparent 70%);transform:translateX(-120%);animation:sweep 3.2s ease-in-out infinite;pointer-events:none}
@keyframes sweep{0%,55%{transform:translateX(-120%)}85%,100%{transform:translateX(120%)}}
.is-done .brand::after,.is-idle .brand::after,.folded .brand::after{display:none}
.row{display:flex;align-items:center;gap:8px;white-space:nowrap;min-height:20px}
.tl{display:inline-flex;align-items:center;gap:6px;overflow:hidden;min-width:0}
.nx{overflow:hidden;text-overflow:ellipsis}
.bar{display:inline-flex;gap:2px;vertical-align:middle}.seg{display:inline-block;width:6px;height:10px;border-radius:1.5px}.seg.off{background:var(--faint)}
.live{display:inline-flex;align-items:center;gap:6px;flex:0 0 auto}.row .tl+.live{margin-left:auto}
.live .tool{font-weight:700}.live .last{font-weight:600;overflow:hidden;text-overflow:ellipsis}.live.done{color:var(--green);font-weight:700}
.spin{color:var(--acc);animation:spin 1s linear infinite;flex:0 0 auto}@keyframes spin{to{transform:rotate(360deg)}}
.spin.soft{color:var(--dim)}
kbd{font-size:12px;color:var(--acc);background:color-mix(in srgb,var(--acc) 12%,transparent);border:1px solid color-mix(in srgb,var(--acc) 32%,transparent);border-radius:6px;padding:0 6px}
.foot{display:flex;align-items:center;gap:12px;margin-top:7px;padding-top:7px;border-top:1px solid color-mix(in srgb,var(--faint) 75%,transparent);font-size:11.5px;color:var(--dim);white-space:nowrap;overflow:hidden}
.use{display:inline-flex;align-items:center;gap:5px}.use b{font-weight:600;color:var(--ink)}
.mini{display:inline-flex;gap:1.5px}.mini i{display:inline-block;width:4px;height:8px;border-radius:1px;background:var(--faint)}
.ws{margin-left:auto;overflow:hidden;text-overflow:ellipsis}
/* the side pane (the host's fullscreen mode): a vertical timeline, the use bars at the bottom */
:root.pane .lc{min-height:calc(100vh - 2px);display:flex;flex-direction:column;padding:18px 20px 16px;font-size:13px}
:root.pane .brand{font-size:13.5px;padding:2px 11px 2px 9px}:root.pane .name{font-size:13.5px}
.tline{margin:18px 0 6px}
.stg{position:relative;padding:0 0 12px 24px}
.stg::before{content:"";position:absolute;left:4px;top:0;bottom:0;width:2px;background:var(--line,var(--rail))}
.stg:first-child::before{top:9px}.stg:last-child::before{bottom:auto;height:9px}.stg:last-child{padding-bottom:0}
.stg .pt{position:absolute;left:0;top:4px;width:10px;height:10px;border-radius:50%;border:2px solid var(--rail);background:var(--bg)}
.stg.done .pt{border-color:var(--c);background:var(--c)}
.stg.cur .pt{border-color:var(--acc);background:var(--bg);box-shadow:0 0 0 3px color-mix(in srgb,var(--acc) 25%,transparent),0 0 10px var(--acc)}
.stg .line1{display:flex;align-items:center;gap:8px;min-height:18px}
.stg .w{font-weight:600}.stg.todo .w{color:var(--dim);font-weight:500}
.stg .meta{margin-left:auto;color:var(--dim);font-size:12px}
.detail{margin-top:8px;padding:8px 11px;border-radius:10px;border:1px solid color-mix(in srgb,var(--faint) 85%,transparent);background:color-mix(in srgb,var(--bg2) 60%,transparent);display:flex;flex-direction:column;gap:3px}
.banner{display:flex;align-items:center;gap:8px;margin:14px 0 0;padding:7px 11px;border-radius:10px;color:var(--green);font-weight:700;background:color-mix(in srgb,var(--green) 11%,transparent);border:1px solid color-mix(in srgb,var(--green) 32%,transparent)}
.banner .dim{font-weight:500}
.usage{margin-top:auto;padding-top:14px;border-top:1px solid color-mix(in srgb,var(--faint) 75%,transparent);display:flex;flex-direction:column;gap:6px;font-size:12px;color:var(--dim)}
.ub{display:grid;grid-template-columns:3.2em 1fr 3.4em;align-items:center;gap:10px}.ub .pct{text-align:right;color:var(--ink);font-weight:600}
.track{height:5px;border-radius:3px;background:var(--faint);overflow:hidden}.track i{display:block;height:100%;border-radius:3px}
.hero{text-align:center;padding:36px 0 10px}.flame{font-size:40px;filter:drop-shadow(0 0 16px rgba(255,99,55,.45))}
.herot{font-weight:700;font-size:15px;margin-top:8px}.heros{color:var(--dim);margin:6px 0 14px}
.examples{display:flex;flex-direction:column;align-items:center;gap:6px}
/* an earlier turn's card, once a newer one opened below: one quiet line, no glow, no motion */
.lc.folded{padding:3px 10px;border-radius:10px;background:var(--bg);border:1px solid color-mix(in srgb,var(--dim) 30%,transparent);box-shadow:none;animation:none;font-size:12px}
.lc.folded .head{min-height:20px;gap:6px}
.lc.folded .brand{padding:0 7px 0 6px;font-size:11px;background:color-mix(in srgb,var(--dim) 24%,var(--bg));color:var(--ink);box-shadow:none;filter:grayscale(1)}
.lc.folded .name{color:var(--dim);font-weight:600}
.lc.folded .right{font-weight:600;letter-spacing:0;flex:0 0 auto}
.pbar{display:inline-block;position:relative;width:54px;height:6px;border-radius:3px;background:var(--faint);overflow:hidden;vertical-align:middle}
.pbar i{position:absolute;top:0;bottom:0;width:38%;border-radius:3px;background:linear-gradient(90deg,transparent,var(--acc),transparent);animation:slidebar 1.8s ease-in-out infinite}
@keyframes slidebar{0%{left:-40%}100%{left:104%}}
.stk{margin:0 0 5px;overflow:hidden;text-overflow:ellipsis;font-size:12px}.stk .fr{font-weight:700}.stk kbd{font-size:11.5px}
.thr{margin:0 0 5px;font-size:12px;overflow:hidden}.thr .row{min-height:19px;gap:7px}.thr .fr{font-weight:700}.thr kbd{font-size:11.5px}
.thr .ld{white-space:pre}.thr .tg,.thr .tw{color:var(--dim);font-weight:700}
.thr .running .tg,.thr .running .tw{color:var(--green)}.thr .blocked .tg,.thr .blocked .tw{color:var(--amber)}.thr .done .tg,.thr .done .tw{color:var(--green)}
.lc.rewind{--rb:#ff2d95,#ff6337,#ffd23c,#6bdb8f,#5fd7ff,#9b6bff,#ff2d95;--rbt:rgba(255,45,149,.34),rgba(255,99,55,.3),rgba(255,210,60,.28),rgba(107,219,143,.28),rgba(95,215,255,.32),rgba(155,107,255,.34),rgba(255,45,149,.34);border:3px solid transparent;padding:9px 12px 8px;background:radial-gradient(120% 140% at 100% 0%,color-mix(in srgb,#9b6bff 18%,transparent),transparent 55%) padding-box,linear-gradient(var(--bg),var(--bg)) padding-box,linear-gradient(115deg,var(--rb)) border-box;background-size:100% 100%,100% 100%,200% 200%;box-shadow:0 0 26px -2px #9b6bff;animation:drift 10s linear infinite,glow 10s linear infinite}
:root.pane .lc.rewind{padding:16px 18px 14px}
.lc.rewind.is-done,.lc.rewind.is-idle{animation:none}
.lc.rewind .head{margin:-9px -12px 6px;padding:7px 12px;border-radius:10px 10px 0 0;background:linear-gradient(100deg,var(--rbt));background-size:200% 100%;animation:slide 8s linear infinite}
:root.pane .lc.rewind .head{margin:-16px -18px 8px;padding:10px 18px}
.lc.rewind.folded{padding:2px 8px;animation:drift 10s linear infinite}
.lc.rewind.folded .head{margin:0;padding:0;background:none;animation:none}
.lc.rewind .brand,.lc.rewind .nowpill{background:linear-gradient(100deg,var(--rb));background-size:200% 100%;animation:slide 5s linear infinite;box-shadow:0 0 14px -2px #ff2d95}
.lc.rewind.is-done .brand{animation:none}
.lc.rewind .name{background:linear-gradient(100deg,var(--rb));background-size:200% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;-webkit-text-fill-color:transparent;animation:slide 5s linear infinite}
@keyframes slide{from{background-position:0 0}to{background-position:200% 0}}
@keyframes glow{0%,100%{box-shadow:0 0 26px -2px #ff2d95}17%{box-shadow:0 0 26px -2px #ff6337}33%{box-shadow:0 0 26px -2px #ffd23c}50%{box-shadow:0 0 26px -2px #5fd7ff}67%{box-shadow:0 0 26px -2px #9b6bff}83%{box-shadow:0 0 26px -2px #6bdb8f}}
.lc.rewind .bar,.lc.rewind .pbar{animation:hue 6s linear infinite}
.lc.rewind .mini,.lc.rewind .st.done{animation:hue 9s linear infinite}
.lc.rewind .pbar{width:84px;height:8px;border-radius:4px}
@keyframes hue{to{filter:hue-rotate(360deg)}}
.lc.rewind .pbar i{background:linear-gradient(90deg,transparent,#ff2d95,#ffd23c,#6bdb8f,#5fd7ff,transparent)}
.sparks{position:absolute;inset:0;overflow:hidden;pointer-events:none;border-radius:inherit}
.sparks i{position:absolute;font-style:normal;font-size:13px;line-height:1;opacity:0;color:#fff;text-shadow:0 0 6px #ff2d95,0 0 12px #5fd7ff;animation:trail 4.2s linear infinite}
.sparks i:nth-child(1){top:8%;animation-delay:0s}.sparks i:nth-child(2){top:30%;animation-delay:.6s}.sparks i:nth-child(3){top:52%;animation-delay:1.2s}.sparks i:nth-child(4){top:74%;animation-delay:1.8s}.sparks i:nth-child(5){top:18%;animation-delay:2.4s}.sparks i:nth-child(6){top:62%;animation-delay:3s}.sparks i:nth-child(7){top:86%;animation-delay:3.6s}
@keyframes trail{0%{left:3%;opacity:0}12%{opacity:.95}80%{opacity:.6}100%{left:95%;opacity:0}}
:root.light .sparks i{color:#c0186b;text-shadow:none}
:root.light .lc.rewind{--rb:#c0186b,#bd3f0b,#9a5b00,#17783f,#006f99,#6a3fd1,#c0186b;--rbt:rgba(192,24,107,.2),rgba(189,63,11,.18),rgba(154,91,0,.16),rgba(23,120,63,.18),rgba(0,111,153,.2),rgba(106,63,209,.2),rgba(192,24,107,.2);background:radial-gradient(120% 140% at 100% 0%,color-mix(in srgb,#6a3fd1 10%,transparent),transparent 55%) padding-box,linear-gradient(var(--bg),var(--bg)) padding-box,linear-gradient(115deg,var(--rb)) border-box;background-size:100% 100%,100% 100%,200% 200%;box-shadow:0 0 22px -4px #6a3fd1}
@keyframes drift{from{background-position:0 0,0 0,0% 50%}to{background-position:0 0,0 0,200% 50%}}
/* YOUR TURN: amber border, slow breathe (2.4 s period) */
.lc.turn{border-color:var(--amber);box-shadow:0 0 18px -4px var(--amber);animation:amberbreathe 2.4s ease-in-out infinite}
.lc.turn .brand{background:var(--amber);color:var(--pillink)}
.lc.turn .right{color:var(--amber)}
.lc.turn .brand::after{display:none}
@keyframes amberbreathe{0%,100%{border-color:color-mix(in srgb,var(--amber) 40%,transparent);box-shadow:0 0 12px -4px color-mix(in srgb,var(--amber) 30%,transparent)}50%{border-color:var(--amber);box-shadow:0 0 22px -2px color-mix(in srgb,var(--amber) 70%,transparent)}}
.lc.turn.folded{animation:none}
/* REVIEW: segmented top and bottom borders drawn by JS in .review-lanes */
.lc.review{border-color:color-mix(in srgb,var(--acc) 40%,transparent);animation:none}
.lc.review .brand::after{display:none}
.review-lanes{display:flex;gap:2px;height:3px;border-radius:2px;margin:0 -2px 6px}.review-lanes i{flex:1;border-radius:2px;transition:background .4s ease}
/* DONE: one burst of rainbow embers, then settle */
.lc.done{border-color:color-mix(in srgb,var(--green) 60%,transparent);box-shadow:0 0 0 1px color-mix(in srgb,var(--green) 8%,transparent)}
.done-burst{position:absolute;inset:0;overflow:hidden;pointer-events:none;border-radius:inherit;animation:burstfade 2s ease-out forwards}
.done-burst i{position:absolute;font-style:normal;font-size:14px;line-height:1;color:#fff;text-shadow:0 0 6px var(--green),0 0 12px var(--acc);animation:ember 1.6s ease-out forwards}
.done-burst i:nth-child(1){top:20%;left:15%;animation-delay:0s}.done-burst i:nth-child(2){top:40%;left:50%;animation-delay:.15s}.done-burst i:nth-child(3){top:60%;left:80%;animation-delay:.3s}.done-burst i:nth-child(4){top:30%;left:70%;animation-delay:.1s}.done-burst i:nth-child(5){top:70%;left:30%;animation-delay:.25s}
@keyframes ember{0%{opacity:1;transform:translateY(0) scale(1)}100%{opacity:0;transform:translateY(-18px) scale(.5)}}
@keyframes burstfade{0%{opacity:1}80%{opacity:1}100%{opacity:0}}
@media (prefers-reduced-motion:reduce){.lc,.lc *{animation:none!important}.lc.rewind{animation:none!important;background-position:0 0,0 0,0% 50%}.brand::after,.nowpill::after,.comet,.sparks,.done-burst{display:none}.pbar i{left:31%}.lc.rewind .bar,.lc.rewind .pbar,.lc.rewind .mini,.lc.rewind .st.done,.lc.rewind .brand,.lc.rewind .nowpill{animation:none!important}.lc.turn{animation:none!important}}
</style></head>
<body><div id="card" class="lc is-idle" role="status" aria-live="polite"><div class="head"><span class="brand">🔥 LIT</span><span class="j">·</span><span class="name dim">starting…</span></div></div>
<script>
(function(){
var STATUS_TOOL="lit_card_status";
var FAST=1500,SLOW=5000,IDLE=15000,MAX_BACKOFF=30000;
var root=document.documentElement,card=document.getElementById("card");
var status=null,thread=null,timer=null,ticker=null,failures=0,idleSince=Date.now(),bridge=null,hostMode=null;
var opened=null,folded=false,burstKey=null;
var nextId=1,pending={};

function el(tag,cls,text){var n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=String(text);return n;}
function add(parent){for(var i=1;i<arguments.length;i++){var c=arguments[i];if(c!=null)parent.appendChild(typeof c==="string"?document.createTextNode(c):c);}return parent;}
function joiner(){var n=el("span","j");n.setAttribute("aria-hidden","true");return n;}

/* linear-RGB mixing, so the flame → pink → accent ramp keeps its brightness */
function hex(c){c=c.trim().replace("#","");return[0,2,4].map(function(i){return parseInt(c.substr(i,2),16)/255;});}
function lin(v){return v<=0.04045?v/12.92:Math.pow((v+0.055)/1.055,2.4);}
function gam(v){return v<=0.0031308?v*12.92:1.055*Math.pow(v,1/2.4)-0.055;}
function mix(a,b,t){var x=hex(a),y=hex(b);return"#"+x.map(function(v,i){var m=gam(lin(v)+(lin(y[i])-lin(v))*t);return("0"+Math.round(Math.max(0,Math.min(1,m))*255).toString(16)).slice(-2);}).join("");}
function token(name){return getComputedStyle(root).getPropertyValue(name)||"#ffffff";}
/* the rewind look draws every cell of a gauge, map or use bar in its own hue round the wheel, whatever the fill */
var WHEEL_DARK=["#ff2d95","#ff6337","#ffd23c","#6bdb8f","#5fd7ff","#9b6bff"],WHEEL_LIGHT=["#c0186b","#bd3f0b","#9a5b00","#17783f","#006f99","#6a3fd1"];
function rewound(){return card.classList.contains("rewind");}
function lookIs(name){return card.classList.contains(name);}
function wheel(t){var c=root.classList.contains("light")?WHEEL_LIGHT:WHEEL_DARK,x=Math.max(0,Math.min(1,t))*(c.length-1),i=Math.min(c.length-2,Math.floor(x));return mix(c[i],c[i+1],x-i);}
function ramp(t){if(rewound())return wheel(t);var f=token("--flame"),p=token("--pink"),a=token("--acc");return t<=0.5?mix(f,p,t*2):mix(p,a,(t-0.5)*2);}

function clock(ms){var s=Math.max(0,Math.floor(ms/1000));return Math.floor(s/60)+":"+("0"+(s%60)).slice(-2);}
function span(ms){var s=Math.max(1,Math.round(ms/1000));if(s<60)return s+"s";var m=Math.floor(s/60);if(m<60)return s%60?m+"m "+(s%60)+"s":m+"m";return Math.floor(m/60)+"h "+(m%60)+"m";}
function since(t){var n=el("span","dim el","· "+clock(Date.now()-t));n.setAttribute("data-since",String(t));return n;}
function turnClock(t){var n=el("span","el",clock(Date.now()-t));n.setAttribute("data-since",String(t));n.setAttribute("data-bare","1");return n;}
function pane(){var m=(window.openai&&window.openai.displayMode)||hostMode;return m==="fullscreen"||m==="pip";}

function bar(done,total){
 var cells=Math.min(total,10),filled=total===0?0:Math.round(done/total*cells);
 if(done>0&&filled===0)filled=1;if(done<total&&filled===cells)filled=cells-1;
 var b=el("span","bar");
 for(var i=0;i<cells;i++){var s=el("i","seg"+(i<filled?"":" off"));if(i<filled)s.style.background=rewound()?wheel(cells<=1?0:i/(cells-1)):mix(token("--pink"),token("--acc"),cells<=1?0:i/(cells-1));b.appendChild(s);}
 return b;
}
function useColor(p){return p>=90?token("--red"):p>=70?token("--amber"):null;}
function mini(p){var b=el("span","mini"),on=Math.round(p/10),warn=useColor(p),fill=warn||token("--acc");for(var i=0;i<10;i++){var c=el("i");if(i<on)c.style.background=warn||!rewound()?fill:wheel(i/9);b.appendChild(c);}return b;}
function spinner(soft){
 var ns="http://www.w3.org/2000/svg",svg=document.createElementNS(ns,"svg");
 svg.setAttribute("class","spin"+(soft?" soft":""));svg.setAttribute("viewBox","0 0 16 16");svg.setAttribute("width","12");svg.setAttribute("height","12");svg.setAttribute("aria-hidden","true");
 var c=document.createElementNS(ns,"circle");
 [["cx","8"],["cy","8"],["r","5.6"],["fill","none"],["stroke","currentColor"],["stroke-width","2.2"],["stroke-dasharray","24 11.2"],["stroke-linecap","round"]].forEach(function(a){c.setAttribute(a[0],a[1]);});
 svg.appendChild(c);return svg;
}
function progressOf(map){if(!map)return null;for(var i=0;i<map.cells.length;i++)if(map.cells[i].progress)return map.cells[i].progress;return null;}
function doneWord(s){return progressOf(s.map)?"COMPLETE":"DONE";}
function took(s){if(s.turnEndedAt)return s.turnEndedAt-(s.turnStartedAt||s.ignitedAt||s.turnEndedAt);return (s.lastStepAt||s.now)-s.ignitedAt;}

/* what LIT is doing now: the running tool, the turn's own time, or that it waits */
function liveNode(s){
 var n=el("span","live");
 if(s.step){add(n,spinner(false),el("span","tool",s.step.tool),since(s.step.startedAt));return n;}
 if(s.state==="complete"){n.className="live done";add(n,"✓ ",el("span",null,doneWord(s)==="DONE"?"turn done":"all done"));if(s.ignitedAt)add(n,el("span","dim","in "+span(took(s))));return n;}
 if(s.state==="ignited"&&s.working){add(n,spinner(true),el("span","dim","thinking"));if(s.lastTool)add(n,el("span","dim","· last"),el("span","acc","▸"),el("span","last",s.lastTool));return n;}
 if(s.state==="ignited"){add(n,el("span","dim","◦ waiting for you"));return n;}
 return null;
}
/* the header's right side: the turn clock while working (the map already names the stage), the result once done */
function head(s){
 var h=el("div","head");add(h,el("span","brand","🔥 LIT"),joiner());
 if(s.state==="ready"){add(h,el("span","name dim","ready"),el("span","right dim","idle"));return h;}
 add(h,el("span","name acc",s.mode||"lit"));
 if(s.state==="complete"){add(h,el("span","right ok",doneWord(s)+" ✓"));return h;}
 if(s.look==="turn"){var tr=el("span","right");tr.style.color="var(--amber)";tr.appendChild(el("span",null,"YOUR TURN"));h.appendChild(tr);return h;}
 if(s.look==="review"&&s.reviewLanes){var cnt=s.reviewLanes.filter(function(l){return l==="pass"||l==="fail";}).length;var rr=el("span","right acc");rr.appendChild(el("span",null,"REVIEW "+cnt+"/5"));h.appendChild(rr);return h;}
 var r=el("span","right acc");if(!s.map)r.appendChild(el("span",null,"IGNITED"));
 if(s.working){if(s.turnStartedAt)r.appendChild(turnClock(s.turnStartedAt));r.appendChild(el("i","dot"));}
 if(r.childNodes.length)h.appendChild(r);return h;
}
/* an earlier turn's card: the LIT mark, its mode and how it ended, on one line */
function renderFolded(s){
 var h=el("div","head");add(h,el("span","brand","🔥 LIT"),joiner(),el("span","name",s&&s.mode||"lit"));
 if(s&&s.state==="complete"){var r=el("span","right ok",doneWord(s).toLowerCase()+" ✓");if(s.ignitedAt)add(r," ",el("span","dim",span(took(s))));h.appendChild(r);}
 else h.appendChild(el("span","right dim","continued below ↓"));
 card.appendChild(h);
}
function pillExtra(c){var l=(c.label||"").toLowerCase(),w=c.word.toLowerCase();if(!l||l===w)return"";return l.indexOf(w+" ")===0?l.slice(w.length+1):l;}
function stageWord(c){var w=c.word;if(c.state==="done"&&c.label)w+=" "+c.label;else if(c.progress&&c.state!=="current")w+=" "+c.progress.done+"/"+c.progress.total;return w;}
function mapRow(s){
 var m=el("div","map"),cells=s.map.cells,n=cells.length,lastColor=null;
 cells.forEach(function(c,i){
  var color=ramp(n<=1?0:i/(n-1)),cur=c.state==="current"&&s.state!=="complete";
  if(i>0){
   var r=el("span","rail");
   if((c.state==="done"||c.state==="partial")&&cells[i-1].state!=="pending")r.style.background="linear-gradient(90deg,"+(lastColor||color)+","+color+")";
   else if(cur){r.style.background="linear-gradient(90deg,"+(lastColor||token("--acc"))+","+token("--acc")+")";r.appendChild(el("i","comet"));}
   else if(cells[i-1].state==="current"&&s.state!=="complete"){r.className="rail lead";r.appendChild(el("i","headfill"));}
   m.appendChild(r);
  }
  if(cur){
   var p=el("span","st nowpill",c.word);var extra=pillExtra(c);if(extra)add(p,el("b",null,extra));if(c.progress)add(p,el("b",null,c.progress.done+"/"+c.progress.total));m.appendChild(p);lastColor=token("--acc");
  }else if(c.state==="pending"){var t=el("span","st todo",c.word);t.appendChild(el("em",null,"·"));m.appendChild(t);}
  else{var d=el("span","st done",stageWord(c));d.style.color=color;d.appendChild(el("em",null,c.state==="partial"?"…":"✓"));m.appendChild(d);lastColor=color;}
 });
 return m;
}
/* the task line: progress and next on the left, the live step on the right; just the live step otherwise */
function taskRow(s){
 var row=el("div","row"),prog=progressOf(s.map),next=s.map&&s.map.next;
 if(prog||next){
  var left=el("span","tl");add(left,el("span","dim","└"));
  if(prog)add(left,el("span","dim","task"),el("b",null,prog.done+"/"+prog.total),bar(prog.done,prog.total));
  if(next){if(prog)left.appendChild(joiner());add(left,el("span","dim","next"),el("span","acc","▸"),el("span","nx",next));}
  add(row,left,liveNode(s));return row;
 }
 add(row,el("span","dim","└"),liveNode(s));return row;
}
/* work paused under a side discipline: paused frames, the running one after the play mark, and the way back */
function pulse(){var b=el("span","pbar");b.setAttribute("aria-hidden","true");b.appendChild(el("i"));return b;}
/* a gauge only when both counts are real; otherwise what is known in words, and a moving pulse on the running frame */
function frameMark(f,running){
 if(f.gauge)return el("span","dim",f.gauge);
 var w=el("span","dim",f.note||"");
 return running?add(el("span","fm"),w,pulse()):w;
}
function stackNode(s){
 var k=s.stack;if(!k||!k.paused||!k.paused.length||!k.running)return null;
 var row=el("div","row stk");add(row,el("span","dim","⏸"));
 k.paused.forEach(function(f,i){if(i>0)row.appendChild(joiner());add(row,el("span","fr",f.name+(f.stage?" "+f.stage:"")),frameMark(f,false));});
 add(row,el("span","acc","‖ ▶"),el("span","fr",k.running.name),frameMark(k.running,true),el("span","dim","· back"),el("kbd",null,"lit continue"));
 return row;
}
/* the thread rows: frames parent first, lanes under the top frame behind a fork line, other sessions last; no placeholder, ever */
var GLYPH={running:"●",paused:"|",blocked:"!",idle:"-",done:"✓"};
function threadRow(t,lead){
 var r=el("div","row tr "+t.state);
 add(r,el("span","dim ld",lead||""),el("span","tg",GLYPH[t.state]||"●"),el("span","fr",t.name));
 if(t.stage)r.appendChild(el("span","dim",t.stage));
 if(t.gauge)r.appendChild(el("span","dim",t.gauge));
 else{if(t.note)r.appendChild(el("span","dim",t.note));if(t.state==="running")r.appendChild(pulse());}
 r.appendChild(el("span","tw",t.state));
 if(t.session)r.appendChild(el("span","dim","· other session "+t.session));
 return r;
}
function threadsNode(s){
 var k=s.threads;if(!k||!k.chain)return null;
 var box=el("div","thr"),last=null,under=new Array(Math.max(1,k.chain.length)).join("   ");
 k.chain.forEach(function(t,i){
  last=threadRow(t,i?new Array(i).join("   ")+"└─ ":"");
  if(k.back&&i===k.chain.length-1)add(last,el("span","dim","· back"),el("kbd",null,"lit continue"));
  box.appendChild(last);
 });
 if(k.laneCount>=2)box.appendChild(add(el("div","row dim"),el("span","ld",under+"┬ "+k.laneCount+" lanes in parallel")));
 (k.lanes||[]).forEach(function(t,i){
  var branch=k.laneCount>=2?(i===k.lanes.length-1?"└─ ":"├─ "):(k.chain.length?"└─ ":"");
  last=threadRow(t,under+branch);box.appendChild(last);
 });
 (k.others||[]).forEach(function(t){last=threadRow(t,"");box.appendChild(last);});
 if(k.more>0&&last)last.appendChild(el("span","dim","+"+k.more+" more"));
 return box;
}
/* the rainbow look's sparkle trail: four small stars drifting along the top edge, one at a time */
function sparks(){var w=el("div","sparks");w.setAttribute("aria-hidden","true");["✦","✧","✦","✧","✦","✧","✦"].forEach(function(c){w.appendChild(el("i",null,c));});return w;}
function doneBurst(){var w=el("div","done-burst");w.setAttribute("aria-hidden","true");["✦","✧","✦","✧","✦"].forEach(function(c){w.appendChild(el("i",null,c));});return w;}
var LANE_COLORS_D=["#5fd7ff","#b48cff","#ff6fae","#6bdb8f","#ffd75f"],LANE_RUNNING_D=["#5095af","#7e6caf","#a85c82","#569771","#a89557"],LANE_DIM_D="#3d444d",LANE_FAIL_D="#ff5f5f";
function laneEl(states){var w=el("div","review-lanes");w.setAttribute("aria-hidden","true");(states||[]).forEach(function(st,i){var s=el("i");s.style.background=st==="pass"?LANE_COLORS_D[i]:st==="running"?LANE_RUNNING_D[i]:st==="fail"?LANE_FAIL_D:LANE_DIM_D;w.appendChild(s);});return w;}
function useItems(s){
 var u=s.usage||{},items=[];
 [["ctx",u.ctx],["5h",u.fiveHour],["1w",u.week]].forEach(function(x){if(typeof x[1]==="number")items.push(x);});
 return items;
}
function foot(s){
 var f=el("div","foot");
 useItems(s).forEach(function(x){var u=el("span","use");add(u,x[0],mini(x[1]),el("b",null,x[1]+"%"));var w=useColor(x[1]);if(w)u.lastChild.style.color=w;f.appendChild(u);});
 if(s.branch){var g=el("span","use");add(g,"git",el("b",null,s.branch));f.appendChild(g);}
 if(s.workspace)f.appendChild(el("span","ws",s.workspace));
 return f.childNodes.length?f:null;
}
function timeline(s){
 var t=el("div","tline"),cells=s.map.cells,n=cells.length;
 cells.forEach(function(c,i){
  var color=ramp(n<=1?0:i/(n-1)),cur=c.state==="current"&&s.state!=="complete",todo=c.state==="pending";
  var g=el("div","stg "+(cur?"cur":todo?"todo":"done"));g.style.setProperty("--c",color);
  var nextCell=cells[i+1];if(!todo&&!cur&&nextCell&&nextCell.state!=="pending")g.style.setProperty("--line",color);
  var l1=el("div","line1"),w;
  if(cur)w=el("span","st nowpill",c.label||c.word.toUpperCase());
  else{w=el("span","w",c.word);if(!todo)w.style.color=color;}
  var meta=el("span","meta");if(c.progress)meta.textContent=c.progress.done+"/"+c.progress.total;else if(!todo&&!cur)meta.textContent=c.label?c.label+" ✓":"✓";
  add(l1,w,meta);add(g,el("span","pt"),l1);
  if(cur){
   var d=el("div","detail"),prog=c.progress;
   if(prog){var r1=el("div","row");add(r1,el("span","dim","tasks"),el("b",null,prog.done+"/"+prog.total),bar(prog.done,prog.total));d.appendChild(r1);}
   if(s.map.next){var r2=el("div","row");add(r2,el("span","dim","next"),el("span","acc","▸"),el("span","nx",s.map.next));d.appendChild(r2);}
   var r3=el("div","row"),live=liveNode(s);if(live){r3.appendChild(live);d.appendChild(r3);}
   g.appendChild(d);
  }
  t.appendChild(g);
 });
 return t;
}
function usageBlock(s){
 var items=useItems(s);if(!items.length&&!s.branch&&!s.workspace)return null;
 var u=el("div","usage");
 items.forEach(function(x){var r=el("div","ub"),tr=el("span","track"),fill=el("i"),w=useColor(x[1]);fill.style.width=x[1]+"%";fill.style.background=w||token("--acc");tr.appendChild(fill);var pct=el("span","pct",x[1]+"%");if(w)pct.style.color=w;add(r,el("span",null,x[0]),tr,pct);u.appendChild(r);});
 var g=el("div","row");if(s.branch)add(g,"git",el("b",null,s.branch));if(s.workspace){if(s.branch)g.appendChild(joiner());g.appendChild(el("span",null,s.workspace));}
 if(g.childNodes.length)u.appendChild(g);
 return u;
}
function renderInline(s){
 card.appendChild(head(s));
 if(s.state==="ready"){var hint=el("div","row");add(hint,el("span","dim","no LIT skill yet"),joiner(),el("span","dim","type"),el("kbd",null,"lit <task>"),el("span","dim","to start one"));hint.style.marginTop="6px";card.appendChild(hint);var back=el("div","row");add(back,el("span","dim","back from a break?"),el("kbd",null,"lit adhd"),el("span","dim","shows where you were"));card.appendChild(back);return;}
 if(s.look==="review"&&s.reviewLanes)card.appendChild(laneEl(s.reviewLanes));
 if(s.map)card.appendChild(mapRow(s));else card.appendChild(el("div","map"));
 var sk=threadsNode(s)||stackNode(s);if(sk)card.appendChild(sk);
 card.appendChild(taskRow(s));
 var f=foot(s);if(!f)return;card.appendChild(f);
 /* a narrow card drops the workspace, then the branch, then the last use items, rather than cut a number */
 var ws=f.querySelector(".ws");if(ws&&ws.scrollWidth>ws.clientWidth+1)f.removeChild(ws);
 while(f.lastChild&&f.scrollWidth>f.clientWidth+1)f.removeChild(f.lastChild);
 if(!f.childNodes.length)card.removeChild(f);
}
function renderPane(s){
 card.appendChild(head(s));
 if(s.look==="review"&&s.reviewLanes)card.appendChild(laneEl(s.reviewLanes));
 if(s.state==="ready"){
  var hero=el("div","hero"),hs=el("div","heros");add(hs,"type ",el("kbd",null,"lit <task>")," in this thread to start one");
  var ex=el("div","examples");["lit add a --shout flag","lit plan the release note","lit-loop fix the parser","lit adhd"].forEach(function(t){ex.appendChild(el("kbd",null,t));});
  add(hero,el("div","flame","🔥"),el("div","herot","no LIT skill yet"),hs,ex);card.appendChild(hero);
 }else{
  if(s.state==="complete"){var prog=progressOf(s.map),bn=el("div","banner",doneWord(s)+" ✓");if(prog)add(bn,el("span","dim",prog.done+"/"+prog.total+" tasks"));if(s.ignitedAt)add(bn,el("span","dim","· "+span(took(s))));card.appendChild(bn);}
  if(s.map)card.appendChild(timeline(s));else{var r=el("div","row");r.style.marginTop="14px";add(r,liveNode(s));card.appendChild(r);}
  var pk=threadsNode(s)||stackNode(s);if(pk){pk.style.marginTop="10px";card.appendChild(pk);}
 }
 var u=usageBlock(s);if(u)card.appendChild(u);
}
function render(){
 var s=status;
 if(folded){root.classList.toggle("pane",false);card.className="lc folded";card.textContent="";renderFolded(s);reportSize();return;}
 if(!s)return;
 var p=pane();root.classList.toggle("pane",p);
 card.className="lc"+(s.state==="complete"?" is-done":s.state==="ready"?" is-idle":"")+(s.state!=="ready"?(s.look==="rewind"?" rewind":s.look==="review"?" review":s.look==="turn"?" turn":s.look==="done"?" done":""):"");
 card.textContent="";
 if(p)renderPane(s);else renderInline(s);
 if(s.look==="rewind"&&s.state==="ignited")card.appendChild(sparks());
 if(s.look==="done"){var key=(s.thread||"")+"/"+(s.ignitedAt||0)+"/"+(s.turnEndedAt||0);if(burstKey!==key){burstKey=key;card.appendChild(doneBurst());}}
 reportSize();
}
function tick(){
 if(ticker){clearInterval(ticker);ticker=null;}
 if(document.hidden||!card.querySelector("[data-since]"))return;
 ticker=setInterval(function(){var n=card.querySelectorAll("[data-since]");for(var i=0;i<n.length;i++)n[i].textContent=(n[i].getAttribute("data-bare")?"":"· ")+clock(Date.now()-Number(n[i].getAttribute("data-since")));},1000);
}
/* the card's own opening time comes only from the tool result that created it, never from a poll */
function own(s){if(opened===null&&s&&s.card&&typeof s.card.openedAt==="number")opened=s.card.openedAt;}
function fold(){
 folded=true;
 if(timer){clearTimeout(timer);timer=null;}
 if(ticker){clearInterval(ticker);ticker=null;}
 render();
}
function accept(s,fromTool){
 if(folded||!s||s.version!==1)return;
 if(fromTool)own(s);
 if(opened!==null&&typeof s.cardOpenedAt==="number"&&s.cardOpenedAt>opened){fold();return;}
 status=s;if(s.thread)thread=s.thread;
 if(s.working)idleSince=Date.now();
 render();tick();
}

/* host bridge: window.openai when present, else MCP Apps JSON-RPC over postMessage */
function rpc(method,params){return new Promise(function(resolve,reject){var id=nextId++;pending[id]={resolve:resolve,reject:reject};window.parent.postMessage({jsonrpc:"2.0",id:id,method:method,params:params},"*");setTimeout(function(){if(pending[id]){delete pending[id];reject(new Error(method+" timed out"));}},5000);});}
window.addEventListener("message",function(ev){
 var m=ev.data;if(ev.source!==window.parent||!m||m.jsonrpc!=="2.0")return;
 if(m.id!=null&&pending[m.id]){var p=pending[m.id];delete pending[m.id];if(m.error)p.reject(m.error);else p.resolve(m.result);return;}
 if(m.method==="ui/notifications/tool-result"&&m.params)accept(m.params.structuredContent,true);
 if(m.method==="ui/notifications/host-context-changed"&&m.params){if(m.params.displayMode)hostMode=m.params.displayMode;applyTheme(m.params.theme||null);}
});
window.addEventListener("openai:set_globals",function(){if(window.openai){var o=window.openai.toolOutput;own(o);applyTheme(window.openai.theme);if(o&&!status)accept(o,true);else render();}});
function callStatus(){
 var args=thread?{thread_id:thread}:{};
 if(bridge==="openai")return window.openai.callTool(STATUS_TOOL,args).then(function(r){return r&&(r.structuredContent||r.result&&r.result.structuredContent);});
 return rpc("tools/call",{name:STATUS_TOOL,arguments:args}).then(function(r){return r&&r.structuredContent;});
}
var lastHeight=0;
function reportSize(){
 if(pane())return;
 var h=Math.ceil(card.getBoundingClientRect().height)+2;if(h===lastHeight)return;lastHeight=h;
 if(bridge==="openai"&&typeof window.openai.notifyIntrinsicHeight==="function"){try{window.openai.notifyIntrinsicHeight(h);}catch(e){}}
 else if(bridge==="mcp")window.parent.postMessage({jsonrpc:"2.0",method:"ui/notifications/size-changed",params:{height:h}},"*");
}
function applyTheme(theme){
 var dark=theme?theme==="dark":!(window.matchMedia&&window.matchMedia("(prefers-color-scheme: light)").matches);
 root.classList.toggle("light",!dark);if(status)render();
}

function delay(){
 if(failures>0)return Math.min(MAX_BACKOFF,FAST*Math.pow(2,failures));
 if(status&&status.working)return FAST;
 return Date.now()-idleSince>120000?IDLE:SLOW;
}
function schedule(){if(timer)clearTimeout(timer);timer=null;if(!document.hidden&&!folded)timer=setTimeout(poll,delay());}
function poll(){
 if(folded)return;
 callStatus().then(function(s){failures=0;accept(s);},function(){failures=Math.min(failures+1,5);}).then(schedule);
}
document.addEventListener("visibilitychange",function(){if(folded)return;if(document.hidden){if(timer)clearTimeout(timer);timer=null;tick();}else{idleSince=Date.now();tick();poll();}});
window.addEventListener("resize",function(){if(status||folded)render();});

function start(){
 if(window.openai&&typeof window.openai.callTool==="function"){
  bridge="openai";applyTheme(window.openai.theme);if(window.openai.toolOutput)accept(window.openai.toolOutput,true);poll();return;
 }
 bridge="mcp";applyTheme(null);
 rpc("ui/initialize",{protocolVersion:"2026-01-26",appInfo:{name:"lit-card",version:"1"},appCapabilities:{availableDisplayModes:["inline","fullscreen"]}}).then(function(r){
  window.parent.postMessage({jsonrpc:"2.0",method:"ui/notifications/initialized",params:{}},"*");
  var ctx=r&&r.hostContext;if(ctx&&ctx.displayMode)hostMode=ctx.displayMode;applyTheme(ctx&&ctx.theme||null);poll();
 },function(){poll();});
}
if(window.matchMedia)window.matchMedia("(prefers-color-scheme: light)").addEventListener("change",function(){if(!(window.openai&&window.openai.theme))applyTheme(null);});
start();
})();
</script></body></html>
`;
