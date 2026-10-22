import { fmtDM } from './dates.ts'
import { api } from './db.ts'
import { useNameOf } from './employees-context.ts'
import { describeId } from './PersonalViews.tsx'
import { useApp } from './store.ts'
import { swapViolations } from './swaps.ts'
import type { Swap } from './types.ts'

const card = 'rounded-2xl bg-white p-4 shadow-soft ring-1 ring-stone-200/70'

/** Manager inbox: shift swaps (after the colleague agreed) and vacation requests. */
export default function RequestsView() {
  const app = useApp()
  const { role, swaps, timeOff, assignments, rules, schedulable, prefs } = app
  const nameOf = useNameOf()
  const swapsPending = swaps.filter((s) => s.status === 'pending_manager')
  const timeOffPending = timeOff.filter((t) => t.status === 'pending')

  const note = (label: string) => window.prompt(label) ?? ''
  /** Requests involving a main manager can only be decided by a main manager. */
  const isTop = (id: string) => ['main', 'admin'].includes(app.employees.find((e) => e.id === id)?.role ?? '')

  const decideSwap = (s: Swap, approve: boolean) => {
    const text = approve ? '' : note('סיבת הדחייה (לא חובה)')
    void app.run(() => api.decideSwap(s.id, approve, text), approve ? 'ההחלפה אושרה' : 'ההחלפה נדחתה')
  }

  const decideTimeOff = async (id: string, approve: boolean) => {
    const text = approve ? '' : note('סיבת הדחייה (לא חובה)')
    const res = await app.run(() => api.decideTimeOff(id, approve, text), approve ? 'החופשה אושרה' : 'החופשה נדחתה')
    if (approve && res.ok && res.value) alert(`הוסרו ${res.value} משמרות של העובד בתקופה הזו. בדקו את החוסרים בסידור.`)
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">בקשות לאישור</h1>

      <section className="space-y-2">
        <h2 className="text-sm font-bold text-stone-500">החלפות משמרות ({swapsPending.length})</h2>
        {swapsPending.length === 0 && <p className="text-sm text-stone-400">אין בקשות ממתינות</p>}
        {swapsPending.map((s) => {
          const effect = swapViolations(
            assignments,
            s,
            rules,
            schedulable,
            { timeOff, prefs },
          )
          const hard = effect?.filter((v) => v.severity === 'hard') ?? []
          const topInvolved = isTop(s.requesterId) || isTop(s.targetId)
          const needsMain = role === 'manager' && topInvolved
          const blocked = effect === null || needsMain || (hard.length > 0 && role !== 'main')
          return (
            <div key={s.id} className={card}>
              <div className="font-semibold">
                {nameOf(s.requesterId)} ⇄ {nameOf(s.targetId)}
                <span className="ms-2 text-xs font-normal text-stone-400">{s.kind === 'swap' ? 'החלפה' : 'מסירה'}</span>
              </div>
              <div className="mt-1 text-sm text-stone-600">
                {s.kind === 'swap'
                  ? `${describeId(s.requesterAssignmentId)}  ⇄  ${describeId(s.targetAssignmentId ?? '')}`
                  : `${describeId(s.requesterAssignmentId)} → ${nameOf(s.targetId)}`}
              </div>
              {s.note && <div className="mt-1 text-xs text-stone-500">“{s.note}”</div>}
              {effect === null && <p className="mt-2 text-sm text-rose-600">אחת המשמרות כבר לא קיימת בסידור.</p>}
              {effect && effect.length > 0 && (
                <ul className="mt-2 space-y-0.5 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  {effect.map((v) => (
                    <li key={v.key} className={v.severity === 'hard' ? 'font-semibold text-rose-700' : ''}>
                      {v.severity === 'hard' ? '🚫' : '⚠'} {nameOf(v.employeeId)}: {v.message}
                    </li>
                  ))}
                </ul>
              )}
              {hard.length > 0 && role !== 'main' && <p className="mt-1 text-xs text-rose-600">חריגה מחוק קשיח: רק מנהל ראשי יכול לאשר.</p>}
              {needsMain && <p className="mt-1 text-xs text-rose-600">הבקשה כוללת מנהל ראשי: רק מנהל ראשי יכול להחליט.</p>}
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  disabled={blocked}
                  onClick={() => decideSwap(s, true)}
                  className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
                >
                  אישור
                </button>
                <button type="button" disabled={needsMain} onClick={() => decideSwap(s, false)} className="rounded-xl px-4 py-2 text-sm text-stone-600 ring-1 ring-stone-200 disabled:opacity-40">
                  דחייה
                </button>
              </div>
            </div>
          )
        })}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-bold text-stone-500">חופשות ({timeOffPending.length})</h2>
        {timeOffPending.length === 0 && <p className="text-sm text-stone-400">אין בקשות ממתינות</p>}
        {timeOffPending.map((t) => (
          <div key={t.id} className={card}>
            <div className="font-semibold">{nameOf(t.employeeId)}</div>
            <div className="text-sm text-stone-600">
              {fmtDM(t.from)}
              {t.to !== t.from ? ` – ${fmtDM(t.to)}` : ''}
            </div>
            {t.note && <div className="mt-1 text-xs text-stone-500">“{t.note}”</div>}
            {role === 'manager' && isTop(t.employeeId) && <p className="mt-1 text-xs text-rose-600">חופשה של מנהל ראשי: רק מנהל ראשי יכול להחליט.</p>}
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                disabled={role === 'manager' && isTop(t.employeeId)}
                onClick={() => void decideTimeOff(t.id, true)}
                className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
              >
                אישור
              </button>
              <button
                type="button"
                disabled={role === 'manager' && isTop(t.employeeId)}
                onClick={() => void decideTimeOff(t.id, false)}
                className="rounded-xl px-4 py-2 text-sm text-stone-600 ring-1 ring-stone-200 disabled:opacity-40"
              >
                דחייה
              </button>
            </div>
          </div>
        ))}
      </section>
    </div>
  )
}
