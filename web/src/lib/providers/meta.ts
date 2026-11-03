// WhatsApp Cloud API (Meta). Needs a verified business for real customers; kept for later.
export const metaConfigured = () => Boolean(process.env.WA_PHONE_NUMBER_ID && process.env.WA_ACCESS_TOKEN);

export async function sendWhatsApp(to: string, text: string, params: string[]) {
  const template = process.env.WA_TEMPLATE_NAME;
  const payload = template
    ? {
        type: "template",
        template: {
          name: template,
          language: { code: process.env.WA_TEMPLATE_LANG || "pt_PT" },
          components: [{ type: "body", parameters: params.map((p) => ({ type: "text", text: p })) }],
        },
      }
    : { type: "text", text: { body: text, preview_url: true } };
  const res = await fetch(`https://graph.facebook.com/v21.0/${process.env.WA_PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.WA_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, ...payload }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`WhatsApp (Meta): ${data.error?.message || res.status}`);
  return data.messages?.[0]?.id as string;
}
