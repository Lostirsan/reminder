// Pago a Tempo prototype server. Run: node server.js  →  http://localhost:3000
// Each service runs live when its credentials are in .env, otherwise it uses mock data.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { config, live } from "./src/config.js";
import { mockInvoices, mockMultibanco } from "./src/mock.js";
import { composeMessage, lateInterest } from "./src/reminders.js";

const moloni = live.moloni ? await import("./src/moloni.js") : null;
// Payments: Stripe test mode if configured (no company needed), else easypay sandbox, else mock.
const stripe = live.stripe ? await import("./src/stripe.js") : null;
const easypay = !stripe && live.easypay ? await import("./src/easypay.js") : null;
const payments = stripe || easypay;
const whatsapp = live.wa ? await import("./src/whatsapp.js") : null;

// In-memory state: invoices plus what we did with each one.
let invoices = [];
const state = new Map(); // id -> { status, mb, mbway, log: [] }

function st(id) {
  if (!state.has(id)) state.set(id, { status: "open", mb: null, mbway: null, log: [] });
  return state.get(id);
}
const log = (id, kind, text) => st(id).log.unshift({ at: new Date().toISOString(), kind, text });

async function loadInvoices() {
  invoices = moloni ? await moloni.listOpenInvoices() : mockInvoices();
}

function view(inv) {
  const s = st(inv.id);
  return { ...inv, ...lateInterestView(inv), status: s.status, mb: s.mb, mbway: s.mbway, log: s.log };
}
function lateInterestView(inv) {
  const li = lateInterest(inv.amount, inv.daysLate);
  return { interest: li.interest, compensation: li.compensation };
}

async function remind(inv, withInterest) {
  const s = st(inv.id);
  if (!s.mb) {
    if (stripe) {
      s.mb = await stripe.createPaymentLink(inv);
      log(inv.id, "payment", `Link de pagamento Stripe (teste) criado: ${s.mb.url}`);
    } else {
      s.mb = easypay ? await easypay.createMultibanco(inv) : mockMultibanco();
      log(inv.id, "payment", `Referência Multibanco criada: ${s.mb.entity} / ${s.mb.reference}${easypay ? " (easypay sandbox)" : " (mock)"}`);
    }
  }
  const msg = composeMessage(inv, s.mb, { withInterest });
  if (whatsapp) {
    const id = await whatsapp.sendReminder(msg.text, msg.params);
    log(inv.id, "whatsapp", `WhatsApp enviado (${msg.step.label}) para +${config.wa.recipient}, id ${id}`);
  } else {
    log(inv.id, "whatsapp", `WhatsApp simulado (${msg.step.label})`);
  }
  if (s.status === "open") s.status = "reminded";
  return msg;
}

async function mbway(inv) {
  const s = st(inv.id);
  if (stripe) {
    log(inv.id, "payment", "Com Stripe o cliente escolhe MB WAY na página de pagamento (teste: qualquer número, ex. +351911111112).");
    return;
  }
  if (!easypay) {
    s.mbway = { paymentId: "mock-mbway" };
    log(inv.id, "payment", "Pedido MB WAY simulado");
    return;
  }
  s.mbway = await easypay.createMbway(inv);
  log(inv.id, "payment", `Pedido MB WAY enviado para ${config.easypay.mbwayPhone} (easypay sandbox)`);
}

async function check(inv) {
  const s = st(inv.id);
  if (s.status === "paid" || !payments) return s.status;
  for (const p of [s.mbway, s.mb]) {
    if (!p?.paymentId) continue;
    const status = await payments.paymentStatus(p.paymentId);
    if (status === "paid") {
      s.status = "paid";
      log(inv.id, "paid", stripe ? "Pagamento confirmado pela Stripe (teste)" : `Pagamento confirmado pela easypay (${p === s.mbway ? "MB WAY" : "Multibanco"})`);
      if (whatsapp) {
        try { await whatsapp.sendReminder(`Pagamento da fatura ${inv.number} recebido. Obrigado!\n${config.businessName}`, [inv.contact || inv.client, inv.number, "", "", "", ""]); } catch { /* thank-you is optional */ }
      }
      break;
    }
  }
  return s.status;
}

const json = (res, code, data) => { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(data)); };

async function body(req) {
  let s = ""; for await (const c of req) s += c;
  try { return s ? JSON.parse(s) : {}; } catch { return {}; }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  try {
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(await readFile(join(config.root, "public", "index.html")));
    }
    if (url.pathname === "/api/status") {
      return json(res, 200, { live, payments: stripe ? "stripe" : easypay ? "easypay" : "mock", business: config.businessName, rate: config.lateRate, recipient: live.wa ? `+${config.wa.recipient}` : null, mbwayPhone: config.easypay.mbwayPhone });
    }
    if (url.pathname === "/api/invoices" && req.method === "GET") {
      if (url.searchParams.get("refresh") === "1" || !invoices.length) await loadInvoices();
      return json(res, 200, invoices.map(view));
    }
    const m = url.pathname.match(/^\/api\/invoices\/([^/]+)\/(remind|mbway|check|mock-pay|preview)$/);
    if (m) {
      const inv = invoices.find((i) => i.id === decodeURIComponent(m[1]));
      if (!inv) return json(res, 404, { error: "Invoice not found. Refresh the list." });
      const action = m[2];
      if (action === "preview") return json(res, 200, composeMessage(inv, st(inv.id).mb || { entity: "·····", reference: "·········" }, { withInterest: url.searchParams.get("interest") !== "0" }));
      if (action === "remind") { const b = await body(req); const msg = await remind(inv, b.withInterest !== false); return json(res, 200, { ok: true, message: msg.text, invoice: view(inv) }); }
      if (action === "mbway") { await mbway(inv); return json(res, 200, { ok: true, invoice: view(inv) }); }
      if (action === "check") { await check(inv); return json(res, 200, { ok: true, invoice: view(inv) }); }
      if (action === "mock-pay") {
        if (payments) return json(res, 400, { error: "Payments are live in test mode: pay through the payment link or the sandbox instead." });
        st(inv.id).status = "paid"; log(inv.id, "paid", "Pagamento simulado (mock)");
        return json(res, 200, { ok: true, invoice: view(inv) });
      }
    }
    json(res, 404, { error: "Not found" });
  } catch (e) {
    console.error(e);
    json(res, 500, { error: e.message });
  }
});

server.listen(config.port, () => {
  console.log(`Pago a Tempo prototype on http://localhost:${config.port}`);
  console.log(`Live services: Moloni=${live.moloni} WhatsApp=${live.wa} payments=${stripe ? "stripe" : easypay ? "easypay" : "mock"} (others use mock data)`);
});
