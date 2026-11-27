import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};
const J = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: { ...cors, "Content-Type": "application/json" },
  });
const admin = () =>
  createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
const b64u = (u: Uint8Array) =>
  btoa(String.fromCharCode(...u))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
const unb64u = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
    c.charCodeAt(0)
  );
const FIM = ["Recebido", "Cancelado"];
const TD: Record<string, [string, number]> = {
  "Diurno 12h": ["07:00", 12],
  "Noturno 12h": ["19:00", 12],
  "24h": ["07:00", 24],
  Outro: ["08:00", 6],
};
const addH = (s: string, h: number): string | null => {
  const ms = Date.parse(String(s || "").replace(" ", "T") + ":00Z");
  if (!Number.isFinite(ms) || !Number.isFinite(h)) return null;
  return new Date(ms + h * 36e5).toISOString().slice(0, 16).replace("T", " ");
};
const addMin = (s: string, m: number): string | null => {
  const ms = Date.parse(String(s || "").replace(" ", "T") + ":00Z");
  if (!Number.isFinite(ms) || !Number.isFinite(m)) return null;
  return new Date(ms + m * 60e3).toISOString().slice(0, 16).replace("T", " ");
};
const br = (d?: string) => (d ? d.split("-").reverse().join("/") : "");
const money = (v: unknown) =>
  (Number(v) || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
const ALARM_VIB = [500, 180, 500, 180, 500, 180, 500];
const NOTIF_VIB = [300, 120, 300, 120, 300];

async function cfg() {
  const a = admin();
  let { data } = await a
    .from("push_config")
    .select("*")
    .eq("id", 1)
    .maybeSingle();

  if (!data) {
    const rand = crypto.getRandomValues(new Uint8Array(24));
    const secret = b64u(rand);
    await a
      .from("push_config")
      .upsert(
        {
          id: 1,
          subject: "mailto:suporte@enfapp.com.br",
          cron_secret: secret,
        },
        { onConflict: "id" }
      );
    ({ data } = await a
      .from("push_config")
      .select("*")
      .eq("id", 1)
      .maybeSingle());
  }

  if (data && (!data.public_key || !data.private_key)) {
    const k = await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign", "verify"]
    );
    const j = await crypto.subtle.exportKey("jwk", k.privateKey);
    const pub = new Uint8Array([4, ...unb64u(j.x!), ...unb64u(j.y!)]);
    await a
      .from("push_config")
      .update({
        public_key: b64u(pub),
        private_key: j.d!,
        subject: data.subject || "mailto:suporte@enfapp.com.br",
      })
      .eq("id", 1);
    ({ data } = await a
      .from("push_config")
      .select("*")
      .eq("id", 1)
      .maybeSingle());
  }
  return data!;
}

async function sendUser(
  c: any,
  uid: string,
  payload: Record<string, unknown>,
  opts?: { urgency?: "very-low" | "low" | "normal" | "high"; ttl?: number }
) {
  const a = admin();
  webpush.setVapidDetails(
    c.subject || "mailto:suporte@enfapp.com.br",
    c.public_key,
    c.private_key
  );
  const { data: subs } = await a
    .from("push_subscriptions")
    .select("endpoint,p256dh,auth")
    .eq("user_id", uid);

  const pushOptions = {
    TTL: opts?.ttl ?? 3600,
    urgency: opts?.urgency ?? "high",
  };

  const outcomes = await Promise.all(
    (subs ?? []).map(async (s: any) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(payload),
          pushOptions
        );
        return "sent";
      } catch (e: any) {
        const sc = Number(e?.statusCode) || 0;
        if (sc === 404 || sc === 410) {
          // Corrige remoção usando endpoint (chave primária real de push_subscriptions)
          await a.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
          return "expired";
        }
        console.warn("web push delivery failed", sc || "unknown", e?.message || "");
        return "retry";
      }
    })
  );
  return {
    sent: outcomes.filter((x) => x === "sent").length,
    retry: outcomes.includes("retry"),
  };
}

async function run(c: any) {
  const a = admin();
  const { data: subs } = await a
    .from("push_subscriptions")
    .select("user_id,tz");
  const users = new Map<string, string>();
  (subs ?? []).forEach((s: any) =>
    users.set(s.user_id, s.tz || "America/Sao_Paulo")
  );
  let total = 0;

  for (const [uid, tz] of users) {
    try {
    const fmt = (d: Date) => {
      try {
        return d.toLocaleString("sv-SE", { timeZone: tz }).slice(0, 16);
      } catch {
        return d
          .toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" })
          .slice(0, 16);
      }
    };
    const nowDate = new Date();
    const nowMs = nowDate.getTime();
    const now = fmt(nowDate);
    const limite = fmt(new Date(nowMs - 48 * 3600e3));
    const lim30 = fmt(new Date(nowMs - 30 * 60e3));
    const lim12h = fmt(new Date(nowMs - 12 * 3600e3));

    const { data } = await a
      .from("app_data")
      .select("key,value")
      .eq("user_id", uid)
      .in("key", [
        "enf_plantoes",
        "enf_receber",
        "enf_contas",
        "enf_meds",
        "enf_medlog",
        "enf_snz",
        "enf_recAc",
        "enf_prev_ntf",
        "enf_snd_on",
      ]);

    const value = (k: string) =>
      (data ?? []).find((r: any) => r.key === k)?.value;
    const get = (k: string) =>
      Array.isArray(value(k)) ? (value(k) as any[]) : [];
    const isOff = (v: unknown) =>
      v === 0 || v === false || v === "0" || v === "false";
    const prevEnabled = !isOff(value("enf_prev_ntf"));
    const soundEnabled = !isOff(value("enf_snd_on"));

    const items: {
      ref: string;
      title: string;
      body: string;
      isAlarm?: boolean;
      extra?: Record<string, unknown>;
    }[] = [];

    const plantoes = get("enf_plantoes");

    // 1. Aviso 1 dia antes do plantão (a partir das 08:00 no fuso local)
    if (prevEnabled && now.slice(11, 16) >= "08:00") {
      const tomorrowDate = new Date(now.slice(0, 10) + "T12:00:00Z");
      tomorrowDate.setUTCDate(tomorrowDate.getUTCDate() + 1);
      const tomorrow = tomorrowDate.toISOString().slice(0, 10);
      for (const r of plantoes) {
        if (!r || !r.data || r.data !== tomorrow || r.status === "Cancelado") continue;
        const ref = `prev|${r.id || r.data + "|" + (r.pac || "")}|${r.data}`;
        items.push({
          ref,
          title: "📅 Plantão amanhã · ENFapp",
          body: `Amanhã (${br(r.data)}) você tem plantão${r.hc ? ` · ${r.hc}` : ""}${r.pac ? ` · ${r.pac}` : ""}${r.tur ? ` · ${r.tur}` : ""}${r.hini ? ` às ${r.hini}` : ""}.`,
          extra: {
            tag: `enfapp-prev-${r.data}`,
            url: `/?tab=plantoes&pdate=${r.data}`,
            kind: "shift_prev",
            renotify: false,
          },
        });
      }
    }

    // 2. Alarme 30 min antes do início do plantão
    for (const r of plantoes) {
      if (!r || !r.data || (r.status && r.status !== "Agendado")) continue;
      const d = TD[r.tur] || TD.Outro;
      const startTime = r.hini || d[0];
      const warnAt = addMin(`${r.data} ${startTime}`, -30);
      if (!warnAt || warnAt > now || warnAt < lim30) continue;
      items.push({
        ref: `ini|${r.id || r.data + "|" + (r.pac || "")}|${r.data}|${startTime}`,
        title: "⏰ Plantão começando em 30 min · ENFapp",
        body: `${[r.hc, r.pac, r.tur].filter(Boolean).join(" · ") || "Plantão"} às ${startTime}.`,
        isAlarm: true,
        extra: {
          url: `/?tab=plantoes&pdate=${r.data}`,
          kind: "shift_start",
          alarm: true,
          requireInteraction: true,
          vibrate: ALARM_VIB,
        },
      });
    }

    // 3. Recebimento individual de plantão
    for (const r of plantoes) {
      if (!r.lem || !r.rec || FIM.includes(r.status)) continue;
      const due = `${r.rec} ${r.hrl || "08:00"}`;
      if (due > now || due < limite) continue;
      items.push({
        ref: `pl|${due}|${r.data}|${r.pac}|${r.valor}`,
        title: "💰 Receber plantão · ENFapp",
        body: `Plantão de ${br(r.data)}${r.hc ? ` (${r.hc})` : ""}: ${money(r.valor)}`,
        extra: {
          url: `/?tab=plantoes&pdate=${r.data || ""}`,
          kind: "shift_pay",
        },
      });
    }

    // 4. Plantão terminou
    for (const r of plantoes) {
      if (!r || !r.data || r.nfim || (r.status && r.status !== "Agendado")) continue;
      const d = TD[r.tur] || TD.Outro;
      const h = Number(r.dur) || d[1];
      const end = addH(`${r.data} ${r.hini || d[0]}`, h);
      if (!end || end > now || end < lim12h) continue;
      items.push({
        ref: `fim|${r.id || r.data + r.pac}|${end}`,
        title: "✅ Plantão terminou · ENFapp",
        body: `Marque como realizado${r.hc ? " · " + r.hc : ""}${r.pac ? " · " + r.pac : ""}`,
        extra: {
          url: `/?tab=plantoes&pdate=${r.data}`,
          kind: "shift_end",
          requireInteraction: true,
        },
      });
    }

    // 5. Recebimento acumulado de plantões
    const ra: any = value("enf_recAc");
    if (ra && ra.lem && ra.data) {
      const due = `${ra.data} ${ra.hrl || "08:00"}`;
      if (due <= now && due >= limite) {
        let n = 0;
        let tot = 0;
        for (const r of plantoes) {
          if (!r || FIM.includes(r.status) || !r.data) continue;
          const d = TD[r.tur] || TD.Outro;
          const h = Number(r.dur) || d[1];
          const end = addH(`${r.data} ${r.hini || d[0]}`, h);
          if (
            r.status === "Realizado" ||
            r.status === "Aguardando pagamento" ||
            (end && end <= now)
          ) {
            n++;
            tot += Number(r.valor) || 0;
          }
        }
        if (n) {
          items.push({
            ref: `ra|${due}`,
            title: "💰 Dia de receber · ENFapp",
            body: `${n} plantão(ões) acumulado(s): ${money(tot)}`,
            extra: { url: "/?tab=plantoes", kind: "shift_pay" },
          });
        }
      }
    }

    // 6. Contas a pagar
    for (const r of get("enf_contas")) {
      if (!r.lem || r.pago || !r.data) continue;
      const due = `${r.data} 08:00`;
      if (due > now || due < limite) continue;
      items.push({
        ref: `ct|${due}|${r.desc}|${r.valor}`,
        title: "🧾 Conta a pagar · ENFapp",
        body: `${r.desc || "Conta"}: ${money(r.valor)}`,
        extra: { url: "/?tab=fin", kind: "bill_due" },
      });
    }

    // 7. Recebimentos previstos
    for (const r of get("enf_receber")) {
      if (!r.lem || r.pago || !r.data) continue;
      const due = `${r.data} 08:00`;
      if (due > now || due < limite) continue;
      items.push({
        ref: `rc|${due}|${r.desc}|${r.valor}`,
        title: "💵 Recebimento previsto · ENFapp",
        body: `${r.desc || r.hc || "Plantão"}: ${money(r.valor)}`,
        extra: { url: "/?tab=fin", kind: "shift_pay" },
      });
    }

    // 8. Alarmes de medicamentos (horário exato + adiados/snooze com app fechado)
    const log = get("enf_medlog");
    const snzObj =
      value("enf_snz") && typeof value("enf_snz") === "object"
        ? (value("enf_snz") as Record<string, number>)
        : {};
    const hoje = now.slice(0, 10);
    const dow = new Date(hoje + "T12:00:00Z").getUTCDay();
    for (const m of get("enf_meds")) {
      if (m.ativo === 0 || m.notif === 0) continue;
      if ((m.ini && hoje < m.ini) || (m.fim && hoje > m.fim)) continue;
      if (Array.isArray(m.dias) && m.dias.length && !m.dias.includes(dow)) continue;
      for (const t of m.times ?? []) {
        const key = `${m.id}|${hoje}|${t}`;
        if (log.some((l: any) => l.key === key)) continue;

        // Verifica alarme adiado (snooze)
        const snzAt = Number(snzObj[key]) || 0;
        if (snzAt && nowMs >= snzAt && nowMs - snzAt <= 30 * 60e3) {
          items.push({
            ref: `mdsnz|${key}|${Math.floor(snzAt / 60000)}`,
            title: "⏰ Alarme adiado · Medicamento",
            body: `${m.nome}${m.dose ? " · " + m.dose : ""}${m.pac ? " · " + m.pac : ""} (dose das ${t})`,
            isAlarm: true,
            extra: {
              kind: "med_alarm",
              alarm: true,
              medKey: key,
              requireInteraction: true,
              renotify: true,
              vibrate: ALARM_VIB,
              url: "/?med=1",
              actions: [
                { action: "taken", title: "✓ Tomei" },
                { action: "snooze", title: "⏰ Adiar 10 min" },
              ],
            },
          });
          continue;
        }

        const due = `${hoje} ${t}`;
        if (due > now || due < lim30) continue;
        items.push({
          ref: `md|${key}`,
          title: "💊 Hora do medicamento · ENFapp",
          body: `${m.nome}${m.dose ? " · " + m.dose : ""}${m.pac ? " · " + m.pac : ""} (${t})`,
          isAlarm: true,
          extra: {
            kind: "med_alarm",
            alarm: true,
            medKey: key,
            requireInteraction: true,
            renotify: true,
            vibrate: ALARM_VIB,
            url: "/?med=1",
            actions: [
              { action: "taken", title: "✓ Tomei" },
              { action: "snooze", title: "⏰ Adiar 10 min" },
            ],
          },
        });
      }
    }

    // 9. Notificações do Administrador / Pagamentos (user_notifications não lidas das últimas 24h)
    try {
      const since24h = new Date(nowMs - 24 * 3600e3).toISOString();
      const { data: unotifs } = await a
        .from("user_notifications")
        .select("id,title,body,kind,created_at")
        .eq("user_id", uid)
        .is("read_at", null)
        .gte("created_at", since24h)
        .limit(10);
      for (const un of unotifs ?? []) {
        items.push({
          ref: `un|${un.id}`,
          title: un.title || "Aviso · ENFapp",
          body: un.body || "",
          extra: {
            kind: "admin",
            tag: `un_${un.id}`,
            url: "/",
            requireInteraction: true,
          },
        });
      }
    } catch {}

    for (const it of items) {
      const { error } = await a
        .from("push_sent")
        .insert({ user_id: uid, ref: it.ref });
      if (error) continue;
      const delivery = await sendUser(
        c,
        uid,
        {
          title: it.title,
          body: it.body,
          tag: it.ref,
          url: "/",
          silent: it.isAlarm ? false : !soundEnabled,
          renotify: !!it.isAlarm,
          timestamp: nowMs,
          vibrate: it.isAlarm ? ALARM_VIB : NOTIF_VIB,
          ...(it.extra ?? {}),
        },
        { urgency: "high", ttl: it.isAlarm ? 1800 : 3600 }
      );
      if (!delivery.sent || delivery.retry) {
        await a
          .from("push_sent")
          .delete()
          .eq("user_id", uid)
          .eq("ref", it.ref);
      }
      total += delivery.sent;
    }
    } catch (userErr) {
      console.error("push run user error", uid, userErr);
    }
  }

  await a
    .from("push_sent")
    .delete()
    .lt("sent_at", new Date(Date.now() - 30 * 864e5).toISOString());

  return { ok: true, usuarios: users.size, enviadas: total };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const act = new URL(req.url).searchParams.get("action") || "key";
  const c = await cfg();

  if (act === "run") {
    if (req.headers.get("x-cron-secret") !== c.cron_secret) {
      return J({ error: "proibido" }, 403);
    }
    return J(await run(c));
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    {
      global: {
        headers: { Authorization: req.headers.get("Authorization") ?? "" },
      },
    }
  );
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return J({ error: "não autenticado" }, 401);

  if (act === "key") return J({ key: c.public_key });

  if (act === "test") {
    const delivery = await sendUser(
      c,
      user.id,
      {
        title: "🔔 ENFapp · Push ativo!",
        body: "Notificações com o app fechado estão funcionando neste aparelho (Windows, PWA e Android).",
        tag: `teste-${Date.now()}`,
        url: "/",
        silent: false,
        renotify: true,
        requireInteraction: true,
        vibrate: NOTIF_VIB,
      },
      { urgency: "high", ttl: 600 }
    );
    return J({ enviadas: delivery.sent, falhasTemporarias: delivery.retry });
  }

  if (act === "test_alarm") {
    const delivery = await sendUser(
      c,
      user.id,
      {
        title: "💊 Alarme de teste · ENFapp",
        body: "Simulação de alarme em alta prioridade com app fechado (Windows, PWA e Android).",
        tag: `alarme-teste-${Date.now()}`,
        url: "/?med=1",
        kind: "med_alarm",
        alarm: true,
        silent: false,
        renotify: true,
        requireInteraction: true,
        vibrate: ALARM_VIB,
        actions: [{ action: "open", title: "Abrir medicamentos" }],
      },
      { urgency: "high", ttl: 600 }
    );
    return J({ enviadas: delivery.sent, falhasTemporarias: delivery.retry });
  }

  if (act === "notify") {
    const a = admin();
    const { data: prof } = await a
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    if (prof?.role !== "master") return J({ error: "sem permissão" }, 403);
    const body = await req.json().catch(() => ({}));
    const targetIds: string[] = Array.isArray(body.user_ids)
      ? body.user_ids.map(String)
      : body.user_id
        ? [String(body.user_id)]
        : [];
    const title = String(body.title || "ENFapp");
    const msg = String(body.body || "");
    if (!msg) return J({ error: "mensagem vazia" }, 400);

    let ids = targetIds;
    if (body.all === true) {
      const { data: allSubs } = await a
        .from("push_subscriptions")
        .select("user_id");
      ids = [...new Set((allSubs ?? []).map((s: any) => String(s.user_id)))];
    }

    let sent = 0;
    for (const uid of ids) {
      const res = await sendUser(
        c,
        uid,
        {
          title,
          body: msg,
          tag: `adm-${Date.now()}-${uid.slice(0, 6)}`,
          url: String(body.url || "/"),
          kind: "admin",
          silent: false,
          renotify: true,
          requireInteraction: true,
          vibrate: NOTIF_VIB,
        },
        { urgency: "high", ttl: 3600 }
      );
      sent += res.sent;
    }
    return J({ ok: true, enviadas: sent });
  }

  return J({ error: "ação inválida" }, 400);
});
