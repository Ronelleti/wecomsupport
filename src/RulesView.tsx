import { useState } from 'react'
import { HE_DAYS } from './dates.ts'
import { KINDS, SHIFTS } from './data.ts'
import { useEmployees, useNameOf } from './employees-context.ts'
import { Sheet } from './ScheduleView.tsx'
import type { Role, Rule, RuleParams, Severity, ShiftKind } from './types.ts'

type RuleType = RuleParams['type']

const TYPES: { id: RuleType; label: string }[] = [
  { id: 'maxPerRollingWeek', label: 'מקסימום משמרות ב-7 ימים רצופים' },
  { id: 'maxPerWeek', label: 'מקסימום משמרות בשבוע (א׳–ש׳)' },
  { id: 'minPerWeek', label: 'מינימום משמרות בשבוע' },
  { id: 'maxNightsPerWeek', label: 'מקסימום לילות בשבוע' },
  { id: 'maxFridaysPerMonth', label: 'מקסימום שישי בחודש' },
  { id: 'noKinds', label: 'ללא סוגי משמרות מסוימים' },
  { id: 'noWeekdays', label: 'ללא ימים מסוימים בשבוע' },
  { id: 'noShabbat', label: 'ללא משמרות בשבת (מכניסתה ועד צאתה)' },
  { id: 'noKindAfter', label: 'ללא משמרת מסוימת ביום אחרי משמרת אחרת' },
]

const kindName = (k: ShiftKind) => SHIFTS[k].label

export function autoLabel(p: RuleParams): string {
  switch (p.type) {
    case 'maxPerRollingWeek':
      return `עד ${p.max} משמרות ב-7 ימים רצופים`
    case 'maxPerWeek':
      return `עד ${p.max} משמרות בשבוע`
    case 'minPerWeek':
      return `לפחות ${p.min} משמרות בשבוע`
    case 'maxNightsPerWeek':
      return `עד ${p.max} לילות בשבוע`
    case 'maxFridaysPerMonth':
      return `עד ${p.max} שישי בחודש`
    case 'noKinds':
      return p.kinds.length ? `ללא משמרות ${p.kinds.map(kindName).join(', ')}` : 'ללא משמרות'
    case 'noWeekdays':
      return p.days.length ? `ללא ימי ${p.days.map((d) => HE_DAYS[d]).join(', ')}` : 'ללא ימים'
    case 'noShabbat':
      return 'ללא משמרות בשבת'
    case 'noKindAfter':
      return `ללא ${kindName(p.next)} אחרי ${kindName(p.prev)}`
  }
}

const defaults: Record<RuleType, RuleParams> = {
  maxPerRollingWeek: { type: 'maxPerRollingWeek', max: 6 },
  maxPerWeek: { type: 'maxPerWeek', max: 5 },
  minPerWeek: { type: 'minPerWeek', min: 5 },
  maxNightsPerWeek: { type: 'maxNightsPerWeek', max: 2 },
  maxFridaysPerMonth: { type: 'maxFridaysPerMonth', max: 2 },
  noKinds: { type: 'noKinds', kinds: ['night'] },
  noWeekdays: { type: 'noWeekdays', days: [6] },
  noShabbat: { type: 'noShabbat' },
  noKindAfter: { type: 'noKindAfter', prev: 'night', next: 'evening' },
}

const field = 'w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-base outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200'

export default function RulesView({ rules, setRules, role }: { rules: Rule[]; setRules: (r: Rule[]) => void; role: Role }) {
  const nameOf = useNameOf()
  const [editing, setEditing] = useState<Rule | 'new' | null>(null)
  const canEdit = role === 'admin' || role === 'main'
  const patch = (id: string, p: Partial<Rule>) => setRules(rules.map((r) => (r.id === id ? { ...r, ...p } : r)))

  const save = (rule: Rule) => {
    setRules(rules.some((r) => r.id === rule.id) ? rules.map((r) => (r.id === rule.id ? rule : r)) : [...rules, rule])
    setEditing(null)
  }

  const remove = (r: Rule) => {
    if (confirm(`למחוק את החוק "${r.label}"?`)) setRules(rules.filter((x) => x.id !== r.id))
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">חוקי שיבוץ</h1>
          <p className="mt-1 text-sm text-stone-500">
            <b className="text-rose-600">קשיח</b> – חוסם שיבוץ (רק מנהל ראשי יכול לאשר חריגה). <b className="text-amber-700">רך</b> – אזהרה בלבד.
          </p>
        </div>
        {canEdit && (
          <button type="button" onClick={() => setEditing('new')} className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">
            + חוק חדש
          </button>
        )}
      </div>
      <ul className="space-y-2">
        {rules.map((r) => (
          <li key={r.id} className={`rounded-2xl bg-white p-4 shadow-soft ring-1 ring-stone-200/70 ${r.enabled ? '' : 'opacity-50'}`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-semibold">{r.label}</div>
                <div className="mt-1 text-xs text-stone-500">
                  {r.who === 'all' ? 'כל העובדים' : r.who.map(nameOf).join(', ')}
                  {r.from ? ` · מ-${r.from.split('-').reverse().join('/')}` : ''}
                  {r.to ? ` · עד ${r.to.split('-').reverse().join('/')}` : ''}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex overflow-hidden rounded-lg text-xs font-semibold ring-1 ring-stone-200">
                  {(['hard', 'soft'] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      disabled={!canEdit}
                      onClick={() => patch(r.id, { severity: s })}
                      className={`px-3 py-1.5 ${
                        r.severity === s ? (s === 'hard' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-800') : 'bg-white text-stone-400'
                      }`}
                    >
                      {s === 'hard' ? 'קשיח' : 'רך'}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={r.enabled}
                  aria-label="פעיל"
                  disabled={!canEdit}
                  onClick={() => patch(r.id, { enabled: !r.enabled })}
                  className={`relative h-6 w-11 rounded-full transition ${r.enabled ? 'bg-brand-600' : 'bg-stone-300'}`}
                >
                  <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${r.enabled ? 'end-0.5' : 'end-[1.375rem]'}`} />
                </button>
                {canEdit && (
                  <>
                    <button type="button" onClick={() => setEditing(r)} className="rounded-lg px-2 py-1.5 text-sm text-stone-600 ring-1 ring-stone-200 hover:bg-stone-50">
                      עריכה
                    </button>
                    <button type="button" onClick={() => remove(r)} aria-label="מחיקה" className="rounded-lg px-2 py-1.5 text-sm text-rose-600 ring-1 ring-rose-200 hover:bg-rose-50">
                      🗑
                    </button>
                  </>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
      {!canEdit && <p className="text-sm text-stone-500">רק מנהל ראשי ואדמין יכולים לערוך חוקים.</p>}
      {editing && <RuleEditor rule={editing === 'new' ? null : editing} onSave={save} onClose={() => setEditing(null)} />}
    </div>
  )
}

function RuleEditor({ rule, onSave, onClose }: { rule: Rule | null; onSave: (r: Rule) => void; onClose: () => void }) {
  const employees = useEmployees()
  const [params, setParams] = useState<RuleParams>(rule?.params ?? defaults.maxPerWeek)
  const [label, setLabel] = useState(rule?.label ?? autoLabel(defaults.maxPerWeek))
  const [labelTouched, setLabelTouched] = useState(!!rule)
  const [everyone, setEveryone] = useState(rule ? rule.who === 'all' : false)
  const [who, setWho] = useState<string[]>(rule && rule.who !== 'all' ? rule.who : [])
  const [severity, setSeverity] = useState<Severity>(rule?.severity ?? 'hard')
  const [from, setFrom] = useState(rule?.from ?? '')
  const [to, setTo] = useState(rule?.to ?? '')
  const [error, setError] = useState('')

  const change = (next: RuleParams) => {
    setParams(next)
    if (!labelTouched) setLabel(autoLabel(next))
  }

  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!label.trim()) return setError('חסר שם לחוק')
    if (!everyone && who.length === 0) return setError('בחרו לפחות עובד אחד, או "כל העובדים"')
    if ((params.type === 'noKinds' && !params.kinds.length) || (params.type === 'noWeekdays' && !params.days.length)) return setError('בחרו לפחות פריט אחד')
    if (from && to && to < from) return setError('תאריך הסיום לפני תאריך ההתחלה')
    onSave({
      id: rule?.id ?? `r_${crypto.randomUUID().slice(0, 8)}`,
      label: label.trim(),
      who: everyone ? 'all' : who,
      severity,
      enabled: rule?.enabled ?? true,
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      params,
    })
  }

  const num = (key: 'max' | 'min', value: number) => change({ ...params, [key]: Math.max(0, value || 0) } as RuleParams)

  return (
    <Sheet title={rule ? 'עריכת חוק' : 'חוק חדש'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <label className="block text-sm text-stone-600">
          סוג החוק
          <select className={`${field} mt-1`} value={params.type} onChange={(e) => change(defaults[e.target.value as RuleType])}>
            {TYPES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>

        {'max' in params && (
          <label className="block text-sm text-stone-600">
            מקסימום
            <input type="number" min={0} className={`${field} mt-1`} value={params.max} onChange={(e) => num('max', Number(e.target.value))} />
          </label>
        )}
        {'min' in params && (
          <label className="block text-sm text-stone-600">
            מינימום
            <input type="number" min={0} className={`${field} mt-1`} value={params.min} onChange={(e) => num('min', Number(e.target.value))} />
          </label>
        )}
        {params.type === 'noKinds' && (
          <div className="flex flex-wrap gap-2">
            {KINDS.map((k) => (
              <Chip key={k} on={params.kinds.includes(k)} onClick={() => change({ ...params, kinds: toggle(params.kinds, k) })}>
                {kindName(k)}
              </Chip>
            ))}
          </div>
        )}
        {params.type === 'noWeekdays' && (
          <div className="flex flex-wrap gap-2">
            {HE_DAYS.map((d, i) => (
              <Chip key={d} on={params.days.includes(i)} onClick={() => change({ ...params, days: toggle(params.days, i) })}>
                {d}
              </Chip>
            ))}
          </div>
        )}
        {params.type === 'noKindAfter' && (
          <div className="grid grid-cols-2 gap-3 text-sm text-stone-600">
            <label>
              אסור משמרת
              <select className={`${field} mt-1`} value={params.next} onChange={(e) => change({ ...params, next: e.target.value as ShiftKind })}>
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {kindName(k)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              ביום אחרי
              <select className={`${field} mt-1`} value={params.prev} onChange={(e) => change({ ...params, prev: e.target.value as ShiftKind })}>
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {kindName(k)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        <label className="block text-sm text-stone-600">
          שם החוק
          <input
            className={`${field} mt-1`}
            value={label}
            onChange={(e) => {
              setLabel(e.target.value)
              setLabelTouched(true)
            }}
          />
        </label>

        <div>
          <div className="mb-1 text-sm text-stone-600">על מי חל</div>
          <label className="mb-2 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={everyone} onChange={(e) => setEveryone(e.target.checked)} />
            כל העובדים
          </label>
          {!everyone && (
            <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto">
              {employees.map((e) => (
                <Chip key={e.id} on={who.includes(e.id)} onClick={() => setWho(toggle(who, e.id))}>
                  {e.name}
                </Chip>
              ))}
            </div>
          )}
        </div>

        <div className="flex overflow-hidden rounded-xl text-sm font-semibold ring-1 ring-stone-200">
          {(['hard', 'soft'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSeverity(s)}
              className={`flex-1 py-2 ${severity === s ? (s === 'hard' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-800') : 'bg-white text-stone-400'}`}
            >
              {s === 'hard' ? 'קשיח (חוסם)' : 'רך (אזהרה)'}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm text-stone-600">
          <label>
            מתאריך (לא חובה)
            <input type="date" className={`${field} mt-1`} value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>
            עד תאריך (לא חובה)
            <input type="date" className={`${field} mt-1`} value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>

        {error && <p className="text-sm text-rose-600">{error}</p>}
        <button className="w-full rounded-xl bg-brand-600 py-3 font-semibold text-white hover:bg-brand-700">שמירה</button>
      </form>
    </Sheet>
  )
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-sm font-medium ring-1 transition ${on ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white text-stone-600 ring-stone-200 hover:bg-stone-50'}`}
    >
      {children}
    </button>
  )
}
