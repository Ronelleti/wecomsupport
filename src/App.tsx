import type { Session } from '@supabase/supabase-js'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChangePassword, Loading, Login, NoAccess } from './AuthScreens.tsx'
import Bell from './Bell.tsx'
import Logo from './Logo.tsx'
import { addDays, toISO, weekStartOf } from './dates.ts'
import AuditView from './AuditView.tsx'
import { DEFAULT_CONFIG, EMPLOYEES, INITIAL_RULES, demoAssignments, makeNeed } from './data.ts'
import {
  fetchAssignments,
  fetchEmployees,
  fetchExtras,
  fetchMe,
  fetchRules,
  syncAssignments,
  syncRules,
  type Extras,
} from './db.ts'
import { EmployeesContext } from './employees-context.ts'
import { MyShiftsView, PreferencesView, SwapsView, TimeOffView } from './PersonalViews.tsx'
import RequestsView from './RequestsView.tsx'
import RulesView from './RulesView.tsx'
import ScheduleView from './ScheduleView.tsx'
import SettingsView from './SettingsView.tsx'
import { AppContext, canApprove, type AppState } from './store.ts'
import { supabase } from './supabase.ts'
import type { Assignment, Employee, Role, Rule } from './types.ts'
import UsersView from './UsersView.tsx'

const KEY = 'wecom-schedule-v1'
const PASSWORD_DAYS = 30

const ROLES: Record<Role, string> = {
  admin: 'אדמין',
  main: 'מנהל ראשי',
  manager: 'מנהל',
  worker: 'עובד',
}

const NO_EXTRAS: Extras = { weeks: {}, timeOff: [], prefs: [], swaps: [], notices: [], config: DEFAULT_CONFIG }

type Base = Omit<AppState, 'go' | 'schedulable' | 'need'>

const MAX_UNDO = 10

interface ShellProps {
  base: Base
  initialWeek: string
  /** Demo mode only: lets you preview the other roles. */
  onRoleChange?: (r: Role) => void
  onLogout?: () => void
  error?: string
  toast?: { msg: string; tone: 'ok' | 'err' } | null
}

function Shell({ base, initialWeek, onRoleChange, onLogout, error, toast }: ShellProps) {
  const [weekStart, setWeekStart] = useState(initialWeek)
  const [tab, setTab] = useState('schedule')
  const { role, me, online } = base

  const schedulable = useMemo(() => base.employees.filter((e) => e.schedulable !== false && e.active !== false), [base.employees])
  const need = useMemo(() => makeNeed(base.config), [base.config])
  const value = useMemo<AppState>(() => ({ ...base, schedulable, need, go: setTab }), [base, schedulable, need])

  const personal = online && me?.schedulable !== false
  const tabs: { id: string; label: string }[] = [
    ...(personal ? [{ id: 'my', label: 'המשמרות שלי' }] : []),
    { id: 'schedule', label: role === 'worker' ? 'סידור כללי' : 'סידור' },
    ...(online && canApprove(role) ? [{ id: 'requests', label: 'בקשות' }] : []),
    ...(personal ? [{ id: 'swaps', label: 'החלפות' }, { id: 'timeoff', label: 'חופשות' }, { id: 'prefs', label: 'העדפות' }] : []),
    ...(role === 'admin' || role === 'main' ? [{ id: 'rules', label: 'חוקים' }] : []),
    ...(online && (role === 'admin' || role === 'main')
      ? [{ id: 'users', label: 'משתמשים' }, { id: 'settings', label: 'הגדרות' }, { id: 'log', label: 'יומן שינויים' }]
      : []),
  ]
  const current = tabs.some((t) => t.id === tab) ? tab : tabs[0].id

  return (
    <AppContext.Provider value={value}>
      <EmployeesContext.Provider value={schedulable}>
        <div className="min-h-screen pb-10">
          <header className="sticky top-0 z-40 border-b border-stone-200/80 bg-white/85 shadow-soft backdrop-blur-md">
            <div className="h-1 bg-gradient-to-l from-brand-500 via-brand-400 to-amber-400" />
            <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-2.5">
              <div className="flex items-center gap-3">
                <Logo className="h-9" />
                <span className="hidden h-6 w-px bg-stone-200 sm:block" />
                <span className="hidden text-sm font-semibold text-stone-500 sm:block">סידור עבודה</span>
              </div>
              <div className="flex items-center gap-2">
                {onRoleChange ? (
                  <label className="flex items-center gap-2 text-xs text-stone-500">
                    <span className="hidden sm:inline">הדגמת הרשאה</span>
                    <select
                      value={role}
                      onChange={(e) => onRoleChange(e.target.value as Role)}
                      className="rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-sm font-medium text-stone-700"
                    >
                      {Object.entries(ROLES).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <>
                    {me?.schedulable !== false && <Bell />}
                    <button type="button" onClick={onLogout} className="rounded-lg px-2 py-1.5 text-sm text-stone-500 hover:bg-stone-100">
                      {me?.name} · יציאה
                    </button>
                  </>
                )}
              </div>
            </div>
            <nav className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4 pb-2">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-semibold transition ${
                    current === t.id ? 'bg-brand-600 text-white shadow-sm' : 'text-stone-500 hover:bg-stone-100'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </nav>
          </header>

          <main className="mx-auto max-w-7xl px-4 py-5">
            {error && <p className="mb-4 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
            {current === 'schedule' && <ScheduleView weekStart={weekStart} setWeekStart={setWeekStart} />}
            {current === 'my' && <MyShiftsView weekStart={weekStart} setWeekStart={setWeekStart} />}
            {current === 'requests' && <RequestsView />}
            {current === 'swaps' && <SwapsView />}
            {current === 'timeoff' && <TimeOffView />}
            {current === 'prefs' && <PreferencesView />}
            {current === 'rules' && <RulesView rules={base.rules} setRules={base.saveRules} role={role} />}
            {current === 'users' && me && <UsersView employees={base.employees} reload={async () => void (await base.run(async () => null))} />}
            {current === 'settings' && <SettingsView />}
            {current === 'log' && <AuditView />}
          </main>

          {toast && (
            <div
              className={`fixed inset-x-4 bottom-4 z-[60] mx-auto max-w-sm rounded-2xl px-4 py-3 text-center text-sm font-medium text-white shadow-lg ${
                toast.tone === 'ok' ? 'bg-stone-800' : 'bg-rose-600'
              }`}
            >
              {toast.msg}
            </div>
          )}
        </div>
      </EmployeesContext.Provider>
    </AppContext.Provider>
  )
}

/** Keeps the last few assignment lists so the previous one can be restored. */
function useUndo(
  assignments: Assignment[],
  setAssignments: (a: Assignment[]) => void,
  persist?: (prev: Assignment[], next: Assignment[]) => Promise<void>,
  onFail?: (e: unknown) => void,
) {
  const [history, setHistory] = useState<Assignment[][]>([])

  const change = (next: Assignment[], remember: boolean) => {
    const prev = assignments
    if (remember) setHistory((h) => [...h.slice(-(MAX_UNDO - 1)), prev])
    setAssignments(next)
    persist?.(prev, next).catch((e: unknown) => {
      setAssignments(prev)
      onFail?.(e)
    })
  }

  const undo = () => {
    const last = history[history.length - 1]
    if (!last) return
    setHistory((h) => h.slice(0, -1))
    change(last, false)
  }

  return { save: (next: Assignment[]) => change(next, true), undo, canUndo: history.length > 0 }
}

/** No Supabase env vars: schedule and rules only, kept in this browser. */
function Demo() {
  const [initial] = useState(() => {
    try {
      const raw = localStorage.getItem(KEY)
      if (raw) return JSON.parse(raw) as { assignments: Assignment[]; rules: Rule[] }
    } catch {
      // storage unavailable or corrupt: use defaults
    }
    return { assignments: demoAssignments(), rules: INITIAL_RULES }
  })
  const [assignments, setAssignments] = useState(initial.assignments)
  const [rules, setRules] = useState(initial.rules)
  const [role, setRole] = useState<Role>('main')
  const history = useUndo(assignments, setAssignments)

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ assignments, rules }))
    } catch {
      // ignore
    }
  }, [assignments, rules])

  const base: Base = {
    ...NO_EXTRAS,
    online: false,
    role,
    employees: EMPLOYEES,
    assignments,
    rules,
    saveAssignments: history.save,
    saveRules: setRules,
    canUndo: history.canUndo,
    undo: history.undo,
    run: async (fn) => ({ ok: true, value: await fn() }),
  }
  return <Shell base={base} initialWeek="2026-10-25" onRoleChange={setRole} />
}

const passwordStatus = (me: Employee): 'ok' | 'first' | 'expired' => {
  if (me.mustChangePassword || !me.passwordChangedAt) return 'first'
  const age = Date.now() - new Date(me.passwordChangedAt).getTime()
  return age > PASSWORD_DAYS * 864e5 ? 'expired' : 'ok'
}

function Authed() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [me, setMe] = useState<Employee | null | undefined>(undefined)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [rules, setRules] = useState<Rule[]>([])
  const [extras, setExtras] = useState<Extras>(NO_EXTRAS)
  const [error, setError] = useState('')
  const [toast, setToast] = useState<{ msg: string; tone: 'ok' | 'err' } | null>(null)
  const [loaded, setLoaded] = useState(false)

  const userId = session?.user.id

  useEffect(() => {
    if (!supabase) return
    void supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  const loadMe = useCallback(async () => {
    if (!userId) return setMe(null)
    try {
      setMe(await fetchMe(userId))
    } catch {
      setMe(null)
    }
  }, [userId])

  const sessionKnown = session !== undefined
  useEffect(() => {
    if (sessionKnown) void loadMe()
  }, [sessionKnown, loadMe])

  const status = me ? passwordStatus(me) : null
  const ready = !!me && me.active !== false && status === 'ok'

  const loadAll = useCallback(async () => {
    try {
      const [e, r, a, x] = await Promise.all([fetchEmployees(), fetchRules(), fetchAssignments(), fetchExtras()])
      setEmployees(e)
      setRules(r)
      setAssignments(a)
      setExtras(x)
      setError('')
    } catch {
      setError('טעינת הנתונים נכשלה')
    }
    setLoaded(true)
  }, [])

  useEffect(() => {
    if (!ready) return
    void loadAll()
    // Pick up new notices and schedule changes made by other people.
    const timer = setInterval(() => {
      if (!document.hidden) void loadAll()
    }, 60000)
    return () => clearInterval(timer)
  }, [ready, loadAll])

  const flash = useCallback((msg: string, tone: 'ok' | 'err') => {
    setToast({ msg, tone })
    setTimeout(() => setToast(null), 3500)
  }, [])

  const run: AppState['run'] = useCallback(
    async (fn, done) => {
      try {
        const value = await fn()
        await loadAll()
        if (done) flash(done, 'ok')
        return { ok: true, value }
      } catch (e) {
        flash(e instanceof Error && e.message ? e.message : 'הפעולה נכשלה', 'err')
        return { ok: false }
      }
    },
    [loadAll, flash],
  )

  const history = useUndo(assignments, setAssignments, syncAssignments, (e) => {
    const msg = typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : ''
    flash(msg ? `השמירה נכשלה: ${msg}` : 'השמירה נכשלה', 'err')
  })
  const saveAssignments = history.save

  const saveRules = (next: Rule[]) => {
    const prev = rules
    setRules(next)
    syncRules(prev, next).catch(() => {
      setRules(prev)
      flash('שמירת החוק נכשלה (ייתכן שאין הרשאה)', 'err')
    })
  }

  const logout = () => {
    setLoaded(false)
    setMe(undefined)
    void supabase?.auth.signOut()
  }

  if (session === undefined) return <Loading />
  if (!session) return <Login />
  if (me === undefined) return <Loading />
  if (!me || me.active === false) return <NoAccess onLogout={logout} />
  if (status !== 'ok') {
    return <ChangePassword expired={status === 'expired'} onDone={() => void loadMe()} onLogout={logout} />
  }
  if (!loaded) return <Loading />

  const base: Base = {
    ...extras,
    online: true,
    me,
    role: me.role ?? 'worker',
    employees,
    assignments,
    rules,
    saveAssignments,
    saveRules,
    canUndo: history.canUndo,
    undo: history.undo,
    run,
  }
  return <Shell base={base} initialWeek={addDays(weekStartOf(toISO(new Date())), 0)} onLogout={logout} error={error} toast={toast} />
}

export default function App() {
  return supabase ? <Authed /> : <Demo />
}
