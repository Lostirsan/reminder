-- Free payment detection without a payment provider: the customer pays by bank transfer (or MB WAY
-- to the company's phone) straight to the company, and the app finds the payment in the company's
-- bank statement, either uploaded as CSV or read through Enable Banking (open banking, read-only).
-- Customers can also press "Já paguei" on the pay page: reminders stop until the owner confirms.

-- ---------------------------------------------------------------- where customers pay
alter table public.organizations
  add column iban text check (iban is null or iban ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$'),
  add column account_holder text check (account_holder is null or length(trim(account_holder)) between 1 and 120),
  add column mbway_phone text check (mbway_phone is null or mbway_phone ~ '^[0-9]{10,15}$');

-- ---------------------------------------------------------------- "Já paguei"
alter table public.invoices add column payer_claimed_at timestamptz;

-- ---------------------------------------------------------------- bank transactions (credits only)
create table public.bank_transactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations on delete cascade,
  source text not null check (source in ('upload', 'enablebanking')),
  -- Dedupe key: the bank's id, or a hash of date+amount+description for uploads.
  external_id text not null,
  booking_date date not null,
  amount numeric(12, 2) not null check (amount > 0),
  description text not null default '',
  counterparty text,
  -- matched: invoice number + amount found, invoice closed automatically.
  -- suggested: only the amount (or only the number) fits; the owner confirms.
  match_status text not null default 'unmatched' check (match_status in ('matched', 'suggested', 'confirmed', 'unmatched', 'ignored')),
  invoice_id uuid references public.invoices on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id, source, external_id)
);
create index bank_transactions_org_idx on public.bank_transactions (organization_id, booking_date desc);

alter table public.bank_transactions enable row level security;
create policy "members read bank transactions" on public.bank_transactions
  for select using (public.is_member(organization_id));

-- ---------------------------------------------------------------- Enable Banking connection
alter table public.integrations drop constraint integrations_provider_check;
alter table public.integrations add constraint integrations_provider_check
  check (provider in ('moloni', 'invoicexpress', 'toconline', 'enablebanking'));
-- Bank consents end (usually after 180 days); the owner renews them in the bank app.
alter table public.integrations add column expires_at timestamptz;
