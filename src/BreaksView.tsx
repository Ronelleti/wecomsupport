import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BREAK_PRESETS, SUGGESTED_STARTS, audience, canTake, generateRows, mySlot, renumber, summarize } from './breaks.ts'
import { localBreaks, remoteBreaks, type BreaksApi } from './breaksApi.ts'
import { KINDS, SHIFTS } from './data.ts'
import { HE_DAYS, addDays, fmtDM, toISO, weekday } from './dates.ts'
import { useApp } from './store.ts'
import type { BreakColumn, BreakSheet, BreakSlot, ShiftKind } from './types.ts'

const card = 'rounded-2xl bg-white p-4 shadow-soft ring-1 ring-stone-200/70'
const input = 'rounded-lg border border-stone-200 bg-white px-3 py-2 text-base outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200'
const primary = 'rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50'
const ghost = 'rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-stone-700 shadow-soft ring-1 ring-stone-200/70 hover:bg-stone-50 disabled:opacity-50'

const STATUS = {
  draft: ['טיוטה', 'bg-amber-100 text-amber-800'],
  open: ['פתוח לבחירה', 'bg-emerald-100 text-emerald-700'],
  closed: ['הבחירה נעולה', 'bg-stone-200 text-stone-700'],
} as const

const newId = () => crypto.randomUUID()

/** Break choices: reps pick a row, managers (אחמ"שים) open the sheet and see who picked what. */
export default function BreaksView() {
  const app = useApp()
  const { me, assignments, departments, employees } = app
  const canManage = app.canManageBreaks
  const [date, setDate] = useState(() => toISO(new Date()))
  const [sheets, setSheets] = useState<BreakSheet[] | null>(null)
  const [message, setMessage] = useState<{ text: string; tone: 'ok' | 'err' } | null>(null)
  const [editing, setEditing] = useState<{ sheet: BreakSheet; removed: string[] } | null>(null)

  // The demo copy needs the latest schedule and user without being rebuilt on every render.
  const latest = useRef({ assignments, meId: me?.id ?? '', isManager: canManage })
  latest.current = { assignments, meId: me?.id ?? '', isManager: canManage }
  const api: BreaksApi = useMemo(() => (app.online ? remoteBreaks : localBreaks(() => latest.current)), [app.online])

  const nameOf = (id: string | null) => (id ? (employees.find((e) => e.id === id)?.name ?? id) : '')
  const flash = (text: string, tone: 'ok' | 'err' = 'ok') => {
    setMessage({ text, tone })
    setTimeout(() => setMessage((m) => (m?.text === text ? null : m)), 3500)
  }

  const refresh = useCallback(async () => {
    try {
      setSheets(await api.load(date))
    } catch {
      setMessage({ text: 'טעינת ההפסקות נכשלה', tone: 'err' })
      setSheets((s) => s ?? [])
    }
  }, [api, date])

  // Choices show up for everyone within a few seconds, without reloading the page.
  useEffect(() => {
    void refresh()
    if (editing) return
    const timer = setInterval(() => {
      if (!document.hidden) void refresh()
    }, 8000)
    return () => clearInterval(timer)
  }, [refresh, editing])

  const act = async (fn: () => Promise<unknown>, done?: string) => {
    try {
      await fn()
      if (done) flash(done)
    } catch (e) {
      flash(e instanceof Error && e.message ? e.message : 'הפעולה נכשלה', 'err')
    }
    await refresh()
  }

  const myDepartments = new Set(assignments.filter((a) => a.employeeId === me?.id && a.date === date).map((a) => a.departmentId))
  const activeDepartments = departments.filter((d) => d.active)
  const visible = (sheets ?? []).filter((s) => canManage || myDepartments.has(s.departmentId))
  const sheetOf = (departmentId: string) => visible.find((s) => s.departmentId === departmentId)
  const dayName = `${HE_DAYS[weekday(date)]} ${fmtDM(date)}`

  const startNew = (departmentId: string) =>
    setEditing({
      removed: [],
      sheet: { id: newId(), date, departmentId, title: '', columns: structuredClone(BREAK_PRESETS[0].columns), status: 'draft', slots: [] },
    })

  const btn = 'grid size-10 place-items-center rounded-xl bg-white text-lg text-stone-600 shadow-soft ring-1 ring-stone-200/70 hover:bg-brand-50'

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">הפסקות</h1>
        <p className="text-sm text-stone-500">
          {canManage ? 'פותחים הפסקות למשמרת, ורואים בזמן אמת מי בחר איזו הפסקה.' : 'בוחרים את שעת ההפסקה שלכם. הבחירות מתעדכנות מיד אצל כולם.'}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <button type="button" aria-label="יום קודם" className={btn} onClick={() => setDate(addDays(date, -1))}>
            ›
          </button>
          <div className="min-w-32 text-center">
            <div className="text-lg font-bold">{dayName}</div>
            <div className="text-xs text-stone-500">{date === toISO(new Date()) ? 'היום' : date.slice(0, 4)}</div>
          </div>
          <button type="button" aria-label="יום הבא" className={btn} onClick={() => setDate(addDays(date, 1))}>
            ‹
          </button>
        </div>
        <input type="date" className={input} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
      </div>

      {message && (
        <p className={`rounded-xl px-3 py-2 text-sm ${message.tone === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-700'}`}>{message.text}</p>
      )}
      {sheets === null && <p className="text-sm text-stone-400">טוען…</p>}

      {sheets !== null && !canManage && visible.length === 0 && (
        <div className={`${card} py-12 text-center text-stone-500`}>
          {myDepartments.size === 0 ? `אינך משובץ ב${dayName}` : `עדיין לא נפתחו הפסקות ל${dayName}`}
        </div>
      )}

      {sheets !== null && canManage &&
        activeDepartments.map((d) => {
          const sheet = sheetOf(d.id)
          return (
            <section key={d.id} className="space-y-2">
              <h2 className="text-sm font-bold text-stone-500">{d.name}</h2>
              {sheet ? (
                <SheetCard
                  sheet={sheet}
                  departmentName={d.name}
                  manager
                  nameOf={nameOf}
                  onEdit={() => setEditing({ sheet: structuredClone(sheet), removed: [] })}
                  onPublish={(open) => void act(() => api.publish(sheet.id, open), open ? 'ההפסקות נפתחו והנציגים קיבלו הודעה' : 'חזר לטיוטה')}
                  onClose={(closed) => void act(() => api.close(sheet.id, closed), closed ? 'הבחירה ננעלה' : 'הבחירה נפתחה מחדש')}
                  onRemind={() =>
                    void act(async () => {
                      const n = await api.remind(sheet.id)
                      flash(n ? `נשלחה תזכורת ל-${n} נציגים` : 'כל הנציגים כבר בחרו')
                    })
                  }
                  onDelete={() => {
                    const taken = sheet.slots.filter((s) => s.chosenBy).length
                    if (confirm(`למחוק את הפסקות ${d.name} של ${dayName}?${taken ? `\nכבר נבחרו ${taken} הפסקות והבחירות יימחקו.` : ''}`)) void act(() => api.deleteSheet(sheet.id), 'נמחק')
                  }}
                  onAssign={(slotId, employeeId) => void act(() => api.assign(slotId, employeeId))}
                  onClear={(slotId) => void act(() => api.release(slotId))}
                />
              ) : (
                <div className={`${card} flex flex-wrap items-center justify-between gap-3`}>
                  <span className="text-sm text-stone-500">עוד לא נפתחו הפסקות ל{d.name} ב{dayName}</span>
                  <button type="button" className={primary} onClick={() => startNew(d.id)}>
                    ☕ פתיחת הפסקות
                  </button>
                </div>
              )}
            </section>
          )
        })}

      {sheets !== null && !canManage &&
        visible.map((sheet) => (
          <SheetCard
            key={sheet.id}
            sheet={sheet}
            departmentName={departments.find((d) => d.id === sheet.departmentId)?.name ?? ''}
            nameOf={nameOf}
            meId={me?.id}
            canTake={(slot) => !!me && canTake(sheet, slot, me.id, assignments)}
            onChoose={(slotId) => void act(() => api.choose(slotId), 'ההפסקה נשמרה')}
            onRelease={(slotId) => void act(() => api.release(slotId), 'הבחירה בוטלה')}
          />
        ))}

      {editing && (
        <Editor
          initial={editing.sheet}
          removedInitial={editing.removed}
          isExisting={(sheets ?? []).some((s) => s.id === editing.sheet.id)}
          departmentName={departments.find((d) => d.id === editing.sheet.departmentId)?.name ?? ''}
          onClose={() => setEditing(null)}
          onSave={async (sheet, removed, publish) => {
            await act(async () => {
              await api.saveSheet(sheet, removed)
              if (publish) await api.publish(sheet.id, true)
            }, publish ? 'ההפסקות נפתחו והנציגים קיבלו הודעה' : 'נשמר')
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ sheet

interface SheetCardProps {
  sheet: BreakSheet
  departmentName: string
  nameOf: (id: string | null) => string
  manager?: boolean
  meId?: string
  canTake?: (slot: BreakSlot) => boolean
  onChoose?: (slotId: string) => void
  onRelease?: (slotId: string) => void
  onEdit?: () => void
  onPublish?: (open: boolean) => void
  onClose?: (closed: boolean) => void
  onRemind?: () => void
  onDelete?: () => void
  onAssign?: (slotId: string, employeeId: string) => void
  onClear?: (slotId: string) => void
}

function SheetCard(p: SheetCardProps) {
  const { sheet } = p
  const app = useApp()
  const [label, tone] = STATUS[sheet.status]
  const info = summarize(sheet, app.assignments)
  const mine = p.meId ? mySlot(sheet, p.meId) : undefined
  const open = sheet.status === 'open'
  const audienceIds = audience(sheet, app.assignments)
  const th = 'px-3 py-2 text-xs font-semibold text-stone-600'

  return (
    <div className={`${card} space-y-3`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-bold">
            {p.departmentName}
            {sheet.title ? ` · ${sheet.title}` : ''}
          </div>
          <div className="text-xs text-stone-500">
            נבחרו {info.taken} מתוך {info.total}
            {p.manager && info.reps > 0 ? ` · ${info.reps} נציגים משובצים` : ''}
          </div>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${tone}`}>{label}</span>
      </div>

      {!p.manager && mine && (
        <p className="rounded-xl bg-brand-50 px-3 py-2 text-sm text-brand-800">
          ההפסקה שלך: <b>מס׳ {mine.label}</b>
          {mine.times.filter(Boolean).map((t, i) => (
            <span key={i}>
              {' · '}
              <bdi>{t}</bdi>
            </span>
          ))}
        </p>
      )}
      {!p.manager && !mine && open && <p className="text-sm text-stone-500">בחרו שורה פנויה. אפשר לשנות כל עוד הבחירה פתוחה.</p>}
      {!p.manager && sheet.status === 'closed' && <p className="text-sm text-stone-500">הבחירה ננעלה. לשינוי פנו לאחמ"ש.</p>}

      {p.manager && (
        <>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={ghost} onClick={p.onEdit}>
              ✎ עריכה
            </button>
            {sheet.status === 'draft' ? (
              <button type="button" className={primary} disabled={sheet.slots.length === 0} onClick={() => p.onPublish?.(true)}>
                פרסום לנציגים
              </button>
            ) : (
              <>
                <button type="button" className={ghost} onClick={() => p.onClose?.(sheet.status === 'open')}>
                  {sheet.status === 'open' ? '🔒 נעילת הבחירה' : '🔓 פתיחה מחדש'}
                </button>
                {open && (
                  <button type="button" className={ghost} disabled={info.waiting.length === 0} onClick={p.onRemind}>
                    🔔 תזכורת ({info.waiting.length})
                  </button>
                )}
                <button type="button" className="px-2 py-2 text-sm text-stone-500 hover:text-stone-800" onClick={() => p.onPublish?.(false)}>
                  חזרה לטיוטה
                </button>
              </>
            )}
            <button type="button" className="px-2 py-2 text-sm text-rose-600 hover:text-rose-800" onClick={p.onDelete}>
              🗑 מחיקה
            </button>
          </div>
          {sheet.status !== 'draft' && info.waiting.length > 0 && (
            <p className="text-sm text-stone-600">עוד לא בחרו: {info.waiting.map((id) => p.nameOf(id)).join(', ')}</p>
          )}
          {info.short > 0 && <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">יש יותר נציגים ({info.reps}) מהפסקות ({info.total}): {info.short} יישארו בלי הפסקה. כדאי להוסיף שורות.</p>}
        </>
      )}

      <div className="overflow-x-auto rounded-xl ring-1 ring-stone-200">
        <table className="w-full min-w-[30rem] border-collapse text-center text-sm">
          <thead>
            <tr className="bg-stone-50">
              <th className={th}>מס׳</th>
              {sheet.columns.map((c, i) => (
                <th key={i} className={`${th} ${c.minutes >= 30 ? 'bg-amber-100' : ''}`}>
                  {c.name}
                  <div className="font-normal text-stone-500">{c.minutes} דקות</div>
                </th>
              ))}
              <th className={th}>נציג</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {sheet.slots.length === 0 && (
              <tr>
                <td colSpan={sheet.columns.length + 2} className="py-6 text-stone-400">
                  עוד אין שורות. לחצו על עריכה כדי להוסיף.
                </td>
              </tr>
            )}
            {sheet.slots.map((slot) => {
              const isMine = !!p.meId && slot.chosenBy === p.meId
              return (
                <tr key={slot.id} className={isMine ? 'bg-brand-50' : ''}>
                  <td className="px-3 py-2 font-bold">
                    {slot.label}
                    {slot.kind && <div className="text-[11px] font-normal text-stone-400">{SHIFTS[slot.kind].label}</div>}
                  </td>
                  {sheet.columns.map((_, i) => (
                    <td key={i} className="px-3 py-2 tabular-nums" dir="ltr">
                      {slot.times[i] || '—'}
                    </td>
                  ))}
                  <td className="px-3 py-2">
                    {p.manager ? (
                      <ManagerCell slot={slot} sheet={sheet} audienceIds={audienceIds} nameOf={p.nameOf} onAssign={p.onAssign} onClear={p.onClear} />
                    ) : slot.chosenBy ? (
                      <span className="inline-flex items-center gap-2">
                        <span className={`rounded-full px-2.5 py-0.5 font-medium ${isMine ? 'bg-brand-600 text-white' : 'bg-stone-100 text-stone-700'}`}>{p.nameOf(slot.chosenBy)}</span>
                        {isMine && open && (
                          <button type="button" className="text-xs text-stone-500 hover:text-rose-600" onClick={() => p.onRelease?.(slot.id)}>
                            ביטול
                          </button>
                        )}
                      </span>
                    ) : open && p.canTake?.(slot) ? (
                      <button type="button" className="rounded-lg px-3 py-1 text-sm font-semibold text-brand-700 ring-1 ring-brand-300 hover:bg-brand-50" onClick={() => p.onChoose?.(slot.id)}>
                        {mine ? 'החלפה לכאן' : 'בחירה'}
                      </button>
                    ) : (
                      <span className="text-stone-300">פנוי</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** Who has a row, with a menu to put someone else there or clear it. */
function ManagerCell({
  slot,
  sheet,
  audienceIds,
  nameOf,
  onAssign,
  onClear,
}: {
  slot: BreakSlot
  sheet: BreakSheet
  audienceIds: string[]
  nameOf: (id: string | null) => string
  onAssign?: (slotId: string, employeeId: string) => void
  onClear?: (slotId: string) => void
}) {
  const ids = [...new Set([...audienceIds, ...(slot.chosenBy ? [slot.chosenBy] : [])])]
  const taken = new Set(sheet.slots.filter((s) => s.id !== slot.id && s.chosenBy).map((s) => s.chosenBy))
  return (
    <span className="inline-flex items-center gap-2">
      <select
        value={slot.chosenBy ?? ''}
        onChange={(e) => (e.target.value ? onAssign?.(slot.id, e.target.value) : onClear?.(slot.id))}
        className={`rounded-lg border px-2 py-1 text-sm ${slot.chosenBy ? 'border-brand-300 bg-brand-50 font-semibold' : 'border-stone-200 bg-white text-stone-400'}`}
      >
        <option value="">— פנוי —</option>
        {ids.map((id) => (
          <option key={id} value={id}>
            {nameOf(id)}
            {taken.has(id) ? ' (יעבור לכאן)' : ''}
          </option>
        ))}
      </select>
    </span>
  )
}

// ----------------------------------------------------------------------------------------------- editor

function Editor({
  initial,
  removedInitial,
  isExisting,
  departmentName,
  onClose,
  onSave,
}: {
  initial: BreakSheet
  removedInitial: string[]
  isExisting: boolean
  departmentName: string
  onClose: () => void
  onSave: (sheet: BreakSheet, removed: string[], publish: boolean) => Promise<void>
}) {
  const [draft, setDraft] = useState<BreakSheet>(initial)
  const [removed, setRemoved] = useState<string[]>(removedInitial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [gen, setGen] = useState<{ kind: ShiftKind | 'all'; count: number; starts: string[]; steps: number[] }>({
    kind: 'morning',
    count: 8,
    starts: [...SUGGESTED_STARTS.morning],
    steps: [15, 40, 15],
  })

  const cols = draft.columns

  /** Changes the columns and reshapes every row's times to match. */
  const setColumns = (next: BreakColumn[], reshape: (times: string[]) => string[]) => {
    setDraft((d) => ({ ...d, columns: next, slots: d.slots.map((s) => ({ ...s, times: reshape(s.times) })) }))
    setGen((g) => ({
      ...g,
      starts: Array.from({ length: next.length }, (_, i) => g.starts[i] ?? ''),
      steps: Array.from({ length: next.length }, (_, i) => g.steps[i] ?? 15),
    }))
  }
  const fit = (n: number) => (times: string[]) => Array.from({ length: n }, (_, i) => times[i] ?? '')

  const applyPreset = (id: string) => {
    const preset = BREAK_PRESETS.find((p) => p.id === id)
    if (preset) setColumns(structuredClone(preset.columns), fit(preset.columns.length))
  }
  const addColumn = () => setColumns([...cols, { name: 'הפסקה', minutes: 10 }], fit(cols.length + 1))
  const removeColumn = (i: number) =>
    cols.length > 1 && setColumns(cols.filter((_, j) => j !== i), (times) => times.filter((_, j) => j !== i))
  const patchColumn = (i: number, patch: Partial<BreakColumn>) => setDraft((d) => ({ ...d, columns: d.columns.map((c, j) => (j === i ? { ...c, ...patch } : c)) }))

  const setKindForGenerator = (kind: ShiftKind | 'all') =>
    setGen((g) => ({ ...g, kind, starts: kind !== 'all' && cols.length === 3 ? [...SUGGESTED_STARTS[kind]] : g.starts }))

  const addRows = () => {
    const rows = generateRows({ kind: gen.kind === 'all' ? null : gen.kind, count: gen.count, starts: gen.starts, steps: gen.steps })
    const added: BreakSlot[] = rows.map((r) => ({ id: newId(), sheetId: draft.id, position: 0, label: '', kind: r.kind, times: fit(cols.length)(r.times), chosenBy: null, chosenAt: null }))
    setDraft((d) => ({ ...d, slots: renumber([...d.slots, ...added]) }))
  }
  const addBlankRow = () =>
    setDraft((d) => ({ ...d, slots: renumber([...d.slots, { id: newId(), sheetId: d.id, position: 0, label: '', kind: null, times: fit(cols.length)([]), chosenBy: null, chosenAt: null }]) }))
  const patchSlot = (id: string, patch: Partial<BreakSlot>) => setDraft((d) => ({ ...d, slots: d.slots.map((s) => (s.id === id ? { ...s, ...patch } : s)) }))
  const removeSlot = (slot: BreakSlot) => {
    if (slot.chosenBy && !confirm('כבר נבחרה ההפסקה הזו. למחוק את השורה ואת הבחירה?')) return
    setDraft((d) => ({ ...d, slots: renumber(d.slots.filter((s) => s.id !== slot.id)) }))
    setRemoved((r) => (isExisting ? [...r, slot.id] : r))
  }

  const save = async (publish: boolean) => {
    if (draft.slots.length === 0) return setError('הוסיפו לפחות שורה אחת')
    if (cols.some((c) => !c.name.trim())) return setError('לכל הפסקה צריך שם')
    setBusy(true)
    setError('')
    await onSave({ ...draft, slots: renumber(draft.slots) }, removed, publish)
    setBusy(false)
  }

  const small = 'rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-brand-500'

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-stone-900/40 backdrop-blur-[2px] md:items-center" onClick={onClose}>
      <div className="max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-white p-5 shadow-xl md:max-w-3xl md:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">
            הפסקות · {departmentName} · {fmtDM(draft.date)}
          </h2>
          <button type="button" onClick={onClose} aria-label="סגור" className="grid size-9 place-items-center rounded-full bg-stone-100 text-stone-600 hover:bg-stone-200">
            ✕
          </button>
        </div>

        <div className="space-y-5">
          <label className="block text-sm text-stone-600">
            כותרת (לא חובה)
            <input className={`${input} mt-1 w-full`} placeholder="למשל: משמרת בוקר" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          </label>

          <section className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-bold text-stone-700">סוגי ההפסקות בכל שורה</h3>
              <select className={small} value="" onChange={(e) => e.target.value && applyPreset(e.target.value)}>
                <option value="">תבנית מוכנה…</option>
                {BREAK_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            {cols.map((c, i) => (
              <div key={i} className="flex items-center gap-2">
                <input className={`${small} flex-1`} value={c.name} onChange={(e) => patchColumn(i, { name: e.target.value })} />
                <input type="number" min={1} max={120} className={`${small} w-20`} value={c.minutes} onChange={(e) => patchColumn(i, { minutes: Math.max(1, Number(e.target.value) || 1) })} />
                <span className="text-sm text-stone-500">דקות</span>
                <button type="button" disabled={cols.length === 1} onClick={() => removeColumn(i)} aria-label="הסרת הפסקה" className="text-stone-400 hover:text-rose-600 disabled:opacity-30">
                  ✕
                </button>
              </div>
            ))}
            <button type="button" onClick={addColumn} className="text-sm font-semibold text-brand-700">
              + עוד הפסקה בשורה
            </button>
          </section>

          <section className="space-y-3 rounded-2xl bg-stone-50 p-3">
            <h3 className="text-sm font-bold text-stone-700">יצירת שורות אוטומטית</h3>
            <p className="text-xs text-stone-500">בוחרים משמרת, כמה שורות, ושעת התחלה וקפיצה (בדקות) לכל הפסקה. אפשר להוסיף כמה קבוצות, למשל בוקר וביניים, ואחר כך לתקן כל שעה.</p>
            <div className="flex flex-wrap items-center gap-2">
              <select className={small} value={gen.kind} onChange={(e) => setKindForGenerator(e.target.value as ShiftKind | 'all')}>
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    משמרת {SHIFTS[k].label} ({SHIFTS[k].time})
                  </option>
                ))}
                <option value="all">כל המשמרות</option>
              </select>
              <label className="flex items-center gap-1 text-sm text-stone-600">
                שורות
                <input type="number" min={1} max={40} className={`${small} w-16`} value={gen.count} onChange={(e) => setGen({ ...gen, count: Math.max(1, Number(e.target.value) || 1) })} />
              </label>
            </div>
            <div className="space-y-2">
              {cols.map((c, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="w-28 text-stone-600">{c.name || `הפסקה ${i + 1}`}</span>
                  <label className="flex items-center gap-1 text-stone-500">
                    מתחילה ב
                    <input type="time" className={small} value={gen.starts[i] ?? ''} onChange={(e) => setGen({ ...gen, starts: gen.starts.map((s, j) => (j === i ? e.target.value : s)) })} />
                  </label>
                  <label className="flex items-center gap-1 text-stone-500">
                    קפיצה
                    <input type="number" min={0} max={240} className={`${small} w-16`} value={gen.steps[i] ?? 0} onChange={(e) => setGen({ ...gen, steps: gen.steps.map((s, j) => (j === i ? Number(e.target.value) || 0 : s)) })} />
                    דק׳
                  </label>
                </div>
              ))}
            </div>
            <button type="button" className={ghost} onClick={addRows}>
              ➕ הוספת השורות
            </button>
          </section>

          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-stone-700">השורות ({draft.slots.length})</h3>
              <button type="button" onClick={addBlankRow} className="text-sm font-semibold text-brand-700">
                + שורה ריקה
              </button>
            </div>
            <div className="overflow-x-auto rounded-xl ring-1 ring-stone-200">
              <table className="w-full min-w-[32rem] text-center text-sm">
                <thead>
                  <tr className="bg-stone-50 text-xs text-stone-500">
                    <th className="p-2">מס׳</th>
                    <th className="p-2">משמרת</th>
                    {cols.map((c, i) => (
                      <th key={i} className="p-2">
                        {c.name} ({c.minutes})
                      </th>
                    ))}
                    <th className="p-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {draft.slots.length === 0 && (
                    <tr>
                      <td colSpan={cols.length + 3} className="py-5 text-stone-400">
                        עוד אין שורות
                      </td>
                    </tr>
                  )}
                  {draft.slots.map((s) => (
                    <tr key={s.id} className={s.chosenBy ? 'bg-brand-50/50' : ''}>
                      <td className="p-2 font-bold">{s.label}</td>
                      <td className="p-2">
                        <select className={small} value={s.kind ?? ''} onChange={(e) => patchSlot(s.id, { kind: (e.target.value || null) as ShiftKind | null })}>
                          <option value="">הכול</option>
                          {KINDS.map((k) => (
                            <option key={k} value={k}>
                              {SHIFTS[k].label}
                            </option>
                          ))}
                        </select>
                      </td>
                      {cols.map((_, i) => (
                        <td key={i} className="p-1">
                          <input
                            type="time"
                            className={`${small} w-28`}
                            value={s.times[i] ?? ''}
                            onChange={(e) => patchSlot(s.id, { times: fit(cols.length)(s.times).map((t, j) => (j === i ? e.target.value : t)) })}
                          />
                        </td>
                      ))}
                      <td className="p-2">
                        <button type="button" onClick={() => removeSlot(s)} aria-label="מחיקת שורה" className="text-stone-400 hover:text-rose-600">
                          🗑
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {error && <p className="text-sm text-rose-600">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} className={primary} onClick={() => void save(draft.status === 'draft')}>
              {draft.status === 'draft' ? 'שמירה ופרסום לנציגים' : 'שמירה'}
            </button>
            {draft.status === 'draft' && (
              <button type="button" disabled={busy} className={ghost} onClick={() => void save(false)}>
                שמירה כטיוטה
              </button>
            )}
            <button type="button" className="px-3 py-2.5 text-sm text-stone-500" onClick={onClose}>
              ביטול
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
