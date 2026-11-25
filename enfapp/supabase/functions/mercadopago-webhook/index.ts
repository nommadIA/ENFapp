import { createClient } from "npm:@supabase/supabase-js@2";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
});

function secretKey(): string {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  try { return JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}").default || ""; } catch { return ""; }
}

function parseSignature(header: string) {
  const fields: Record<string, string> = {};
  for (const item of header.split(",")) {
    const [key, ...value] = item.trim().split("=");
    if (key && value.length) fields[key] = value.join("=");
  }
  return fields;
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

async function validSignature(secret: string, signature: string, requestId: string, dataId: string): Promise<boolean> {
  const fields = parseSignature(signature);
  if (!fields.ts || !fields.v1 || !requestId || !dataId) return false;
  const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${fields.ts};`;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(manifest)));
  return safeEqual(digest, fields.v1.toLowerCase());
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "método não permitido" }, 405);
  const url = Deno.env.get("SUPABASE_URL") || "";
  const key = secretKey();
  const mpToken = Deno.env.get("MP_ACCESS_TOKEN") || Deno.env.get("MERCADO_PAGO_ACCESS_TOKEN") || "";
  const webhookSecret = Deno.env.get("MP_WEBHOOK_SECRET") || Deno.env.get("MERCADO_PAGO_WEBHOOK_SECRET") || "";
  if (!url || !key || !mpToken || !webhookSecret) return json({ error: "webhook não configurado" }, 503);

  try {
    const payload = await req.json().catch(() => ({}));
    const eventType = String(payload.type || payload.topic || "").toLowerCase();
    if (eventType && eventType !== "payment" && !eventType.startsWith("payment.")) return json({ received: true, ignored: true });
    const queryId = new URL(req.url).searchParams.get("data.id") || "";
    const bodyId = String(payload.data?.id || "");
    if (queryId && bodyId && queryId.toLowerCase() !== bodyId.toLowerCase()) return json({ error: "id de notificação divergente" }, 400);
    const paymentId = queryId || bodyId;
    const signature = req.headers.get("x-signature") || "";
    const requestId = req.headers.get("x-request-id") || "";
    if (!await validSignature(webhookSecret, signature, requestId, paymentId)) return json({ error: "assinatura inválida" }, 401);

    const paymentResponse = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, {
      headers: { Authorization: `Bearer ${mpToken}` },
    });
    const payment = await paymentResponse.json().catch(() => ({}));
    if (!paymentResponse.ok) {
      console.error("Mercado Pago payment lookup failed", paymentResponse.status, payment);
      return json({ error: "não foi possível consultar o pagamento" }, 502);
    }
    const orderId = String(payment.external_reference || "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(orderId)) {
      console.error("Mercado Pago payment without a valid ENFapp order", paymentId);
      return json({ received: true, ignored: true });
    }

    const rawStatus = String(payment.status || "");
    const status = rawStatus === "in_mediation" ? "in_process" : rawStatus === "authorized" ? "pending" : rawStatus;
    const allowed = ["approved", "pending", "in_process", "rejected", "cancelled", "refunded", "charged_back"];
    if (!allowed.includes(status)) return json({ received: true, ignored: true });
    const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error } = await supabase.rpc("apply_mercadopago_payment", {
      p_order_id: orderId,
      p_payment_id: String(payment.id || paymentId),
      p_payment_status: status,
      p_amount: Number(payment.transaction_amount),
      p_currency: String(payment.currency_id || ""),
      p_status_detail: String(payment.status_detail || "") || null,
    });
    if (error) {
      console.error("apply_mercadopago_payment failed", error.message);
      return json({ error: "não foi possível atualizar o pedido" }, 500);
    }
    return json({ received: true });
  } catch (error) {
    console.error("mercadopago-webhook", error);
    return json({ error: "erro ao processar notificação" }, 500);
  }
});
