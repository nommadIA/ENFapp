import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, "Content-Type": "application/json" },
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "método não permitido" }, 405);
  const authorization = req.headers.get("Authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  const url = Deno.env.get("SUPABASE_URL") || "";
  let key = Deno.env.get("SUPABASE_ANON_KEY") || "";
  if (!key) {
    try { key = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "{}").default || ""; } catch { /* Invalid environment value. */ }
  }
  if (!url || !key) return json({ error: "Supabase não configurado" }, 503);
  if (!token) return json({ error: "sessão não autenticada" }, 401);
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return json({ error: "sessão inválida" }, 401);
    const input = await req.json().catch(() => ({}));
    const orderId = String(input.order_id || "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(orderId)) {
      return json({ error: "pedido inválido" }, 400);
    }
    let { data, error } = await supabase.from("payment_orders")
      .select("id,plan,cycle,billing_mode,status,amount,currency,expires_at")
      .eq("id", orderId).eq("user_id", user.id).maybeSingle();
    if (error && String(error.message || "").includes("billing_mode")) {
      const fb = await supabase.from("payment_orders")
        .select("id,plan,cycle,status,amount,currency,expires_at")
        .eq("id", orderId).eq("user_id", user.id).maybeSingle();
      data = fb.data ? { ...fb.data, billing_mode: "avulso" } : null;
      error = fb.error;
    }
    if (error || !data) return json({ error: "pedido não encontrado" }, 404);
    return json({ order: data });
  } catch (error) {
    console.error("mercadopago-status", error);
    return json({ error: "não foi possível consultar o pedido" }, 500);
  }
});
