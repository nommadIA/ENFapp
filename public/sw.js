const V='enfapp-v8',SH=['/','/manifest.webmanifest','/icon-192.png','/icon-512.png'],REM_CACHE='enfapp-reminders-v2';
self.addEventListener('install',e=>{e.waitUntil(caches.open(V).then(c=>c.addAll(SH)).catch(()=>{}).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==V&&x!==REM_CACHE).map(x=>caches.delete(x)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{
  const r=e.request,u=new URL(r.url);
  if(r.method!=='GET'||u.origin!==location.origin)return;
  if(u.pathname.startsWith('/@vite')||u.pathname.startsWith('/@fs')||u.pathname.startsWith('/node_modules')||u.pathname.startsWith('/src/')||u.pathname.startsWith('/api/')||u.pathname.startsWith('/auth/callback'))return;
  if(r.mode==='navigate'){
    e.respondWith(fetch(r).then(x=>{if(x&&x.ok){const c=x.clone();caches.open(V).then(h=>h.put('/',c))}return x}).catch(()=>caches.match('/')));
    return;
  }
  e.respondWith(caches.match(r).then(h=>{
    const net=fetch(r).then(x=>{if(x&&x.ok){const c=x.clone();caches.open(V).then(h2=>h2.put(r,c))}return x}).catch(()=>h);
    return h||net;
  }));
});
self.addEventListener('message',e=>{
  const d=e.data||{};
  if(d.type==='SKIP_WAITING'){
    self.skipWaiting();
    return;
  }
  if(d.type==='SYNC_SHIFTS'&&Array.isArray(d.shifts)){
    const payload={
      shifts:d.shifts,
      meds:Array.isArray(d.meds)?d.meds:[],
      bills:Array.isArray(d.bills)?d.bills:[],
      enabled:d.enabled!==false,
      sndOn:d.sndOn!==false,
      updated:Date.now()
    };
    e.waitUntil(caches.open(REM_CACHE).then(c=>c.put('/__enfapp_shifts.json',new Response(JSON.stringify(payload),{headers:{'Content-Type':'application/json'}}))).catch(()=>{}));
  }
});
function fmtYmd(dt){
  return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
}
async function checkBgReminders(){
  try{
    const cache=await caches.open(REM_CACHE);
    const res=await cache.match('/__enfapp_shifts.json');
    if(!res)return;
    const data=await res.json();
    if(!data)return;
    const firedRes=await cache.match('/__enfapp_prev_fired.json');
    const fired=firedRes?(await firedRes.json().catch(()=>({}))):{};
    let changed=false;
    const now=new Date();
    const todayStr=fmtYmd(now);
    const tmr=new Date(now.getFullYear(),now.getMonth(),now.getDate()+1);
    const tmrStr=fmtYmd(tmr);
    const silent=data.sndOn===false;

    if(data.enabled!==false&&Array.isArray(data.shifts)){
      const list=data.shifts.filter(s=>s&&s.data===tmrStr&&s.status!=='Cancelado');
      if(list.length&&!fired['prev|'+tmrStr]){
        fired['prev|'+tmrStr]=Date.now();
        changed=true;
        const first=list[0];
        const [,m,dd]=tmrStr.split('-');
        const body=list.length===1
          ?`Amanhã (${dd}/${m}) você tem plantão: ${[first.hc,first.pac,first.tur,first.hini?'às '+first.hini:''].filter(Boolean).join(' · ')}.`
          :`Amanhã (${dd}/${m}) você tem ${list.length} plantões agendados${first.hc?' ('+first.hc+')':''}. Toque para conferir sua escala.`;
        await self.registration.showNotification('📅 Plantão amanhã · ENFapp',{
          body,
          icon:'/icon-192.png',
          badge:'/icon-192.png',
          tag:'enfapp-prev-'+tmrStr,
          renotify:true,
          silent,
          requireInteraction:true,
          vibrate:[300,120,300,120,300],
          data:{url:'/?tab=plantoes&pdate='+tmrStr}
        });
      }
      for(const s of data.shifts){
        if(!s||!s.lem||!s.rec||s.rec!==todayStr||s.status==='Recebido'||s.status==='Cancelado')continue;
        const rk='rec|'+s.id+'|'+s.rec;
        if(fired[rk])continue;
        const at=new Date(s.rec+'T'+(s.hrl||'08:00')+':00').getTime();
        if(now.getTime()>=at){
          fired[rk]=Date.now();
          changed=true;
          await self.registration.showNotification('💰 Recebimento de plantão · ENFapp',{
            body:`Hoje é dia de receber: ${[s.hc,s.pac].filter(Boolean).join(' · ')||'Plantão'}`,
            icon:'/icon-192.png',
            badge:'/icon-192.png',
            tag:'enfapp-rec-'+s.id,
            renotify:true,
            silent,
            requireInteraction:true,
            vibrate:[280,120,280],
            data:{url:'/?tab=plantoes&pdate='+(s.data||'')}
          });
        }
      }
    }

    if(Array.isArray(data.meds)){
      const dow=now.getDay();
      for(const m of data.meds){
        if(!m||(m.ini&&todayStr<m.ini)||(m.fim&&todayStr>m.fim)||(m.dias&&m.dias.length&&!m.dias.includes(dow)))continue;
        for(const tm of (m.times||[])){
          const mk='med|'+m.id+'|'+todayStr+'|'+tm;
          if(fired[mk])continue;
          const at=new Date(todayStr+'T'+tm+':00').getTime();
          const diff=now.getTime()-at;
          if(diff>=0&&diff<=30*60*1000){
            fired[mk]=Date.now();
            changed=true;
            await self.registration.showNotification('💊 Hora do medicamento · ENFapp',{
              body:`${m.nome}${m.dose?' · '+m.dose:''}${m.pac?' · '+m.pac:''} (${tm})`,
              icon:'/icon-192.png',
              badge:'/icon-192.png',
              tag:'md|'+mk,
              renotify:true,
              silent,
              requireInteraction:true,
              vibrate:[400,200,400,200,400],
              data:{url:'/?med=1'}
            });
          }
        }
      }
    }

    if(changed){
      await cache.put('/__enfapp_prev_fired.json',new Response(JSON.stringify(fired),{headers:{'Content-Type':'application/json'}}));
    }
  }catch(err){}
}
self.addEventListener('periodicsync',e=>{
  if(e.tag==='enfapp-shift-check'){
    e.waitUntil(checkBgReminders());
  }
});
self.addEventListener('push',e=>{
  let d={};try{d=e.data?e.data.json():{}}catch(x){d={body:e.data&&e.data.text()}}
  e.waitUntil(self.registration.showNotification(d.title||'ENFapp',{
    body:d.body||'',
    icon:'/icon-192.png',
    badge:'/icon-192.png',
    tag:d.tag||'enfapp',
    renotify:true,
    silent:d.silent===true,
    requireInteraction:d.requireInteraction!==false,
    vibrate:d.vibrate||[300,120,300,120,300],
    data:{url:d.url||'/'}
  }));
});
self.addEventListener('notificationclick',e=>{
  e.notification.close();
  const u=(e.notification.data&&e.notification.data.url)||'/';
  e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(l=>{
    for(const c of l){if('focus' in c){c.postMessage({t:u.includes('med=1')?'med':'open',url:u,playSound:true});return c.focus()}}
    return self.clients.openWindow(u);
  }));
});
