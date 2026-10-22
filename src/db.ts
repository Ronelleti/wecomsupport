import { supabase } from './supabase.ts'
import type { Assignment, Employee, Notice, Preference, Role, Rule, Swap, SwapStatus, TimeOff } from './types.ts'

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
}

const toEmployee = (r: EmployeeRow): Employee => ({
  id: r.id,
  name: r.name,
  target: r.target,
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
  return (data as { id: string; date: string; kind: Assignment['kind']; employee_id: string; override: boolean }[]).map(
    (r) => ({
      id: r.id,
      date: r.date,
      kind: r.kind,
      employeeId: r.employee_id,
      ...(r.override ? { override: true } : {}),
    }),
  )
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
      override: !!a.override,
    }))
    const { error } = await db().from('assignments').upsert(rows)
    if (error) throw error
  }
}

/** Upserts only the rules that changed. */
export async function syncRules(prev: Rule[], next: Rule[]) {
  const before = new Map(prev.map((r) => [r.id, JSON.stringify(r)]))
  const changed = next.filter((r) => before.get(r.id) !== JSON.stringify(r))
  if (!changed.length) return
  const { error } = await db().from('rules').upsert(changed.map(fromRule))
  if (error) throw error
}

export interface Extras {
  weeks: Record<string, boolean>
  timeOff: TimeOff[]
  prefs: Preference[]
  swaps: Swap[]
  notices: Notice[]
}

const must = <T>(r: { data: T | null; error: unknown }): T => {
  if (r.error) throw r.error
  return (r.data ?? []) as T
}

export async function fetchExtras(): Promise<Extras> {
  const c = db()
  const [weeks, timeOff, prefs, swaps, notices] = await Promise.all([
    c.from('weeks').select('*'),
    c.from('time_off').select('*').order('from_date'),
    c.from('preferences').select('*'),
    c.from('swaps').select('*').order('created_at', { ascending: false }),
    c.from('notifications').select('*').order('created_at', { ascending: false }).limit(50),
  ])
  return {
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
  async markRead(ids: string[]) {
    if (!ids.length) return
    const { error } = await db().from('notifications').update({ read: true }).in('id', ids)
    if (error) throw new Error(error.message)
  },
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
