-- Pago a Tempo core schema: companies (organizations) with members, their customers and invoices,
-- payment links, sent messages and an activity log. Every row belongs to one organization and
-- Row Level Security lets a signed-in user see only the organizations they are a member of.
-- Secrets (integration tokens) live in a table with no client access at all; only the server
-- (service role) reads them.


-- ---------------------------------------------------------------- organizations & members
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  nif text check (nif is null or nif ~ '^[0-9]{9}$'),
  -- Name the customers see at the end of each reminder.
  sender_name text not null check (length(trim(sender_name)) between 1 and 120),
  locale text not null default 'pt' check (locale in ('pt', 'en')),
  timezone text not null default 'Europe/Lisbon',
  auto_reminders boolean not null default false,
  -- Mention statutory late interest (DL 62/2013) and the 40 EUR compensation in the firm step.
  mention_interest boolean not null default true,
  late_interest_rate numeric(5, 2) not null default 10.40 check (late_interest_rate between 0 and 50),
  channel_whatsapp boolean not null default true,
  channel_email boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.members (
  organization_id uuid not null references public.organizations on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);
create index members_user_idx on public.members (user_id);

-- True when the signed-in user belongs to the organization. security definer so policies on
-- members itself don't recurse.
create function public.is_member(org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where organization_id = org and user_id = auth.uid())
$$;

-- ---------------------------------------------------------------- customers & invoices
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations on delete cascade,
  source text not null default 'manual' check (source in ('manual', 'moloni', 'invoicexpress', 'toconline', 'demo')),
  external_id text,
  name text not null check (length(trim(name)) between 1 and 200),
  contact_name text,
  phone text,          -- E.164 digits without '+', e.g. 351912345678
  email text,
  locale text not null default 'pt' check (locale in ('pt', 'en')),
  created_at timestamptz not null default now(),
  unique (organization_id, source, external_id)
);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations on delete cascade,
  customer_id uuid not null references public.customers on delete cascade,
  source text not null default 'manual' check (source in ('manual', 'moloni', 'invoicexpress', 'toconline', 'demo')),
  external_id text,
  number text not null check (length(trim(number)) between 1 and 60),
  amount numeric(12, 2) not null check (amount > 0),      -- amount still to be paid
  issue_date date,
  due_date date not null,
  status text not null default 'open' check (status in ('open', 'paid', 'paused', 'cancelled')),
  paid_at timestamptz,
  -- Secret part of the public pay link in reminders (/pay/<token>); never expires, unlike a checkout session.
  pay_token text not null unique default replace(gen_random_uuid()::text, '-', ''),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, source, external_id)
);
create index invoices_org_status_idx on public.invoices (organization_id, status, due_date);

-- ---------------------------------------------------------------- payments, messages, activity
create table public.payment_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations on delete cascade,
  invoice_id uuid not null references public.invoices on delete cascade,
  provider text not null check (provider in ('stripe', 'easypay', 'demo')),
  external_id text not null,
  url text,
  entity text,
  reference text,
  amount numeric(12, 2) not null,
  status text not null default 'pending' check (status in ('pending', 'paid', 'expired', 'failed')),
  created_at timestamptz not null default now(),
  unique (provider, external_id)
);
create index payment_links_invoice_idx on public.payment_links (invoice_id, created_at desc);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations on delete cascade,
  invoice_id uuid not null references public.invoices on delete cascade,
  channel text not null check (channel in ('whatsapp', 'email', 'walink')),
  step text not null check (step in ('pre', 'd1', 'd5', 'firm', 'thanks')),
  trigger text not null default 'manual' check (trigger in ('manual', 'auto')),
  status text not null default 'queued' check (status in ('queued', 'sent', 'delivered', 'read', 'failed', 'simulated')),
  provider text,
  provider_id text,
  recipient text,
  body text not null,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- The scheduler claims (invoice, step, channel) once: a crash or a second cron run can't double-send.
create unique index messages_auto_once on public.messages (invoice_id, step, channel) where trigger = 'auto';
create index messages_invoice_idx on public.messages (invoice_id, created_at desc);
create index messages_provider_idx on public.messages (provider, provider_id);

create table public.activity (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations on delete cascade,
  invoice_id uuid references public.invoices on delete cascade,
  kind text not null,
  detail text not null,
  created_at timestamptz not null default now()
);
create index activity_invoice_idx on public.activity (invoice_id, created_at desc);
create index activity_org_idx on public.activity (organization_id, created_at desc);

-- ---------------------------------------------------------------- integrations
create table public.integrations (
  organization_id uuid not null references public.organizations on delete cascade,
  provider text not null check (provider in ('moloni', 'invoicexpress', 'toconline')),
  status text not null default 'connected' check (status in ('connected', 'error', 'disconnected')),
  account_label text,
  last_sync_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  primary key (organization_id, provider)
);

-- Tokens, encrypted by the app (AES-GCM, key in the server env). No policies: clients can't read it.
create table public.integration_secrets (
  organization_id uuid not null,
  provider text not null,
  ciphertext text not null,
  updated_at timestamptz not null default now(),
  primary key (organization_id, provider),
  foreign key (organization_id, provider) references public.integrations on delete cascade
);

-- ---------------------------------------------------------------- row level security
alter table public.organizations enable row level security;
alter table public.members enable row level security;
alter table public.customers enable row level security;
alter table public.invoices enable row level security;
alter table public.payment_links enable row level security;
alter table public.messages enable row level security;
alter table public.activity enable row level security;
alter table public.integrations enable row level security;
alter table public.integration_secrets enable row level security;

create policy "members read their organizations" on public.organizations
  for select using (public.is_member(id));
create policy "members update their organizations" on public.organizations
  for update using (public.is_member(id)) with check (public.is_member(id));

create policy "see co-members" on public.members
  for select using (public.is_member(organization_id));

-- Customers and invoices are fully managed by members.
create policy "members manage customers" on public.customers
  for all using (public.is_member(organization_id)) with check (public.is_member(organization_id));
create policy "members manage invoices" on public.invoices
  for all using (public.is_member(organization_id)) with check (public.is_member(organization_id));

-- The rest is written by the server (sending, webhooks); members only read it.
create policy "members read payment links" on public.payment_links
  for select using (public.is_member(organization_id));
create policy "members read messages" on public.messages
  for select using (public.is_member(organization_id));
create policy "members read activity" on public.activity
  for select using (public.is_member(organization_id));
create policy "members read integrations" on public.integrations
  for select using (public.is_member(organization_id));

revoke all on public.integration_secrets from anon, authenticated;

-- ---------------------------------------------------------------- functions
-- Creates a company and makes the caller its owner. One company per user for now.
create function public.create_organization(p_name text, p_sender_name text, p_nif text, p_locale text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  org uuid;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if exists (select 1 from members where user_id = uid) then raise exception 'already_member'; end if;
  insert into organizations (name, sender_name, nif, locale)
  values (trim(p_name), coalesce(nullif(trim(p_sender_name), ''), trim(p_name)), nullif(trim(p_nif), ''), coalesce(p_locale, 'pt'))
  returning id into org;
  insert into members (organization_id, user_id, role) values (org, uid, 'owner');
  insert into activity (organization_id, kind, detail) values (org, 'org', 'created');
  return org;
end $$;

-- Members can add notes to the log for their own organization (manual actions in the UI).
create function public.log_activity(p_invoice uuid, p_kind text, p_detail text) returns void
language plpgsql security definer set search_path = public as $$
declare org uuid;
begin
  select organization_id into org from invoices where id = p_invoice;
  if org is null or not is_member(org) then raise exception 'forbidden'; end if;
  insert into activity (organization_id, invoice_id, kind, detail) values (org, p_invoice, p_kind, left(p_detail, 500));
end $$;

create function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
create trigger invoices_touch before update on public.invoices for each row execute function public.touch_updated_at();
create trigger messages_touch before update on public.messages for each row execute function public.touch_updated_at();

-- An invoice can't point at another organization's customer.
create function public.check_invoice_customer() returns trigger language plpgsql as $$
begin
  if not exists (select 1 from public.customers c where c.id = new.customer_id and c.organization_id = new.organization_id) then
    raise exception 'customer_mismatch';
  end if;
  return new;
end $$;
create trigger invoices_customer_check before insert or update of customer_id, organization_id on public.invoices
  for each row execute function public.check_invoice_customer();

revoke execute on function public.create_organization(text, text, text, text) from anon;
revoke execute on function public.log_activity(uuid, text, text) from anon;

-- GDPR: an owner can erase the company and everything in it.
create function public.delete_organization(p_org uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from members where organization_id = p_org and user_id = auth.uid() and role = 'owner') then
    raise exception 'forbidden';
  end if;
  delete from organizations where id = p_org;
end $$;
revoke execute on function public.delete_organization(uuid) from anon;
