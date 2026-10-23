import { useEffect, useState } from 'react'
import { fmtDM } from './dates.ts'
import { fetchAudit } from './db.ts'
import { SHIFTS } from './data.ts'
import { useApp } from './store.ts'
import type { AuditEntry, ShiftKind } from './types.ts'

interface Group {
  key: string
  at: string
  actor: string | null
  action: string
  entries: AuditEntry[]
}

const s = (v: unknown) => (typeof v === 'string' ? v : '')

/** Consecutive entries by the same person and action within a few seconds count as one change. */
function group(entries: AuditEntry[]): Group[] {
  const out: Group[] = []
  for (const e of entries) {
    const last = out[out.length - 1]
    if (last && last.actor === e.actorId && last.action === e.action && Math.abs(new Date(last.at).getTime() - new Date(e.at).getTime()) < 15000) {
      last.entries.push(e)
    } else out.push({ key: String(e.id), at: e.at, actor: e.actorId, action: e.action, entries: [e] })
  }
  return out
}

export default function AuditView() {
  const app = useApp()
  const [entries, setEntries] = useState<AuditEntry[] | null>(null)
  const [error, setError] = useState('')
  const nameOf = (id: string | null) => (id ? (app.employees.find((e) => e.id === id)?.name ?? id) : 'מערכת')

  useEffect(() => {
    let alive = true
    fetchAudit()
      .then((r) => alive && setEntries(r))
      .catch(() => alive && setError('טעינת היומן נכשלה'))
    return () => {
      alive = false
    }
  }, [])

  const describe = (g: Group): string => {
    const d = g.entries[0].detail
    const n = g.entries.length
    const person = nameOf(s(d.employee))
    switch (g.action) {
      case 'assignments.insert':
        return n === 1 ? `שיבץ/ה את ${person} ב${SHIFTS[d.kind as ShiftKind]?.label ?? ''} ${s(d.date) && fmtDM(s(d.date))}` : `שיבץ/ה ${n} משמרות`
      case 'assignments.delete':
        return n === 1 ? `הסיר/ה את ${person} מ${SHIFTS[d.kind as ShiftKind]?.label ?? ''} ${s(d.date) && fmtDM(s(d.date))}` : `הסיר/ה ${n} משמרות`
      case 'assignments.update':
        return `עדכן/ה ${n} שיבוצים`
      case 'rules.insert':
        return `הוסיף/ה חוק: ${s(d.label)}`
      case 'rules.update':
        return n === 1 ? `עדכן/ה חוק: ${s(d.label)}` : `עדכן/ה ${n} חוקים`
      case 'rules.delete':
        return `מחק/ה חוק: ${s(d.label)}`
      case 'weeks.insert':
      case 'weeks.update':
        return `${d.published ? 'פרסם/ה' : 'ביטל/ה פרסום של'} שבוע ${fmtDM(s(d.week))}`
      case 'employees.insert':
        return `הוסיף/ה עובד: ${s(d.name)}`
      case 'employees.update':
        return n === 1 ? `עדכן/ה עובד: ${s(d.name)}` : `עדכן/ה ${n} עובדים`
      case 'staffing.update':
      case 'staffing.insert':
        return 'עדכן/ה את הצורך באיוש'
      case 'holidays.insert':
        return `הוסיף/ה חג: ${s(d.name)}`
      case 'holidays.delete':
        return `הסיר/ה חג: ${s(d.name)}`
      default:
        return g.action
    }
  }

  const groups = entries ? group(entries) : []

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">יומן שינויים</h1>
      {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      {!entries && !error && <p className="text-sm text-stone-400">טוען…</p>}
      {entries && groups.length === 0 && <p className="text-sm text-stone-400">אין שינויים עדיין</p>}
      <ul className="space-y-2">
        {groups.map((g) => (
          <li key={g.key} className="flex items-start justify-between gap-3 rounded-2xl bg-white p-3 text-sm shadow-soft ring-1 ring-stone-200/70">
            <div>
              <span className="font-semibold">{nameOf(g.actor)}</span> {describe(g)}
            </div>
            <time className="shrink-0 text-xs text-stone-400" dateTime={g.at}>
              {new Date(g.at).toLocaleString('he-IL', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </time>
          </li>
        ))}
      </ul>
    </div>
  )
}
