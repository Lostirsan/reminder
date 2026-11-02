// Stripe Checkout in TEST mode (sandbox). Works without a registered company:
// test keys are available right after signing up. The customer gets a Stripe-hosted
// payment page in Portuguese with MB WAY and Multibanco.
// Docs: https://docs.stripe.com/payments/mb-way/accept-a-payment?payment-ui=checkout
//       https://docs.stripe.com/payments/multibanco/accept-a-payment?payment-ui=checkout
import { config } from "./config.js";

const BASE = "https://api.stripe.com/v1";

async function call(path, method = "GET", form) {
  if (!config.stripe.secretKey.startsWith("sk_test_") && !config.stripe.secretKey.startsWith("rk_test_")) {
    throw new Error("Stripe: use a TEST secret key (sk_test_...). Live keys are refused by this prototype.");
  }
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.stripe.secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Stripe-Version": "2025-10-29.clover",
    },
    body: form ? new URLSearchParams(form) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Stripe ${method} ${path} failed: ${data.error?.message || res.status}`);
  return data;
}

// Tries MB WAY + Multibanco; if MB WAY is not enabled on the account, falls back to Multibanco only.
export async function createPaymentLink(inv) {
  try {
    return await createSession(inv, ["mb_way", "multibanco"]);
  } catch (e) {
    if (!/mb_way/i.test(e.message)) throw e;
    return createSession(inv, ["multibanco"]);
  }
}

async function createSession(inv, methods) {
  const types = Object.fromEntries(methods.map((m, i) => [`payment_method_types[${i}]`, m]));
  const s = await call("/checkout/sessions", "POST", {
    mode: "payment",
    ...types,
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "eur",
    "line_items[0][price_data][unit_amount]": String(Math.round(inv.amount * 100)),
    "line_items[0][price_data][product_data][name]": `Fatura ${inv.number} · ${inv.client}`,
    locale: "pt",
    client_reference_id: inv.id,
    success_url: "https://example.com/pago",
  });
  return { paymentId: s.id, url: s.url };
}

// "paid" once MB WAY is approved or the Multibanco voucher is paid; otherwise Stripe's status.
export async function paymentStatus(paymentId) {
  const s = await call(`/checkout/sessions/${paymentId}`);
  return s.payment_status === "paid" ? "paid" : s.status === "expired" ? "failed" : "pending";
}
