import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Minimal .env loader (no dependencies).
// Reads .env, or env.txt (easier to create on Windows).
const envPath = [join(root, ".env"), join(root, "env.txt")].find((p) => existsSync(p));
if (envPath) {
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const e = (k, d = "") => (process.env[k] ?? d).trim();

export const config = {
  root,
  port: Number(e("PORT", "3000")),
  businessName: e("BUSINESS_NAME", "Distribuidora Exemplo"),
  lateRate: Number(e("LATE_INTEREST_RATE", "10.40")),
  moloni: {
    developerId: e("MOLONI_DEVELOPER_ID"),
    clientSecret: e("MOLONI_CLIENT_SECRET"),
    username: e("MOLONI_USERNAME"),
    password: e("MOLONI_PASSWORD"),
    companyId: e("MOLONI_COMPANY_ID"),
  },
  wa: {
    phoneNumberId: e("WA_PHONE_NUMBER_ID"),
    token: e("WA_ACCESS_TOKEN"),
    recipient: e("WA_TEST_RECIPIENT").replace(/\D/g, ""),
    template: e("WA_TEMPLATE_NAME"),
    templateLang: e("WA_TEMPLATE_LANG", "pt_PT"),
  },
  stripe: {
    secretKey: e("STRIPE_SECRET_KEY"),
  },
  easypay: {
    accountId: e("EASYPAY_ACCOUNT_ID"),
    apiKey: e("EASYPAY_API_KEY"),
    mbwayPhone: e("EASYPAY_MBWAY_TEST_PHONE", "911234567"),
  },
};

export const live = {
  moloni: Boolean(config.moloni.developerId && config.moloni.clientSecret && config.moloni.username && config.moloni.password),
  wa: Boolean(config.wa.phoneNumberId && config.wa.token && config.wa.recipient),
  stripe: Boolean(config.stripe.secretKey),
  easypay: Boolean(config.easypay.accountId && config.easypay.apiKey),
};
