import { useNameOf } from './employees-context.ts'
import type { Role, Rule } from './types.ts'

export default function RulesView({ rules, setRules, role }: { rules: Rule[]; setRules: (r: Rule[]) => void; role: Role }) {
  const nameOf = useNameOf()
  const canEdit = role === 'admin' || role === 'main'
  const patch = (id: string, p: Partial<Rule>) => setRules(rules.map((r) => (r.id === id ? { ...r, ...p } : r)))

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">חוקי שיבוץ</h1>
        <p className="mt-1 text-sm text-stone-500">
          <b className="text-rose-600">קשיח</b> – חוסם שיבוץ (רק מנהל ראשי יכול לאשר חריגה). <b className="text-amber-700">רך</b> – אזהרה בלבד.
        </p>
      </div>
      <ul className="space-y-2">
        {rules.map((r) => (
          <li key={r.id} className={`rounded-2xl bg-white p-4 shadow-soft ring-1 ring-stone-200/70 ${r.enabled ? '' : 'opacity-50'}`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-semibold">{r.label}</div>
                <div className="mt-1 text-xs text-stone-500">
                  {r.who === 'all' ? 'כל העובדים' : r.who.map(nameOf).join(', ')}
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
              </div>
            </div>
          </li>
        ))}
      </ul>
      {!canEdit && <p className="text-sm text-stone-500">רק מנהל ראשי ואדמין יכולים לערוך חוקים.</p>}
    </div>
  )
}
