-- Run once in Supabase SQL Editor, after migration-4.sql.
-- Stores phone / browser push subscriptions. Only the server (Netlify function) reads them.

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  employee_id text not null references public.employees (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);
create index push_subscriptions_emp_idx on public.push_subscriptions (employee_id);
alter table public.push_subscriptions enable row level security;  -- no policies: no direct access from the browser

-- A device can only belong to one person: logging in as someone else on the same phone moves it.
create function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_ua text) returns void
language plpgsql security definer set search_path = public as $$
declare me text := public.my_employee_id();
begin
  if not public.password_ok() or me is null then raise exception 'אין הרשאה'; end if;
  delete from public.push_subscriptions where endpoint = p_endpoint;
  insert into public.push_subscriptions (employee_id, endpoint, p256dh, auth, user_agent)
    values (me, p_endpoint, p_p256dh, p_auth, left(p_ua, 300));
end $$;

create function public.remove_push_subscription(p_endpoint text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.password_ok() then raise exception 'אין הרשאה'; end if;
  delete from public.push_subscriptions where endpoint = p_endpoint and employee_id = public.my_employee_id();
end $$;

revoke execute on function public.save_push_subscription(text, text, text, text), public.remove_push_subscription(text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text), public.remove_push_subscription(text) to authenticated;
