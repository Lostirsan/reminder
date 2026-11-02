// Reminder ladder, Portuguese message texts and late-interest maths (DL 62/2013).
import { config } from "./config.js";

const eur = (n) => new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(n).replace(/ /g, " ");
const ptDate = (iso) => new Date(iso).toLocaleDateString("pt-PT");

export function lateInterest(amount, daysLate, ratePct = config.lateRate) {
  const days = Math.max(0, daysLate);
  const interest = Math.round(amount * (ratePct / 100) * (days / 365) * 100) / 100;
  const compensation = days > 0 ? 40 : 0;
  return { interest, compensation, total: Math.round((interest + compensation) * 100) / 100 };
}

export function step(daysLate) {
  if (daysLate < 0) return { key: "pre", label: "Lembrete amigável (antes do vencimento)" };
  if (daysLate <= 5) return { key: "d1", label: "Talvez se tenha esquecido" };
  if (daysLate <= 10) return { key: "d5", label: "Pedido de data de pagamento" };
  return { key: "firm", label: "Aviso firme com juros de mora" };
}

export function composeMessage(inv, pay, { withInterest = true } = {}) {
  const name = inv.contact || inv.client;
  const s = step(inv.daysLate);
  const payLines = [
    pay?.entity && pay?.reference ? `Multibanco: Entidade ${pay.entity} · Referência ${String(pay.reference).replace(/(\d{3})(?=\d)/g, "$1 ")} · ${eur(inv.amount)}` : null,
    "MB WAY: enviamos o pedido para o seu telemóvel, basta aceitar na app.",
  ].filter(Boolean).join("\n");
  let body;
  if (s.key === "pre") {
    body = `Bom dia ${name}, só um lembrete amigável: a fatura ${inv.number} de ${eur(inv.amount)} vence a ${ptDate(inv.dueDate)}.`;
  } else if (s.key === "d1") {
    body = `Olá ${name}, bom dia! A fatura ${inv.number} de ${eur(inv.amount)} venceu a ${ptDate(inv.dueDate)}. Talvez tenha passado despercebida. Pode pagar em 1 minuto:`;
  } else if (s.key === "d5") {
    body = `Olá ${name}, volto a lembrar a fatura ${inv.number} (${eur(inv.amount)}), vencida a ${ptDate(inv.dueDate)}. Consegue indicar-me uma data para o pagamento? Pode pagar aqui:`;
  } else {
    const li = lateInterest(inv.amount, inv.daysLate);
    body = `Bom dia ${name}, a fatura ${inv.number} de ${eur(inv.amount)} está vencida desde ${ptDate(inv.dueDate)} (${inv.daysLate} dias).`;
    if (withInterest) body += ` Nos termos do Decreto-Lei n.º 62/2013, o atraso dá lugar a juros de mora (neste momento ${eur(li.interest)}) e a uma indemnização de 40 €. Preferimos resolver de forma simples:`;
    else body += " Agradecemos a regularização. Pode pagar aqui:";
  }
  const text = `${body}\n\n${payLines}\n\nObrigado!\n${config.businessName}\n\n[PROTÓTIPO · dados de teste]`;
  const params = [name, inv.number, eur(inv.amount), ptDate(inv.dueDate), pay?.entity || "-", pay?.reference || "-"];
  return { step: s, text, params };
}
