import { useMemo, useState } from 'react'
import { HE_DAYS, addDays, fmtDM, fromISO, toISO, weekDates, weekStartOf, weekday } from './dates.ts'
import { api } from './db.ts'
import { KINDS, SHIFTS } from './data.ts'
import { useNameOf } from './employees-context.ts'
import { Sheet, WeekNav } from './ScheduleView.tsx'
import { useApp } from './store.ts'
import { parseAssignmentId, swapViolations } from './swaps.ts'
import type { Assignment, Preference, ShiftKind, Swap } from './types.ts'

const today = () => toISO(new Date())

export const describeId = (id: string) => {
  const p = parseAssignmentId(id)
  return p ? `${HE_DAYS[weekday(p.date)]} ${fmtDM(p.date)} · ${SHIFTS[p.kind].label}` : id
}

export const SWAP_STATUS: Record<Swap['status'], [string, string]> = {
  pending_peer: ['ממתין לעמית', 'bg-amber-100 text-amber-800'],
  pending_manager: ['ממתין לאישור מנהל', 'bg-sky-100 text-sky-800'],
  approved: ['אושר', 'bg-emerald-100 text-emerald-700'],
  rejected: ['נדחה', 'bg-rose-100 text-rose-700'],
  cancelled: ['בוטל', 'bg-stone-100 text-stone-500'],
}

const card = 'rounded-2xl bg-white p-4 shadow-soft ring-1 ring-stone-200/70'
const field = 'w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-base outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200'
const primary = 'rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50'

function Badge({ label, tone }: { label: string; tone: string }) {
  return <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${tone}`}>{label}</span>
}

// ---------------------------------------------------------------- My shifts

export function MyShiftsView({ weekStart, setWeekStart }: { weekStart: string; setWeekStart: (s: string) => void }) {
  const { me, assignments, timeOff, weeks } = useApp()
  const [swapping, setSwapping] = useState<Assignment | null>(null)
  const dates = weekDates(weekStart)
  const published = !!weeks[weekStart]
  const mine = assignments.filter((a) => a.employeeId === me?.id)
  const total = mine.filter((a) => dates.includes(a.date)).length
  const next = mine.filter((a) => a.date >= today()).sort((x, y) => x.date.localeCompare(y.date))[0]
  const daysAway = next ? Math.round((fromISO(next.date).getTime() - fromISO(today()).getTime()) / 864e5) : 0
  const when = daysAway === 0 ? 'היום' : daysAway === 1 ? 'מחר' : `בעוד ${daysAway} ימים`

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">שלום {me?.name} 👋</h1>
        <p className="text-sm text-stone-500">הנה המשמרות שלך</p>
      </div>
      {next && (
        <div className="rise relative overflow-hidden rounded-3xl bg-gradient-to-l from-brand-500 via-brand-500 to-orange-400 p-5 text-white shadow-lift">
          <div className="pointer-events-none absolute -start-12 -top-12 size-44 rounded-full bg-white/15 blur-2xl" />
          <div className="pointer-events-none absolute -bottom-16 end-10 size-40 rounded-full bg-amber-200/25 blur-2xl" />
          <div className="relative flex items-end justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-white/85">המשמרת הבאה שלך · {when}</div>
              <div className="mt-1 text-3xl font-extrabold tracking-tight">
                {HE_DAYS[weekday(next.date)]} {fmtDM(next.date)}
              </div>
            </div>
            <div className="rounded-2xl bg-white/20 px-4 py-2 text-center backdrop-blur">
              <div className="text-base font-bold">{SHIFTS[next.kind].label}</div>
              <div className="text-xs text-white/90" dir="ltr">
                {SHIFTS[next.kind].time}
              </div>
            </div>
          </div>
        </div>
      )}
      <WeekNav weekStart={weekStart} setWeekStart={setWeekStart} />
      {!published ? (
        <div className={`${card} py-12 text-center text-stone-500`}>הסידור לשבוע הזה טרם פורסם</div>
      ) : (
        <>
          <p className="text-sm text-stone-500">סה״כ {total} משמרות השבוע</p>
          <ul className="space-y-2">
            {dates.map((d) => {
              const a = mine.find((x) => x.date === d)
              const off = timeOff.find((t) => t.employeeId === me?.id && t.status === 'approved' && d >= t.from && d <= t.to)
              return (
                <li key={d} className={`${card} flex items-center justify-between gap-3 ${a ? '' : 'opacity-70'}`}>
                  <div>
                    <div className="font-bold">{HE_DAYS[weekday(d)]}</div>
                    <div className="text-xs text-stone-500">{fmtDM(d)}</div>
                  </div>
                  {a ? (
                    <div className="flex flex-1 items-center justify-end gap-3">
                      <div className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold ${SHIFTS[a.kind].head}`}>
                        <span>{SHIFTS[a.kind].label}</span>
                        <span className="text-xs font-normal opacity-80" dir="ltr">
                          {SHIFTS[a.kind].time}
                        </span>
                      </div>
                      {d >= today() && (
                        <button type="button" onClick={() => setSwapping(a)} className="rounded-lg px-3 py-1.5 text-sm text-brand-700 ring-1 ring-brand-200 hover:bg-brand-50">
                          החלפה
                        </button>
                      )}
                    </div>
                  ) : (
                    <span className="text-sm text-stone-400">{off ? '🌴 חופשה' : 'אין משמרת'}</span>
                  )}
                </li>
              )
            })}
          </ul>
        </>
      )}
      {swapping && <SwapDialog mine={swapping} onClose={() => setSwapping(null)} />}
    </div>
  )
}

function SwapDialog({ mine, onClose }: { mine: Assignment; onClose: () => void }) {
  const app = useApp()
  const { me, schedulable, assignments, rules, timeOff, prefs } = app
  const [kind, setKind] = useState<'swap' | 'handover'>('swap')
  const [target, setTarget] = useState('')
  const [theirs, setTheirs] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const others = schedulable.filter((e) => e.id !== me?.id)
  const theirShifts = assignments.filter((a) => a.employeeId === target && a.date >= today()).sort((a, b) => a.date.localeCompare(b.date))
  const ready = !!target && (kind === 'handover' || !!theirs)

  const effect = useMemo(() => {
    if (!me || !ready) return null
    return swapViolations(
      assignments,
      { kind, requesterId: me.id, targetId: target, requesterAssignmentId: mine.id, targetAssignmentId: kind === 'swap' ? theirs : null },
      rules,
      schedulable,
      { timeOff, prefs },
    )
  }, [me, ready, kind, target, theirs, mine.id, assignments, rules, schedulable, timeOff, prefs])

  const submit = async () => {
    setBusy(true)
    const res = await app.run(() => api.requestSwap(kind, mine.id, target, kind === 'swap' ? theirs : null, note), 'הבקשה נשלחה לעמית')
    setBusy(false)
    if (res.ok) onClose()
  }

  return (
    <Sheet title="בקשת החלפה" onClose={onClose}>
      <p className="mb-3 rounded-xl bg-stone-50 px-3 py-2 text-sm">המשמרת שלך: <b>{describeId(mine.id)}</b></p>
      <div className="mb-3 flex rounded-xl bg-stone-100 p-1 text-sm font-semibold">
        {(['swap', 'handover'] as const).map((k) => (
          <button key={k} type="button" onClick={() => setKind(k)} className={`flex-1 rounded-lg py-1.5 ${kind === k ? 'bg-white text-brand-700 shadow-sm' : 'text-stone-500'}`}>
            {k === 'swap' ? 'החלפה (משמרת תמורת משמרת)' : 'מסירה'}
          </button>
        ))}
      </div>
      <div className="space-y-3">
        <select className={field} value={target} onChange={(e) => { setTarget(e.target.value); setTheirs('') }}>
          <option value="">בחרו עמית…</option>
          {others.map((e) => (
            <option key={e.id} value={e.id}>{e.name}</option>
          ))}
        </select>
        {kind === 'swap' && target && (
          <select className={field} value={theirs} onChange={(e) => setTheirs(e.target.value)}>
            <option value="">בחרו משמרת של העמית…</option>
            {theirShifts.map((a) => (
              <option key={a.id} value={a.id}>{describeId(a.id)}</option>
            ))}
          </select>
        )}
        <input className={field} placeholder="הערה (לא חובה)" value={note} onChange={(e) => setNote(e.target.value)} />
        {effect && effect.length > 0 && (
          <ul className="space-y-1 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {effect.slice(0, 4).map((v) => (
              <li key={v.key}>⚠ {schedulable.find((e) => e.id === v.employeeId)?.name}: {v.message}</li>
            ))}
            <li className="text-xs text-amber-700">המנהל יראה זאת לפני האישור.</li>
          </ul>
        )}
        <button type="button" disabled={!ready || busy} onClick={() => void submit()} className={`${primary} w-full`}>
          שליחת בקשה
        </button>
        <p className="text-xs text-stone-500">הבקשה עוברת קודם לעמית ואחר כך לאישור מנהל.</p>
      </div>
    </Sheet>
  )
}

// ----------------------------------------------------------------- Swaps

export function SwapsView() {
  const app = useApp()
  const { me, swaps } = app
  const nameOf = useNameOf()
  const incoming = swaps.filter((s) => s.targetId === me?.id && s.status === 'pending_peer')
  const mine = swaps.filter((s) => s.requesterId === me?.id)
  const done = swaps.filter((s) => s.targetId === me?.id && s.status !== 'pending_peer')

  const text = (s: Swap) =>
    s.kind === 'swap'
      ? `${describeId(s.requesterAssignmentId)}  ⇄  ${describeId(s.targetAssignmentId ?? '')}`
      : `מסירה: ${describeId(s.requesterAssignmentId)}`

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">החלפות</h1>
      <p className="-mt-4 text-sm text-stone-500">כדי לבקש החלפה, היכנסו ל״המשמרות שלי״ ולחצו ״החלפה״ ליד המשמרת.</p>

      <section className="space-y-2">
        <h2 className="text-sm font-bold text-stone-500">בקשות אליי ({incoming.length})</h2>
        {incoming.length === 0 && <p className="text-sm text-stone-400">אין בקשות ממתינות</p>}
        {incoming.map((s) => (
          <div key={s.id} className={card}>
            <div className="font-semibold">{nameOf(s.requesterId)}</div>
            <div className="mt-1 text-sm text-stone-600">{text(s)}</div>
            {s.note && <div className="mt-1 text-xs text-stone-500">“{s.note}”</div>}
            <div className="mt-3 flex gap-2">
              <button type="button" className={primary} onClick={() => void app.run(() => api.respondSwap(s.id, true), 'אישרת, הבקשה עברה למנהל')}>
                אישור
              </button>
              <button type="button" className="rounded-xl px-4 py-2.5 text-sm text-stone-600 ring-1 ring-stone-200" onClick={() => void app.run(() => api.respondSwap(s.id, false), 'הבקשה נדחתה')}>
                דחייה
              </button>
            </div>
          </div>
        ))}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-bold text-stone-500">הבקשות שלי</h2>
        {mine.length === 0 && <p className="text-sm text-stone-400">עדיין לא שלחת בקשות</p>}
        {mine.map((s) => (
          <div key={s.id} className={`${card} flex flex-wrap items-center justify-between gap-2`}>
            <div>
              <div className="text-sm font-medium">{nameOf(s.targetId)}</div>
              <div className="text-sm text-stone-600">{text(s)}</div>
              {s.decisionNote && <div className="text-xs text-stone-500">{s.decisionNote}</div>}
            </div>
            <div className="flex items-center gap-2">
              <Badge label={SWAP_STATUS[s.status][0]} tone={SWAP_STATUS[s.status][1]} />
              {(s.status === 'pending_peer' || s.status === 'pending_manager') && (
                <button type="button" className="text-sm text-stone-500 hover:text-rose-600" onClick={() => void app.run(() => api.cancelSwap(s.id), 'הבקשה בוטלה')}>
                  ביטול
                </button>
              )}
            </div>
          </div>
        ))}
      </section>

      {done.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-bold text-stone-500">היסטוריה</h2>
          {done.map((s) => (
            <div key={s.id} className={`${card} flex items-center justify-between gap-2 text-sm`}>
              <span>
                {nameOf(s.requesterId)}: {text(s)}
              </span>
              <Badge label={SWAP_STATUS[s.status][0]} tone={SWAP_STATUS[s.status][1]} />
            </div>
          ))}
        </section>
      )}
    </div>
  )
}

// -------------------------------------------------------------- Vacations

const TIME_OFF_STATUS = {
  pending: ['ממתין לאישור', 'bg-amber-100 text-amber-800'],
  approved: ['אושר', 'bg-emerald-100 text-emerald-700'],
  rejected: ['נדחה', 'bg-rose-100 text-rose-700'],
} as const

export function TimeOffView() {
  const app = useApp()
  const { me, timeOff } = app
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [note, setNote] = useState('')
  const mine = timeOff.filter((t) => t.employeeId === me?.id).sort((a, b) => b.from.localeCompare(a.from))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!me || !from) return
    const end = to || from
    if (end < from) return alert('תאריך הסיום לפני תאריך ההתחלה')
    const res = await app.run(() => api.requestTimeOff(me.id, from, end, note), 'הבקשה נשלחה למנהל')
    if (res.ok) {
      setFrom('')
      setTo('')
      setNote('')
    }
  }

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold">חופשות</h1>
      <form onSubmit={(e) => void submit(e)} className={`${card} space-y-3`}>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm text-stone-600">
            מתאריך
            <input type="date" className={`${field} mt-1`} value={from} onChange={(e) => setFrom(e.target.value)} min={today()} required />
          </label>
          <label className="text-sm text-stone-600">
            עד תאריך
            <input type="date" className={`${field} mt-1`} value={to} onChange={(e) => setTo(e.target.value)} min={from || today()} />
          </label>
        </div>
        <input className={field} placeholder="הערה (לא חובה)" value={note} onChange={(e) => setNote(e.target.value)} />
        <button className={`${primary} w-full`}>בקשת חופשה</button>
        <p className="text-xs text-stone-500">אחרי שמנהל מאשר, לא ניתן לשבץ אותך בימים האלה.</p>
      </form>

      <ul className="space-y-2">
        {mine.length === 0 && <p className="text-sm text-stone-400">אין בקשות</p>}
        {mine.map((t) => (
          <li key={t.id} className={`${card} flex flex-wrap items-center justify-between gap-2`}>
            <div>
              <div className="font-semibold">
                {fmtDM(t.from)}
                {t.to !== t.from ? ` – ${fmtDM(t.to)}` : ''}
              </div>
              {t.note && <div className="text-xs text-stone-500">{t.note}</div>}
              {t.decisionNote && <div className="text-xs text-stone-500">{t.decisionNote}</div>}
            </div>
            <div className="flex items-center gap-2">
              <Badge label={TIME_OFF_STATUS[t.status][0]} tone={TIME_OFF_STATUS[t.status][1]} />
              {t.status === 'pending' && (
                <button type="button" className="text-sm text-stone-500 hover:text-rose-600" onClick={() => void app.run(() => api.cancelTimeOff(t.id), 'הבקשה בוטלה')}>
                  ביטול
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ------------------------------------------------------------ Preferences

export function PreferencesView() {
  const app = useApp()
  const { me, prefs } = app
  const [weekStart, setWeekStart] = useState(() => addDays(weekStartOf(today()), 7))
  const saved = prefs.find((p) => p.employeeId === me?.id && p.weekStart === weekStart)
  return <PrefsEditor key={weekStart + (saved ? '1' : '0')} weekStart={weekStart} setWeekStart={setWeekStart} saved={saved} />
}

function PrefsEditor({ weekStart, setWeekStart, saved }: { weekStart: string; setWeekStart: (s: string) => void; saved?: Preference }) {
  const app = useApp()
  const { me } = app
  const [cells, setCells] = useState<Preference['cells']>(saved?.cells ?? {})
  const [note, setNote] = useState(saved?.note ?? '')
  const dates = weekDates(weekStart)

  const cycle = (key: string) =>
    setCells((c) => {
      const next = { ...c }
      if (!c[key]) next[key] = 'prefer'
      else if (c[key] === 'prefer') next[key] = 'cant'
      else delete next[key]
      return next
    })

  const save = () => {
    if (!me) return
    void app.run(() => api.savePreference({ employeeId: me.id, weekStart, cells, note }), 'ההעדפות נשמרו')
  }

  const style = (k: ShiftKind, d: string) => {
    const v = cells[`${d}|${k}`]
    return v === 'prefer' ? 'bg-emerald-100 text-emerald-700 ring-emerald-300' : v === 'cant' ? 'bg-rose-100 text-rose-700 ring-rose-300' : 'bg-white text-stone-300 ring-stone-200'
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">העדפות לשבוע</h1>
      <WeekNav weekStart={weekStart} setWeekStart={setWeekStart} />
      <p className="text-sm text-stone-500">לחצו על משבצת: פעם אחת ✓ = מעדיף, פעמיים ✕ = לא יכול, שוב = ביטול. המנהל מתחשב בזה בשיבוץ.</p>
      <div className={`${card} overflow-x-auto`}>
        <table className="w-full min-w-[34rem] border-separate border-spacing-1 text-center text-sm">
          <thead>
            <tr>
              <th />
              {dates.map((d) => (
                <th key={d} className="font-semibold">
                  {HE_DAYS[weekday(d)]}
                  <div className="text-xs font-normal text-stone-400">{fmtDM(d)}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {KINDS.map((k) => (
              <tr key={k}>
                <td className={`rounded-lg px-2 py-2 text-xs font-semibold ${SHIFTS[k].head}`}>{SHIFTS[k].label}</td>
                {dates.map((d) => (
                  <td key={d}>
                    <button type="button" onClick={() => cycle(`${d}|${k}`)} className={`h-11 w-full rounded-lg text-lg ring-1 transition ${style(k, d)}`}>
                      {cells[`${d}|${k}`] === 'prefer' ? '✓' : cells[`${d}|${k}`] === 'cant' ? '✕' : '·'}
                    </button>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <textarea className={field} rows={2} placeholder="הערה למנהל (לא חובה)" value={note} onChange={(e) => setNote(e.target.value)} />
      <button type="button" className={primary} onClick={save}>
        שמירת העדפות
      </button>
    </div>
  )
}
