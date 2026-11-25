import { createClient } from "npm:@supabase/supabase-js@2";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return json({ error: "não autenticado" }, 401);
  const { data, error } = await sb.from("app_data").select("key,value").in("key", ["enf_plantoes", "enf_receber", "enf_contas", "enf_meds"]);
  if (error) return json({ error: error.message }, 500);
  const now = new Date(), hoje = new Date(now).setHours(0, 0, 0, 0), todayStr = now.toISOString().slice(0, 10), dow = now.getDay(), fim = ["Recebido", "Cancelado"], out: unknown[] = [];
  for (const row of data ?? []) {
    const tipo = row.key.replace("enf_", "");
    for (const r of (row.value as any[]) ?? []) {
      if (tipo === "meds") {
        if (r.ativo === 0 || r.notif === 0) continue;
        if ((r.ini && todayStr < r.ini) || (r.fim && todayStr > r.fim)) continue;
        if (Array.isArray(r.dias) && r.dias.length && !r.dias.includes(dow)) continue;
        for (const tm of (r.times as string[]) ?? []) {
          out.push({ tipo: "medicamento", descricao: [r.nome, r.dose, r.pac].filter(Boolean).join(" · "), valor: 0, data: todayStr, hora: tm, dias: 0 });
        }
        continue;
      }
      if (tipo === "plantoes" && r.data && r.status !== "Cancelado") {
        const diasPl = Math.round((new Date(r.data + "T00:00").getTime() - hoje) / 864e5);
        if (diasPl === 1) {
          out.push({ tipo: "plantão amanhã", descricao: [r.hc, r.pac, r.tur].filter(Boolean).join(" · ") || "Plantão agendado", valor: r.valor, data: r.data, hora: r.hini ?? null, dias: 1 });
        }
      }
      const dt = tipo === "plantoes" ? r.rec : r.data;
      if (!dt || !r.lem || r.pago || fim.includes(r.status)) continue;
      const dias = Math.round((new Date(dt + "T00:00").getTime() - hoje) / 864e5);
      if (dias <= 3) out.push({ tipo, descricao: r.desc || r.pac || r.hc, valor: r.valor, data: dt, hora: r.hrl ?? null, dias });
    }
  }
  return json({ lembretes: out });
});
