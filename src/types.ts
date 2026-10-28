export type ShiftKind = 'morning' | 'mid' | 'evening' | 'night'
export type Severity = 'hard' | 'soft'
export type Role = 'admin' | 'main' | 'manager' | 'worker'

export interface Department {
  id: string
  name: string
  sort: number
  active: boolean
}

export interface Attendance {
  employeeId: string
  date: string
  kind: ShiftKind
  status: 'late' | 'absent'
  note: string
}

export interface Employee {
  id: string
  name: string
  target: number
  /** Home department: the board this person is scheduled on by default. */
  departmentId?: string | null
  schedulable?: boolean
  active?: boolean
  email?: string | null
  role?: Role
  userId?: string | null
  mustChangePassword?: boolean
  passwordChangedAt?: string | null
}

export interface Assignment {
  id: string
  date: string
  kind: ShiftKind
  employeeId: string
  /** The board (department) this shift appears on. */
  departmentId: string
  override?: boolean
}

export type RuleParams =
  | { type: 'maxPerRollingWeek'; max: number }
  | { type: 'maxPerWeek'; max: number }
  | { type: 'minPerWeek'; min: number }
  | { type: 'maxNightsPerWeek'; max: number }
  | { type: 'maxFridaysPerMonth'; max: number }
  | { type: 'noKinds'; kinds: ShiftKind[] }
  | { type: 'noWeekdays'; days: number[] }
  | { type: 'noShabbat' }
  | { type: 'noKindAfter'; prev: ShiftKind; next: ShiftKind }

export interface Rule {
  id: string
  label: string
  who: string[] | 'all'
  severity: Severity
  enabled: boolean
  from?: string
  to?: string
  params: RuleParams
}

/** Staffing needs by day type (0 = Sunday .. 6 = Saturday, 7 = holiday), holidays, and settings. */
export interface Config {
  /** department id -> day type -> shift kind -> required headcount */
  staffing: Record<string, Record<number, Record<ShiftKind, number>>>
  holidays: Record<string, string>
  /** Day of the week (0 = Sunday) by which next week's preferences are due. */
  prefDeadlineDay: number
}

export interface AuditEntry {
  id: number
  at: string
  actorId: string | null
  action: string
  detail: Record<string, unknown>
}

export interface TimeOff {
  id: string
  employeeId: string
  from: string
  to: string
  note: string
  status: 'pending' | 'approved' | 'rejected'
  decisionNote?: string
}

/** `cells` keys look like "2026-10-26|night". */
export interface Preference {
  employeeId: string
  weekStart: string
  cells: Record<string, 'prefer' | 'cant'>
  note: string
}

export type SwapStatus = 'pending_peer' | 'pending_manager' | 'approved' | 'rejected' | 'cancelled'

export interface Swap {
  id: string
  kind: 'swap' | 'handover'
  requesterId: string
  requesterAssignmentId: string
  targetId: string
  targetAssignmentId: string | null
  status: SwapStatus
  note: string
  decisionNote: string
  createdAt: string
}

export interface Notice {
  id: string
  title: string
  body: string
  link: string | null
  read: boolean
  createdAt: string
}

export interface Violation {
  key: string
  employeeId: string
  date?: string
  kind?: ShiftKind
  ruleId: string
  severity: Severity
  message: string
  overridden?: boolean
}
