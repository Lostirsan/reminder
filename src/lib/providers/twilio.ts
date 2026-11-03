// WhatsApp through Twilio. Works on a trial without a registered company, but the new
// "Try out WhatsApp" trial only sends Twilio templates (TWILIO_CONTENT_SID, HX...);
// free text needs a paid account or the old sandbox.
import { hmac, safeEqual, toBase64 } from "../crypto";

export const twilioConfigured = () => Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);

const KEYS = ["name", "invoice", "amount", "due", "link", "sender"];

/** Fills {name} {invoice} {amount} {due} {link} {sender} in TWILIO_CONTENT_VARIABLES. */
export function fillVariables(template: string, params: string[]) {
  const values = Object.fromEntries(KEYS.map((k, i) => [k, String(params[i] ?? "")]));
  const vars = JSON.parse(template) as Record<string, string>;
  for (const k of Object.keys(vars)) vars[k] = String(vars[k]).replace(/\{(\w+)\}/g, (m, key) => (key in values ? values[key] : m));
  return JSON.stringify(vars);
}

export async function sendWhatsApp(to: string, text: string, params: string[], statusCallback?: string) {
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const token = process.env.TWILIO_AUTH_TOKEN!;
  const from = process.env.TWILIO_WHATSAPP_FROM || "+14155238886";
  const contentSid = process.env.TWILIO_CONTENT_SID;
  const form: Record<string, string> = { From: `whatsapp:${from}`, To: `whatsapp:+${to}` };
  if (contentSid) {
    form.ContentSid = contentSid;
    if (process.env.TWILIO_CONTENT_VARIABLES) form.ContentVariables = fillVariables(process.env.TWILIO_CONTENT_VARIABLES, params);
  } else form.Body = text;
  if (statusCallback) form.StatusCallback = statusCallback;
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: { Authorization: "Basic " + btoa(`${sid}:${token}`), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg: string = data.message || String(res.status);
    let hint = "";
    if (/ContentSid/i.test(msg)) hint = " (this Twilio trial only sends templates: set TWILIO_CONTENT_SID)";
    else if (data.code === 63015) hint = " (send 'join <code>' to the sandbox number first)";
    else if (data.code === 21608) hint = " (trial accounts can only message verified numbers)";
    throw new Error(`Twilio: ${msg}${hint}`);
  }
  return data.sid as string;
}

/** X-Twilio-Signature: base64(HMAC-SHA1(url + sorted key+value pairs)). */
export async function verifySignature(url: string, params: Record<string, string>, signature: string | null, token = process.env.TWILIO_AUTH_TOKEN || "") {
  if (!signature || !token) return false;
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  return safeEqual(toBase64(await hmac("SHA-1", token, data)), signature);
}

export function mapStatus(s: string) {
  if (s === "delivered") return "delivered";
  if (s === "read") return "read";
  if (s === "failed" || s === "undelivered") return "failed";
  if (s === "sent") return "sent";
  return null;
}
