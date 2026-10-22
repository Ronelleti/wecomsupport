-- Run once in Supabase SQL Editor, after migration-2.sql.
-- A manager can no longer override a main manager:
--  * shifts saved as an exception (override) can only be changed by admin / main manager
--  * requests that involve a main manager can only be decided by a main manager

create function public.is_top(p_employee text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('admin', 'main') from public.employees where id = p_employee), false)
$$;
revoke execute on function public.is_top(text) from public, anon;
grant execute on function public.is_top(text) to authenticated;

-- Assignments: split the write policy so overrides are protected on update and delete too.
drop policy assignments_write on public.assignments;

create policy assignments_insert on public.assignments
  for insert to authenticated
  with check (
    public.password_ok()
    and public.my_role() in ('admin', 'main', 'manager')
    and (override = false or public.my_role() in ('admin', 'main'))
  );

create policy assignments_update on public.assignments
  for update to authenticated
  using (
    public.password_ok()
    and public.my_role() in ('admin', 'main', 'manager')
    and (override = false or public.my_role() in ('admin', 'main'))
  )
  with check (
    public.password_ok()
    and public.my_role() in ('admin', 'main', 'manager')
    and (override = false or public.my_role() in ('admin', 'main'))
  );

create policy assignments_delete on public.assignments
  for delete to authenticated
  using (
    public.password_ok()
    and public.my_role() in ('admin', 'main', 'manager')
    and (override = false or public.my_role() in ('admin', 'main'))
  );

-- Swap decisions
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

-- Vacation decisions
create or replace function public.decide_time_off(p_id uuid, p_approve boolean, p_note text) returns integer
language plpgsql security definer set search_path = public as $$
declare t public.time_off; removed integer := 0;
begin
  if not public.password_ok() or public.my_role() not in ('main', 'manager') then raise exception 'אין הרשאה'; end if;
  select * into t from public.time_off where id = p_id and status = 'pending';
  if not found then raise exception 'הבקשה לא נמצאה'; end if;
  if t.employee_id = public.my_employee_id() then raise exception 'אי אפשר לאשר בקשה שלך'; end if;
  if public.my_role() = 'manager' and public.is_top(t.employee_id) then
    raise exception 'רק מנהל ראשי יכול להחליט בחופשה של מנהל ראשי';
  end if;
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
