import { validate, type Context } from './rules.ts'
import type { Assignment, Employee, Rule, ShiftKind, Violation } from './types.ts'

export interface SwapShape {
  kind: 'swap' | 'handover'
  requesterId: string
  targetId: string
  requesterAssignmentId: string
  targetAssignmentId: string | null
}

/** Assignment ids look like "2026-10-26|night|elad". */
export function parseAssignmentId(id: string): { date: string; kind: ShiftKind; employeeId: string } | null {
  const [date, kind, employeeId] = id.split('|')
  return date && kind && employeeId ? { date, kind: kind as ShiftKind, employeeId } : null
}

/** A shift keeps its department when it changes hands. */
const mk = (date: string, kind: ShiftKind, employeeId: string, departmentId: string): Assignment => ({
  id: `${date}|${kind}|${employeeId}`,
  date,
  kind,
  employeeId,
  departmentId,
})

/** The assignment list after the swap is applied, or null when a shift no longer exists. */
export function applySwap(assignments: Assignment[], s: SwapShape): Assignment[] | null {
  const a = assignments.find((x) => x.id === s.requesterAssignmentId)
  if (!a) return null
  if (s.kind === 'handover') {
    return [...assignments.filter((x) => x.id !== a.id), mk(a.date, a.kind, s.targetId, a.departmentId)]
  }
  const b = assignments.find((x) => x.id === s.targetAssignmentId)
  if (!b) return null
  return [
    ...assignments.filter((x) => x.id !== a.id && x.id !== b.id),
    mk(a.date, a.kind, s.targetId, a.departmentId),
    mk(b.date, b.kind, s.requesterId, b.departmentId),
  ]
}

/** Violations the swap would introduce (hard ones first). */
export function swapViolations(
  assignments: Assignment[],
  s: SwapShape,
  rules: Rule[],
  employees: Employee[],
  ctx: Context,
): Violation[] | null {
  const after = applySwap(assignments, s)
  if (!after) return null
  const before = new Set(validate(assignments, rules, employees, undefined, ctx).map((v) => v.key))
  return validate(after, rules, employees, undefined, ctx)
    .filter((v) => !before.has(v.key))
    .sort((x, y) => (x.severity === y.severity ? 0 : x.severity === 'hard' ? -1 : 1))
}
