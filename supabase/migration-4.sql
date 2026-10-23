-- Run once in Supabase SQL Editor, after migration-3.sql.
-- Adds: editable staffing needs and holidays, app settings, change log,
-- calendar tokens, preference reminders, and employee editing.

-- Staffing needs ---------------------------------------------------------
-- day_type: 0..6 = Sunday..Saturday, 7 = holiday.
create table public.staffing (
  day_type int not null check (day_type between 0 and 7),
  kind text not null check (kind in ('morning', 'mid', 'evening', 'night')),
  required int not null check (required >= 0),
  primary key (day_type, kind)
);

insert into public.staffing (day_type, kind, required)
select d, k.kind,
  case
    when d = 6 then (case k.kind when 'morning' then 2 when 'mid' then 0 when 'evening' then 2 else 1 end)
    when d = 5 then (case k.kind when 'morning' then 5 when 'mid' then 2 when 'evening' then 4 else 1 end)
    when d = 7 then (case k.kind when 'morning' then 5 when 'mid' then 0 when 'evening' then 5 else 1 end)
    else (case k.kind when 'morning' then 5 when 'mid' then 2 when 'evening' then 5 else 1 end)
  end
from generate_series(0, 7) d
cross join (values ('morning'), ('mid'), ('evening'), ('night')) as k(kind);

create table public.holidays (
  date date primary key,
  name text not null
);
insert into public.holidays (date, name) values ('2026-10-27', 'יום בחירות');

create table public.app_settings (
  key text primary key,
  value jsonb not null
);
-- Day of the week (0 = Sunday) by which next week's preferences are due.
insert into public.app_settings (key, value) values ('pref_deadline_day', '3');

alter table public.staffing enable row level security;
alter table public.holidays enable row level security;
alter table public.app_settings enable row level security;

create policy staffing_read on public.staffing for select to authenticated using (public.password_ok());
create policy staffing_write on public.staffing for all to authenticated
  using (public.password_ok() and public.my_role() in ('admin', 'main'))
  with check (public.password_ok() and public.my_role() in ('admin', 'main'));

create policy holidays_read on public.holidays for select to authenticated using (public.password_ok());
create policy holidays_write on public.holidays for all to authenticated
  using (public.password_ok() and public.my_role() in ('admin', 'main'))
  with check (public.password_ok() and public.my_role() in ('admin', 'main'));

create policy settings_read on public.app_settings for select to authenticated using (public.password_ok());
create policy settings_write on public.app_settings for all to authenticated
  using (public.password_ok() and public.my_role() in ('admin', 'main'))
  with check (public.password_ok() and public.my_role() in ('admin', 'main'));

-- Employee editing (admin and main manager) --------------------------------
create policy employees_insert on public.employees for insert to authenticated
  with check (public.password_ok() and public.my_role() in ('admin', 'main'));
create policy employees_update on public.employees for update to authenticated
  using (public.password_ok() and public.my_role() in ('admin', 'main'))
  with check (public.password_ok() and public.my_role() in ('admin', 'main'));

-- Change log -------------------------------------------------------------
create table public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_id text,
  action text not null,
  detail jsonb not null default '{}'
);
create index audit_log_at_idx on public.audit_log (at desc);
alter table public.audit_log enable row level security;
create policy audit_read on public.audit_log for select to authenticated
  using (public.password_ok() and public.my_role() in ('admin', 'main'));

create function public.audit_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
declare rec jsonb;
begin
  rec := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  insert into public.audit_log (actor_id, action, detail) values (
    public.my_employee_id(),
    tg_table_name || '.' || lower(tg_op),
    case tg_table_name
      when 'assignments' then jsonb_build_object('date', rec->>'date', 'kind', rec->>'kind', 'employee', rec->>'employee_id')
      when 'rules' then jsonb_build_object('id', rec->>'id', 'label', rec->>'label', 'severity', rec->>'severity', 'enabled', rec->'enabled')
      when 'weeks' then jsonb_build_object('week', rec->>'week_start', 'published', rec->'published')
      when 'employees' then jsonb_build_object('id', rec->>'id', 'name', rec->>'name', 'role', rec->>'role', 'active', rec->'active')
      when 'staffing' then jsonb_build_object('day_type', rec->'day_type', 'kind', rec->>'kind', 'required', rec->'required')
      when 'holidays' then jsonb_build_object('date', rec->>'date', 'name', rec->>'name')
      else jsonb_build_object('key', rec->>'key', 'value', rec->'value')
    end
  );
  return null;
end $$;
revoke execute on function public.audit_trigger() from public, anon, authenticated;

create trigger audit_assignments after insert or update or delete on public.assignments for each row execute function public.audit_trigger();
create trigger audit_rules after insert or update or delete on public.rules for each row execute function public.audit_trigger();
create trigger audit_weeks after insert or update or delete on public.weeks for each row execute function public.audit_trigger();
create trigger audit_employees after insert or update or delete on public.employees for each row execute function public.audit_trigger();
create trigger audit_staffing after insert or update or delete on public.staffing for each row execute function public.audit_trigger();
create trigger audit_holidays after insert or update or delete on public.holidays for each row execute function public.audit_trigger();
create trigger audit_settings after insert or update or delete on public.app_settings for each row execute function public.audit_trigger();

-- Calendar subscription token (private to each employee) --------------------
create table public.calendar_tokens (
  employee_id text primary key references public.employees (id) on delete cascade,
  token uuid not null default gen_random_uuid()
);
alter table public.calendar_tokens enable row level security;  -- no policies: only the function below can read it

create function public.get_calendar_token() returns uuid
language plpgsql security definer set search_path = public as $$
declare me text := public.my_employee_id(); t uuid;
begin
  if not public.password_ok() or me is null then raise exception 'אין הרשאה'; end if;
  insert into public.calendar_tokens (employee_id) values (me) on conflict do nothing;
  select token into t from public.calendar_tokens where employee_id = me;
  return t;
end $$;

-- Preference reminders -----------------------------------------------------
create function public.remind_preferences(p_week date) returns integer
language plpgsql security definer set search_path = public as $$
declare e record; n integer := 0;
begin
  if not public.password_ok() or public.my_role() not in ('admin', 'main', 'manager') then raise exception 'אין הרשאה'; end if;
  for e in
    select id from public.employees emp
     where emp.active and emp.schedulable and emp.user_id is not null
       and not exists (select 1 from public.preferences p where p.employee_id = emp.id and p.week_start = p_week)
  loop
    perform public.notify(e.id, 'תזכורת: העדפות לשבוע',
      'שבוע ' || to_char(p_week, 'DD/MM') || ' – ' || to_char(p_week + 6, 'DD/MM'), 'prefs');
    n := n + 1;
  end loop;
  return n;
end $$;

revoke execute on function public.get_calendar_token(), public.remind_preferences(date) from public, anon;
grant execute on function public.get_calendar_token(), public.remind_preferences(date) to authenticated;
