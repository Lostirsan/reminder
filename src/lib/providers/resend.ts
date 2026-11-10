// Email through Resend (free: 3,000/month, 100/day). Without a verified domain Resend only delivers
// from onboarding@resend.dev to the account's own address: keep EMAIL_TEST_RECIPIENT set until then.
import { safeEqual, toBase64 } from "../crypto";

export const resendConfigured = () => Boolean(process.env.RESEND_API_KEY);

/** True while EMAIL_FROM is still Resend's shared test sender (no own domain yet). */
export const resendSandbox = () => !process.env.EMAIL_FROM || /@resend\.dev>?\s*$/i.test(process.env.EMAIL_FROM);

export type OutgoingEmail = {
  from: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string | null;
  /** Same key → Resend sends at most once (24 h), so a retried tick can't double-send. */
  idempotencyKey?: string;
  tags?: Record<string, string>;
};

export async function sendEmail(e: OutgoingEmail) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      ...(e.idempotencyKey ? { "Idempotency-Key": e.idempotencyKey } : {}),
    },
    body: JSON.stringify({
      from: e.from,
      to: [e.to],
      subject: e.subject,
      text: e.text,
      ...(e.html ? { html: e.html } : {}),
      ...(e.replyTo ? { reply_to: e.replyTo } : {}),
      ...(e.tags ? { tags: Object.entries(e.tags).map(([name, value]) => ({ name, value: value.replace(/[^\w-]/g, "_") })) } : {}),
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Resend: ${data.message || res.status}`);
  return data.id as string;
}

/**
 * Verifies a Resend webhook (Svix scheme): HMAC-SHA256 over "id.timestamp.body" with the
 * base64 key after "whsec_"; the header holds space-separated "v1,<base64>" signatures.
 */
export async function verifyWebhook(
  body: string,
  h: { id: string | null; timestamp: string | null; signature: string | null },
  secret = process.env.RESEND_WEBHOOK_SECRET || "",
  toleranceSec = 300,
  now = Date.now(),
) {
  if (!secret || !h.id || !h.timestamp || !h.signature) return false;
  const ts = Number(h.timestamp);
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > toleranceSec) return false;
  const raw = Uint8Array.from(atob(secret.replace(/^whsec_/, "")), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = toBase64(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${h.id}.${h.timestamp}.${body}`))));
  return h.signature.split(" ").some((s) => {
    const [v, sig] = s.split(",");
    return v === "v1" && !!sig && safeEqual(sig, mac);
  });
}

/** Resend event type → our message status (null: ignore). */
export function mapEvent(type: string) {
  switch (type) {
    case "email.delivered": return "delivered" as const;
    case "email.opened": return "read" as const;
    case "email.bounced":
    case "email.complained":
    case "email.failed": return "failed" as const;
    default: return null;
  }
}
