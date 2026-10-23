import { KINDS } from './data.ts'
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
  /** Required headcount for a shift. */
  need: (date: string, kind: ShiftKind) => number
  seed?: number
}

export interface DraftResult {
  assignments: Assignment[]
  /** Slots nobody could take without breaking a hard rule. */
  unfilled: number
  /** Violations (hard or soft) still present in the finished week. */
  remaining: number
}

/** Hardest slots first: nights, then Fri/Sat, then the rest. */
const slotOrder = (s: Slot) => {
  const wd = weekday(s.date)
  const weekend = wd === 5 || wd === 6 ? 0 : 1
  const kind = { night: 0, evening: 1, morning: 2, mid: 3 }[s.kind]
  return (s.kind === 'night' ? 0 : 10) + weekend * 5 + kind
}

const mk = (date: string, kind: ShiftKind, employeeId: string): Assignment => ({
  id: `${date}|${kind}|${employeeId}`,
  date,
  kind,
  employeeId,
})

/**
 * Builds a week that follows every rule:
 *  1. fills each required slot, treating soft rules and "can't" preferences as strict;
 *  2. fills whatever is left while only accepting soft warnings, never hard breaks;
 *  3. repairs weekly minimums by swapping shifts from people who can spare them,
 *     or by adding an extra shift when needed.
 */
export function autoDraft({ weekStart, employees, rules, existing, ctx, need: needFor, seed = 1 }: Options): DraftResult {
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

  const onLeave = (id: string) =>
    (ctx.timeOff ?? []).some((t) => t.status === 'approved' && t.employeeId === id && t.from <= weekEnd && t.to >= weekStart)

  /** Weekly minimum that applies to this person (0 when none, or when they're on leave). */
  const minOf = (id: string) => {
    if (onLeave(id)) return 0
    let min = 0
    for (const r of rules) {
      if (!r.enabled || r.params.type !== 'minPerWeek') continue
      if (r.who !== 'all' && !r.who.includes(id)) continue
      if ((r.from && weekStart < r.from) || (r.to && weekStart > r.to)) continue
      min = Math.max(min, r.params.min)
    }
    return min
  }

  let rnd = seed
  const jitter = () => {
    rnd = (rnd * 1664525 + 1013904223) % 4294967296
    return (rnd / 4294967296) * 0.9
  }

  const countsOf = (list: Assignment[]) => {
    const m = new Map<string, number>()
    for (const a of list) m.set(a.employeeId, (m.get(a.employeeId) ?? 0) + 1)
    return m
  }

  const violationsOf = (chosen: Assignment[]) => validate([...base, ...chosen], rules, employees, weekStart, ctx)

  /** Lower is better: hard breaks, then any violation, then people still short of their minimum. */
  const cost = (chosen: Assignment[]) => {
    const v = violationsOf(chosen)
    const counts = countsOf(chosen)
    let deficit = 0
    for (const e of pool) deficit += Math.max(0, minOf(e.id) - (counts.get(e.id) ?? 0))
    return v.filter((x) => x.severity === 'hard').length * 1000 + v.length * 10 + deficit
  }

  const pickFor = (slot: Slot, chosen: Assignment[], relaxed: boolean): Employee | null => {
    const current = [...base, ...chosen]
    const before = new Set(validate(current, rules, employees, undefined, ctx).map((v) => v.key))
    const counts = countsOf(chosen)
    const nights = countsOf(chosen.filter((a) => a.kind === 'night'))
    let best: { e: Employee; score: number } | null = null

    for (const e of pool) {
      if (chosen.some((a) => a.employeeId === e.id && a.date === slot.date)) continue
      const cand = mk(slot.date, slot.kind, e.id)
      const added = validate([...current, cand], rules, employees, undefined, ctx).filter((v) => !before.has(v.key))
      if (added.some((v) => v.severity === 'hard')) continue
      if (!relaxed && added.length) continue

      const n = counts.get(e.id) ?? 0
      const min = minOf(e.id)
      const p = pref.get(`${e.id}|${slot.date}|${slot.kind}`)
      const score =
        (n / Math.max(e.target, min)) * 10 +
        (slot.kind === 'night' ? (nights.get(e.id) ?? 0) * 3 : 0) +
        added.length * 8 +
        (p === 'prefer' ? -6 : 0) +
        (n < min ? -4 : 0) +
        jitter()
      if (!best || score < best.score) best = { e, score }
    }
    return best?.e ?? null
  }

  const slots: Slot[] = []
  for (const date of dates) {
    for (const kind of KINDS) {
      for (let i = 0; i < needFor(date, kind); i++) slots.push({ date, kind })
    }
  }
  slots.sort((a, b) => slotOrder(a) - slotOrder(b) || a.date.localeCompare(b.date))

  const chosen: Assignment[] = []
  const pending: Slot[] = []

  for (const slot of slots) {
    const e = pickFor(slot, chosen, false)
    if (e) chosen.push(mk(slot.date, slot.kind, e.id))
    else pending.push(slot)
  }

  const hardCount = (list: Assignment[]) => violationsOf(list).filter((v) => v.severity === 'hard').length
  const replace = (next: Assignment[]) => chosen.splice(0, chosen.length, ...next)

  /** Moves someone off another shift into `slot`, then finds a replacement for the shift they left. */
  const rescue = (slot: Slot): boolean => {
    const baseHard = hardCount(chosen)
    for (const e of pool) {
      for (const x of chosen.filter((a) => a.employeeId === e.id)) {
        const trial = [...chosen.filter((a) => a !== x), mk(slot.date, slot.kind, e.id)]
        if (hardCount(trial) > baseHard) continue
        const f = pickFor({ date: x.date, kind: x.kind }, trial, true)
        if (!f) continue
        const next = [...trial, mk(x.date, x.kind, f.id)]
        if (hardCount(next) > baseHard) continue
        replace(next)
        return true
      }
    }
    return false
  }

  /** Replaces the holder of any shift that still has a warning, when someone else fits better. */
  const cleanup = () => {
    for (let guard = 0; guard < 30; guard++) {
      let improved = false
      for (const v of violationsOf(chosen)) {
        if (!v.date || !v.kind) continue
        const a = chosen.find((x) => x.employeeId === v.employeeId && x.date === v.date && x.kind === v.kind)
        if (!a) continue
        const baseCost = cost(chosen)
        let best: { next: Assignment[]; c: number } | null = null
        for (const e of pool) {
          if (e.id === a.employeeId || chosen.some((x) => x.employeeId === e.id && x.date === a.date)) continue
          const next = [...chosen.filter((x) => x !== a), mk(a.date, a.kind, e.id)]
          const c = cost(next)
          if (c < baseCost && (!best || c < best.c)) best = { next, c }
        }
        if (best) {
          replace(best.next)
          improved = true
          break
        }
      }
      if (!improved) return
    }
  }

  let unfilled = 0
  for (const slot of pending) {
    const e = pickFor(slot, chosen, true)
    if (e) chosen.push(mk(slot.date, slot.kind, e.id))
    else if (!rescue(slot)) unfilled++
  }
  cleanup()

  // Repair weekly minimums.
  const stuck = new Set<string>()
  for (let guard = 0; guard < 60; guard++) {
    const counts = countsOf(chosen)
    const needy = pool
      .filter((e) => !stuck.has(e.id) && minOf(e.id) > (counts.get(e.id) ?? 0))
      .sort((a, b) => minOf(b.id) - (counts.get(b.id) ?? 0) - (minOf(a.id) - (counts.get(a.id) ?? 0)))
    if (!needy.length) break
    const e = needy[0]
    const baseCost = cost(chosen)

    // A: take a shift from someone who can spare it.
    let bestSwap: { next: Assignment[]; c: number; spare: number } | null = null
    for (const a of chosen) {
      const h = a.employeeId
      if (h === e.id) continue
      const spare = (counts.get(h) ?? 0) - minOf(h)
      if (spare <= 0) continue
      if (chosen.some((x) => x.employeeId === e.id && x.date === a.date)) continue
      const next = [...chosen.filter((x) => x !== a), mk(a.date, a.kind, e.id)]
      const c = cost(next)
      if (c < baseCost && (!bestSwap || c < bestSwap.c || (c === bestSwap.c && spare > bestSwap.spare))) bestSwap = { next, c, spare }
    }

    // B: add an extra shift, in the least crowded slot.
    let bestAdd: { next: Assignment[]; c: number; crowd: number } | null = null
    if (!bestSwap) {
      for (const date of dates) {
        if (chosen.some((x) => x.employeeId === e.id && x.date === date)) continue
        for (const kind of KINDS) {
          const required = needFor(date, kind)
          if (required === 0) continue
          const crowd = chosen.filter((x) => x.date === date && x.kind === kind).length - required
          const next = [...chosen, mk(date, kind, e.id)]
          const c = cost(next)
          if (c < baseCost && (!bestAdd || c < bestAdd.c || (c === bestAdd.c && crowd < bestAdd.crowd))) bestAdd = { next, c, crowd }
        }
      }
    }

    const pickedNext = bestSwap?.next ?? bestAdd?.next
    if (pickedNext) replace(pickedNext)
    else stuck.add(e.id)
  }
  cleanup()

  return { assignments: chosen, unfilled, remaining: violationsOf(chosen).length }
}
