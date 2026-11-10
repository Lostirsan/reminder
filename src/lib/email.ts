// HTML version of a reminder email. Built from the same plain text the WhatsApp message uses, so
// there is one source of truth for the wording; the pay link becomes a button. Pure: unit-tested.
import type { Locale, Step } from "./types";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export type EmailInput = {
  text: string;
  payUrl: string;
  step: Step;
  locale: Locale;
  senderName: string;
  /** Where replies go (the supplier), shown in the footer. */
  replyTo?: string | null;
};

/** "Name <addr>" display-name form, with characters that would break the header removed. */
export function fromHeader(senderName: string, configured = process.env.EMAIL_FROM || "Pago a Tempo <onboarding@resend.dev>") {
  const addr = configured.match(/<([^>]+)>/)?.[1] ?? configured.trim();
  const name = senderName.replace(/["\\<>\r\n]/g, "").trim().slice(0, 70);
  return name ? `"${name}" <${addr}>` : `<${addr}>`;
}

export function renderEmailHtml(i: EmailInput) {
  const pt = i.locale === "pt";
  const paragraphs = i.text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const blocks = paragraphs.map((p) => {
    if (i.step !== "thanks" && p.includes(i.payUrl)) {
      // "Pagar com MB WAY ou Multibanco: <url>" / "Detalhes do pagamento: <url>" → label + button
      const lines = p.split("\n").map((line) => {
        if (!line.includes(i.payUrl)) return `<p style="margin:0 0 12px">${esc(line)}</p>`;
        const label = line.replace(i.payUrl, "").replace(/[:\s]+$/, "").trim();
        return (
          `<p style="margin:8px 0 16px"><a href="${esc(i.payUrl)}" style="display:inline-block;background:#047857;color:#ffffff;` +
          `text-decoration:none;font-weight:600;padding:12px 20px;border-radius:8px">${esc(label || (pt ? "Ver detalhes e pagar" : "View and pay"))}</a></p>`
        );
      });
      return lines.join("");
    }
    return `<p style="margin:0 0 16px">${p.split("\n").map(esc).join("<br>")}</p>`;
  });
  const footer = i.step === "thanks"
    ? ""
    : pt
      ? `Se já efetuou o pagamento, por favor ignore esta mensagem.${i.replyTo ? ` Para qualquer questão basta responder a este email (${esc(i.replyTo)}).` : ""}`
      : `If you have already paid, please ignore this message.${i.replyTo ? ` For any question just reply to this email (${esc(i.replyTo)}).` : ""}`;
  const via = pt ? `Enviado por ${esc(i.senderName)} através de Pago a Tempo.` : `Sent by ${esc(i.senderName)} via Pago a Tempo.`;
  return (
    `<!doctype html><html lang="${pt ? "pt-PT" : "en"}"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head>` +
    `<body style="margin:0;padding:24px 12px;background:#f4f4f5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#18181b">` +
    `<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px 24px;font-size:15px;line-height:1.55">` +
    blocks.join("") +
    `</div><div style="max-width:560px;margin:12px auto 0;font-size:12px;line-height:1.5;color:#71717a;text-align:center">` +
    (footer ? `<p style="margin:0 0 6px">${footer}</p>` : "") +
    `<p style="margin:0">${via}</p></div></body></html>`
  );
}
