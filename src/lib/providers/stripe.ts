// Stripe Checkout (hosted page in Portuguese with MB WAY and Multibanco). Plain fetch, no SDK,
// so it runs on Cloudflare Workers. Test keys work without a registered company.
import { hmac, safeEqual, toHex } from "../crypto";

const BASE = "https://api.stripe.com/v1";
const VERSION = "2025-10-29.clover";

export const stripeConfigured = () => Boolean(process.env.STRIPE_SECRET_KEY);

async function call<T>(path: string, method = "GET", form?: Record<string, string>): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Stripe-Version": VERSION,
    },
    body: form ? new URLSearchParams(form) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Stripe ${method} ${path}: ${data.error?.message || res.status}`);
  return data as T;
}

type Session = { id: string; url: string; payment_status: string; status: string; metadata?: Record<string, string> };

export async function createCheckout(p: {
  invoiceId: string;
  organizationId: string;
  amount: number;
  title: string;
  locale: "pt" | "en";
  successUrl: string;
  cancelUrl: string;
}) {
  const make = (methods: string[]) =>
    call<Session>("/checkout/sessions", "POST", {
      mode: "payment",
      ...Object.fromEntries(methods.map((m, i) => [`payment_method_types[${i}]`, m])),
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": "eur",
      "line_items[0][price_data][unit_amount]": String(Math.round(p.amount * 100)),
      "line_items[0][price_data][product_data][name]": p.title,
      locale: p.locale,
      client_reference_id: p.invoiceId,
      "metadata[invoice_id]": p.invoiceId,
      "metadata[organization_id]": p.organizationId,
      "payment_intent_data[metadata][invoice_id]": p.invoiceId,
      success_url: p.successUrl,
      cancel_url: p.cancelUrl,
    });
  // MB WAY must be enabled in the Stripe dashboard; fall back to Multibanco (then card) if not.
  for (const methods of [["mb_way", "multibanco"], ["multibanco"], ["card"]]) {
    try {
      const s = await make(methods);
      return { id: s.id, url: s.url };
    } catch (e) {
      if (!/payment method type|mb_way|multibanco/i.test((e as Error).message)) throw e;
    }
  }
  throw new Error("Stripe: no payment method available");
}

export type StripeEvent = { id: string; type: string; data: { object: Session & { amount_total?: number } } };

/** Verifies the Stripe-Signature header (t=...,v1=...) and returns the parsed event. */
export async function verifyWebhook(payload: string, header: string | null, secret: string, toleranceSec = 300, now = Date.now()) {
  if (!header) throw new Error("missing signature");
  const parts = Object.fromEntries(header.split(",").map((kv) => kv.split("=") as [string, string]).filter((p) => p.length === 2 && p[0] !== "v1"));
  const sigs = header.split(",").filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  const t = Number(parts.t);
  if (!t || !sigs.length) throw new Error("bad signature header");
  if (Math.abs(now / 1000 - t) > toleranceSec) throw new Error("signature too old");
  const expected = toHex(await hmac("SHA-256", secret, `${t}.${payload}`));
  if (!sigs.some((s) => safeEqual(s, expected))) throw new Error("signature mismatch");
  return JSON.parse(payload) as StripeEvent;
}
