import { api } from './db.ts'
import { supabase } from './supabase.ts'

const PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined

export type PushState = 'unsupported' | 'needs-install' | 'denied' | 'off' | 'on'

export const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

/** True when running as an installed app (home-screen icon) rather than in a browser tab. */
export const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true

export const pushConfigured = () => !!PUBLIC_KEY && !!supabase

const b64ToBytes = (b64: string) => {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4)
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

const registration = async () => {
  if (!('serviceWorker' in navigator)) return null
  return (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register('/sw.js'))
}

/** What the "turn on notifications" control should show on this device. */
export async function pushState(): Promise<PushState> {
  if (!pushConfigured() || !('serviceWorker' in navigator) || !('Notification' in window)) {
    // iPhone browsers hide these APIs until the app is added to the home screen.
    return isIos() && !isStandalone() ? 'needs-install' : 'unsupported'
  }
  if (isIos() && !isStandalone()) return 'needs-install'
  if (Notification.permission === 'denied') return 'denied'
  if (!('PushManager' in window)) return 'unsupported'
  const reg = await registration()
  const sub = await reg?.pushManager.getSubscription()
  return sub && Notification.permission === 'granted' ? 'on' : 'off'
}

export async function enablePush(): Promise<void> {
  if (!PUBLIC_KEY) throw new Error('התראות לא מוגדרות באתר')
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('לא אושרו התראות במכשיר')
  const reg = await registration()
  if (!reg) throw new Error('המכשיר לא תומך בהתראות')
  await navigator.serviceWorker.ready
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(PUBLIC_KEY) }))
  const json = sub.toJSON()
  await api.savePushSubscription(sub.endpoint, json.keys?.p256dh ?? '', json.keys?.auth ?? '', navigator.userAgent)
}

export async function disablePush(): Promise<void> {
  const reg = await registration()
  const sub = await reg?.pushManager.getSubscription()
  if (!sub) return
  await api.removePushSubscription(sub.endpoint)
  await sub.unsubscribe()
}

/** Asks the server to send a test notification to this person's devices. */
export async function sendTestPush(): Promise<void> {
  const { data } = (await supabase?.auth.getSession()) ?? { data: { session: null } }
  const res = await fetch('/.netlify/functions/push', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${data.session?.access_token ?? ''}` },
    body: JSON.stringify({ test: true }),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error ?? 'שליחת הבדיקה נכשלה')
  if (!json.sent) throw new Error('לא נמצא מכשיר רשום להתראות')
}
