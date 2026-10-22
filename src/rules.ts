import { addDays, weekStartOf, weekday } from './dates.ts'
import { SHIFTS } from './data.ts'
import type { Assignment, Employee, Preference, Rule, ShiftKind, TimeOff, Violation } from './types.ts'

/** A shift counts as "in Shabbat" when it starts between Friday 16:00 and Saturday 18:00. */
export function startsInShabbat(date: string, kind: ShiftKind): boolean {
  const wd = weekday(date)
  const start = SHIFTS[kind].start
  return (wd === 5 && start >= 16) || (wd === 6 && start < 18)
}

const isActive = (r: Rule, date: string) => r.enabled && (!r.from || date >= r.from) && (!r.to || date <= r.to)

const byDate = (a: Assignment, b: Assignment) => a.date.localeCompare(b.date)

function groupBy<T>(items: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>()
  for (const it of items) {
    const k = key(it)
    const list = m.get(k)
    if (list) list.push(it)
    else m.set(k, [it])
  }
  return m
}

export interface Context {
  timeOff?: TimeOff[]
  prefs?: Preference[]
}

/** Every violation in `assignments`. Pass `weekStart` to also evaluate per-week minimums for that week. */
export function validate(
  assignments: Assignment[],
  rules: Rule[],
  employees: Employee[],
  weekStart?: string,
  ctx: Context = {},
): Violation[] {
  const out: Violation[] = []
  const perEmp = groupBy(assignments, (a) => a.employeeId)

  // Built-in: approved vacation (hard) and "can't work" preferences (soft).
  const approved = (ctx.timeOff ?? []).filter((t) => t.status === 'approved')
  const cant = new Set(
    (ctx.prefs ?? []).flatMap((p) => Object.entries(p.cells).filter(([, v]) => v === 'cant').map(([k]) => `${p.employeeId}|${k}`)),
  )
  for (const a of assignments) {
    const base = { employeeId: a.employeeId, date: a.date, kind: a.kind }
    if (approved.some((t) => t.employeeId === a.employeeId && a.date >= t.from && a.date <= t.to)) {
      out.push({ ...base, key: `vacation|${a.employeeId}|${a.date}|${a.kind}`, ruleId: 'vacation', severity: 'hard', message: 'העובד בחופשה' })
    }
    if (cant.has(`${a.employeeId}|${a.date}|${a.kind}`)) {
      out.push({ ...base, key: `pref|${a.employeeId}|${a.date}|${a.kind}`, ruleId: 'pref', severity: 'soft', message: 'ביקש לא לעבוד במשמרת הזו' })
    }
  }

  const flag = (rule: Rule, a: Assignment, message = rule.label) =>
    out.push({
      key: `${rule.id}|${a.employeeId}|${a.date}|${a.kind}`,
      employeeId: a.employeeId,
      date: a.date,
      kind: a.kind,
      ruleId: rule.id,
      severity: rule.severity,
      message,
    })

  // Built-in: one shift per person per day.
  for (const emp of employees) {
    const seen = new Set<string>()
    for (const a of [...(perEmp.get(emp.id) ?? [])].sort(byDate)) {
      if (seen.has(a.date)) {
        out.push({
          key: `double|${a.employeeId}|${a.date}|${a.kind}`,
          employeeId: a.employeeId,
          date: a.date,
          kind: a.kind,
          ruleId: 'double',
          severity: 'hard',
          message: 'כבר משובץ באותו יום',
        })
      }
      seen.add(a.date)
    }
  }

  for (const rule of rules) {
    if (!rule.enabled) continue
    for (const emp of employees) {
      if (rule.who !== 'all' && !rule.who.includes(emp.id)) continue
      const all = [...(perEmp.get(emp.id) ?? [])].sort(byDate)
      const mine = all.filter((a) => isActive(rule, a.date))
      const p = rule.params

      switch (p.type) {
        case 'noKinds':
          mine.filter((a) => p.kinds.includes(a.kind)).forEach((a) => flag(rule, a))
          break
        case 'noWeekdays':
          mine.filter((a) => p.days.includes(weekday(a.date))).forEach((a) => flag(rule, a))
          break
        case 'noShabbat':
          mine.filter((a) => startsInShabbat(a.date, a.kind)).forEach((a) => flag(rule, a))
          break
        case 'maxPerRollingWeek':
          for (const a of mine) {
            const from = addDays(a.date, -6)
            const n = all.filter((x) => x.date >= from && x.date <= a.date).length
            if (n > p.max) flag(rule, a)
          }
          break
        case 'maxPerWeek':
          for (const group of groupBy(mine, (a) => weekStartOf(a.date)).values()) {
            group.slice(p.max).forEach((a) => flag(rule, a))
          }
          break
        case 'maxNightsPerWeek':
          for (const group of groupBy(
            mine.filter((a) => a.kind === 'night'),
            (a) => weekStartOf(a.date),
          ).values()) {
            group.slice(p.max).forEach((a) => flag(rule, a))
          }
          break
        case 'maxFridaysPerMonth':
          for (const group of groupBy(
            mine.filter((a) => weekday(a.date) === 5),
            (a) => a.date.slice(0, 7),
          ).values()) {
            group.slice(p.max).forEach((a) => flag(rule, a))
          }
          break
        case 'noKindAfter':
          for (const a of mine) {
            if (a.kind !== p.next) continue
            const prev = addDays(a.date, -1)
            if (all.some((x) => x.date === prev && x.kind === p.prev)) flag(rule, a)
          }
          break
        case 'minPerWeek':
          // Someone on approved leave that week isn't expected to reach the minimum.
          const leave = approved.some((t) => t.employeeId === emp.id && t.from <= addDays(weekStart ?? '', 6) && t.to >= (weekStart ?? ''))
          if (weekStart && !leave && isActive(rule, weekStart)) {
            const n = all.filter((a) => weekStartOf(a.date) === weekStart).length
            if (n < p.min) {
              out.push({
                key: `${rule.id}|${emp.id}|${weekStart}`,
                employeeId: emp.id,
                ruleId: rule.id,
                severity: rule.severity,
                message: `${rule.label} (יש ${n})`,
              })
            }
          }
          break
      }
    }
  }
  return out
}

/** Violations that adding `cand` would introduce. */
export function checkAdd(
  assignments: Assignment[],
  rules: Rule[],
  employees: Employee[],
  cand: Assignment,
  ctx: Context = {},
): Violation[] {
  const before = new Set(validate(assignments, rules, employees, undefined, ctx).map((v) => v.key))
  return validate([...assignments, cand], rules, employees, undefined, ctx).filter((v) => !before.has(v.key))
}
