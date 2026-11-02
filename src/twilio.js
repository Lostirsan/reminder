// Twilio WhatsApp Sandbox: free trial, no business verification.
// The recipient first sends "join <code>" to the sandbox number; then free text works for 24 h.
// Docs: https://www.twilio.com/docs/whatsapp/sandbox
import { config } from "./config.js";

export async function sendText(text) {
  const { accountSid, authToken, from } = config.twilio;
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${accountSid}:${authToken}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ From: `whatsapp:${from}`, To: `whatsapp:+${config.wa.recipient}`, Body: text }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const hint = data.code === 63015 || /sandbox/i.test(data.message || "") ? " (Send 'join <code>' from your phone to the sandbox number first.)" : "";
    throw new Error(`Twilio send failed: ${data.message || res.status}${hint}`);
  }
  return data.sid;
}
