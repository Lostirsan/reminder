export type Locale = "pt" | "en";
export type Step = "pre" | "d1" | "d5" | "firm" | "thanks";
export type Channel = "whatsapp" | "email" | "walink";
export type InvoiceStatus = "open" | "paid" | "paused" | "cancelled";

export type Organization = {
  id: string;
  name: string;
  nif: string | null;
  sender_name: string;
  locale: Locale;
  timezone: string;
  auto_reminders: boolean;
  mention_interest: boolean;
  late_interest_rate: number;
  channel_whatsapp: boolean;
  channel_email: boolean;
  iban: string | null;
  account_holder: string | null;
  mbway_phone: string | null;
};

export type Customer = {
  id: string;
  organization_id: string;
  source: string;
  external_id: string | null;
  name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  locale: Locale;
  whatsapp_opt_in: boolean;
  /** Owner edited the contacts: the Moloni sync no longer overwrites them. */
  contacts_custom: boolean;
};

export type Invoice = {
  id: string;
  organization_id: string;
  customer_id: string;
  source: string;
  external_id: string | null;
  number: string;
  amount: number;
  issue_date: string | null;
  due_date: string;
  status: InvoiceStatus;
  paid_at: string | null;
  pay_token: string;
  payer_claimed_at: string | null;
  created_at: string;
};

export type InvoiceWithCustomer = Invoice & { customer: Customer };

export type Message = {
  id: string;
  invoice_id: string;
  channel: Channel;
  step: Step;
  trigger: "manual" | "auto";
  status: "queued" | "sent" | "delivered" | "read" | "failed" | "simulated";
  provider: string | null;
  provider_id: string | null;
  recipient: string | null;
  body: string;
  error: string | null;
  created_at: string;
};

export type Activity = { id: number; invoice_id: string | null; kind: string; detail: string; created_at: string };

export type ActionState = { ok?: string; error?: string; email?: string } | undefined;
