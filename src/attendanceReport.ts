import type { Assignment, Attendance, Department, Employee } from './types.ts'

export interface ReportRow {
  employeeId: string
  name: string
  department: string
  /** Shifts that already took place in the month (up to and including today). */
  scheduled: number
  late: number
  lateLogin: number
  absent: number
  /** Shifts the person showed up for (scheduled minus absences). */
  attended: number
  /** attended / scheduled, as a percentage with one decimal, or null with no shifts. */
  attendancePct: number | null
  /** Shifts with no late arrival, late login or absence, as a percentage of scheduled. */
  punctualPct: number | null
  events: Attendance[]
}

export interface Report {
  month: string
  rows: ReportRow[]
  totals: Omit<ReportRow, 'employeeId' | 'name' | 'department' | 'events'>
}

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null)

const figures = (scheduled: number, late: number, lateLogin: number, absent: number) => {
  const attended = Math.max(0, scheduled - absent)
  const punctual = Math.max(0, scheduled - absent - late - lateLogin)
  return { scheduled, late, lateLogin, absent, attended, attendancePct: pct(attended, scheduled), punctualPct: pct(punctual, scheduled) }
}

interface Input {
  /** First day of the month, YYYY-MM-01. */
  month: string
  assignments: Assignment[]
  attendance: Attendance[]
  employees: Employee[]
  departments: Department[]
  /** Only shifts up to this date count as having taken place. */
  today: string
  /** Limit to one department's members, or 'all'. */
  departmentId: string
}

/** Counts shifts, lateness, late logins and absences per employee for one month. */
export function buildReport({ month, assignments, attendance, employees, departments, today, departmentId }: Input): Report {
  const monthKey = month.slice(0, 7)
  const inMonth = (date: string) => date.slice(0, 7) === monthKey
  const deptName = (id?: string | null) => departments.find((d) => d.id === id)?.name ?? ''

  const rows: ReportRow[] = []
  for (const e of employees) {
    if (departmentId !== 'all' && e.departmentId !== departmentId) continue
    const events = attendance.filter((m) => m.employeeId === e.id && inMonth(m.date)).sort((a, b) => a.date.localeCompare(b.date))
    const scheduled = assignments.filter((a) => a.employeeId === e.id && inMonth(a.date) && a.date <= today).length
    if (scheduled === 0 && events.length === 0) continue
    const count = (status: Attendance['status']) => events.filter((m) => m.status === status).length
    rows.push({
      employeeId: e.id,
      name: e.name,
      department: deptName(e.departmentId),
      ...figures(scheduled, count('late'), count('late_login'), count('absent')),
      events,
    })
  }
  rows.sort((a, b) => a.name.localeCompare(b.name, 'he'))

  const sum = (key: 'scheduled' | 'late' | 'lateLogin' | 'absent') => rows.reduce((n, r) => n + r[key], 0)
  return { month, rows, totals: figures(sum('scheduled'), sum('late'), sum('lateLogin'), sum('absent')) }
}
