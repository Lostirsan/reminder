// WhatsApp through Twilio, free trial, no business verification.
//
// Two kinds of Twilio trial exist:
//  - Old "WhatsApp Sandbox": the recipient sends "join <code>" to the sandbox number,
//    then free text (Body) works for 24 h. Docs: https://www.twilio.com/docs/whatsapp/sandbox
//  - New "Try out WhatsApp" (most accounts created since 2025): free text is NOT allowed,
//    only Twilio's pre-approved templates, sent with a ContentSid (HX...). Find it in
//    Console → Try it out → Communications → Send a WhatsApp message (the code sample shows
//    ContentSid). Docs: https://www.twilio.com/docs/usage/trials/try-out-whatsapp
//
// If TWILIO_CONTENT_SID is set we send that template; otherwise free text.
// Optional TWILIO_CONTENT_VARIABLES, e.g. {"1":"{due}","2":"{invoice}"}: placeholders
// {name} {invoice} {amount} {due} {link} {reference} are filled from the invoice.
// The trial only accepts variables the template expects; leave it empty to send as is.
import { config } from "./config.js";

const KEYS = ["name", "invoice", "amount", "due", "link", "reference"];

function fillVariables(template, params = []) {
  const values = Object.fromEntries(KEYS.map((k, i) => [k, String(params[i] ?? "")]));
  const vars = JSON.parse(template);
  for (const k of Object.keys(vars)) vars[k] = String(vars[k]).replace(/\{(\w+)\}/g, (m, key) => (key in values ? values[key] : m));
  return JSON.stringify(vars);
}

export async function sendText(text, params) {
  const { accountSid, authToken, from, contentSid, contentVariables } = config.twilio;
  const form = { From: `whatsapp:${from}`, To: `whatsapp:+${config.wa.recipient}` };
  if (contentSid) {
    form.ContentSid = contentSid;
    if (contentVariables) form.ContentVariables = fillVariables(contentVariables, params);
  } else {
    form.Body = text;
  }
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${accountSid}:${authToken}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(form),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.message || String(res.status);
    let hint = "";
    if (/ContentSid/i.test(msg)) hint = " (This Twilio trial only sends Twilio templates: copy the ContentSid HX... from Console → Send a WhatsApp message into TWILIO_CONTENT_SID.)";
    else if (data.code === 63015 || /sandbox/i.test(msg)) hint = " (Send 'join <code>' from your phone to the sandbox number first.)";
    else if (data.code === 21608 || /unverified/i.test(msg)) hint = " (Trial accounts can only message verified numbers: verify WA_TEST_RECIPIENT in the Twilio Console.)";
    throw new Error(`Twilio send failed: ${msg}${hint}`);
  }
  return contentSid ? `${data.sid} (modelo Twilio ${contentSid})` : data.sid;
}
