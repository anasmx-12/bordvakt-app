(function(){
var feed=[{bord:3,text:'Bord 3 behöver dukas av',typ:'Avdukning',prio:'hög',level:'high'},{bord:7,text:'Bord 7 – tomma glas',typ:'Påfyllning',prio:'medel',level:'mid'},{bord:12,text:'Bord 12 söker kontakt',typ:'Service',prio:'hög',level:'high'},{bord:5,text:'Bord 5 redo för nästa sällskap',typ:'Ledigt',prio:'info',level:'info'},{bord:9,text:'Bord 9 – läge för dessert',typ:'Mersälj',prio:'medel',level:'mid'},{bord:1,text:'Bord 1 behöver dukas av',typ:'Avdukning',prio:'hög',level:'high'}];
function chip(l){return l==='high'?['#E2552E','#FFFFFF']:l==='mid'?['#FFE6DE','#7A2410']:['#DCF1FC','#01679A'];}
var prevLb={},idx=0,flip=false,ago=['nu','1 min','2 min','4 min'];
function esc(s){return String(s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
function render(){
 var n=feed.length,vis=[0,1,2,3].map(function(k){return feed[(idx-k+n*4)%n];});
 var t=vis[0],c=chip(t.level),tc=document.getElementById('topChip');
 tc.style.background=c[0];tc.style.color=c[1];tc.textContent=t.bord;
 document.getElementById('topText').textContent=t.text;
 document.getElementById('topMeta').textContent=t.typ+' · Prio '+t.prio+' · nu';
 var tn=document.getElementById('topNotif');tn.className=flip?'nin-a':'nin-b';
 document.getElementById('rest').innerHTML=vis.slice(1).map(function(v,i){var c=chip(v.level);return '<div style="display:flex;gap:12px;align-items:flex-start;padding:10px 12px;border-radius:12px;border:1px solid #E7EFF4;background:#FFFFFF"><div style="flex:none;width:32px;height:32px;border-radius:9px;background:'+c[0]+';color:'+c[1]+';display:flex;align-items:center;justify-content:center;font-family:\'Space Grotesk\',sans-serif;font-weight:700;font-size:14px">'+v.bord+'</div><div style="display:flex;flex-direction:column;gap:1px;min-width:0"><div style="font-weight:600;font-size:13px">'+esc(v.text)+'</div><div style="font-size:11.5px;color:#4B5563">'+esc(v.typ)+' · Prio '+v.prio+' · '+ago[i+1]+'</div></div></div>';}).join('');
 var by={};vis.forEach(function(v){if(!by[v.bord])by[v.bord]=v;});
 var base='aspect-ratio:1/1;border-radius:10px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;transition:background .4s,color .4s;',h='';
 for(var i=1;i<=12;i++){var v=by[i],st=base+'background:#FFFFFF;color:#475763;border:1px solid #DAE5EC;',lb='OK';if(v){var cc=chip(v.level);st=base+'background:'+cc[0]+';color:'+cc[1]+';border:1px solid '+cc[0]+';';lb=v.typ;}
 var changed=prevLb[i]!==undefined&&prevLb[i]!==lb;prevLb[i]=lb;
 h+='<div'+(changed?' class="pop"':'')+' style="'+st+'"><span style="font-size:15px;font-weight:700;font-family:\'Space Grotesk\',sans-serif">'+i+'</span><span style="font-size:9.5px;font-weight:600">'+lb+'</span></div>';}
 document.getElementById('tables').innerHTML=h;
}
render();setInterval(function(){idx=(idx+1)%feed.length;flip=!flip;render();},2800);
var s={bord:24,sitt:2,spar:5,nota:900};
function fmt(x){return Math.round(x).toLocaleString('sv-SE');}
var still=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
/* Siffrorna räknas mjukt upp/ned till det nya värdet */
function tween(id,to,f){var el=document.getElementById(id),from=el._v==null?0:el._v;el._v=to;
 if(still||from===to){el.textContent=f(to);return;}
 cancelAnimationFrame(el._raf);var t0=performance.now(),d=650;
 (function step(t){var k=Math.min(1,(t-t0)/d),e=1-Math.pow(1-k,3);el.textContent=f(from+(to-from)*e);if(k<1)el._raf=requestAnimationFrame(step);})(t0);}
function one(x){return x.toLocaleString('sv-SE',{maximumFractionDigits:1,minimumFractionDigits:0});}
function bump(id,v){var el=document.getElementById(id);if(el.textContent===String(v))return;el.textContent=v;el.classList.remove('bump');void el.offsetWidth;el.classList.add('bump');}
function calc(){var e=s.bord*s.sitt*(s.spar/90),m=e*s.nota*26;
 bump('v-bord',s.bord);bump('v-sitt',s.sitt);bump('v-spar',s.spar);bump('v-nota',fmt(s.nota));
 if(!counted){document.getElementById('v-extra').textContent=one(Math.round(e*10)/10);document.getElementById('v-month').textContent=fmt(m);document.getElementById('v-year').textContent=fmt(m*12);return;}
 tween('v-extra',Math.round(e*10)/10,function(x){return one(Math.round(x*10)/10);});tween('v-month',m,fmt);tween('v-year',m*12,fmt);}
/* Resultatet räknas upp från noll första gången det syns */
var counted=false;
document.querySelectorAll('input[type=range][data-k]').forEach(function(el){el.addEventListener('input',function(){s[el.dataset.k]=Number(el.value);calc();});});
calc();
var res=document.getElementById('v-month');
if('IntersectionObserver' in window&&!still){var io0=new IntersectionObserver(function(en){if(en[0].isIntersecting){io0.disconnect();counted=true;['v-extra','v-month','v-year'].forEach(function(id){document.getElementById(id)._v=0;});calc();}},{threshold:.4});io0.observe(res);}else{counted=true;}
var f=document.getElementById('demoForm');
/* Förfrågan skickas till /api/demo, som mejlar supporten */
var fErr=document.getElementById('formError'),fBtn=f.querySelector('button[type=submit]'),fLabel=fBtn.textContent;
f.addEventListener('submit',function(e){e.preventDefault();
 var data={};new FormData(f).forEach(function(v,k){data[k]=String(v);});
 fErr.hidden=true;fBtn.disabled=true;fBtn.textContent='Skickar …';
 fetch('/api/demo',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})
  .then(function(r){return r.json().catch(function(){return {};}).then(function(j){if(!r.ok)throw new Error(j.error||'Något gick fel. Försök igen.');});})
  .then(function(){document.getElementById('formBox').hidden=true;document.getElementById('sentBox').hidden=false;prepDraw();})
  .catch(function(err){fErr.textContent=err.message||'Kunde inte skicka. Kontrollera internet och försök igen.';fErr.hidden=false;})
  .finally(function(){fBtn.disabled=false;fBtn.textContent=fLabel;});});
document.getElementById('resetBtn').addEventListener('click',function(){f.reset();document.getElementById('formBox').hidden=false;document.getElementById('sentBox').hidden=true;});
})();

/* ------------------------------------------------ Animationer */
(function(){
var still=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
var root=document.documentElement;

/* Linjer som ritas: mät hur långa de är */
window.prepDraw=function(){document.querySelectorAll('.draw path,.draw circle').forEach(function(p){try{p.style.setProperty('--len',Math.ceil(p.getTotalLength())+1);}catch(e){}});};
prepDraw();

/* Rubriken i hero: ord för ord */
var h1=document.querySelector('.hero-copy h1');
if(h1&&!still){var words=h1.textContent.trim().split(/\s+/);h1.setAttribute('aria-label',h1.textContent.trim());
 h1.innerHTML=words.map(function(w,i){return '<span class="w'+(i>=words.length-2?' grad':'')+'" aria-hidden="true" style="--i:'+i+'">'+w.replace(/[&<>]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;'}[c];})+'</span>';}).join(' ');}

/* Tona in när man rullar dit. Kort bredvid varandra kommer en i taget. */
var items=[].slice.call(document.querySelectorAll('.reveal'));
items.forEach(function(el){var sib=[].filter.call(el.parentNode.children,function(c){return c.classList.contains('reveal');});el.style.setProperty('--i',Math.max(0,sib.indexOf(el)));});
if('IntersectionObserver' in window&&!still){
 var io=new IntersectionObserver(function(en){en.forEach(function(e){if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target);}});},{threshold:.12,rootMargin:'0px 0px -6% 0px'});
 items.forEach(function(el){io.observe(el);});
}else{items.forEach(function(el){el.classList.add('in');});}

/* Rullningslist och menyn som blir genomskinlig */
var bar=document.createElement('div');bar.className='scroll-progress';bar.setAttribute('aria-hidden','true');document.body.appendChild(bar);
var header=document.querySelector('.site-header'),ticking=false;
function onScroll(){ticking=false;var y=window.scrollY,max=root.scrollHeight-innerHeight;
 bar.style.transform='scaleX('+(max>0?Math.min(1,y/max):0)+')';
 if(header)header.classList.toggle('scrolled',y>8);}
addEventListener('scroll',function(){if(!ticking){ticking=true;requestAnimationFrame(onScroll);}},{passive:true});onScroll();

/* Menyn visar vilken del man är på */
var links={};document.querySelectorAll('.nav-link').forEach(function(a){links[a.getAttribute('href').slice(1)]=a;});
if('IntersectionObserver' in window){
 var spy=new IntersectionObserver(function(en){en.forEach(function(e){var a=links[e.target.id];if(!a)return;if(e.isIntersecting){Object.keys(links).forEach(function(k){links[k].classList.remove('active');});a.classList.add('active');}});},{rootMargin:'-45% 0px -50% 0px'});
 Object.keys(links).forEach(function(id){var sec=document.getElementById(id);if(sec)spy.observe(sec);});
}

/* Surfplattan lutar lite efter musen (bara med mus, inte på mobil) */
var mock=document.querySelector('.hero-mock'),hero=document.getElementById('top');
if(mock&&hero&&!still&&matchMedia('(hover: hover) and (pointer: fine)').matches){
 var raf=0;
 hero.addEventListener('mousemove',function(ev){cancelAnimationFrame(raf);raf=requestAnimationFrame(function(){
  var b=mock.getBoundingClientRect(),x=(ev.clientX-b.left)/b.width-.5,y=(ev.clientY-b.top)/b.height-.5;
  mock.classList.add('tilting');mock.style.transform='perspective(1400px) rotateY('+(x*7).toFixed(2)+'deg) rotateX('+(-y*6).toFixed(2)+'deg)';});});
 hero.addEventListener('mouseleave',function(){cancelAnimationFrame(raf);mock.style.transform='';});
}
})();
