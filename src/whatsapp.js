// WhatsApp Cloud API (Meta). With the free test number, messages can go only to
// up to 5 allowlisted numbers, so every message is sent to WA_TEST_RECIPIENT.
import { config } from "./config.js";

const GRAPH = "https://graph.facebook.com/v21.0";

async function post(payload) {
  const res = await fetch(`${GRAPH}/${config.wa.phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.wa.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to: config.wa.recipient, ...payload }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = data.error || {};
    let hint = "";
    if (err.code === 131047 || /24 hours|re-engagement/i.test(err.message || "")) {
      hint = " (Free text works only within 24 h after the recipient writes to the test number. Send 'Olá' to the test number from your phone, or set WA_TEMPLATE_NAME.)";
    }
    if (err.code === 190) hint = " (Access token expired: generate a new one in the Meta app dashboard.)";
    throw new Error(`WhatsApp send failed: ${err.message || res.status}${hint}`);
  }
  return data.messages?.[0]?.id;
}

export async function sendReminder(text, params) {
  if (config.wa.template) {
    // Approved template with body variables {{1}}..{{n}} in this order:
    // contact name, invoice number, amount, due date, Multibanco entity, reference.
    return post({
      type: "template",
      template: {
        name: config.wa.template,
        language: { code: config.wa.templateLang },
        components: [{ type: "body", parameters: params.map((p) => ({ type: "text", text: String(p) })) }],
      },
    });
  }
  return post({ type: "text", text: { body: text, preview_url: /https?:\/\//.test(text) } });
}
