// Calendar subscription: GET /.netlify/functions/calendar?token=<private token>
// Returns the employee's published shifts as an .ics feed. Uses the service-role key (server only).
import { createClient } from '@supabase/supabase-js'
import { weekStartOf } from '../../src/dates.ts'
import { buildIcs } from '../../src/ics.ts'

const notFound = () => new Response('Not found', { status: 404 })

export default async (req: Request) => {
  const token = new URL(req.url).searchParams.get('token') ?? ''
  if (!/^[0-9a-f-]{36}$/i.test(token)) return notFound()

  const url = process.env.SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) return new Response('Server not configured', { status: 500 })
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

  const { data: row } = await admin.from('calendar_tokens').select('employee_id').eq('token', token).maybeSingle()
  if (!row) return notFound()
  const { data: emp } = await admin.from('employees').select('active').eq('id', row.employee_id).maybeSingle()
  if (!emp?.active) return notFound()

  const since = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10)
  const [{ data: shifts }, { data: weeks }] = await Promise.all([
    admin.from('assignments').select('date, kind').eq('employee_id', row.employee_id).gte('date', since).order('date'),
    admin.from('weeks').select('week_start').eq('published', true),
  ])
  const published = new Set((weeks ?? []).map((w: { week_start: string }) => w.week_start))
  const mine = (shifts ?? []).filter((s: { date: string }) => published.has(weekStartOf(s.date)))

  return new Response(buildIcs(mine as { date: string; kind: 'morning' | 'mid' | 'evening' | 'night' }[]), {
    headers: { 'content-type': 'text/calendar; charset=utf-8', 'cache-control': 'no-cache' },
  })
}
