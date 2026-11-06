import { assignSlot, chooseSlot, releaseSlot, renumber, summarize } from './breaks.ts'
import { supabase } from './supabase.ts'
import type { Assignment, BreakColumn, BreakSheet, BreakSlot, BreakStatus, ShiftKind } from './types.ts'

/** Everything the breaks screen does with data. One version talks to Supabase, one keeps a local demo copy. */
export interface BreaksApi {
  /** All sheets for a day that the current user may see, with their rows. */
  load(date: string): Promise<BreakSheet[]>
  /** Creates or updates a sheet and its rows. Rows that already exist keep who picked them. */
  saveSheet(sheet: BreakSheet, removedSlotIds: string[]): Promise<void>
  deleteSheet(id: string): Promise<void>
  /** Opens a sheet for choosing (notifying the reps), or takes it back to a draft. */
  publish(id: string, open: boolean): Promise<void>
  /** Locks the choices, or reopens. */
  close(id: string, closed: boolean): Promise<void>
  choose(slotId: string): Promise<void>
  release(slotId: string): Promise<void>
  assign(slotId: string, employeeId: string): Promise<void>
  /** Reminds reps who haven't picked. Returns how many. */
  remind(id: string): Promise<number>
}

// ---------------------------------------------------------------------------------------- Supabase

const db = () => {
  if (!supabase) throw new Error('Supabase is not configured')
  return supabase
}

const fail = (error: { message: string } | null) => {
  if (error) throw new Error(error.message)
}

interface SlotRow {
  id: string
  sheet_id: string
  position: number
  label: string
  kind: ShiftKind | null
  times: string[]
  chosen_by: string | null
  chosen_at: string | null
}

interface SheetRow {
  id: string
  date: string
  department_id: string
  title: string | null
  columns: BreakColumn[]
  status: BreakStatus
  break_slots: SlotRow[]
}

const toSlot = (r: SlotRow): BreakSlot => ({
  id: r.id,
  sheetId: r.sheet_id,
  position: r.position,
  label: r.label,
  kind: r.kind,
  times: r.times,
  chosenBy: r.chosen_by,
  chosenAt: r.chosen_at,
})

export const remoteBreaks: BreaksApi = {
  async load(date) {
    const { data, error } = await db().from('break_sheets').select('*, break_slots(*)').eq('date', date)
    fail(error)
    return (data as SheetRow[]).map((r) => ({
      id: r.id,
      date: r.date,
      departmentId: r.department_id,
      title: r.title ?? '',
      columns: r.columns,
      status: r.status,
      slots: r.break_slots.map(toSlot).sort((a, b) => a.position - b.position),
    }))
  },

  async saveSheet(sheet, removedSlotIds) {
    // The status is left out on purpose: it only changes through publish / close.
    const { error } = await db()
      .from('break_sheets')
      .upsert({ id: sheet.id, date: sheet.date, department_id: sheet.departmentId, title: sheet.title || null, columns: sheet.columns })
    fail(error)
    if (removedSlotIds.length) fail((await db().from('break_slots').delete().in('id', removedSlotIds)).error)
    if (sheet.slots.length) {
      // Who picked a row is not sent, so editing times never wipes a choice.
      const rows = sheet.slots.map((s) => ({ id: s.id, sheet_id: sheet.id, position: s.position, label: s.label, kind: s.kind, times: s.times }))
      fail((await db().from('break_slots').upsert(rows)).error)
    }
  },

  async deleteSheet(id) {
    fail((await db().from('break_sheets').delete().eq('id', id)).error)
  },
  async publish(id, open) {
    fail((await db().rpc('publish_breaks', { p_sheet: id, p_open: open })).error)
  },
  async close(id, closed) {
    fail((await db().rpc('close_breaks', { p_sheet: id, p_closed: closed })).error)
  },
  async choose(slotId) {
    fail((await db().rpc('choose_break', { p_slot: slotId })).error)
  },
  async release(slotId) {
    fail((await db().rpc('release_break', { p_slot: slotId })).error)
  },
  async assign(slotId, employeeId) {
    fail((await db().rpc('assign_break', { p_slot: slotId, p_employee: employeeId })).error)
  },
  async remind(id) {
    const { data, error } = await db().rpc('remind_breaks', { p_sheet: id })
    fail(error)
    return Number(data ?? 0)
  },
}

// ------------------------------------------------------------------------------------- local demo

const KEY = 'wecom-breaks-demo-v1'

export interface LocalContext {
  assignments: Assignment[]
  meId: string
  isManager: boolean
}

/** Demo mode: the same rules as the database, kept in this browser. */
export function localBreaks(context: () => LocalContext): BreaksApi {
  const read = (): BreakSheet[] => {
    try {
      return JSON.parse(localStorage.getItem(KEY) ?? '[]') as BreakSheet[]
    } catch {
      return []
    }
  }
  const write = (sheets: BreakSheet[]) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(sheets))
    } catch {
      // storage unavailable: the demo just won't remember
    }
  }
  const update = (id: string, change: (s: BreakSheet) => BreakSheet) => {
    const sheets = read()
    if (!sheets.some((s) => s.id === id)) throw new Error('הגיליון לא נמצא')
    write(sheets.map((s) => (s.id === id ? change(s) : s)))
  }
  const findSheet = (slotId: string) => read().find((s) => s.slots.some((k) => k.id === slotId)) ?? (() => { throw new Error('ההפסקה לא נמצאה') })()

  return {
    async load(date) {
      const { isManager } = context()
      return read().filter((s) => s.date === date && (isManager || s.status !== 'draft'))
    },
    async saveSheet(sheet, removedSlotIds) {
      const existing = read().find((s) => s.id === sheet.id)
      const kept = new Map((existing?.slots ?? []).map((s) => [s.id, s]))
      const slots = renumber(sheet.slots.filter((s) => !removedSlotIds.includes(s.id))).map((s) => ({
        ...s,
        chosenBy: kept.get(s.id)?.chosenBy ?? null,
        chosenAt: kept.get(s.id)?.chosenAt ?? null,
      }))
      const next: BreakSheet = { ...sheet, status: existing?.status ?? 'draft', slots }
      write([...read().filter((s) => s.id !== sheet.id), next])
    },
    async deleteSheet(id) {
      write(read().filter((s) => s.id !== id))
    },
    async publish(id, open) {
      update(id, (s) => ({ ...s, status: open ? 'open' : 'draft' }))
    },
    async close(id, closed) {
      update(id, (s) => (s.status === 'draft' ? s : { ...s, status: closed ? 'closed' : 'open' }))
    },
    async choose(slotId) {
      const sheet = findSheet(slotId)
      const { assignments, meId } = context()
      update(sheet.id, (s) => chooseSlot(s, slotId, meId, assignments))
    },
    async release(slotId) {
      const sheet = findSheet(slotId)
      const { meId, isManager } = context()
      update(sheet.id, (s) => releaseSlot(s, slotId, meId, isManager))
    },
    async assign(slotId, employeeId) {
      const sheet = findSheet(slotId)
      update(sheet.id, (s) => assignSlot(s, slotId, employeeId))
    },
    async remind(id) {
      const sheet = read().find((s) => s.id === id)
      return sheet ? summarize(sheet, context().assignments).waiting.length : 0
    },
  }
}
