(function(){
'use strict';
const $=s=>document.querySelector(s);
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const fd=iso=>{if(!iso)return '-';const p=iso.split('-');return +p[2]+' '+MON[+p[1]-1]+' '+p[0];};
const fdShort=iso=>{const p=iso.split('-');return +p[2]+' '+MON[+p[1]-1];};
const num=(n,d=0)=>Number(n).toLocaleString('en-IN',{minimumFractionDigits:d,maximumFractionDigits:d});
const sgn=(n,d=0)=>(n>=0?'+':'')+num(n,d)+'%';
const cssv=k=>getComputedStyle(document.documentElement).getPropertyValue(k).trim();
let SCAN=null,scanTab='break_',DATA=null,state={filter:'all',sort:'score',q:''},rangeSel='6M';
const id=r=>r.sym+'-'+r.signal;
const idx=r=>DATA.stocks.indexOf(r);

async function load(force){
  try{
    const r=await fetch('data.json'+(force?'?t='+Date.now():''),{cache:'no-store'});
    if(!r.ok)throw new Error(r.status);
    DATA=await r.json();
    try{const rs=await fetch('chartscan.json'+(force?'?t='+Date.now():''),{cache:'no-store'});SCAN=rs.ok?await rs.json():null;}catch(e){SCAN=null;}
    try{localStorage.setItem('pm-last',JSON.stringify({g:DATA.generated}));}catch(e){}
  }catch(e){
    $('#view').innerHTML='<p class="empty">Could not load data.json.<br>Check your connection and tap refresh.</p>';
    return;
  }
  route();
}

function setHead(title,back){
  $('#title').textContent=title;
  $('#back').style.visibility=back?'visible':'hidden';
}
function tab(name){document.querySelectorAll('#tabs a').forEach(a=>a.classList.toggle('on',a.dataset.tab===name));}

function banner(){
  let h='';
  if(DATA.stale){
    h+='<div class="banner"><b>Filings feed is behind.</b> The newest insider filing in the data is from '+fd(DATA.filings_asof)+', so these flags are from '+fd(DATA.window_from)+' to '+fd(DATA.filings_asof)+'. Prices are current to '+fd(DATA.price_asof)+'.</div>';
  }
  return h;
}

/* ---------- home ---------- */
function filtered(){
  let a=DATA.stocks.slice();
  const pin=a.filter(r=>r.sym===DATA.pin);
  let rest=a.filter(r=>r.sym!==DATA.pin);
  if(state.filter==='strict')rest=rest.filter(r=>r.strict);
  if(state.filter==='multi')rest=rest.filter(r=>r.days>=2);
  if(state.q){const q=state.q.toLowerCase();rest=rest.filter(r=>r.sym.toLowerCase().includes(q)||r.name.toLowerCase().includes(q));}
  const key={score:(x,y)=>y.score-x.score||(y.signal>x.signal?1:-1),new:(x,y)=>(y.signal>x.signal?1:-1),since:(x,y)=>y.since_pct-x.since_pct}[state.sort];
  rest.sort(key);
  return {pin:state.q||state.filter!=='all'?[]:pin,rest};
}
function card(r,pinned){
  const tags=[r.days+(r.days>1?' days':' day')+' of buying'];
  const g=[];
  if(r.pct_equity!=null)tags.push(num(r.pct_equity,2)+'% of company');
  if(r.qty_adv!=null)tags.push(num(r.qty_adv,1)+'x daily volume');
  tags.push(num(r.near_low,2)+'x 12-mo low');
  return '<a class="card" href="#stock-'+idx(r)+'">'+(pinned?'<span class="ribbon">REFERENCE EXAMPLE</span>':'')+
   '<div class="row"><div><span class="sym">'+esc(r.sym)+'</span><span class="co">'+esc(r.name)+'</span></div><span class="score'+(r.score>=5?' hi':'')+'">'+r.score+'/6</span></div>'+
   '<div class="meta">First filed '+fd(r.signal)+' &middot; '+esc(r.who)+'</div>'+
   '<div class="tags">'+tags.map((t,i)=>'<span'+(i===1&&r.max_day_pct!=null&&r.max_day_pct<0.5?' class="g"':'')+'>'+esc(t)+'</span>').join('')+'</div>'+
   '<canvas class="spark" data-id="'+esc(id(r))+'"></canvas>'+
   '<div class="row bottom"><span>Signal close &#8377;'+num(r.signal_close,1)+' &rarr; now &#8377;'+num(r.last_close,1)+'</span><span class="'+(r.since_pct>=0?'pos':'neg')+'">'+sgn(r.since_pct,0)+' since</span></div></a>';
}
function home(){
  tab('home');setHead('Promoter Monitor',false);
  const f=filtered();
  const n=DATA.stocks.length-1,ns=DATA.stocks.filter(r=>r.strict&&r.sym!==DATA.pin).length;
  let h=banner()+'<div class="asof">'+n+' episodes &middot; '+ns+' IOLCP-style &middot; updated '+esc(DATA.generated)+'</div>';
  h+='<input class="search" id="q" type="search" placeholder="Search symbol or company" value="'+esc(state.q)+'">';
  h+='<div class="chips">'+[['all','All'],['strict','IOLCP-style'],['multi','2+ days']].map(a=>'<button class="chip'+(state.filter===a[0]?' on':'')+'" data-f="'+a[0]+'">'+a[1]+'</button>').join('')+
     '<span style="flex:1"></span>'+[['score','Score'],['new','Newest'],['since','Since signal']].map(a=>'<button class="chip'+(state.sort===a[0]?' on':'')+'" data-s="'+a[0]+'">'+a[1]+'</button>').join('')+'</div>';
  h+=f.pin.map(r=>card(r,true)).join('')+f.rest.map(r=>card(r,false)).join('');
  if(!f.rest.length&&!f.pin.length)h+='<p class="empty">Nothing matches.</p>';
  $('#view').innerHTML=h;
  $('#q').addEventListener('input',e=>{state.q=e.target.value.trim();const p=e.target.selectionStart;home();const q=$('#q');q.focus();q.setSelectionRange(p,p);});
  document.querySelectorAll('[data-f]').forEach(b=>b.onclick=()=>{state.filter=b.dataset.f;home();});
  document.querySelectorAll('[data-s]').forEach(b=>b.onclick=()=>{state.sort=b.dataset.s;home();});
  document.querySelectorAll('canvas.spark').forEach(cv=>{const r=DATA.stocks.find(x=>id(x)===cv.dataset.id);if(r)spark(cv,r);});
}
function spark(cv,r){
  const dpr=window.devicePixelRatio||1,w=cv.clientWidth,h=cv.clientHeight;
  cv.width=w*dpr;cv.height=h*dpr;
  const x=cv.getContext('2d');x.setTransform(dpr,0,0,dpr,0,0);
  const S=r.series,n=S.c.length,i0=Math.max(0,n-170),c=S.c.slice(i0);
  const lo=Math.min(...c),hi=Math.max(...c),pad=3;
  const X=i=>pad+(i/(c.length-1))*(w-2*pad),Y=v=>h-pad-((v-lo)/(hi-lo||1))*(h-2*pad);
  const acc=cssv('--accent'),mut=cssv('--muted');
  x.lineWidth=1.6;x.strokeStyle=mut;x.lineJoin='round';x.beginPath();
  c.forEach((v,i)=>{i?x.lineTo(X(i),Y(v)):x.moveTo(X(i),Y(v));});x.stroke();
  const bs=new Set(r.buy_days.map(b=>b.d));
  x.fillStyle=acc;
  S.d.slice(i0).forEach((d,i)=>{if(bs.has(d)){x.beginPath();x.moveTo(X(i),Y(c[i])-5);x.lineTo(X(i)+4,Y(c[i]));x.lineTo(X(i),Y(c[i])+5);x.lineTo(X(i)-4,Y(c[i]));x.closePath();x.fill();}});
  x.beginPath();x.arc(X(c.length-1),Y(c[c.length-1]),3,0,7);x.fillStyle=r.since_pct>=0?cssv('--pos'):cssv('--neg');x.fill();
}

/* ---------- detail ---------- */
function detail(k){
  const r=DATA.stocks[+k];
  if(!r){$('#view').innerHTML='<p class="empty">Not found.</p>';return;}
  tab('home');setHead(r.sym,true);
  const i0b=r.series.d.indexOf(r.buy_days[0].d),need=i0b>=0?r.series.c.length-i0b+15:126;
  rangeSel=need<=63?'3M':need<=126?'6M':'1Y';
  const ck=r.checks,F=r.flags;
  const yes=b=>b?'<span class="ok">&#10003;</span>':'<span class="no">&#10007;</span>';
  let h='<div style="margin:2px 2px 10px"><div class="sub">'+esc(r.name)+'</div><div class="big">&#8377;'+num(r.last_close,2)+' <span class="'+(r.since_pct>=0?'pos':'neg')+'" style="font-size:16px">'+sgn(r.since_pct,1)+' since signal</span></div><div class="sub">Signal close &#8377;'+num(r.signal_close,2)+' on '+fd(r.signal)+'</div></div>';
  h+='<div class="charthead"><b>Price</b><div class="ranges">'+['3M','6M','1Y'].map(k=>'<button data-r="'+k+'" class="'+(rangeSel===k?'on':'')+'">'+k+'</button>').join('')+'</div></div>';
  h+='<div class="chartbox"><canvas class="chart" id="ch"></canvas><div class="tip" id="tip"></div></div>';
  h+='<div class="legend"><span><i class="leg-buy"></i>Promoter buying day</span><span><i class="leg-line"></i>Signal close level</span></div>';
  h+='<h2>Why it was flagged ('+r.score+' of 6)</h2><div class="sec">'+
    kv(yes(F.multi)+' Bought on 2+ days',r.days+' day'+(r.days>1?'s':''))+
    kv(yes(F.near_low)+' Within 15% of 12-month low',num(r.near_low,2)+'x the low')+
    kv(yes(F.size)+' At least half a day of volume',r.qty_adv!=null?num(r.qty_adv,1)+'x daily volume':'-')+
    kv(yes(F.hidden)+' No day above 0.5% of company',r.max_day_pct!=null?'largest day '+num(r.max_day_pct,2)+'%':'-')+
    kv(yes(F.base)+' Inside a 250-day base',F.base?'range under 2.2x':'wider range')+
    kv(yes(F.absorb)+' Volume up, price flat',r.avg_vm!=null?num(r.avg_vm,1)+'x volume, '+sgn(r.avg_ret,1)+' a day':'-')+'</div>';
  h+='<h2>The buying</h2><div class="sec">'+kv('Buyer',esc(r.who))+kv('Total bought',num(r.qty)+' shares')+kv('Value','&#8377;'+num(r.val_cr,2)+' Cr')+
    kv('Share of company',r.pct_equity!=null?num(r.pct_equity,2)+'%':'-')+'</div>';
  h+='<div class="sec">'+r.buy_days.map(b=>'<div class="kv"><span>'+fd(b.d)+'</span><b>'+num(b.q)+' shares'+(b.px?' @ &#8377;'+num(b.px,1):'')+'</b></div>').join('')+'</div>';
  h+='<h2>Checks</h2><div class="sec">'+
    kv(yes(ck.promoter_sells_90d===0)+' No promoter open-market sales in the 90 days before',ck.promoter_sells_90d+' found')+
    kv(yes(ck.held_signal_close)+' Price still above 92% of the signal close',num(r.last_close,1)+' vs '+num(r.signal_close,1))+
    kv('Worst dip after the signal',sgn(ck.below_signal_pct,1))+'</div>';
  h+='<h2>Look-alike history</h2>';
  const b1=DATA.baserates[1],b2=DATA.baserates[2];
  h+='<div class="sec pad"><div style="font-size:14px">In 10 years of NSE data, <b>'+num(b1.n)+'</b> setups like this (base, 2+ days of promoter buying, near the low) had a full year of prices after them. <b>'+num(b1.reach*100)+'%</b> made a new all-time high within a year and <b>'+num(b1.doubled*100)+'%</b> doubled. Similar stocks without the buying: '+num(b1.exp_reach*100)+'% and '+num(b1.exp_doubled*100)+'%.</div>'+
    '<div class="note">The stricter IOLCP-style version ('+num(b2.n)+' setups): '+num(b2.reach*100)+'% new high, '+num(b2.doubled*100)+'% doubled.</div></div>';
  h+='<div class="note" style="margin:8px 2px 4px">Closest past setups to this one:</div><div class="sec">'+r.lookalikes.map(l=>{
    const w=l.outcome==='new all-time high',m=l.outcome==='doubled, no new high';
    return '<div class="la"><div class="t"><span>'+esc(l.sym)+' <span class="sub" style="font-weight:400">'+fd(l.signal)+'</span></span><span class="badge '+(w?'win':m?'mid':'none')+'">'+(w?'New high'+(l.days_to_ath?' in '+l.days_to_ath+' days':''):m?'Doubled, no new high':'Neither')+'</span></div><div class="sub">'+esc(l.name)+' &middot; best gain '+sgn(l.peak,0)+' in the next year</div></div>';
  }).join('')+'</div>';
  h+='<h2>Insider filings (last 2 years)</h2><div class="sec">'+(r.filings.length?r.filings.map(f=>{
    const s=(f.side||'').toLowerCase(),isb=s==='buy',iss=s==='sell';
    return '<div class="fil"><div class="t"><span><span class="tag '+(isb?'buy':iss?'sell':'other')+'">'+esc(f.side||'-')+'</span>'+esc(f.who)+'</span><span>'+num(f.qty)+'</span></div><div class="d">'+fd(f.d)+' &middot; '+esc(f.cat)+' &middot; '+esc(f.mode)+(f.val?' &middot; &#8377;'+num(f.val,2)+' Cr':'')+(f.after!=null?' &middot; holds '+num(f.after,2)+'% after':'')+' &middot; filed '+fdShort(f.filed)+'</div></div>';
  }).join(''):'<p class="empty">No filings.</p>')+'</div>';
  h+='<p class="note">Research only. This is not a recommendation to buy or sell. A promoter-group purchase is a public, legal act and says nothing about intent.</p>';
  $('#view').innerHTML=h;
  document.querySelectorAll('.ranges button').forEach(b=>b.onclick=()=>{rangeSel=b.dataset.r;document.querySelectorAll('.ranges button').forEach(x=>x.classList.toggle('on',x===b));chart(r);});
  chart(r);window.scrollTo(0,0);
}
function kv(a,b){return '<div class="kv"><span>'+a+'</span><b>'+b+'</b></div>';}

function chart(r){
  const cv=$('#ch'),tip=$('#tip');
  const dpr=window.devicePixelRatio||1,W=cv.clientWidth,H=cv.clientHeight;
  cv.width=W*dpr;cv.height=H*dpr;
  const x=cv.getContext('2d');x.setTransform(dpr,0,0,dpr,0,0);
  const S=r.series,N=S.c.length,bars={'3M':63,'6M':126,'1Y':252}[rangeSel],i0=Math.max(0,N-bars);
  const c=S.c.slice(i0),v=S.v.slice(i0),d=S.d.slice(i0),n=c.length;
  const L=8,R=44,T=10,B=22,volH=40,pH=H-T-B-volH-6;
  let lo=Math.min(...c,r.signal_close),hi=Math.max(...c,r.signal_close);const pd=(hi-lo)*.08;lo-=pd;hi+=pd;
  const X=i=>L+(i/(n-1))*(W-L-R),Y=val=>T+pH-((val-lo)/(hi-lo))*pH;
  const mut=cssv('--muted'),line=cssv('--line'),acc=cssv('--accent'),fg=cssv('--fg');
  x.font='11px -apple-system,Segoe UI,Arial';x.textBaseline='middle';x.textAlign='left';
  for(let k=0;k<=3;k++){const val=lo+(hi-lo)*k/3,y=Y(val);x.strokeStyle=line;x.lineWidth=1;x.beginPath();x.moveTo(L,y);x.lineTo(W-R,y);x.stroke();x.fillStyle=mut;x.fillText(val>=100?num(val):num(val,1),W-R+4,y);}
  const vmax=Math.max(...v)||1;
  x.fillStyle=cssv('--line');
  v.forEach((q,i)=>{const h=q/vmax*volH;x.fillRect(X(i)-1,H-B-h,Math.max(1.5,(W-L-R)/n-.5),h);});
  const bs=new Set(r.buy_days.map(b=>b.d));
  x.fillStyle=acc;v.forEach((q,i)=>{if(bs.has(d[i])){const h=q/vmax*volH;x.fillRect(X(i)-1,H-B-h,Math.max(2.5,(W-L-R)/n),h);}});
  const sy=Y(r.signal_close);x.save();x.setLineDash([4,4]);x.strokeStyle=acc;x.lineWidth=1.2;x.beginPath();x.moveTo(L,sy);x.lineTo(W-R,sy);x.stroke();x.restore();
  x.lineWidth=1.8;x.lineJoin='round';x.strokeStyle=fg;x.beginPath();c.forEach((q,i)=>{i?x.lineTo(X(i),Y(q)):x.moveTo(X(i),Y(q));});x.stroke();
  x.fillStyle=acc;d.forEach((dd,i)=>{if(bs.has(dd)){const px=X(i),py=Y(c[i]);x.beginPath();x.moveTo(px,py-6);x.lineTo(px+5,py);x.lineTo(px,py+6);x.lineTo(px-5,py);x.closePath();x.fill();}});
  x.fillStyle=mut;x.textAlign='center';[0,Math.floor(n/2),n-1].forEach(i=>x.fillText(fdShort(d[i]),Math.min(W-R-10,Math.max(L+16,X(i))),H-B+12));
  function show(ev){
    const rc=cv.getBoundingClientRect(),px=(ev.touches?ev.touches[0].clientX:ev.clientX)-rc.left;
    const i=Math.max(0,Math.min(n-1,Math.round(((px-L)/(W-L-R))*(n-1))));
    chart.draw=i;
    tip.style.display='block';tip.innerHTML='<b>'+fd(d[i])+'</b> &middot; &#8377;'+num(c[i],2)+' &middot; vol '+num(v[i])+(bs.has(d[i])?' &middot; <b style="color:'+acc+'">promoter buying</b>':'');
  }
  cv.onpointermove=show;cv.onpointerdown=show;cv.onpointerleave=()=>{tip.style.display='none';};
}

/* ---------- tracking ---------- */
function track(){
  tab('track');setHead('Tracking',false);
  const T=DATA.tracked,live=T.filter(t=>t.source==='live'),bf=T.filter(t=>t.source!=='live');
  const stat=a=>{const v=a.map(t=>t.since_pct).filter(x=>x!=null).sort((p,q)=>p-q);if(!v.length)return null;return {n:v.length,up:v.filter(x=>x>0).length/v.length*100,med:v[Math.floor(v.length/2)]};};
  const sl=stat(live),sb=stat(bf);
  let h='<p class="note" style="margin:0 2px 10px">Every flag the daily run finds is written to a log and followed without anyone trading it. After about a year the live rows give a clean, out-of-sample answer on whether the signal works.</p>';
  h+='<h2 style="margin-top:6px">Live flags (found after the log started)</h2>';
  h+=sl?statRow(sl):'<div class="sec pad"><span class="sub">None yet. Live flags appear once the daily run sees new filings.</span></div>';
  h+='<h2>Backfilled flags (found after the fact, not a forward test)</h2>'+(sb?statRow(sb):'');
  const rows=T.slice().sort((a,b)=>(b.signal>a.signal?1:-1));
  h+='<div class="sec">'+rows.map(t=>'<a class="fil" style="display:block;color:inherit;text-decoration:none" href="#stock-'+Math.max(0,DATA.stocks.findIndex(x=>x.sym===t.sym&&x.signal===t.signal))+'"><div class="t"><span>'+esc(t.sym)+' <span class="sub" style="font-weight:400">'+fd(t.signal)+(t.source==='live'?' &middot; live':'')+'</span></span><span class="'+(t.since_pct==null?'':t.since_pct>=0?'pos':'neg')+'">'+(t.since_pct==null?'-':sgn(t.since_pct,0))+'</span></div><div class="d">Signal close &#8377;'+num(t.signal_close,1)+' &middot; now '+(t.last_close?'&#8377;'+num(t.last_close,1):'-')+' &middot; score '+t.score+'/6'+(t.strict?' &middot; IOLCP-style':'')+'</div></a>').join('')+'</div>';
  $('#view').innerHTML=banner()+h;
}
function statRow(s){return '<div class="stat"><div><b>'+s.n+'</b><span>flags</span></div><div><b>'+num(s.up)+'%</b><span>up since signal</span></div><div><b>'+sgn(s.med,0)+'</b><span>median move</span></div></div>';}


/* ---------- chart scan ---------- */
function spark2(cv,c,mark,color){
  const dpr=window.devicePixelRatio||1,w=cv.clientWidth,h=cv.clientHeight;
  cv.width=w*dpr;cv.height=h*dpr;
  const x=cv.getContext('2d');x.setTransform(dpr,0,0,dpr,0,0);
  const lo=Math.min(...c),hi=Math.max(...c),pad=3;
  const X=i=>pad+(i/(c.length-1))*(w-2*pad),Y=v=>h-pad-((v-lo)/(hi-lo||1))*(h-2*pad);
  x.lineWidth=1.6;x.strokeStyle=cssv('--muted');x.lineJoin='round';x.beginPath();
  c.forEach((v,i)=>{i?x.lineTo(X(i),Y(v)):x.moveTo(X(i),Y(v));});x.stroke();
  if(mark!=null&&mark>=0&&mark<c.length){const px=X(mark),py=Y(c[mark]);x.fillStyle=color;x.beginPath();x.moveTo(px,py-5);x.lineTo(px+4,py);x.lineTo(px,py+5);x.lineTo(px-4,py);x.closePath();x.fill();}
  x.beginPath();x.arc(X(c.length-1),Y(c[c.length-1]),3,0,7);x.fillStyle=cssv('--accent');x.fill();
}
function scanCard(r,kind){
  const tags=[];
  if(kind==='break_'){tags.push('<span class="st '+r.status.toLowerCase()+'">'+r.status+'</span>','<span>'+num(r.vol_x,1)+'x volume</span>','<span>'+(r.bars===0?'today':r.bars+' bars ago')+'</span>');
    if(r.bars>0)tags.push('<span>'+r.above+' of '+r.bars+' closes above</span>','<span>worst dip '+sgn(r.dip,1)+'</span>');}
  else if(kind==='base'){tags.push('<span>range '+num(r.range_x,2)+'x</span>','<span>'+sgn(r.below_pct,1)+' from ceiling</span>');}
  else{tags.push('<span class="st fresh">New high</span>','<span>'+(r.bars===0?'today':r.bars+' bars ago')+'</span>','<span>'+sgn(r.above_pct,1)+' above old high</span>');}
  const sub=kind==='break_'?'Broke &#8377;'+num(r.level,1)+' on '+fd(r.date)+' &middot; since '+sgn(r.since,1):kind==='base'?'Ceiling &#8377;'+num(r.ceiling,1)+' &middot; volume '+num(r.vol_x,1)+'x':'Old high &#8377;'+num(r.old_high,1)+' cleared '+fd(r.date);
  const pb=r.promoter?'<span class="g">Promoter buying '+r.promoter.score+'/6</span>':'';
  const open=r.promoter?'href="#stock-'+r.promoter.idx+'"':'';
  return '<a class="card" '+open+'><div class="row"><div><span class="sym">'+esc(r.sym)+'</span><span class="co">'+esc(r.name)+'</span></div><div style="text-align:right"><b>&#8377;'+num(r.close,1)+'</b><div class="'+(r.chg>=0?'pos':'neg')+'" style="font-size:12px">'+sgn(r.chg,1)+' today</div></div></div>'+
   '<div class="meta">'+sub+'</div><div class="tags">'+tags.join('')+pb+'</div><canvas class="spark" data-s="'+esc(r.sym)+'"></canvas></a>';
}
function scanView(){
  tab('scan');setHead('Chart Scan',false);
  if(!SCAN){$('#view').innerHTML='<p class="empty">No chart scan data yet.<br>It appears after the next daily run.</p>';return;}
  const T=SCAN.totals,L=[['break_','Breakouts',T.break_],['base','Base near ceiling',T.base],['ath','New highs',T.ath]];
  let h='<div class="asof">'+num(SCAN.scanned)+' stocks scanned &middot; prices to '+fd(SCAN.price_asof)+' &middot; updated '+esc(SCAN.generated)+'</div>';
  h+='<div class="chips">'+L.map(a=>'<button class="chip'+(scanTab===a[0]?' on':'')+'" data-t="'+a[0]+'">'+a[1]+' ('+a[2]+')</button>').join('')+'</div>';
  const rows=SCAN[scanTab]||[];
  const info={break_:'A close at a 250-day high on 3x or more volume, inside a year-long range, in the last 20 trading days. <b>Failing</b> means fewer than 80% of closes since have held the old high, or it dipped more than 12%.',base:'A year-long range under 2.2x high to low, with the price within 5% of the top and no breakout yet.',ath:'A close above the all-time high of the stock in the data (4+ years of history) in the last 20 trading days.'}[scanTab];
  h+='<p class="note" style="margin:0 2px 10px">'+info+' Showing '+rows.length+' of '+L.find(a=>a[0]===scanTab)[2]+'.</p>';
  h+=rows.length?rows.map(r=>scanCard(r,scanTab)).join(''):'<p class="empty">Nothing right now.</p>';
  h+='<p class="note">In backtests these chart-only stages did not beat matched random stocks, and breakouts that fail to hold did clearly worse. Use them to build a list to research, not as buy or sell signals. Cards with a green promoter tag open the insider-filing detail.</p>';
  $('#view').innerHTML=h;
  document.querySelectorAll('[data-t]').forEach(b=>b.onclick=()=>{scanTab=b.dataset.t;scanView();});
  document.querySelectorAll('canvas.spark[data-s]').forEach(cv=>{const r=rows.find(x=>x.sym===cv.dataset.s);if(r)spark2(cv,r.spark,r.mark,cssv('--accent'));});
}

/* ---------- about ---------- */
function about(){
  tab('about');setHead('About',false);
  $('#view').innerHTML='<div class="about">'+banner()+
  '<h2 style="margin-top:2px">What this shows</h2><div class="sec pad"><p style="margin:0">Episodes where a promoter or promoter-group company bought shares in the open market, as filed with NSE under SEBI insider-trading rules. Purchases within 5 trading days are one episode. Each is scored 0 to 6 on IOLCP-style traits: 2+ days, price within 15% of its 12-month low, at least half a day of volume, no day above 0.5% of the company (too small to be a bulk deal), inside a 250-day base, and volume up with price flat.</p></div>'+
  '<h2>What the history says</h2><div class="sec pad"><ul style="margin:0;padding-left:18px"><li>Promoter open-market buying beat matched random stocks on doubling within a year (about 1.3 times), in both halves of the history.</li><li>Promoter selling did worse than random.</li><li>The stricter IOLCP-style traits did not add to the simple rule.</li><li>Most look-alike setups did not make a new high.</li></ul></div>'+
  '<h2>Limits</h2><div class="sec pad"><ul style="margin:0;padding-left:18px"><li>The backtests use hindsight and today\'s listed stocks, so rates are flattered. The Tracking tab is the fair test.</li><li>Filings can arrive up to two trading days after a trade.</li><li>Costs, slippage and exits are not modelled.</li><li>This shows public, legal purchases by promoter-group companies. It does not identify any hidden operator.</li><li><b>Research only. Not a recommendation to buy or sell.</b></li></ul></div>'+
  '<h2>Data</h2><div class="sec"><div class="kv"><span>Last updated</span><b>'+esc(DATA.generated)+'</b></div><div class="kv"><span>Prices to</span><b>'+fd(DATA.price_asof)+'</b></div><div class="kv"><span>Filings to</span><b>'+fd(DATA.filings_asof)+'</b></div><div class="kv"><span>Showing flags from</span><b>'+fd(DATA.window_from)+'</b></div></div></div>';
}

/* ---------- router ---------- */
function route(){
  if(!DATA)return;
  const h=location.hash||'#home';
  if(h.startsWith('#stock-'))detail(h.slice(7));
  else if(h==='#track')track();
  else if(h==='#scan')scanView();
  else if(h==='#about')about();
  else home();
  if(!h.startsWith('#stock-'))window.scrollTo(0,0);
}
window.addEventListener('hashchange',route);
$('#back').onclick=()=>{location.hash='#home';};
$('#refresh').onclick=()=>load(true);
window.addEventListener('resize',()=>{const h=location.hash||'#home';if(DATA&&(h==='#home'||h.startsWith('#stock-')))route();});
try{if('serviceWorker' in navigator&&!window.__DATA__&&(location.protocol==='https:'||location.hostname==='localhost')){navigator.serviceWorker.register('sw.js').catch(()=>{});}}catch(e){}
if(window.__DATA__){DATA=window.__DATA__;SCAN=window.__SCAN__||null;$('#refresh').style.visibility='hidden';route();}else{load(false);}
})();
