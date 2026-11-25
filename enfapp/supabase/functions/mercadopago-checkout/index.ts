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

function keyFromEnv(name: string, jsonName?: string): string {
  const value = Deno.env.get(name);
  if (value) return value;
  if (jsonName) {
    try {
      const keys = JSON.parse(Deno.env.get(jsonName) || "{}");
      if (typeof keys.default === "string") return keys.default;
    } catch { /* Use the legacy environment variable fallback. */ }
  }
  return "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "método não permitido" }, 405);

  const authorization = req.headers.get("Authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const publishableKey = keyFromEnv("SUPABASE_ANON_KEY", "SUPABASE_PUBLISHABLE_KEYS");
  const secretKey = keyFromEnv("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEYS");
  const mpToken = Deno.env.get("MP_ACCESS_TOKEN") || Deno.env.get("MERCADO_PAGO_ACCESS_TOKEN") || "";
  if (!supabaseUrl || !publishableKey || !secretKey || !mpToken) {
    return json({ error: "checkout indisponível: configure os segredos do servidor" }, 503);
  }
  if (!token) return json({ error: "sessão não autenticada" }, 401);

  const userClient = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const admin = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const { data: { user }, error: authError } = await userClient.auth.getUser(token);
    if (authError || !user) return json({ error: "sessão inválida" }, 401);
    const input = await req.json().catch(() => ({}));
    const plan = String(input.plan || "");
    const cycle = String(input.cycle || "");
    if (!["basico", "profissional", "premium"].includes(plan) || !["mensal", "anual"].includes(cycle)) {
      return json({ error: "plano ou ciclo inválido" }, 400);
    }

    const { data: profile, error: profileError } = await admin.from("profiles")
      .select("id,role,status").eq("id", user.id).maybeSingle();
    if (profileError || !profile) return json({ error: "perfil não encontrado" }, 403);
    if (profile.role === "master") return json({ error: "a conta master não precisa de checkout" }, 400);
    if (profile.status === "bloqueado") return json({ error: "conta bloqueada" }, 403);

    const { data: pricing, error: pricingError } = await admin.from("plan_limits")
      .select("plan,price_monthly,price_annual").eq("plan", plan).maybeSingle();
    if (pricingError || !pricing) return json({ error: "preço do plano indisponível" }, 503);
    const amount = Number(cycle === "anual" ? pricing.price_annual : pricing.price_monthly);
    if (!Number.isFinite(amount) || amount <= 0) return json({ error: "preço do plano não configurado" }, 409);

    const orderId = crypto.randomUUID();
    const { error: insertError } = await admin.from("payment_orders").insert({
      id: orderId, user_id: user.id, plan, cycle, amount, currency: "BRL", status: "pending",
    });
    if (insertError) throw new Error("não foi possível registrar o pedido");

    const publicUrl = (Deno.env.get("ENFAPP_PUBLIC_URL") || "https://enfapp.netlify.app").replace(/\/$/, "");
    const webhookUrl = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/mercadopago-webhook`;
    const backUrl = (result: string) => `${publicUrl}/?mp_order=${encodeURIComponent(orderId)}&mp_result=${result}`;
    const planName = plan === "basico" ? "Básico" : plan === "profissional" ? "Profissional" : "Premium";
    let preferenceResponse: Response;
    try {
      preferenceResponse = await fetch("https://api.mercadopago.com/checkout/preferences", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${mpToken}`,
          "Content-Type": "application/json",
          "X-Idempotency-Key": orderId,
        },
        body: JSON.stringify({
          items: [{
            id: `enfapp-${plan}-${cycle}`,
            title: `ENFapp · Plano ${planName} ${cycle}`,
            description: `Acesso ao plano ${planName} por ${cycle === "anual" ? "365" : "30"} dias`,
            quantity: 1,
            currency_id: "BRL",
            unit_price: amount,
          }],
          payer: user.email ? { email: user.email } : undefined,
          external_reference: orderId,
          notification_url: webhookUrl,
          back_urls: {
            success: backUrl("success"),
            pending: backUrl("pending"),
            failure: backUrl("failure"),
          },
          auto_return: "approved",
          metadata: { order_id: orderId, user_id: user.id, plan, cycle },
        }),
      });
    } catch (error) {
      await admin.from("payment_orders").update({ status: "rejected", status_detail: "preference_request_failed" }).eq("id", orderId);
      throw error;
    }
    const preference = await preferenceResponse.json().catch(() => ({}));
    if (!preferenceResponse.ok) {
      await admin.from("payment_orders").update({ status: "rejected", status_detail: "preference_creation_failed" }).eq("id", orderId);
      console.error("Mercado Pago preference error", preferenceResponse.status, preference);
      return json({ error: "não foi possível abrir o checkout do Mercado Pago" }, 502);
    }
    if (!preference.id) {
      await admin.from("payment_orders").update({ status: "rejected", status_detail: "preference_id_missing" }).eq("id", orderId);
      throw new Error("Mercado Pago não retornou o identificador do checkout");
    }

    const useSandbox = Deno.env.get("MP_ENVIRONMENT") === "sandbox";
    const checkoutUrl = String((useSandbox ? preference.sandbox_init_point : preference.init_point) || "");
    let host = "";
    try { host = new URL(checkoutUrl).hostname; } catch { /* Rejected below. */ }
    if (!checkoutUrl.startsWith("https://") || !(host === "mercadopago.com" || host.endsWith(".mercadopago.com") || host === "mercadopago.com.br" || host.endsWith(".mercadopago.com.br"))) {
      await admin.from("payment_orders").update({ status: "rejected", status_detail: "invalid_checkout_url" }).eq("id", orderId);
      throw new Error("URL de checkout inválida retornada pelo Mercado Pago");
    }
    const { error: updateError } = await admin.from("payment_orders")
      .update({ preference_id: String(preference.id || "") || null, updated_at: new Date().toISOString() })
      .eq("id", orderId);
    if (updateError) throw new Error("não foi possível salvar o checkout criado");

    return json({ order_id: orderId, checkout_url: checkoutUrl });
  } catch (error) {
    console.error("mercadopago-checkout", error);
    return json({ error: error instanceof Error ? error.message : "erro ao iniciar pagamento" }, 500);
  }
});
