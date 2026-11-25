import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret" };
const J = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const admin = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const b64u = (u: Uint8Array) => btoa(String.fromCharCode(...u)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const FIM = ["Recebido", "Cancelado"];
const TD: Record<string, [string, number]> = { "Diurno 12h": ["07:00", 12], "Noturno 12h": ["19:00", 12], "24h": ["07:00", 24], "Outro": ["08:00", 6] };
const addH = (s: string, h: number) => new Date(Date.parse(s.replace(" ", "T") + ":00Z") + h * 36e5).toISOString().slice(0, 16).replace("T", " ");
const br = (d?: string) => (d ? d.split("-").reverse().join("/") : "");
const money = (v: unknown) => (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

async function cfg() {
  const a = admin();
  let { data } = await a.from("push_config").select("*").eq("id", 1).maybeSingle();
  if (data && !data.public_key) {
    const k = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const j = await crypto.subtle.exportKey("jwk", k.privateKey);
    const pub = new Uint8Array([4, ...unb64u(j.x!), ...unb64u(j.y!)]);
    await a.from("push_config").update({ public_key: b64u(pub), private_key: j.d! }).eq("id", 1).is("public_key", null);
    ({ data } = await a.from("push_config").select("*").eq("id", 1).maybeSingle());
  }
  return data!;
}

async function sendUser(c: any, uid: string, payload: Record<string, unknown>) {
  const a = admin();
  webpush.setVapidDetails(c.subject, c.public_key, c.private_key);
  const { data: subs } = await a.from("push_subscriptions").select("*").eq("user_id", uid);
  let n = 0;
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload));
      n++;
    } catch (e: any) {
      if (e?.statusCode === 404 || e?.statusCode === 410) await a.from("push_subscriptions").delete().eq("id", s.id);
      else console.warn("web push delivery failed", Number(e?.statusCode) || "unknown");
    }
  }
  return n;
}

async function run(c: any) {
  const a = admin();
  const { data: subs } = await a.from("push_subscriptions").select("user_id,tz");
  const users = new Map<string, string>();
  (subs ?? []).forEach((s: any) => users.set(s.user_id, s.tz || "America/Sao_Paulo"));
  let total = 0;
  for (const [uid, tz] of users) {
    const fmt = (d: Date) => d.toLocaleString("sv-SE", { timeZone: tz }).slice(0, 16);
    const now = fmt(new Date()), limite = fmt(new Date(Date.now() - 48 * 3600e3)), lim30 = fmt(new Date(Date.now() - 30 * 60e3)), lim12h = fmt(new Date(Date.now() - 12 * 3600e3));
    const { data } = await a.from("app_data").select("key,value").eq("user_id", uid).in("key", ["enf_plantoes", "enf_receber", "enf_contas", "enf_meds", "enf_medlog", "enf_recAc", "enf_prev_ntf", "enf_snd_on"]);
    const value = (k: string) => (data ?? []).find((r: any) => r.key === k)?.value;
    const get = (k: string) => (value(k) as any[]) ?? [];
    const prevEnabled = value("enf_prev_ntf") !== 0;
    const soundEnabled = value("enf_snd_on") !== 0;
    const items: { ref: string; title: string; body: string; extra?: Record<string, unknown> }[] = [];
    const plantoes = get("enf_plantoes");
    if (prevEnabled) {
      const tomorrowDate = new Date(now.slice(0, 10) + "T12:00:00Z");
      tomorrowDate.setUTCDate(tomorrowDate.getUTCDate() + 1);
      const tomorrow = tomorrowDate.toISOString().slice(0, 10);
      for (const r of plantoes) {
        if (!r.data || r.data !== tomorrow || r.status === "Cancelado") continue;
        const ref = `prev|${r.id || r.data + "|" + (r.pac || "")}|${r.data}`;
        items.push({
          ref,
          title: "📅 Plantão amanhã · ENFapp",
          body: `Amanhã (${br(r.data)}) você tem plantão${r.hc ? ` · ${r.hc}` : ""}${r.pac ? ` · ${r.pac}` : ""}${r.tur ? ` · ${r.tur}` : ""}${r.hini ? ` às ${r.hini}` : ""}.`,
          extra: { tag: `enfapp-prev-${r.data}`, renotify: false },
        });
      }
    }
    for (const r of plantoes) {
      if (!r.lem || !r.rec || FIM.includes(r.status)) continue;
      const due = `${r.rec} ${r.hrl || "08:00"}`;
      if (due > now || due < limite) continue;
      items.push({ ref: `pl|${due}|${r.data}|${r.pac}|${r.valor}`, title: "Receber plantão", body: `Plantão de ${br(r.data)}${r.hc ? ` (${r.hc})` : ""}: ${money(r.valor)}` });
    }
    for (const r of plantoes) {
      if (!r.data || r.nfim || (r.status && r.status !== "Agendado")) continue;
      const d = TD[r.tur] || TD.Outro, h = Number(r.dur) || d[1];
      const end = addH(`${r.data} ${r.hini || d[0]}`, h);
      if (end > now || end < lim12h) continue;
      items.push({ ref: `fim|${r.id || r.data + r.pac}|${end}`, title: "Plantão terminou", body: `Marque como realizado${r.hc ? " · " + r.hc : ""}${r.pac ? " · " + r.pac : ""}`, extra: { url: "/?tab=plantoes", requireInteraction: true } });
    }
    const ra: any = (data ?? []).find((x: any) => x.key === "enf_recAc")?.value;
    if (ra && ra.lem && ra.data) {
      const due = `${ra.data} ${ra.hrl || "08:00"}`;
      if (due <= now && due >= limite) {
        let n = 0, tot = 0;
        for (const r of plantoes) {
          if (FIM.includes(r.status) || !r.data) continue;
          const d = TD[r.tur] || TD.Outro, h = Number(r.dur) || d[1];
          const end = addH(`${r.data} ${r.hini || d[0]}`, h);
          if (r.status === "Realizado" || r.status === "Aguardando pagamento" || end <= now) { n++; tot += Number(r.valor) || 0; }
        }
        if (n) items.push({ ref: `ra|${due}`, title: "Dia de receber", body: `${n} plantão(ões) acumulado(s): ${money(tot)}`, extra: { url: "/?tab=plantoes" } });
      }
    }
    for (const r of get("enf_contas")) {
      if (!r.lem || r.pago || !r.data) continue;
      const due = `${r.data} 08:00`;
      if (due > now || due < limite) continue;
      items.push({ ref: `ct|${due}|${r.desc}|${r.valor}`, title: "Conta a pagar", body: `${r.desc || "Conta"}: ${money(r.valor)}` });
    }
    for (const r of get("enf_receber")) {
      if (!r.lem || r.pago || !r.data) continue;
      const due = `${r.data} 08:00`;
      if (due > now || due < limite) continue;
      items.push({ ref: `rc|${due}|${r.desc}|${r.valor}`, title: "Recebimento previsto", body: `${r.desc || r.hc || "Plantão"}: ${money(r.valor)}` });
    }
    const log = get("enf_medlog"), hoje = now.slice(0, 10), dow = new Date(hoje + "T12:00:00Z").getUTCDay();
    for (const m of get("enf_meds")) {
      if (m.ativo === 0 || m.notif === 0) continue;
      if ((m.ini && hoje < m.ini) || (m.fim && hoje > m.fim)) continue;
      if (Array.isArray(m.dias) && m.dias.length && !m.dias.includes(dow)) continue;
      for (const t of (m.times ?? [])) {
        const due = `${hoje} ${t}`;
        if (due > now || due < lim30) continue;
        const key = `${m.id}|${hoje}|${t}`;
        if (log.some((l: any) => l.key === key)) continue;
        items.push({ ref: `md|${key}`, title: "💊 Hora do medicamento", body: `${m.nome}${m.dose ? " " + m.dose : ""}${m.pac ? " · " + m.pac : ""} · ${t}`, extra: { requireInteraction: true, vibrate: [300, 150, 300, 150, 300], url: "/?med=1" } });
      }
    }
    for (const it of items) {
      const { error } = await a.from("push_sent").insert({ user_id: uid, ref: it.ref });
      if (error) continue;
      const delivered = await sendUser(c, uid, { title: it.title, body: it.body, tag: it.ref, url: "/", silent: !soundEnabled, ...(it.extra ?? {}) });
      if (!delivered) await a.from("push_sent").delete().eq("user_id", uid).eq("ref", it.ref);
      total += delivered;
    }
  }
  await a.from("push_sent").delete().lt("sent_at", new Date(Date.now() - 30 * 864e5).toISOString());
  return { ok: true, usuarios: users.size, enviadas: total };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const act = new URL(req.url).searchParams.get("action") || "key";
  const c = await cfg();
  if (act === "run") {
    if (req.headers.get("x-cron-secret") !== c.cron_secret) return J({ error: "proibido" }, 403);
    return J(await run(c));
  }
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return J({ error: "não autenticado" }, 401);
  if (act === "key") return J({ key: c.public_key });
  if (act === "test") return J({ enviadas: await sendUser(c, user.id, { title: "ENFapp", body: "Notificação de teste: tudo certo! 🔔", tag: "teste", url: "/" }) });
  return J({ error: "ação inválida" }, 400);
});
