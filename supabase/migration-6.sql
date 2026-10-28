-- Run once in Supabase SQL Editor, after migration-5.sql.
-- Adds departments (a separate schedule board for each) and attendance marks (late / absent).

-- Departments ----------------------------------------------------------------
create table public.departments (
  id text primary key,
  name text not null,
  sort int not null default 0,
  active boolean not null default true
);
insert into public.departments (id, name, sort) values
  ('tech', 'תמיכה', 0),
  ('service', 'שירות', 1),
  ('shiftmgr', 'אחמ"שיה', 2),
  ('experts', 'מומחים', 3);

alter table public.departments enable row level security;
create policy departments_read on public.departments for select to authenticated using (public.password_ok());
create policy departments_write on public.departments for all to authenticated
  using (public.password_ok() and public.my_role() in ('admin', 'main'))
  with check (public.password_ok() and public.my_role() in ('admin', 'main'));
create trigger audit_departments after insert or update or delete on public.departments
  for each row execute function public.audit_trigger();

-- Keep the backfills below out of the change log.
alter table public.assignments disable trigger audit_assignments;
alter table public.employees disable trigger audit_employees;
alter table public.staffing disable trigger audit_staffing;

-- Every employee has a home department (everyone starts in "תמיכה": change it in the users screen).
alter table public.employees add column department_id text references public.departments (id);
update public.employees set department_id = 'tech';

-- Every shift belongs to a department's board.
alter table public.assignments add column department_id text references public.departments (id);
update public.assignments a set department_id = coalesce(e.department_id, 'tech')
  from public.employees e where e.id = a.employee_id;
alter table public.assignments alter column department_id set not null;
create index assignments_dept_idx on public.assignments (department_id, date);

-- Staffing needs are per department. Existing numbers go to "תמיכה"; the others start at 0
-- and are set in the settings screen.
alter table public.staffing add column department_id text references public.departments (id);
alter table public.staffing drop constraint staffing_pkey;
update public.staffing set department_id = 'tech';
insert into public.staffing (department_id, day_type, kind, required)
  select d.id, s.day_type, s.kind, 0
    from public.staffing s cross join public.departments d
   where s.department_id = 'tech' and d.id <> 'tech';
alter table public.staffing alter column department_id set not null;
alter table public.staffing add primary key (department_id, day_type, kind);

alter table public.assignments enable trigger audit_assignments;
alter table public.employees enable trigger audit_employees;
alter table public.staffing enable trigger audit_staffing;

-- Attendance -------------------------------------------------------------------
-- Kept separately from the shifts, so the record survives if a shift is later removed.
create table public.attendance (
  employee_id text not null references public.employees (id) on delete cascade,
  date date not null,
  kind text not null check (kind in ('morning', 'mid', 'evening', 'night')),
  status text not null check (status in ('late', 'absent')),
  note text,
  marked_by text references public.employees (id),
  marked_at timestamptz not null default now(),
  primary key (employee_id, date, kind)
);
alter table public.attendance enable row level security;

-- Managers see everything; an employee sees only their own record.
create policy attendance_read on public.attendance for select to authenticated
  using (
    public.password_ok()
    and (employee_id = public.my_employee_id() or public.my_role() in ('admin', 'main', 'manager'))
  );

-- Only managers can classify a shift as late or missed, and only for shifts that already started.
create function public.mark_attendance(p_employee text, p_date date, p_kind text, p_status text, p_note text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.password_ok() or public.my_role() not in ('admin', 'main', 'manager') then
    raise exception 'אין הרשאה';
  end if;
  if p_date > public.il_today() then raise exception 'אי אפשר לסווג משמרת עתידית'; end if;
  if coalesce(p_status, '') = '' then
    delete from public.attendance where employee_id = p_employee and date = p_date and kind = p_kind;
    return;
  end if;
  if p_status not in ('late', 'absent') then raise exception 'סיווג לא תקין'; end if;
  insert into public.attendance (employee_id, date, kind, status, note, marked_by, marked_at)
    values (p_employee, p_date, p_kind, p_status, nullif(trim(p_note), ''), public.my_employee_id(), now())
    on conflict (employee_id, date, kind)
    do update set status = excluded.status, note = excluded.note, marked_by = excluded.marked_by, marked_at = now();
end $$;
revoke execute on function public.mark_attendance(text, date, text, text, text) from public, anon;
grant execute on function public.mark_attendance(text, date, text, text, text) to authenticated;

create function public.attendance_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare rec jsonb;
begin
  rec := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  insert into public.audit_log (actor_id, action, detail) values (
    public.my_employee_id(), 'attendance.' || lower(tg_op),
    jsonb_build_object('employee', rec->>'employee_id', 'date', rec->>'date', 'kind', rec->>'kind', 'status', rec->>'status'));
  return null;
end $$;
revoke execute on function public.attendance_audit() from public, anon, authenticated;
create trigger audit_attendance after insert or update or delete on public.attendance
  for each row execute function public.attendance_audit();

-- Swaps keep the department of the shift that changes hands.
create or replace function public.decide_swap(p_id uuid, p_approve boolean, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare s public.swaps; a public.assignments; b public.assignments; me text := public.my_employee_id();
begin
  if not public.password_ok() or public.my_role() not in ('main', 'manager') then raise exception 'אין הרשאה'; end if;
  select * into s from public.swaps where id = p_id and status = 'pending_manager';
  if not found then raise exception 'הבקשה לא נמצאה'; end if;
  if me in (s.requester_id, s.target_id) then raise exception 'אי אפשר לאשר בקשה שלך'; end if;
  if public.my_role() = 'manager' and (public.is_top(s.requester_id) or public.is_top(s.target_id)) then
    raise exception 'רק מנהל ראשי יכול להחליט בבקשה שכוללת מנהל ראשי';
  end if;

  if p_approve then
    select * into a from public.assignments where id = s.requester_assignment_id;
    if not found then raise exception 'המשמרת כבר לא קיימת'; end if;
    if s.kind = 'handover' then
      if exists (select 1 from public.assignments where employee_id = s.target_id and date = a.date) then
        raise exception 'העובד כבר משובץ באותו יום';
      end if;
      delete from public.assignments where id = a.id;
      insert into public.assignments (id, date, kind, employee_id, department_id)
        values (a.date::text || '|' || a.kind || '|' || s.target_id, a.date, a.kind, s.target_id, a.department_id);
    else
      select * into b from public.assignments where id = s.target_assignment_id;
      if not found then raise exception 'המשמרת כבר לא קיימת'; end if;
      if exists (select 1 from public.assignments where employee_id = s.requester_id and date = b.date and id <> a.id)
         or exists (select 1 from public.assignments where employee_id = s.target_id and date = a.date and id <> b.id) then
        raise exception 'אחד העובדים כבר משובץ באותו יום';
      end if;
      delete from public.assignments where id in (a.id, b.id);
      insert into public.assignments (id, date, kind, employee_id, department_id) values
        (a.date::text || '|' || a.kind || '|' || s.target_id, a.date, a.kind, s.target_id, a.department_id),
        (b.date::text || '|' || b.kind || '|' || s.requester_id, b.date, b.kind, s.requester_id, b.department_id);
    end if;
  end if;

  update public.swaps set status = case when p_approve then 'approved' else 'rejected' end,
         decision_note = p_note, decided_by = me, updated_at = now() where id = p_id;
  perform public.notify(s.requester_id, case when p_approve then 'ההחלפה אושרה' else 'ההחלפה נדחתה' end, p_note, 'my');
  perform public.notify(s.target_id, case when p_approve then 'ההחלפה אושרה' else 'ההחלפה נדחתה' end, p_note, 'my');
end $$;
