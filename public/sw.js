const V = 'enfapp-v15';
const SH = [
  '/',
  '/manifest.webmanifest',
  '/icon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-192.png',
  '/icon-maskable-512.png',
  '/apple-touch-icon.png',
  '/apple-touch-icon-167x167.png',
  '/apple-touch-icon-152x152.png',
];
const REM_CACHE = 'enfapp-reminders-v3';
const ALARM_VIBRATE = [500, 180, 500, 180, 500, 180, 500];
const NOTIF_VIBRATE = [300, 120, 300, 120, 300];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(V)
      .then((c) => c.addAll(SH))
      .catch(() => {})
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((ks) =>
        Promise.all(
          ks
            .filter((x) => x !== V && x !== REM_CACHE)
            .map((x) => caches.delete(x))
        )
      )
      .then(() => self.clients.claim())
      .then(() => checkBgReminders().catch(() => {}))
  );
});

self.addEventListener('fetch', (e) => {
  const r = e.request;
  const u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin) return;
  if (
    u.pathname.startsWith('/@vite') ||
    u.pathname.startsWith('/@fs') ||
    u.pathname.startsWith('/node_modules') ||
    u.pathname.startsWith('/src/') ||
    u.pathname.startsWith('/api/') ||
    u.pathname.startsWith('/auth/callback')
  ) {
    return;
  }
  if (r.mode === 'navigate') {
    e.respondWith(
      fetch(r)
        .then((x) => {
          if (x && x.ok) {
            const c = x.clone();
            caches.open(V).then((h) => h.put('/', c));
          }
          return x;
        })
        .catch(() => caches.match('/'))
    );
    return;
  }
  e.respondWith(
    caches.match(r).then((h) => {
      const net = fetch(r)
        .then((x) => {
          if (x && x.ok) {
            const c = x.clone();
            caches.open(V).then((h2) => h2.put(r, c));
          }
          return x;
        })
        .catch(() => h);
      return h || net;
    })
  );
});

async function putCacheJson(key, obj) {
  const cache = await caches.open(REM_CACHE);
  await cache.put(
    key,
    new Response(JSON.stringify(obj), {
      headers: { 'Content-Type': 'application/json' },
    })
  );
}

async function getCacheJson(key, fallback) {
  try {
    const cache = await caches.open(REM_CACHE);
    const res = await cache.match(key);
    if (!res) return fallback;
    return await res.json();
  } catch {
    return fallback;
  }
}

function u8FromB64Url(b) {
  const pad = '='.repeat((4 - (b.length % 4)) % 4);
  const raw = atob((b + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function setBadgeSafe(count) {
  try {
    if (self.navigator && typeof self.navigator.setAppBadge === 'function') {
      if (count > 0) await self.navigator.setAppBadge(count);
      else if (typeof self.navigator.clearAppBadge === 'function') {
        await self.navigator.clearAppBadge();
      }
    }
  } catch {}
}

async function deleteCacheKey(key) {
  try {
    const cache = await caches.open(REM_CACHE);
    await cache.delete(key);
  } catch {}
}

async function showNotifSafe(title, opts) {
  try {
    return await self.registration.showNotification(title, opts);
  } catch {
    const fallback = {
      body: opts && opts.body ? opts.body : '',
      icon: (opts && opts.icon) || '/icon-192.png',
      badge: (opts && opts.badge) || '/icon-192.png',
      tag: (opts && opts.tag) || 'enfapp',
      data: (opts && opts.data) || { url: '/' },
    };
    return self.registration.showNotification(title || 'ENFapp', fallback);
  }
}

self.addEventListener('message', (e) => {
  const d = e.data || {};
  if (d.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }
  if (d.type === 'CLEAR_BADGE') {
    e.waitUntil(setBadgeSafe(0));
    return;
  }
  if (d.type === 'GET_PENDING_SUB') {
    e.waitUntil(
      (async () => {
        try {
          const pending = await getCacheJson('/__enfapp_pending_sub.json', null);
          if (pending && pending.sub && e.source && typeof e.source.postMessage === 'function') {
            e.source.postMessage({ t: 'pending_sub', sub: pending.sub, at: pending.at || Date.now() });
          }
        } catch {}
      })()
    );
    return;
  }
  if (d.type === 'CLEAR_PENDING_SUB') {
    e.waitUntil(deleteCacheKey('/__enfapp_pending_sub.json'));
    return;
  }
  if (d.type === 'SAVE_VAPID' && typeof d.key === 'string' && d.key) {
    e.waitUntil(
      putCacheJson('/__enfapp_push_meta.json', {
        vapidKey: d.key,
        sbUrl: d.sbUrl || '',
        sbAnon: d.sbAnon || '',
        tz: d.tz || 'America/Sao_Paulo',
        updated: Date.now(),
      }).catch(() => {})
    );
    return;
  }
  if (d.type === 'SYNC_SHIFTS' && Array.isArray(d.shifts)) {
    const payload = {
      shifts: d.shifts,
      meds: Array.isArray(d.meds) ? d.meds : [],
      medLog: Array.isArray(d.medLog) ? d.medLog : [],
      snooze: d.snooze && typeof d.snooze === 'object' ? d.snooze : {},
      bills: Array.isArray(d.bills) ? d.bills : [],
      receivables: Array.isArray(d.receivables) ? d.receivables : [],
      enabled: d.enabled !== false,
      sndOn: d.sndOn !== false,
      updated: Date.now(),
    };
    e.waitUntil(putCacheJson('/__enfapp_shifts.json', payload).catch(() => {}));
  }
});

function fmtYmd(dt) {
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

async function checkBgReminders() {
  try {
    const data = await getCacheJson('/__enfapp_shifts.json', null);
    if (!data) return;
    const fired = await getCacheJson('/__enfapp_prev_fired.json', {});
    let changed = false;
    let badgeInc = 0;
    const now = new Date();
    const nowMs = now.getTime();
    const todayStr = fmtYmd(now);
    const tmr = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const tmrStr = fmtYmd(tmr);
    const silent = data.sndOn === false;
    const medLogKeys = new Set(Array.isArray(data.medLog) ? data.medLog : []);

    // Limpa registros antigos (> 10 dias) para não acumular cache
    for (const k of Object.keys(fired)) {
      if (nowMs - (Number(fired[k]) || 0) > 10 * 864e5) {
        delete fired[k];
        changed = true;
      }
    }

    if (data.enabled !== false && Array.isArray(data.shifts)) {
      const list = data.shifts.filter(
        (s) => s && s.data === tmrStr && s.status !== 'Cancelado'
      );
      if (list.length && !fired['prev|' + tmrStr]) {
        fired['prev|' + tmrStr] = nowMs;
        changed = true;
        badgeInc++;
        const first = list[0];
        const [, m, dd] = tmrStr.split('-');
        const body =
          list.length === 1
            ? `Amanhã (${dd}/${m}) você tem plantão: ${[first.hc, first.pac, first.tur, first.hini ? 'às ' + first.hini : ''].filter(Boolean).join(' · ')}.`
            : `Amanhã (${dd}/${m}) você tem ${list.length} plantões agendados${first.hc ? ' (' + first.hc + ')' : ''}. Toque para conferir sua escala.`;
        await showNotifSafe('📅 Plantão amanhã · ENFapp', {
          body,
          icon: '/icon-192.png',
          badge: '/icon-192.png',
          tag: 'enfapp-prev-' + tmrStr,
          renotify: false,
          timestamp: nowMs,
          ...(silent ? { silent: true } : { silent: false, vibrate: NOTIF_VIBRATE }),
          requireInteraction: true,
          actions: [{ action: 'open', title: 'Ver escala' }],
          data: { url: '/?tab=plantoes&pdate=' + tmrStr, kind: 'shift_prev' },
        });
      }

      for (const s of data.shifts) {
        if (!s || s.status === 'Cancelado') continue;
        // Lembrete 30 min antes do início do plantão
        if (s.data === todayStr && s.hini && s.status === 'Agendado') {
          const startAt = new Date(todayStr + 'T' + s.hini + ':00').getTime();
          const minsLeft = (startAt - nowMs) / 60000;
          const sk = 'start|' + s.id + '|' + todayStr + '|' + s.hini;
          if (!fired[sk] && minsLeft <= 35 && minsLeft >= -15) {
            fired[sk] = nowMs;
            changed = true;
            badgeInc++;
            await showNotifSafe('⏰ Plantão começando em breve · ENFapp', {
              body: `${[s.hc, s.pac, s.tur].filter(Boolean).join(' · ') || 'Plantão'} às ${s.hini}.`,
              icon: '/icon-192.png',
              badge: '/icon-192.png',
              tag: 'enfapp-start-' + s.id,
              renotify: true,
              timestamp: nowMs,
              ...(silent ? { silent: true } : { silent: false, vibrate: ALARM_VIBRATE }),
              requireInteraction: true,
              actions: [{ action: 'open', title: 'Abrir plantão' }],
              data: { url: '/?tab=plantoes&pdate=' + todayStr, kind: 'shift_start' },
            });
          }
        }
        // Lembrete de recebimento do plantão
        if (s.lem && s.rec === todayStr && s.status !== 'Recebido') {
          const rk = 'rec|' + s.id + '|' + s.rec;
          if (!fired[rk]) {
            const at = new Date(s.rec + 'T' + (s.hrl || '08:00') + ':00').getTime();
            if (nowMs >= at) {
              fired[rk] = nowMs;
              changed = true;
              badgeInc++;
              await showNotifSafe('💰 Recebimento de plantão · ENFapp', {
                body: `Hoje é dia de receber: ${[s.hc, s.pac].filter(Boolean).join(' · ') || 'Plantão'}`,
                icon: '/icon-192.png',
                badge: '/icon-192.png',
                tag: 'enfapp-rec-' + s.id,
                renotify: true,
                timestamp: nowMs,
                ...(silent ? { silent: true } : { silent: false, vibrate: NOTIF_VIBRATE }),
                requireInteraction: true,
                actions: [{ action: 'open', title: 'Ver plantão' }],
                data: { url: '/?tab=plantoes&pdate=' + (s.data || ''), kind: 'shift_pay' },
              });
            }
          }
        }
      }
    }

    // Alarmes de medicamentos (horários normais + adiados)
    if (Array.isArray(data.meds)) {
      const dow = now.getDay();
      const snooze = data.snooze || {};
      for (const m of data.meds) {
        if (
          !m ||
          (m.ini && todayStr < m.ini) ||
          (m.fim && todayStr > m.fim) ||
          (m.dias && m.dias.length && !m.dias.includes(dow))
        ) {
          continue;
        }
        for (const tm of m.times || []) {
          const medKey = m.id + '|' + todayStr + '|' + tm;
          if (medLogKeys.has(medKey)) continue;

          const snzAt = Number(snooze[medKey]) || 0;
          if (snzAt && nowMs >= snzAt && nowMs - snzAt <= 30 * 60 * 1000) {
            const sk = 'snz|' + medKey + '|' + snzAt;
            if (!fired[sk]) {
              fired[sk] = nowMs;
              changed = true;
              badgeInc++;
              await showNotifSafe('⏰ Alarme adiado · Medicamento', {
                body: `${m.nome}${m.dose ? ' · ' + m.dose : ''}${m.pac ? ' · ' + m.pac : ''} (dose das ${tm})`,
                icon: '/icon-192.png',
                badge: '/icon-192.png',
                tag: 'md|' + medKey,
                renotify: true,
                timestamp: nowMs,
                ...(silent ? { silent: true } : { silent: false, vibrate: ALARM_VIBRATE }),
                requireInteraction: true,
                actions: [
                  { action: 'taken', title: '✓ Tomei' },
                  { action: 'snooze', title: '⏰ Adiar 10 min' },
                ],
                data: { url: '/?med=1', kind: 'med_alarm', medKey },
              });
            }
            continue;
          }

          const mk = 'med|' + medKey;
          if (fired[mk]) continue;
          const at = new Date(todayStr + 'T' + tm + ':00').getTime();
          const diff = nowMs - at;
          if (diff >= 0 && diff <= 30 * 60 * 1000) {
            fired[mk] = nowMs;
            changed = true;
            badgeInc++;
            await showNotifSafe('💊 Hora do medicamento · ENFapp', {
              body: `${m.nome}${m.dose ? ' · ' + m.dose : ''}${m.pac ? ' · ' + m.pac : ''} (${tm})`,
              icon: '/icon-192.png',
              badge: '/icon-192.png',
              tag: 'md|' + medKey,
              renotify: true,
              timestamp: nowMs,
              ...(silent ? { silent: true } : { silent: false, vibrate: ALARM_VIBRATE }),
              requireInteraction: true,
              actions: [
                { action: 'taken', title: '✓ Tomei' },
                { action: 'snooze', title: '⏰ Adiar 10 min' },
              ],
              data: { url: '/?med=1', kind: 'med_alarm', medKey },
            });
          }
        }
      }
    }

    // Contas a pagar vencendo hoje
    if (Array.isArray(data.bills)) {
      const at8 = new Date(todayStr + 'T08:00:00').getTime();
      if (nowMs >= at8) {
        for (const b of data.bills) {
          if (!b || b.data !== todayStr) continue;
          const bk = 'bill|' + todayStr + '|' + (b.desc || '') + '|' + (b.valor || 0);
          if (fired[bk]) continue;
          fired[bk] = nowMs;
          changed = true;
          badgeInc++;
          const valStr = (Number(b.valor) || 0).toLocaleString('pt-BR', {
            style: 'currency',
            currency: 'BRL',
          });
          await showNotifSafe('🧾 Conta a pagar hoje · ENFapp', {
            body: `${b.desc || 'Conta'}: ${valStr}`,
            icon: '/icon-192.png',
            badge: '/icon-192.png',
            tag: 'enfapp-bill-' + todayStr,
            renotify: true,
            timestamp: nowMs,
            ...(silent ? { silent: true } : { silent: false, vibrate: NOTIF_VIBRATE }),
            requireInteraction: true,
            actions: [{ action: 'open', title: 'Ver financeiro' }],
            data: { url: '/?tab=fin', kind: 'bill_due' },
          });
        }
      }
    }

    if (badgeInc > 0) await setBadgeSafe(badgeInc);
    if (changed) await putCacheJson('/__enfapp_prev_fired.json', fired);
  } catch {}
}

self.addEventListener('periodicsync', (e) => {
  if (e.tag === 'enfapp-shift-check' || e.tag === 'enfapp-alarms-sync') {
    e.waitUntil(checkBgReminders());
  }
});

self.addEventListener('sync', (e) => {
  if (e.tag === 'enfapp-bg-sync' || e.tag === 'enfapp-alarms-sync') {
    e.waitUntil(checkBgReminders());
  }
});

// Renovação automática da assinatura Web Push caso Chrome/Edge/Android gire o endpoint em segundo plano
self.addEventListener('pushsubscriptionchange', (e) => {
  e.waitUntil(
    (async () => {
      try {
        const meta = await getCacheJson('/__enfapp_push_meta.json', null);
        const key =
          (e.oldSubscription &&
            e.oldSubscription.options &&
            e.oldSubscription.options.applicationServerKey) ||
          (meta && meta.vapidKey ? u8FromB64Url(meta.vapidKey) : null);
        if (!key) return;
        const newSub = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: key,
        });
        const clients = await self.clients.matchAll({
          type: 'window',
          includeUncontrolled: true,
        });
        const subJson = newSub.toJSON();
        for (const c of clients) {
          c.postMessage({ t: 'push_rotated', sub: subJson });
        }
        await putCacheJson('/__enfapp_pending_sub.json', {
          sub: subJson,
          at: Date.now(),
        });
      } catch {}
    })()
  );
});

// Recebe Web Push do servidor (Windows, PWA instalável e Android com app 100% fechado)
self.addEventListener('push', (e) => {
  let d = {};
  try {
    d = e.data ? e.data.json() : {};
  } catch {
    d = { body: e.data ? e.data.text() : '' };
  }
  const isAlarm =
    d.kind === 'med_alarm' ||
    d.kind === 'shift_start' ||
    d.alarm === true ||
    String(d.tag || '').startsWith('md|');
  const silent = d.silent === true && !isAlarm;
  const actions = Array.isArray(d.actions)
    ? d.actions
    : isAlarm && d.medKey
      ? [
          { action: 'taken', title: '✓ Tomei' },
          { action: 'snooze', title: '⏰ Adiar 10 min' },
        ]
      : [{ action: 'open', title: 'Abrir ENFapp' }];

  const opts = {
    body: d.body || '',
    icon: d.icon || '/icon-192.png',
    badge: d.badge || '/icon-192.png',
    tag: d.tag || (isAlarm ? 'enfapp-alarm-' + Date.now() : 'enfapp'),
    renotify: d.renotify !== false || isAlarm,
    timestamp: Number(d.timestamp) || Date.now(),
    ...(silent
      ? { silent: true }
      : { silent: false, vibrate: d.vibrate || (isAlarm ? ALARM_VIBRATE : NOTIF_VIBRATE) }),
    requireInteraction: isAlarm ? true : d.requireInteraction !== false,
    actions,
    data: {
      url: d.url || (isAlarm ? '/?med=1' : '/'),
      kind: d.kind || (isAlarm ? 'med_alarm' : 'notif'),
      medKey: d.medKey || '',
      alarm: isAlarm,
    },
  };

  e.waitUntil(
    Promise.all([
      showNotifSafe(d.title || 'ENFapp', opts),
      setBadgeSafe(1),
    ])
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const data = (e.notification && e.notification.data) || {};
  const action = e.action || 'open';
  const medKey = data.medKey || '';
  let targetUrl = data.url || '/';

  if (medKey && (action === 'taken' || action === 'snooze')) {
    targetUrl =
      '/?med=1&act=' +
      encodeURIComponent(action) +
      '&key=' +
      encodeURIComponent(medKey);
  }

  e.waitUntil(
    (async () => {
      await setBadgeSafe(0);

      // Se o usuário tocou em "Adiar 10 min" direto na notificação, registra no cache local do SW imediatamente
      if (medKey && action === 'snooze') {
        try {
          const cached = await getCacheJson('/__enfapp_shifts.json', null);
          if (cached) {
            cached.snooze = cached.snooze || {};
            cached.snooze[medKey] = Date.now() + 10 * 60 * 1000;
            await putCacheJson('/__enfapp_shifts.json', cached);
          }
        } catch {}
      }

      const list = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      for (const c of list) {
        if ('focus' in c) {
          c.postMessage({
            t: medKey && (action === 'taken' || action === 'snooze')
              ? 'med_action'
              : targetUrl.includes('med=1')
                ? 'med'
                : 'open',
            action,
            medKey,
            url: targetUrl,
            playSound: action === 'open',
          });
          return c.focus();
        }
      }
      return self.clients.openWindow(targetUrl);
    })()
  );
});
