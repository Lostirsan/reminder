-- Tenant isolation test. Runs as the 'authenticated' role with a fake JWT subject, the way
-- Supabase's API does. Any failed check raises and stops the run.
\set ON_ERROR_STOP on
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'ana@example.pt'),
  ('00000000-0000-0000-0000-00000000000b', 'bruno@example.pt');

create function pg_temp.as_user(u text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', u, false);
  execute 'set role authenticated';
end $$;
create function pg_temp.expect(ok boolean, what text) returns void language plpgsql as $$
begin if not ok then raise exception 'FAILED: %', what; end if; end $$;

-- Ana creates her company, a customer and an invoice.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.create_organization('Distribuidora Ana', 'Ana Lda', '123456789', 'pt') as org_a \gset
insert into customers (organization_id, name, phone) values (:'org_a', 'Tasca do Rui', '351911111111') returning id as cust_a \gset
insert into invoices (organization_id, customer_id, number, amount, due_date)
  values (:'org_a', :'cust_a', 'FT 1', 100, current_date - 10) returning id as inv_a \gset
select pg_temp.expect((select count(*) from invoices) = 1, 'Ana sees her invoice');

-- A second company for the same user is refused.
do $$ begin
  perform public.create_organization('Again', 'Again', null, 'pt');
  raise exception 'FAILED: second organization allowed';
exception when others then
  if sqlerrm not like 'already_member%' then raise; end if;
end $$;

-- Ana can't insert into the log tables directly or read secrets.
do $$ begin
  insert into activity (organization_id, kind, detail) select id, 'x', 'y' from organizations;
  raise exception 'FAILED: direct activity insert allowed';
exception when insufficient_privilege then null;
  when others then if sqlerrm like 'FAILED%' then raise; end if;
end $$;
do $$ begin
  perform * from integration_secrets;
  raise exception 'FAILED: secrets readable';
exception when insufficient_privilege then null;
end $$;
select public.log_activity(:'inv_a', 'note', 'called the client');
reset role;

-- Bruno: his own company, sees nothing of Ana's.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select public.create_organization('Bruno Cafés', 'Bruno', null, 'en') as org_b \gset
select pg_temp.expect((select count(*) from organizations) = 1, 'Bruno sees only his org');
select pg_temp.expect((select count(*) from invoices) = 0, 'Bruno sees no invoices of Ana');
select pg_temp.expect((select count(*) from customers) = 0, 'Bruno sees no customers of Ana');
select pg_temp.expect((select count(*) from activity where invoice_id is not null) = 0, 'Bruno sees no activity of Ana');
update invoices set status = 'paid' where id = :'inv_a';
delete from customers where id = :'cust_a';
do $$ begin
  insert into customers (organization_id, name) select id, 'X' from (select '00000000-0000-0000-0000-000000000000'::uuid id) t;
  raise exception 'FAILED: insert into foreign org allowed';
exception when insufficient_privilege then null;
  when others then if sqlerrm like 'FAILED%' then raise; end if;
end $$;
-- Bruno can't write into Ana's activity log.
select set_config('test.inv_a', :'inv_a', false);
do $$ begin
  perform public.log_activity(current_setting('test.inv_a')::uuid, 'note', 'x');
  raise exception 'FAILED: log into a foreign invoice allowed';
exception when others then if sqlerrm not like 'forbidden%' then raise; end if;
end $$;
do $$ begin
  perform public.delete_organization('00000000-0000-0000-0000-000000000000');
  raise exception 'FAILED: delete of a foreign org allowed';
exception when others then if sqlerrm not like 'forbidden%' then raise; end if;
end $$;
reset role;

-- Ana's data is untouched by Bruno's attempts.
select pg_temp.expect((select status from invoices where id = :'inv_a') = 'open', 'Bruno could not change Ana''s invoice');
select pg_temp.expect((select count(*) from customers where id = :'cust_a') = 1, 'Bruno could not delete Ana''s customer');

-- Cross-tenant customer reference is refused even for the server.
do $$ begin
  insert into invoices (organization_id, customer_id, number, amount, due_date)
  select o.id, c.id, 'X', 1, current_date from organizations o, customers c where o.name = 'Bruno Cafés' limit 1;
  raise exception 'FAILED: cross-tenant customer allowed';
exception when others then if sqlerrm not like 'customer_mismatch%' then raise; end if;
end $$;

-- The scheduler claims each (invoice, step, channel) only once.
insert into messages (organization_id, invoice_id, channel, step, trigger, body) values (:'org_a', :'inv_a', 'whatsapp', 'd5', 'auto', 'x');
insert into messages (organization_id, invoice_id, channel, step, trigger, body) values (:'org_a', :'inv_a', 'whatsapp', 'd5', 'auto', 'x')
  on conflict do nothing;
select pg_temp.expect((select count(*) from messages) = 1, 'auto reminder claimed once');

-- Bank transactions: written by the server, readable only by members; dedupe per source.
insert into bank_transactions (organization_id, source, external_id, booking_date, amount, description)
  values (:'org_a', 'upload', 'csv:1', current_date, 100, 'FT 1');
insert into bank_transactions (organization_id, source, external_id, booking_date, amount, description)
  values (:'org_a', 'upload', 'csv:1', current_date, 100, 'FT 1') on conflict do nothing;
select pg_temp.expect((select count(*) from bank_transactions) = 1, 'bank transaction stored once');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect((select count(*) from bank_transactions) = 0, 'Bruno can''t see Ana''s bank transactions');
do $$ begin
  update bank_transactions set match_status = 'ignored';
  if found then raise exception 'FAILED: bank transaction update allowed'; end if;
exception when insufficient_privilege then null;
end $$;
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect((select count(*) from bank_transactions) = 1, 'Ana sees her bank transactions');
do $$ begin
  insert into bank_transactions (organization_id, source, external_id, booking_date, amount) select id, 'upload', 'x', current_date, 1 from organizations;
  raise exception 'FAILED: direct bank insert allowed';
exception when insufficient_privilege then null;
  when others then if sqlerrm like 'FAILED%' then raise; end if;
end $$;
reset role;
-- Enable Banking is an allowed integration provider.
insert into integrations (organization_id, provider, account_label) values (:'org_a', 'enablebanking', 'Test');

-- Owner can erase the company (GDPR); everything goes with it.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.delete_organization(:'org_a');
reset role;
select pg_temp.expect((select count(*) from invoices) = 0 and (select count(*) from messages) = 0, 'org deletion cascades');
\echo 'RLS tests passed'
