// Reminder ladder, message texts (pt/en) and statutory late interest (Decreto-Lei 62/2013).
// Pure functions: no I/O, so they are unit-tested and shared by the UI, the scheduler and webhooks.
import type { Locale, Step } from "./types";

export const COMPENSATION_EUR = 40;

export function eur(n: number, locale: Locale = "pt") {
  return new Intl.NumberFormat(locale === "pt" ? "pt-PT" : "en-IE", { style: "currency", currency: "EUR" })
    .format(n)
    .replace(/ /g, " ");
}

export function formatDate(iso: string, locale: Locale = "pt") {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(locale === "pt" ? "pt-PT" : "en-GB", { timeZone: "UTC" });
}

/** Today's date (YYYY-MM-DD) in a time zone. */
export function todayIn(timeZone: string, now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Whole days from due date to today; negative before the due date. */
export function daysLate(dueDate: string, today: string) {
  return Math.round((Date.parse(today) - Date.parse(dueDate.slice(0, 10))) / 864e5);
}

export function lateInterest(amount: number, days: number, ratePct: number) {
  const d = Math.max(0, days);
  const interest = Math.round(amount * (ratePct / 100) * (d / 365) * 100) / 100;
  const compensation = d > 0 ? COMPENSATION_EUR : 0;
  return { interest, compensation, total: Math.round((interest + compensation) * 100) / 100 };
}

/** Which step of the ladder fits an invoice that is `days` late (manual sends: always a step). */
export function stepFor(days: number): Exclude<Step, "thanks"> {
  if (days < 0) return "pre";
  if (days <= 4) return "d1";
  if (days <= 10) return "d5";
  return "firm";
}

/**
 * Which step the scheduler should send today, or null. Friendly reminder 1–3 days before the
 * due date; nothing on the due date itself; then d1 (1–4 days late), d5 (5–10), firm (11+).
 */
export function autoStepFor(days: number): Exclude<Step, "thanks"> | null {
  if (days >= -3 && days <= -1) return "pre";
  if (days === 0 || days < -3) return null;
  return stepFor(days);
}

export const STEP_ORDER: Step[] = ["pre", "d1", "d5", "firm"];

/** Business hours check: Monday–Friday, 09:00–19:00 in the company's time zone. */
export function inSendWindow(timeZone: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short", hour: "2-digit", hour12: false }).formatToParts(now);
  const weekday = parts.find((p) => p.type === "weekday")?.value;
  const hour = Number(parts.find((p) => p.type === "hour")?.value);
  return weekday !== "Sat" && weekday !== "Sun" && hour >= 9 && hour < 19;
}

export type ComposeInput = {
  locale: Locale;
  step: Step;
  contactName: string;
  invoiceNumber: string;
  amount: number;
  dueDate: string;
  days: number;
  payUrl: string;
  senderName: string;
  mentionInterest: boolean;
  interestRate: number;
};

/** The reminder text, plus the values Twilio/Meta templates need, in a fixed order. */
export function composeMessage(i: ComposeInput) {
  const L = i.locale;
  const amount = eur(i.amount, L);
  const due = formatDate(i.dueDate, L);
  const n = i.invoiceNumber;
  let body: string;
  const pt = L === "pt";
  switch (i.step) {
    case "pre":
      body = pt
        ? `Bom dia ${i.contactName}, só um lembrete amigável: a fatura ${n} de ${amount} vence a ${due}. Pode pagar já aqui:`
        : `Hello ${i.contactName}, a friendly reminder: invoice ${n} for ${amount} is due on ${due}. You can pay here:`;
      break;
    case "d1":
      body = pt
        ? `Olá ${i.contactName}, bom dia! A fatura ${n} de ${amount} venceu a ${due}. Talvez tenha passado despercebida. Pode pagar em 1 minuto:`
        : `Hello ${i.contactName}! Invoice ${n} for ${amount} was due on ${due}. Perhaps it slipped through. You can pay in one minute:`;
      break;
    case "d5":
      body = pt
        ? `Olá ${i.contactName}, volto a lembrar a fatura ${n} (${amount}), vencida a ${due}. Consegue indicar-me uma data para o pagamento? Pode pagar aqui:`
        : `Hello ${i.contactName}, a second reminder about invoice ${n} (${amount}), due on ${due}. Could you let me know when it will be paid? You can pay here:`;
      break;
    case "firm": {
      const li = lateInterest(i.amount, i.days, i.interestRate);
      body = pt
        ? `Bom dia ${i.contactName}, a fatura ${n} de ${amount} está vencida desde ${due} (${i.days} dias).`
        : `Hello ${i.contactName}, invoice ${n} for ${amount} has been overdue since ${due} (${i.days} days).`;
      if (i.mentionInterest) {
        body += pt
          ? ` Nos termos do Decreto-Lei n.º 62/2013, o atraso dá lugar a juros de mora (neste momento ${eur(li.interest, L)}) e a uma indemnização de ${eur(COMPENSATION_EUR, L)}. Preferimos resolver de forma simples:`
          : ` Under Portuguese Decree-Law 62/2013, late payment accrues statutory interest (currently ${eur(li.interest, L)}) and a ${eur(COMPENSATION_EUR, L)} compensation. We'd rather settle this simply:`;
      } else {
        body += pt ? " Agradecemos a regularização. Pode pagar aqui:" : " Please settle it here:";
      }
      break;
    }
    case "thanks":
      body = pt
        ? `Pagamento da fatura ${n} (${amount}) recebido. Muito obrigado!`
        : `Payment for invoice ${n} (${amount}) received. Thank you!`;
      break;
  }
  const payLine = i.step === "thanks" ? "" : `\n\n${pt ? "Pagar com MB WAY ou Multibanco" : "Pay with MB WAY or Multibanco"}: ${i.payUrl}`;
  const text = `${body}${payLine}\n\n${pt ? "Obrigado!" : "Thank you!"}\n${i.senderName}`;
  const subject = i.step === "thanks"
    ? (pt ? `Pagamento recebido · fatura ${n}` : `Payment received · invoice ${n}`)
    : (pt ? `Fatura ${n} · ${i.senderName}` : `Invoice ${n} · ${i.senderName}`);
  // {1}..{6}: name, invoice, amount, due date, pay link, sender
  const params = [i.contactName, n, amount, due, i.payUrl, i.senderName];
  return { text, subject, params };
}

/** Portuguese mobile/landline to E.164 digits (no '+'); returns null if it doesn't look valid. */
export function normalizePhone(raw: string | null | undefined, defaultCountry = "351") {
  if (!raw) return null;
  let d = raw.replace(/[^\d+]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  else if (d.startsWith("00")) d = d.slice(2);
  else if (d.length === 9) d = defaultCountry + d;
  return /^\d{10,15}$/.test(d) ? d : null;
}
