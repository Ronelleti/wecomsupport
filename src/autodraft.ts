import { KINDS, required } from './data.ts'
import { addDays, weekDates, weekday } from './dates.ts'
import { validate, type Context } from './rules.ts'
import type { Assignment, Employee, Rule, ShiftKind } from './types.ts'

interface Slot {
  date: string
  kind: ShiftKind
}

interface Options {
  weekStart: string
  employees: Employee[]
  rules: Rule[]
  /** Everything already saved; shifts inside the target week are ignored. */
  existing: Assignment[]
  ctx: Context
  seed?: number
}

export interface DraftResult {
  assignments: Assignment[]
  unfilled: number
}

/** Hardest slots first: nights, then Fri/Sat, then the rest. */
const slotOrder = (s: Slot) => {
  const wd = weekday(s.date)
  const weekend = wd === 5 || wd === 6 ? 0 : 1
  const kind = { night: 0, evening: 1, morning: 2, mid: 3 }[s.kind]
  return (s.kind === 'night' ? 0 : 10) + weekend * 5 + kind
}

/**
 * Greedy generator: for every required slot it picks the eligible employee who is
 * furthest below their weekly target, never breaking a hard rule or approved vacation.
 * Soft rules and "can't" preferences are avoided when possible.
 */
export function autoDraft({ weekStart, employees, rules, existing, ctx, seed = 1 }: Options): DraftResult {
  const dates = weekDates(weekStart)
  const weekEnd = addDays(weekStart, 6)
  const base = existing.filter(
    (a) => (a.date < weekStart || a.date > weekEnd) && a.date >= addDays(weekStart, -35) && a.date <= addDays(weekStart, 42),
  )

  const pool = employees.filter((e) => e.schedulable !== false && e.active !== false && e.target > 0)
  const pref = new Map<string, 'prefer' | 'cant'>()
  for (const p of ctx.prefs ?? []) {
    for (const [k, v] of Object.entries(p.cells)) pref.set(`${p.employeeId}|${k}`, v)
  }

  let rnd = seed
  const jitter = () => {
    rnd = (rnd * 1664525 + 1013904223) % 4294967296
    return (rnd / 4294967296) * 0.9
  }

  const slots: Slot[] = []
  for (const date of dates) {
    for (const kind of KINDS) {
      for (let i = 0; i < required(date, kind, weekday(date)); i++) slots.push({ date, kind })
    }
  }
  slots.sort((a, b) => slotOrder(a) - slotOrder(b) || a.date.localeCompare(b.date))

  const chosen: Assignment[] = []
  const count = new Map<string, number>()
  const nights = new Map<string, number>()
  let unfilled = 0

  for (const slot of slots) {
    const current = [...base, ...chosen]
    const before = new Set(validate(current, rules, employees, undefined, ctx).map((v) => v.key))
    let best: { e: Employee; score: number } | null = null

    for (const e of pool) {
      if (chosen.some((a) => a.employeeId === e.id && a.date === slot.date)) continue
      const cand: Assignment = { id: `${slot.date}|${slot.kind}|${e.id}`, date: slot.date, kind: slot.kind, employeeId: e.id }
      const added = validate([...current, cand], rules, employees, undefined, ctx).filter((v) => !before.has(v.key))
      if (added.some((v) => v.severity === 'hard')) continue

      const n = count.get(e.id) ?? 0
      const p = pref.get(`${e.id}|${slot.date}|${slot.kind}`)
      const score =
        (n / e.target) * 10 +
        (slot.kind === 'night' ? (nights.get(e.id) ?? 0) * 3 : 0) +
        added.length * 8 +
        (p === 'prefer' ? -6 : 0) +
        (p === 'cant' ? 100 : 0) +
        jitter()
      if (!best || score < best.score) best = { e, score }
    }

    if (!best) {
      unfilled++
      continue
    }
    chosen.push({ id: `${slot.date}|${slot.kind}|${best.e.id}`, date: slot.date, kind: slot.kind, employeeId: best.e.id })
    count.set(best.e.id, (count.get(best.e.id) ?? 0) + 1)
    if (slot.kind === 'night') nights.set(best.e.id, (nights.get(best.e.id) ?? 0) + 1)
  }

  return { assignments: chosen, unfilled }
}
