-- Run once in Supabase SQL Editor, after migration-6.sql.
-- 1) Renames the first department to "תמיכה בכל המערכת".
-- 2) Adds a third attendance classification: "late_login" (איחור התחברות), next to late and absent.

update public.departments set name = 'תמיכה בכל המערכת' where id = 'tech';

alter table public.attendance drop constraint if exists attendance_status_check;
alter table public.attendance
  add constraint attendance_status_check check (status in ('late', 'late_login', 'absent'));

create or replace function public.mark_attendance(p_employee text, p_date date, p_kind text, p_status text, p_note text) returns void
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
  if p_status not in ('late', 'late_login', 'absent') then raise exception 'סיווג לא תקין'; end if;
  insert into public.attendance (employee_id, date, kind, status, note, marked_by, marked_at)
    values (p_employee, p_date, p_kind, p_status, nullif(trim(p_note), ''), public.my_employee_id(), now())
    on conflict (employee_id, date, kind)
    do update set status = excluded.status, note = excluded.note, marked_by = excluded.marked_by, marked_at = now();
end $$;
