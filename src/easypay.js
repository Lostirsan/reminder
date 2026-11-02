// easypay API 2.0, TEST environment only (https://docs.easypay.pt).
// Creates a Multibanco reference and an MB WAY request for an invoice and checks payment status.
import { config } from "./config.js";

const BASE = "https://api.test.easypay.pt/2.0";

async function call(path, method = "GET", body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      AccountId: config.easypay.accountId,
      ApiKey: config.easypay.apiKey,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.status === "error") {
    throw new Error(`easypay ${method} ${path} failed: ${JSON.stringify(data.message || data).slice(0, 300)}`);
  }
  return data;
}

// Multibanco reference: printed in the WhatsApp message, payable at any ATM / homebanking.
export async function createMultibanco(inv) {
  const d = await call("/single", "POST", {
    type: "sale",
    key: inv.id,
    value: inv.amount,
    method: "mb",
    customer: { name: inv.client, key: inv.id },
  });
  return { paymentId: d.id, entity: d.method?.entity, reference: d.method?.reference };
}

// MB WAY request: pushes a payment request to the customer's MB WAY app.
// In the sandbox, 911234567 authorises automatically and 917654321 fails.
export async function createMbway(inv) {
  const d = await call("/single", "POST", {
    type: "sale",
    key: inv.id,
    value: inv.amount,
    method: "mbw",
    customer: { name: inv.client, key: inv.id, phone: config.easypay.mbwayPhone, phone_indicative: "+351" },
  });
  return { paymentId: d.id };
}

// Returns "paid" | "pending" | "failed" | other easypay status.
export async function paymentStatus(paymentId) {
  const d = await call(`/single/${paymentId}`);
  return d.payment_status || d.status || "unknown";
}
