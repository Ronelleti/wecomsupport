import { DEFAULT_CONFIG } from './data.ts'
import { supabase } from './supabase.ts'
import type { Assignment, AuditEntry, Attendance, Config, Department, Employee, Notice, Preference, Role, Rule, ShiftKind, Swap, SwapStatus, TimeOff } from './types.ts'

const db = () => {
  if (!supabase) throw new Error('Supabase is not configured')
  return supabase
}

interface EmployeeRow {
  id: string
  name: string
  target: number
  schedulable: boolean
  active: boolean
  email: string | null
  user_id: string | null
  role: Role
  must_change_password: boolean
  password_changed_at: string | null
  department_id: string | null
}

const toEmployee = (r: EmployeeRow): Employee => ({
  id: r.id,
  name: r.name,
  target: r.target,
  departmentId: r.department_id,
  schedulable: r.schedulable,
  active: r.active,
  email: r.email,
  role: r.role,
  userId: r.user_id,
  mustChangePassword: r.must_change_password,
  passwordChangedAt: r.password_changed_at,
})

interface RuleRow {
  id: string
  label: string
  who: string[] | 'all'
  severity: Rule['severity']
  enabled: boolean
  from_date: string | null
  to_date: string | null
  params: Rule['params']
}

const toRule = (r: RuleRow): Rule => ({
  id: r.id,
  label: r.label,
  who: r.who,
  severity: r.severity,
  enabled: r.enabled,
  ...(r.from_date ? { from: r.from_date } : {}),
  ...(r.to_date ? { to: r.to_date } : {}),
  params: r.params,
})

const fromRule = (r: Rule) => ({
  id: r.id,
  label: r.label,
  who: r.who,
  severity: r.severity,
  enabled: r.enabled,
  from_date: r.from ?? null,
  to_date: r.to ?? null,
  params: r.params,
})

export async function fetchMe(userId: string): Promise<Employee | null> {
  const { data, error } = await db().from('employees').select('*').eq('user_id', userId).maybeSingle()
  if (error) throw error
  return data ? toEmployee(data as EmployeeRow) : null
}

export async function fetchEmployees(): Promise<Employee[]> {
  const { data, error } = await db().from('employees').select('*').order('name')
  if (error) throw error
  return (data as EmployeeRow[]).map(toEmployee)
}

export async function fetchRules(): Promise<Rule[]> {
  const { data, error } = await db().from('rules').select('*').order('sort')
  if (error) throw error
  return (data as RuleRow[]).map(toRule)
}

export async function fetchAssignments(): Promise<Assignment[]> {
  const { data, error } = await db().from('assignments').select('*')
  if (error) throw error
  return (
    data as { id: string; date: string; kind: Assignment['kind']; employee_id: string; department_id: string; override: boolean }[]
  ).map((r) => ({
    id: r.id,
    date: r.date,
    kind: r.kind,
    employeeId: r.employee_id,
    departmentId: r.department_id,
    ...(r.override ? { override: true } : {}),
  }))
}

/** Writes the difference between two assignment lists. */
export async function syncAssignments(prev: Assignment[], next: Assignment[]) {
  const nextIds = new Set(next.map((a) => a.id))
  const prevIds = new Set(prev.map((a) => a.id))
  const removed = prev.filter((a) => !nextIds.has(a.id)).map((a) => a.id)
  const added = next.filter((a) => !prevIds.has(a.id))
  if (removed.length) {
    const { error } = await db().from('assignments').delete().in('id', removed)
    if (error) throw error
  }
  if (added.length) {
    const rows = added.map((a) => ({
      id: a.id,
      date: a.date,
      kind: a.kind,
      employee_id: a.employeeId,
      department_id: a.departmentId,
      override: !!a.override,
    }))
    const { error } = await db().from('assignments').upsert(rows)
    if (error) throw error
  }
}

/** Upserts the rules that changed and deletes the ones that were removed. */
export async function syncRules(prev: Rule[], next: Rule[]) {
  const before = new Map(prev.map((r) => [r.id, JSON.stringify(r)]))
  const nextIds = new Set(next.map((r) => r.id))
  const removed = prev.filter((r) => !nextIds.has(r.id)).map((r) => r.id)
  const changed = next.filter((r) => before.get(r.id) !== JSON.stringify(r))
  if (removed.length) {
    const { error } = await db().from('rules').delete().in('id', removed)
    if (error) throw error
  }
  if (changed.length) {
    // `sort` follows the order in the list, so new rules appear where the user put them.
    const rows = changed.map((r) => ({ ...fromRule(r), sort: next.findIndex((x) => x.id === r.id) }))
    const { error } = await db().from('rules').upsert(rows)
    if (error) throw error
  }
}

export interface Extras {
  weeks: Record<string, boolean>
  timeOff: TimeOff[]
  prefs: Preference[]
  swaps: Swap[]
  notices: Notice[]
  config: Config
  departments: Department[]
  attendance: Attendance[]
}

const must = <T>(r: { data: T | null; error: unknown }): T => {
  if (r.error) throw r.error
  return (r.data ?? []) as T
}

export async function fetchExtras(): Promise<Extras> {
  const c = db()
  const [weeks, timeOff, prefs, swaps, notices, staffing, holidays, settings, depts, attendance] = await Promise.all([
    c.from('weeks').select('*'),
    c.from('time_off').select('*').order('from_date'),
    c.from('preferences').select('*'),
    c.from('swaps').select('*').order('created_at', { ascending: false }),
    c.from('notifications').select('*').order('created_at', { ascending: false }).limit(50),
    c.from('staffing').select('*'),
    c.from('holidays').select('*'),
    c.from('app_settings').select('*'),
    c.from('departments').select('*').order('sort'),
    c.from('attendance').select('*').order('date', { ascending: false }),
  ])
  const departments = must<{ id: string; name: string; sort: number; active: boolean }[]>(depts)
  const config: Config = {
    staffing: Object.fromEntries(
      departments.map((d) => [d.id, structuredClone(DEFAULT_CONFIG.staffing.service)]),
    ),
    holidays: Object.fromEntries(must<{ date: string; name: string }[]>(holidays).map((h) => [h.date, h.name])),
    prefDeadlineDay: DEFAULT_CONFIG.prefDeadlineDay,
  }
  for (const s of must<{ department_id: string; day_type: number; kind: ShiftKind; required: number }[]>(staffing)) {
    const dept = (config.staffing[s.department_id] ??= structuredClone(DEFAULT_CONFIG.staffing.service))
    dept[s.day_type] = { ...dept[s.day_type], [s.kind]: s.required }
  }
  const deadline = must<{ key: string; value: unknown }[]>(settings).find((s) => s.key === 'pref_deadline_day')
  if (typeof deadline?.value === 'number') config.prefDeadlineDay = deadline.value
  return {
    config,
    departments,
    attendance: must<{ employee_id: string; date: string; kind: ShiftKind; status: 'late' | 'absent'; note: string | null }[]>(attendance).map((a) => ({
      employeeId: a.employee_id,
      date: a.date,
      kind: a.kind,
      status: a.status,
      note: a.note ?? '',
    })),
    weeks: Object.fromEntries(
      must<{ week_start: string; published: boolean }[]>(weeks).map((w) => [w.week_start, w.published]),
    ),
    timeOff: must<Record<string, string>[]>(timeOff).map((t) => ({
      id: t.id,
      employeeId: t.employee_id,
      from: t.from_date,
      to: t.to_date,
      note: t.note ?? '',
      status: t.status as TimeOff['status'],
      decisionNote: t.decision_note ?? '',
    })),
    prefs: must<Record<string, unknown>[]>(prefs).map((p) => ({
      employeeId: p.employee_id as string,
      weekStart: p.week_start as string,
      cells: (p.cells ?? {}) as Preference['cells'],
      note: (p.note as string) ?? '',
    })),
    swaps: must<Record<string, string | null>[]>(swaps).map((s) => ({
      id: s.id as string,
      kind: s.kind as Swap['kind'],
      requesterId: s.requester_id as string,
      requesterAssignmentId: s.requester_assignment_id as string,
      targetId: s.target_id as string,
      targetAssignmentId: s.target_assignment_id,
      status: s.status as SwapStatus,
      note: s.note ?? '',
      decisionNote: s.decision_note ?? '',
      createdAt: s.created_at as string,
    })),
    notices: must<Record<string, string | boolean | null>[]>(notices).map((n) => ({
      id: n.id as string,
      title: n.title as string,
      body: (n.body as string) ?? '',
      link: n.link as string | null,
      read: n.read as boolean,
      createdAt: n.created_at as string,
    })),
  }
}

async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await db().rpc(name, args)
  if (error) throw new Error(error.message)
  return data
}

export const api = {
  publishWeek: (week: string, publish: boolean) => rpc('publish_week', { p_week: week, p_publish: publish }),
  requestSwap: (kind: Swap['kind'], mine: string, target: string, theirs: string | null, note: string) =>
    rpc('request_swap', { p_kind: kind, p_my: mine, p_target: target, p_their: theirs, p_note: note }),
  respondSwap: (id: string, accept: boolean) => rpc('respond_swap', { p_id: id, p_accept: accept }),
  cancelSwap: (id: string) => rpc('cancel_swap', { p_id: id }),
  decideSwap: (id: string, approve: boolean, note: string) => rpc('decide_swap', { p_id: id, p_approve: approve, p_note: note }),
  decideTimeOff: (id: string, approve: boolean, note: string) =>
    rpc('decide_time_off', { p_id: id, p_approve: approve, p_note: note }) as Promise<number>,
  async requestTimeOff(employeeId: string, from: string, to: string, note: string) {
    const { error } = await db().from('time_off').insert({ employee_id: employeeId, from_date: from, to_date: to, note })
    if (error) throw new Error(error.message)
  },
  async cancelTimeOff(id: string) {
    const { error } = await db().from('time_off').delete().eq('id', id)
    if (error) throw new Error(error.message)
  },
  async savePreference(p: Preference) {
    const { error } = await db()
      .from('preferences')
      .upsert({ employee_id: p.employeeId, week_start: p.weekStart, cells: p.cells, note: p.note, updated_at: new Date().toISOString() })
    if (error) throw new Error(error.message)
  },
  async saveEmployee(e: {
    id: string
    name: string
    target: number
    departmentId: string
    schedulable: boolean
    active: boolean
    role?: Role
    isNew?: boolean
  }) {
    const row = {
      id: e.id,
      name: e.name,
      target: e.target,
      department_id: e.departmentId,
      schedulable: e.schedulable,
      active: e.active,
      ...(e.role ? { role: e.role } : {}),
    }
    const { error } = e.isNew ? await db().from('employees').insert(row) : await db().from('employees').update(row).eq('id', e.id)
    if (error) throw new Error(error.message)
  },
  async saveStaffing(config: Config) {
    const rows = Object.entries(config.staffing).flatMap(([department, days]) =>
      Object.entries(days).flatMap(([day, kinds]) =>
        Object.entries(kinds).map(([kind, required]) => ({ department_id: department, day_type: Number(day), kind, required })),
      ),
    )
    const { error } = await db().from('staffing').upsert(rows)
    if (error) throw new Error(error.message)
  },
  async saveDepartment(d: Department) {
    const { error } = await db().from('departments').upsert({ id: d.id, name: d.name, sort: d.sort, active: d.active })
    if (error) throw new Error(error.message)
    // A new department starts with no staffing needs: create its rows so they can be edited.
    const rows = Object.entries(DEFAULT_CONFIG.staffing.service).flatMap(([day, kinds]) =>
      Object.keys(kinds).map((kind) => ({ department_id: d.id, day_type: Number(day), kind, required: 0 })),
    )
    const { error: e2 } = await db().from('staffing').upsert(rows, { onConflict: 'department_id,day_type,kind', ignoreDuplicates: true })
    if (e2) throw new Error(e2.message)
  },
  markAttendance: (employeeId: string, date: string, kind: ShiftKind, status: 'late' | 'absent' | '', note: string) =>
    rpc('mark_attendance', { p_employee: employeeId, p_date: date, p_kind: kind, p_status: status, p_note: note }),
  async saveHolidays(holidays: Record<string, string>, removed: string[]) {
    if (removed.length) {
      const { error } = await db().from('holidays').delete().in('date', removed)
      if (error) throw new Error(error.message)
    }
    const rows = Object.entries(holidays).map(([date, name]) => ({ date, name }))
    if (rows.length) {
      const { error } = await db().from('holidays').upsert(rows)
      if (error) throw new Error(error.message)
    }
  },
  async savePrefDeadline(day: number) {
    const { error } = await db().from('app_settings').upsert({ key: 'pref_deadline_day', value: day })
    if (error) throw new Error(error.message)
  },
  savePushSubscription: (endpoint: string, p256dh: string, auth: string, ua: string) =>
    rpc('save_push_subscription', { p_endpoint: endpoint, p_p256dh: p256dh, p_auth: auth, p_ua: ua }),
  removePushSubscription: (endpoint: string) => rpc('remove_push_subscription', { p_endpoint: endpoint }),
  remindPreferences: (week: string) => rpc('remind_preferences', { p_week: week }) as Promise<number>,
  calendarToken: () => rpc('get_calendar_token', {}) as Promise<string>,
  async markRead(ids: string[]) {
    if (!ids.length) return
    const { error } = await db().from('notifications').update({ read: true }).in('id', ids)
    if (error) throw new Error(error.message)
  },
}

export async function fetchAudit(limit = 300): Promise<AuditEntry[]> {
  const { data, error } = await db().from('audit_log').select('*').order('id', { ascending: false }).limit(limit)
  if (error) throw error
  return (data as { id: number; at: string; actor_id: string | null; action: string; detail: Record<string, unknown> }[]).map((r) => ({
    id: r.id,
    at: r.at,
    actorId: r.actor_id,
    action: r.action,
    detail: r.detail,
  }))
}

export async function markPasswordChanged() {
  const { error } = await db().rpc('mark_password_changed')
  if (error) throw error
}

export interface UserAction {
  action: 'create' | 'reset'
  employeeId?: string
  name?: string
  email?: string
  role?: Role
  departmentId?: string
}

/** Calls the server-side function that creates logins and resets passwords. Returns the one-time password. */
export async function callUsers(body: UserAction): Promise<{ password: string; employeeId: string }> {
  const { data } = await db().auth.getSession()
  const res = await fetch('/.netlify/functions/users', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${data.session?.access_token ?? ''}` },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error ?? 'הפעולה נכשלה')
  return json
}
