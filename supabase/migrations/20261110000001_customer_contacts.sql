-- Customer contacts for reminders. Customers imported from Moloni follow the contacts in Moloni
-- (refreshed by the sync) until the owner edits them here: from then on the owner's contacts are
-- used for all of that customer's invoices, including new ones from Moloni. Clearing both phone
-- and email goes back to the Moloni contacts.
alter table public.customers
  add column contacts_custom boolean not null default false,
  add column contacts_checked_at timestamptz;
