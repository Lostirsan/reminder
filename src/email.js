// Email reminders via Resend (free tier, no company). Without a verified domain Resend
// only delivers from onboarding@resend.dev to the account's own email, which is fine for a demo.
// Docs: https://resend.com/docs/api-reference/emails/send-email
import { config } from "./config.js";

export async function sendEmail(subject, text) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${config.email.resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: config.email.from, to: [config.email.to], subject, text }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Email send failed: ${data.message || res.status}`);
  return data.id;
}
