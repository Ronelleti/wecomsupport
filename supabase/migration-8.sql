-- Run once in Supabase SQL Editor, after migration-7.sql.
-- Break sheets (הפסקות): a shift manager opens a list of break slots for a shift,
-- reps pick their slot, and the manager sees who picked what.
-- Everything here is additive: the current production code keeps working.

-- Who can manage breaks: admin, main manager, manager, or anyone flagged as a break manager (אחמ"ש).
alter table public.employees add column breaks_manager boolean not null default false;

create function public.can_manage_breaks() returns boolean
language sql stable security definer set search_path = public as $$
  select public.password_ok() and (
    public.my_role() in ('admin', 'main', 'manager')
    or coalesce((select breaks_manager from public.employees where user_id = auth.uid() and active), false)
  )
$$;
revoke execute on function public.can_manage_breaks() from public, anon;
grant execute on function public.can_manage_breaks() to authenticated;

-- One sheet per department per day.
create table public.break_sheets (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  department_id text not null references public.departments (id),
  title text,
  -- Which breaks each row contains, e.g. [{"name":"הפסקה קצרה","minutes":10},{"name":"הפסקה ארוכה","minutes":30}]
  columns jsonb not null default '[]',
  status text not null default 'draft' check (status in ('draft', 'open', 'closed')),
  created_by text references public.employees (id) on delete set null,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  unique (date, department_id)
);

-- A row a rep can take. `times` lines up with the sheet's columns ("" = no break in that column).
create table public.break_slots (
  id uuid primary key default gen_random_uuid(),
  sheet_id uuid not null references public.break_sheets (id) on delete cascade,
  position int not null,
  label text not null,
  kind text check (kind in ('morning', 'mid', 'evening', 'night')),
  times jsonb not null default '[]',
  chosen_by text references public.employees (id) on delete set null,
  chosen_at timestamptz
);
create index break_slots_sheet_idx on public.break_slots (sheet_id, position);
-- A person can hold only one slot per sheet.
create unique index break_slots_one_per_person on public.break_slots (sheet_id, chosen_by) where chosen_by is not null;

alter table public.break_sheets enable row level security;
alter table public.break_slots enable row level security;

-- Everyone sees published sheets; only break managers see drafts.
create policy break_sheets_read on public.break_sheets for select to authenticated
  using (public.password_ok() and (public.can_manage_breaks() or status in ('open', 'closed')));
create policy break_sheets_write on public.break_sheets for all to authenticated
  using (public.can_manage_breaks()) with check (public.can_manage_breaks());

create policy break_slots_read on public.break_slots for select to authenticated
  using (exists (select 1 from public.break_sheets s where s.id = break_slots.sheet_id));
create policy break_slots_write on public.break_slots for all to authenticated
  using (public.can_manage_breaks()) with check (public.can_manage_breaks());

-- A rep picks (or switches to) a slot. Atomic: if the new slot is already taken, the old choice stays.
create function public.choose_break(p_slot uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me text := public.my_employee_id(); s public.break_slots; sh public.break_sheets;
begin
  if not public.password_ok() or me is null then raise exception 'אין הרשאה'; end if;
  select * into s from public.break_slots where id = p_slot;
  if not found then raise exception 'ההפסקה לא נמצאה'; end if;
  select * into sh from public.break_sheets where id = s.sheet_id;
  if sh.status <> 'open' then raise exception 'הבחירה בהפסקות סגורה'; end if;
  if not exists (
    select 1 from public.assignments a
     where a.employee_id = me and a.date = sh.date and a.department_id = sh.department_id
       and (s.kind is null or a.kind = s.kind)
  ) then raise exception 'אינך משובץ במשמרת הזו'; end if;

  update public.break_slots set chosen_by = null, chosen_at = null
   where sheet_id = sh.id and chosen_by = me and id <> p_slot;
  update public.break_slots set chosen_by = me, chosen_at = now()
   where id = p_slot and (chosen_by is null or chosen_by = me);
  if not found then raise exception 'ההפסקה כבר נבחרה על ידי מישהו אחר'; end if;
end $$;

-- A rep gives their slot back (while the sheet is open); a break manager can clear any slot.
create function public.release_break(p_slot uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me text := public.my_employee_id(); s public.break_slots; sh public.break_sheets;
begin
  if not public.password_ok() then raise exception 'אין הרשאה'; end if;
  select * into s from public.break_slots where id = p_slot;
  if not found then raise exception 'ההפסקה לא נמצאה'; end if;
  select * into sh from public.break_sheets where id = s.sheet_id;
  if not (public.can_manage_breaks() or (s.chosen_by = me and sh.status = 'open')) then raise exception 'אין הרשאה'; end if;
  update public.break_slots set chosen_by = null, chosen_at = null where id = p_slot;
end $$;

-- A break manager puts a person on a slot (replacing whoever had it, and the person's previous slot).
create function public.assign_break(p_slot uuid, p_employee text) returns void
language plpgsql security definer set search_path = public as $$
declare s public.break_slots;
begin
  if not public.can_manage_breaks() then raise exception 'אין הרשאה'; end if;
  select * into s from public.break_slots where id = p_slot;
  if not found then raise exception 'ההפסקה לא נמצאה'; end if;
  update public.break_slots set chosen_by = null, chosen_at = null
   where sheet_id = s.sheet_id and chosen_by = p_employee and id <> p_slot;
  update public.break_slots set chosen_by = p_employee, chosen_at = now() where id = p_slot;
end $$;

-- Reps that work this sheet's department on its date (and shift, when the slots are tied to one).
create function public.break_audience(p_sheet uuid) returns table (employee_id text)
language sql stable security definer set search_path = public as $$
  select distinct a.employee_id
    from public.break_sheets sh
    join public.assignments a on a.date = sh.date and a.department_id = sh.department_id
    join public.employees e on e.id = a.employee_id and e.active and e.user_id is not null
   where sh.id = p_sheet
     and (
       exists (select 1 from public.break_slots k where k.sheet_id = sh.id and k.kind is null)
       or a.kind in (select k.kind from public.break_slots k where k.sheet_id = sh.id and k.kind is not null)
     )
$$;
revoke execute on function public.break_audience(uuid) from public, anon, authenticated;

-- Publish (open for choosing) or take back to draft. Publishing notifies the reps.
create function public.publish_breaks(p_sheet uuid, p_open boolean) returns void
language plpgsql security definer set search_path = public as $$
declare sh public.break_sheets; was text; dept text; r record;
begin
  if not public.can_manage_breaks() then raise exception 'אין הרשאה'; end if;
  select * into sh from public.break_sheets where id = p_sheet;
  if not found then raise exception 'הגיליון לא נמצא'; end if;
  was := sh.status;
  update public.break_sheets
     set status = case when p_open then 'open' else 'draft' end,
         published_at = case when p_open then now() else null end
   where id = p_sheet;
  if p_open and was = 'draft' then
    select name into dept from public.departments where id = sh.department_id;
    for r in select employee_id from public.break_audience(p_sheet) loop
      perform public.notify(r.employee_id, 'נפתחה בחירת הפסקות', dept || ' · ' || to_char(sh.date, 'DD/MM'), 'breaks');
    end loop;
  end if;
end $$;

-- Lock the choices (everyone sees them, nobody can change) or reopen.
create function public.close_breaks(p_sheet uuid, p_closed boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.can_manage_breaks() then raise exception 'אין הרשאה'; end if;
  update public.break_sheets set status = case when p_closed then 'closed' else 'open' end
   where id = p_sheet and status in ('open', 'closed');
end $$;

-- Remind reps who haven't picked yet. Returns how many were reminded.
create function public.remind_breaks(p_sheet uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare sh public.break_sheets; dept text; r record; n integer := 0;
begin
  if not public.can_manage_breaks() then raise exception 'אין הרשאה'; end if;
  select * into sh from public.break_sheets where id = p_sheet and status = 'open';
  if not found then raise exception 'הבחירה לא פתוחה'; end if;
  select name into dept from public.departments where id = sh.department_id;
  for r in
    select employee_id from public.break_audience(p_sheet) a
     where not exists (select 1 from public.break_slots k where k.sheet_id = p_sheet and k.chosen_by = a.employee_id)
  loop
    perform public.notify(r.employee_id, 'תזכורת: בחירת הפסקה', dept || ' · ' || to_char(sh.date, 'DD/MM'), 'breaks');
    n := n + 1;
  end loop;
  return n;
end $$;

revoke execute on function
  public.choose_break(uuid), public.release_break(uuid), public.assign_break(uuid, text),
  public.publish_breaks(uuid, boolean), public.close_breaks(uuid, boolean), public.remind_breaks(uuid)
from public, anon;
grant execute on function
  public.choose_break(uuid), public.release_break(uuid), public.assign_break(uuid, text),
  public.publish_breaks(uuid, boolean), public.close_breaks(uuid, boolean), public.remind_breaks(uuid)
to authenticated;
