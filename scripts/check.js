// Checks which services are configured and tries a harmless read on each live one.
import { live, config } from "../src/config.js";

console.log("Configured:", live);
if (live.moloni) {
  const { listOpenInvoices } = await import("../src/moloni.js");
  try { const inv = await listOpenInvoices(); console.log(`Moloni OK: ${inv.length} open invoices`); }
  catch (e) { console.log("Moloni ERROR:", e.message); }
}
if (live.easypay) {
  try {
    const res = await fetch("https://api.test.easypay.pt/2.0/single?limit=1", { headers: { AccountId: config.easypay.accountId, ApiKey: config.easypay.apiKey } });
    console.log(`easypay sandbox: HTTP ${res.status}${res.ok ? " OK" : ""}`);
  } catch (e) { console.log("easypay ERROR:", e.message); }
}
if (live.wa) {
  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${config.wa.phoneNumberId}`, { headers: { Authorization: `Bearer ${config.wa.token}` } });
    const d = await res.json();
    console.log(res.ok ? `WhatsApp OK: test number ${d.display_phone_number || ""}` : `WhatsApp ERROR: ${d.error?.message}`);
  } catch (e) { console.log("WhatsApp ERROR:", e.message); }
}
