-- Run this once in Supabase: SQL Editor -> New query -> paste -> Run.

create table public.employees (
  id text primary key,
  name text not null,
  target int not null default 5,
  schedulable boolean not null default true,
  active boolean not null default true,
  email text unique,
  user_id uuid unique references auth.users (id) on delete set null,
  role text not null default 'worker' check (role in ('admin', 'main', 'manager', 'worker')),
  must_change_password boolean not null default true,
  password_changed_at timestamptz
);

create table public.rules (
  id text primary key,
  label text not null,
  who jsonb not null default '"all"',
  severity text not null check (severity in ('hard', 'soft')),
  enabled boolean not null default true,
  from_date date,
  to_date date,
  params jsonb not null,
  sort int not null default 0
);

create table public.assignments (
  id text primary key,
  date date not null,
  kind text not null check (kind in ('morning', 'mid', 'evening', 'night')),
  employee_id text not null references public.employees (id) on delete cascade,
  override boolean not null default false
);
create index assignments_date_idx on public.assignments (date);

-- Helpers -------------------------------------------------------------

create function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.employees where user_id = auth.uid() and active
$$;

-- True only when the password was changed after the first login and within the last 30 days.
create function public.password_ok() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select not must_change_password and password_changed_at > now() - interval '30 days'
       from public.employees where user_id = auth.uid() and active),
    false)
$$;

create function public.mark_password_changed() returns void
language sql security definer set search_path = public as $$
  update public.employees
     set must_change_password = false, password_changed_at = now()
   where user_id = auth.uid()
$$;

revoke execute on function public.my_role(), public.password_ok(), public.mark_password_changed() from public, anon;
grant execute on function public.my_role(), public.password_ok(), public.mark_password_changed() to authenticated;

-- Row level security --------------------------------------------------

alter table public.employees enable row level security;
alter table public.rules enable row level security;
alter table public.assignments enable row level security;

-- A user can always read their own row (needed to learn they must change the password).
create policy employees_read on public.employees
  for select to authenticated
  using (user_id = auth.uid() or public.password_ok());

create policy rules_read on public.rules
  for select to authenticated using (public.password_ok());
create policy rules_write on public.rules
  for all to authenticated
  using (public.password_ok() and public.my_role() in ('admin', 'main'))
  with check (public.password_ok() and public.my_role() in ('admin', 'main'));

create policy assignments_read on public.assignments
  for select to authenticated using (public.password_ok());
create policy assignments_write on public.assignments
  for all to authenticated
  using (public.password_ok() and public.my_role() in ('admin', 'main', 'manager'))
  with check (
    public.password_ok()
    and public.my_role() in ('admin', 'main', 'manager')
    and (override = false or public.my_role() in ('admin', 'main'))
  );
