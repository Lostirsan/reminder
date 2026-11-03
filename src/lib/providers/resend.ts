// Email through Resend (free: 3,000/month). Without a verified domain Resend only delivers
// from onboarding@resend.dev to the account's own address: set EMAIL_TEST_RECIPIENT until then.
export const resendConfigured = () => Boolean(process.env.RESEND_API_KEY);

export async function sendEmail(to: string, subject: string, text: string, replyTo?: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM || "Pago a Tempo <onboarding@resend.dev>",
      to: [to],
      subject,
      text,
      ...(replyTo ? { reply_to: replyTo } : {}),
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Resend: ${data.message || res.status}`);
  return data.id as string;
}
