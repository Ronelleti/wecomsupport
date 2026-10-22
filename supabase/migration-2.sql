-- Run once in Supabase SQL Editor, after schema.sql.
-- Adds: publishing, vacations, weekly preferences, shift swaps, notifications.

create function public.my_employee_id() returns text
language sql stable security definer set search_path = public as $$
  select id from public.employees where user_id = auth.uid() and active
$$;

create function public.il_today() returns date
language sql stable as $$ select (now() at time zone 'Asia/Jerusalem')::date $$;

-- Tables ----------------------------------------------------------------

create table public.weeks (
  week_start date primary key check (extract(dow from week_start) = 0),
  published boolean not null default false,
  published_at timestamptz
);

create table public.time_off (
  id uuid primary key default gen_random_uuid(),
  employee_id text not null references public.employees (id) on delete cascade,
  from_date date not null,
  to_date date not null check (to_date >= from_date),
  note text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decision_note text,
  decided_by text references public.employees (id),
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.preferences (
  employee_id text not null references public.employees (id) on delete cascade,
  week_start date not null,
  cells jsonb not null default '{}',
  note text,
  updated_at timestamptz not null default now(),
  primary key (employee_id, week_start)
);

create table public.swaps (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('swap', 'handover')),
  requester_id text not null references public.employees (id) on delete cascade,
  requester_assignment_id text not null,
  target_id text not null references public.employees (id) on delete cascade,
  target_assignment_id text,
  status text not null default 'pending_peer'
    check (status in ('pending_peer', 'pending_manager', 'approved', 'rejected', 'cancelled')),
  note text,
  decision_note text,
  decided_by text references public.employees (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  employee_id text not null references public.employees (id) on delete cascade,
  title text not null,
  body text,
  link text,
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index notifications_emp_idx on public.notifications (employee_id, created_at desc);

-- Internal helper: not callable from the browser.
create function public.notify(p_employee text, p_title text, p_body text, p_link text) returns void
language sql security definer set search_path = public as $$
  insert into public.notifications (employee_id, title, body, link) values (p_employee, p_title, p_body, p_link)
$$;
revoke execute on function public.notify(text, text, text, text) from public, anon, authenticated;

create function public.notify_managers(p_title text, p_body text, p_link text) returns void
language sql security definer set search_path = public as $$
  insert into public.notifications (employee_id, title, body, link)
  select id, p_title, p_body, p_link from public.employees
   where active and role in ('main', 'manager') and user_id is not null
$$;
revoke execute on function public.notify_managers(text, text, text) from public, anon, authenticated;

-- Row level security ----------------------------------------------------

alter table public.weeks enable row level security;
alter table public.time_off enable row level security;
alter table public.preferences enable row level security;
alter table public.swaps enable row level security;
alter table public.notifications enable row level security;

-- Workers only see published weeks; managers see drafts too.
drop policy assignments_read on public.assignments;
create policy assignments_read on public.assignments
  for select to authenticated
  using (
    public.password_ok()
    and (
      public.my_role() in ('admin', 'main', 'manager')
      or exists (
        select 1 from public.weeks w
         where w.week_start = assignments.date - extract(dow from assignments.date)::int and w.published
      )
    )
  );

create policy weeks_read on public.weeks for select to authenticated using (public.password_ok());

create policy time_off_read on public.time_off for select to authenticated
  using (public.password_ok() and (employee_id = public.my_employee_id() or public.my_role() in ('admin', 'main', 'manager')));
create policy time_off_insert on public.time_off for insert to authenticated
  with check (public.password_ok() and employee_id = public.my_employee_id() and status = 'pending');
create policy time_off_delete on public.time_off for delete to authenticated
  using (public.password_ok() and employee_id = public.my_employee_id() and status = 'pending');

create policy prefs_read on public.preferences for select to authenticated
  using (public.password_ok() and (employee_id = public.my_employee_id() or public.my_role() in ('admin', 'main', 'manager')));
create policy prefs_write on public.preferences for all to authenticated
  using (public.password_ok() and employee_id = public.my_employee_id())
  with check (public.password_ok() and employee_id = public.my_employee_id());

create policy swaps_read on public.swaps for select to authenticated
  using (
    public.password_ok()
    and (requester_id = public.my_employee_id() or target_id = public.my_employee_id()
         or public.my_role() in ('admin', 'main', 'manager'))
  );

create policy notifications_read on public.notifications for select to authenticated
  using (public.password_ok() and employee_id = public.my_employee_id());
create policy notifications_update on public.notifications for update to authenticated
  using (public.password_ok() and employee_id = public.my_employee_id())
  with check (public.password_ok() and employee_id = public.my_employee_id());

-- Approved vacation blocks any shift --------------------------------------

create function public.block_vacation() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (
    select 1 from public.time_off
     where employee_id = new.employee_id and status = 'approved' and new.date between from_date and to_date
  ) then
    raise exception 'העובד בחופשה בתאריך זה';
  end if;
  return new;
end $$;
create trigger assignments_vacation before insert or update on public.assignments
  for each row execute function public.block_vacation();

create function public.time_off_notify() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.notify_managers('בקשת חופשה חדשה',
    (select name from public.employees where id = new.employee_id) || ' ביקש/ה חופשה', 'requests');
  return new;
end $$;
create trigger time_off_new after insert on public.time_off
  for each row execute function public.time_off_notify();

-- Actions ---------------------------------------------------------------

create function public.publish_week(p_week date, p_publish boolean) returns void
language plpgsql security definer set search_path = public as $$
declare e record;
begin
  if not public.password_ok() or public.my_role() not in ('admin', 'main', 'manager') then
    raise exception 'אין הרשאה';
  end if;
  if extract(dow from p_week) <> 0 then raise exception 'תאריך לא תקין'; end if;
  insert into public.weeks (week_start, published, published_at)
    values (p_week, p_publish, case when p_publish then now() end)
    on conflict (week_start) do update set published = excluded.published, published_at = excluded.published_at;
  if p_publish then
    for e in select id from public.employees where active and schedulable and user_id is not null loop
      perform public.notify(e.id, 'פורסם סידור עבודה',
        'שבוע ' || to_char(p_week, 'DD/MM') || ' – ' || to_char(p_week + 6, 'DD/MM'), 'my');
    end loop;
  end if;
end $$;

create function public.request_swap(p_kind text, p_my text, p_target text, p_their text, p_note text) returns uuid
language plpgsql security definer set search_path = public as $$
declare me text := public.my_employee_id(); a public.assignments; b public.assignments; sid uuid;
begin
  if not public.password_ok() or me is null then raise exception 'אין הרשאה'; end if;
  if p_kind not in ('swap', 'handover') or p_target = me then raise exception 'בקשה לא תקינה'; end if;
  select * into a from public.assignments where id = p_my and employee_id = me;
  if not found or a.date < public.il_today() then raise exception 'המשמרת לא זמינה להחלפה'; end if;
  if p_kind = 'swap' then
    select * into b from public.assignments where id = p_their and employee_id = p_target;
    if not found or b.date < public.il_today() then raise exception 'המשמרת של העמית לא זמינה'; end if;
  end if;
  if exists (
    select 1 from public.swaps
     where status in ('pending_peer', 'pending_manager')
       and (requester_assignment_id in (p_my, coalesce(p_their, '')) or target_assignment_id in (p_my, coalesce(p_their, '')))
  ) then raise exception 'כבר קיימת בקשה פתוחה על המשמרת'; end if;
  insert into public.swaps (kind, requester_id, requester_assignment_id, target_id, target_assignment_id, note)
    values (p_kind, me, p_my, p_target, case when p_kind = 'swap' then p_their end, p_note)
    returning id into sid;
  perform public.notify(p_target,
    case when p_kind = 'swap' then 'בקשת החלפת משמרת' else 'בקשה לקבל משמרת' end,
    (select name from public.employees where id = me) || ' שלח/ה לך בקשה', 'swaps');
  return sid;
end $$;

create function public.respond_swap(p_id uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = public as $$
declare s public.swaps; me text := public.my_employee_id();
begin
  if not public.password_ok() or me is null then raise exception 'אין הרשאה'; end if;
  select * into s from public.swaps where id = p_id and target_id = me and status = 'pending_peer';
  if not found then raise exception 'הבקשה לא נמצאה'; end if;
  update public.swaps set status = case when p_accept then 'pending_manager' else 'rejected' end, updated_at = now()
   where id = p_id;
  if p_accept then
    perform public.notify_managers('בקשת החלפה ממתינה לאישור',
      (select name from public.employees where id = s.requester_id) || ' ו' ||
      (select name from public.employees where id = s.target_id), 'requests');
  else
    perform public.notify(s.requester_id, 'בקשת ההחלפה נדחתה', (select name from public.employees where id = me) || ' דחה/תה', 'swaps');
  end if;
end $$;

create function public.cancel_swap(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.password_ok() then raise exception 'אין הרשאה'; end if;
  update public.swaps set status = 'cancelled', updated_at = now()
   where id = p_id and requester_id = public.my_employee_id() and status in ('pending_peer', 'pending_manager');
end $$;

-- Only a main manager or manager can decide (admin is deliberately excluded).
create function public.decide_swap(p_id uuid, p_approve boolean, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare s public.swaps; a public.assignments; b public.assignments; me text := public.my_employee_id();
begin
  if not public.password_ok() or public.my_role() not in ('main', 'manager') then raise exception 'אין הרשאה'; end if;
  select * into s from public.swaps where id = p_id and status = 'pending_manager';
  if not found then raise exception 'הבקשה לא נמצאה'; end if;
  if me in (s.requester_id, s.target_id) then raise exception 'אי אפשר לאשר בקשה שלך'; end if;

  if p_approve then
    select * into a from public.assignments where id = s.requester_assignment_id;
    if not found then raise exception 'המשמרת כבר לא קיימת'; end if;
    if s.kind = 'handover' then
      if exists (select 1 from public.assignments where employee_id = s.target_id and date = a.date) then
        raise exception 'העובד כבר משובץ באותו יום';
      end if;
      delete from public.assignments where id = a.id;
      insert into public.assignments (id, date, kind, employee_id)
        values (a.date::text || '|' || a.kind || '|' || s.target_id, a.date, a.kind, s.target_id);
    else
      select * into b from public.assignments where id = s.target_assignment_id;
      if not found then raise exception 'המשמרת כבר לא קיימת'; end if;
      if exists (select 1 from public.assignments where employee_id = s.requester_id and date = b.date and id <> a.id)
         or exists (select 1 from public.assignments where employee_id = s.target_id and date = a.date and id <> b.id) then
        raise exception 'אחד העובדים כבר משובץ באותו יום';
      end if;
      delete from public.assignments where id in (a.id, b.id);
      insert into public.assignments (id, date, kind, employee_id) values
        (a.date::text || '|' || a.kind || '|' || s.target_id, a.date, a.kind, s.target_id),
        (b.date::text || '|' || b.kind || '|' || s.requester_id, b.date, b.kind, s.requester_id);
    end if;
  end if;

  update public.swaps set status = case when p_approve then 'approved' else 'rejected' end,
         decision_note = p_note, decided_by = me, updated_at = now() where id = p_id;
  perform public.notify(s.requester_id, case when p_approve then 'ההחלפה אושרה' else 'ההחלפה נדחתה' end, p_note, 'my');
  perform public.notify(s.target_id, case when p_approve then 'ההחלפה אושרה' else 'ההחלפה נדחתה' end, p_note, 'my');
end $$;

create function public.decide_time_off(p_id uuid, p_approve boolean, p_note text) returns integer
language plpgsql security definer set search_path = public as $$
declare t public.time_off; removed integer := 0;
begin
  if not public.password_ok() or public.my_role() not in ('main', 'manager') then raise exception 'אין הרשאה'; end if;
  select * into t from public.time_off where id = p_id and status = 'pending';
  if not found then raise exception 'הבקשה לא נמצאה'; end if;
  if t.employee_id = public.my_employee_id() then raise exception 'אי אפשר לאשר בקשה שלך'; end if;
  update public.time_off set status = case when p_approve then 'approved' else 'rejected' end,
         decision_note = p_note, decided_by = public.my_employee_id(), decided_at = now() where id = p_id;
  if p_approve then
    delete from public.assignments where employee_id = t.employee_id and date between t.from_date and t.to_date;
    get diagnostics removed = row_count;
    if removed > 0 then
      perform public.notify_managers('הוסרו משמרות בגלל חופשה',
        (select name from public.employees where id = t.employee_id) || ': ' || removed || ' משמרות', 'schedule');
    end if;
  end if;
  perform public.notify(t.employee_id, case when p_approve then 'החופשה אושרה' else 'החופשה נדחתה' end,
    to_char(t.from_date, 'DD/MM') || ' – ' || to_char(t.to_date, 'DD/MM'), 'timeoff');
  return removed;
end $$;

revoke execute on function
  public.my_employee_id(), public.publish_week(date, boolean), public.request_swap(text, text, text, text, text),
  public.respond_swap(uuid, boolean), public.cancel_swap(uuid), public.decide_swap(uuid, boolean, text),
  public.decide_time_off(uuid, boolean, text)
from public, anon;
grant execute on function
  public.my_employee_id(), public.publish_week(date, boolean), public.request_swap(text, text, text, text, text),
  public.respond_swap(uuid, boolean), public.cancel_swap(uuid), public.decide_swap(uuid, boolean, text),
  public.decide_time_off(uuid, boolean, text)
to authenticated;
