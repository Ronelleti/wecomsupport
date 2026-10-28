import { createContext, useContext } from 'react'
import type { Assignment, Attendance, Config, Department, Employee, Notice, Preference, Role, Rule, ShiftKind, Swap, TimeOff } from './types.ts'

export type Result<T> = { ok: true; value: T } | { ok: false }

export interface AppState {
  /** false in local demo mode: publishing, swaps, vacations etc. are unavailable. */
  online: boolean
  me?: Employee
  role: Role
  employees: Employee[]
  /** Employees that can be put on a shift. */
  schedulable: Employee[]
  assignments: Assignment[]
  rules: Rule[]
  weeks: Record<string, boolean>
  timeOff: TimeOff[]
  prefs: Preference[]
  swaps: Swap[]
  notices: Notice[]
  config: Config
  departments: Department[]
  attendance: Attendance[]
  /** Required headcount for a shift on a date, for one department's board (honours holidays). */
  need: (date: string, kind: ShiftKind, departmentId: string) => number
  saveAssignments: (a: Assignment[]) => void
  saveRules: (r: Rule[]) => void
  canUndo: boolean
  undo: () => void
  /** Runs a server action, refreshes the data and shows `done` (or the error). */
  run: <T>(fn: () => Promise<T>, done?: string) => Promise<Result<T>>
  go: (tab: string) => void
}

export const AppContext = createContext<AppState | null>(null)

export function useApp(): AppState {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('AppContext missing')
  return ctx
}

export const isStaff = (role: Role) => role !== 'worker'
export const canApprove = (role: Role) => role === 'main' || role === 'manager'
