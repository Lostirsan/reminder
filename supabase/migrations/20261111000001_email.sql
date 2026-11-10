-- Automatic email reminders.
-- 1. Replies to a reminder go straight to the supplier (we are a tool; the supplier is the sender).
--    Filled from the owner's sign-in email; editable in Settings.
-- 2. Positioning: polite reminders. Mentioning late interest and the 40 € compensation is optional
--    and now off by default for new companies (existing companies keep their choice).
alter table public.organizations
  add column if not exists reply_email text
  check (reply_email is null or reply_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$');

alter table public.organizations alter column mention_interest set default false;

update public.organizations o
set reply_email = u.email
from public.members m
join auth.users u on u.id = m.user_id
where m.organization_id = o.id and m.role = 'owner' and o.reply_email is null
  and u.email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$';

create or replace function public.fill_reply_email() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role = 'owner' then
    update organizations o set reply_email = u.email
    from auth.users u
    where o.id = new.organization_id and u.id = new.user_id and o.reply_email is null
      and u.email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$';
  end if;
  return new;
end $$;
revoke execute on function public.fill_reply_email() from public, anon, authenticated;

drop trigger if exists members_fill_reply_email on public.members;
create trigger members_fill_reply_email after insert on public.members
  for each row execute function public.fill_reply_email();
