-- Every 15 minutes, call the app's /api/cron/tick, which syncs connected invoicing software and
-- sends due reminders. The app URL and the shared secret live in Supabase Vault, so nothing
-- secret is in git. Set them once in the SQL editor (see README):
--   select vault.create_secret('https://<your-app>/api/cron/tick', 'cron_url');
--   select vault.create_secret('<same value as CRON_SECRET>', 'cron_secret');
-- Until both exist the job does nothing.
create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.cron_tick() returns void
language plpgsql security definer set search_path = public as $$
declare
  u text;
  s text;
begin
  select decrypted_secret into u from vault.decrypted_secrets where name = 'cron_url';
  select decrypted_secret into s from vault.decrypted_secrets where name = 'cron_secret';
  if u is null or s is null then return; end if;
  perform net.http_post(
    url := u,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || s),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
end $$;
revoke execute on function public.cron_tick() from public, anon, authenticated;

select cron.schedule('pago-a-tempo-tick', '*/15 * * * *', $$select public.cron_tick()$$);
