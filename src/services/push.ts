/**
 * Device notifications.
 *  - Browsers / installed web app: Web Push through /sw.js (arrives even when Zaylo is closed).
 *  - Android / iOS app: local notifications for live activity, plus scheduled payment and payday reminders.
 *  - Desktop app: system notifications while Zaylo is running.
 */
import { Capacitor, registerPlugin } from '@capacitor/core';
import { supabase, isSupabaseReady } from '../lib/supabase';

const API_BASE = import.meta.env.VITE_API_BASE ?? '';

let serverKey: string | null = null;
async function getServerKey(): Promise<string> {
    if (serverKey) return serverKey;
    const r = await fetch(`${API_BASE}/api/push`).then(x => x.json()).catch(() => ({}));
    if (!r.publicKey) throw new Error("Notifications aren't available right now. Try again later.");
    serverKey = r.publicKey as string;
    return serverKey;
}
const keyOf = (sub: PushSubscription) => {
    const k = sub.options?.applicationServerKey;
    return k ? btoa(String.fromCharCode(...new Uint8Array(k as ArrayBuffer))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : '';
};

const isNative = () => Capacitor.isNativePlatform();
const isElectron = () => typeof navigator !== 'undefined' && navigator.userAgent.includes('Electron');

// Native local notifications (plugin ships in the Android / iOS app)
interface LocalNotif { id: number; title: string; body: string; schedule?: { at: Date; allowWhileIdle?: boolean }; extra?: Record<string, unknown>; channelId?: string; smallIcon?: string }
interface LocalNotificationsPlugin {
    requestPermissions(): Promise<{ display: string }>;
    checkPermissions(): Promise<{ display: string }>;
    schedule(o: { notifications: LocalNotif[] }): Promise<unknown>;
    getPending(): Promise<{ notifications: { id: number }[] }>;
    cancel(o: { notifications: { id: number }[] }): Promise<void>;
    createChannel?(c: { id: string; name: string; importance?: number; description?: string; vibration?: boolean }): Promise<void>;
    addListener(e: 'localNotificationActionPerformed', cb: (a: { notification: { extra?: { url?: string } } }) => void): Promise<unknown>;
}
const LocalNotifications = registerPlugin<LocalNotificationsPlugin>('LocalNotifications');
const nativeAvailable = () => isNative() && Capacitor.isPluginAvailable('LocalNotifications');

export type PushState = 'on' | 'off' | 'denied' | 'unsupported';

const urlB64ToUint8 = (b64: string) => {
    const pad = '='.repeat((4 - (b64.length % 4)) % 4);
    const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
};

const webPushSupported = () => !isNative() && !isElectron() && typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

export function deviceKind(): 'android' | 'ios' | 'desktop' | 'web' {
    if (isNative()) return Capacitor.getPlatform() === 'ios' ? 'ios' : 'android';
    if (isElectron()) return 'desktop';
    return 'web';
}

/** Register the service worker early so taps on notifications can open the app. */
export async function initPush(onOpen: (path: string) => void) {
    if (nativeAvailable()) {
        LocalNotifications.createChannel?.({ id: 'zaylo', name: 'Zaylo', importance: 4, description: 'Payments, payday, chats and workspace activity', vibration: true }).catch(() => {});
        LocalNotifications.addListener('localNotificationActionPerformed', a => { const u = a.notification.extra?.url; if (u) onOpen(u); }).catch(() => {});
        return;
    }
    if (!('serviceWorker' in navigator) || isElectron()) return;
    try {
        await navigator.serviceWorker.register('/sw.js');
        navigator.serviceWorker.addEventListener('message', e => {
            if (e.data?.type === 'zaylo-open') onOpen(new URL(e.data.url).pathname);
        });
    } catch { /* blocked: in-app notifications still work */ }
}

export async function pushState(): Promise<PushState> {
    if (nativeAvailable()) {
        const p = await LocalNotifications.checkPermissions().catch(() => ({ display: 'denied' }));
        return p.display === 'granted' ? 'on' : p.display === 'denied' ? 'denied' : 'off';
    }
    if (isElectron()) return 'Notification' in window ? (Notification.permission === 'granted' ? 'on' : Notification.permission === 'denied' ? 'denied' : 'off') : 'unsupported';
    if (!webPushSupported()) return 'unsupported';
    if (Notification.permission === 'denied') return 'denied';
    const reg = await navigator.serviceWorker.getRegistration('/sw.js');
    const sub = await reg?.pushManager.getSubscription();
    return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

async function authHeader(): Promise<Record<string, string>> {
    const { data } = (await supabase?.auth.getSession()) || { data: { session: null } };
    return data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {};
}

async function callPush(body: object) {
    const res = await fetch(`${API_BASE}/api/push`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeader()) }, body: JSON.stringify(body) });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || `Push error ${res.status}`);
    return out;
}

/** Ask permission and connect this device. Returns the resulting state. */
export async function enablePush(userDbId: string): Promise<PushState> {
    if (nativeAvailable()) {
        const p = await LocalNotifications.requestPermissions();
        if (p.display !== 'granted') return 'denied';
        await LocalNotifications.schedule({ notifications: [{ id: 1, title: 'Notifications are on', body: "You'll hear from Zaylo about payments, payday, chats and workspace changes.", channelId: 'zaylo' }] }).catch(() => {});
        return 'on';
    }
    if (isElectron()) {
        const p = await Notification.requestPermission();
        if (p === 'granted') new Notification('Notifications are on', { body: "You'll hear from Zaylo while the app is open.", icon: '/icon-192.png' });
        return p === 'granted' ? 'on' : p === 'denied' ? 'denied' : 'off';
    }
    if (!webPushSupported()) return 'unsupported';
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return perm === 'denied' ? 'denied' : 'off';
    const reg = (await navigator.serviceWorker.getRegistration('/sw.js')) || (await navigator.serviceWorker.register('/sw.js'));
    await navigator.serviceWorker.ready;
    const key = await getServerKey();
    let sub = await reg.pushManager.getSubscription();
    // A subscription made with an older server key can't receive pushes any more
    if (sub && keyOf(sub) && keyOf(sub) !== key) { await sub.unsubscribe().catch(() => {}); sub = null; }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8(key) });
    const j = sub.toJSON();
    if (isSupabaseReady() && supabase) {
        const { error } = await supabase.from('push_subscriptions').upsert({
            user_id: userDbId, endpoint: j.endpoint, p256dh: j.keys?.p256dh, auth: j.keys?.auth, platform: deviceKind(), user_agent: navigator.userAgent.slice(0, 200),
        }, { onConflict: 'endpoint' });
        if (error) throw new Error(/push_subscriptions|schema cache/i.test(error.message) ? 'Push needs the latest database update.' : error.message);
    }
    callPush({ action: 'test' }).catch(() => {});
    return 'on';
}

export async function disablePush(): Promise<void> {
    if (!webPushSupported()) return;
    const reg = await navigator.serviceWorker.getRegistration('/sw.js');
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
        if (supabase) await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
        await sub.unsubscribe();
    }
}

export const sendTestPush = () => callPush({ action: 'test' });

let dispatchTimer: ReturnType<typeof setTimeout> | null = null;
/** Ask the server to push notifications that were just created (by this user's action). */
export function dispatchPush() {
    if (dispatchTimer) clearTimeout(dispatchTimer);
    dispatchTimer = setTimeout(() => { callPush({ action: 'dispatch' }).catch(() => {}); }, 600);
}
export function pushChatMessage(messageId: string) { callPush({ action: 'chat', messageId }).catch(() => {}); }

// ── In-app → device notification for live events (native app and desktop) ──
let nextId = 1000;
/** Show a device notification for something that just happened, when Zaylo isn't in front. */
export async function notifyDevice(title: string, body: string, url = '/activity') {
    const away = typeof document !== 'undefined' && document.visibilityState !== 'visible';
    if (!away) return;
    if (nativeAvailable()) {
        LocalNotifications.schedule({ notifications: [{ id: nextId++ % 100000 + 1000, title, body, extra: { url }, channelId: 'zaylo' }] }).catch(() => {});
        return;
    }
    // Web Push covers browsers; the desktop app gets a system notification here
    if (isElectron() && 'Notification' in window && Notification.permission === 'granted') {
        const n = new Notification(title, { body, icon: '/icon-192.png' });
        n.onclick = () => { window.focus(); window.location.assign(url); };
    }
}

// ── Scheduled reminders on the phone (work even with the app closed) ──
export interface ReminderBill { id: string; name: string; amount: number; currency: string; dueDate: number; lastPaidMonth?: string; workspaceName: string }
export interface ReminderPayday { workspaceId: string; workspaceName: string; day: number; expected?: string }

const REMINDER_BASE = 500_000;
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7) >>> 0;

/** Replace scheduled reminders with the next 60 days of payment and payday reminders (9:00 local time). */
export async function scheduleReminders(bills: ReminderBill[], paydays: ReminderPayday[]) {
    if (!nativeAvailable()) return;
    const perm = await LocalNotifications.checkPermissions().catch(() => ({ display: 'denied' }));
    if (perm.display !== 'granted') return;
    const pending = await LocalNotifications.getPending().catch(() => ({ notifications: [] as { id: number }[] }));
    const old = pending.notifications.filter(n => n.id >= REMINDER_BASE);
    if (old.length) await LocalNotifications.cancel({ notifications: old }).catch(() => {});

    const out: LocalNotif[] = [];
    const now = new Date();
    for (let d = 0; d <= 60; d++) {
        const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + d, 9, 0, 0);
        if (day <= now) continue;
        const lastDay = new Date(day.getFullYear(), day.getMonth() + 1, 0).getDate();
        const month = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}`;
        for (const b of bills) {
            const due = Math.min(b.dueDate, lastDay);
            if (b.lastPaidMonth === month) continue;
            const diff = due - day.getDate();
            if (diff !== 0 && diff !== 1) continue;
            out.push({
                id: REMINDER_BASE + (hash(`${b.id}${month}${diff}`) % 400_000), channelId: 'zaylo',
                title: 'Payment reminder', body: `${b.name} is due ${diff === 0 ? 'today' : 'tomorrow'}: ${b.currency} ${b.amount.toLocaleString()} (${b.workspaceName})`,
                schedule: { at: day, allowWhileIdle: true }, extra: { url: '/bills' },
            });
        }
        for (const p of paydays) {
            if (Math.min(p.day, lastDay) !== day.getDate()) continue;
            out.push({
                id: REMINDER_BASE + (hash(`pay${p.workspaceId}${month}`) % 400_000), channelId: 'zaylo',
                title: 'Payday', body: p.expected ? `${p.expected} expected in "${p.workspaceName}". A new budget cycle starts today.` : `A new budget cycle starts in "${p.workspaceName}". Add this month's income.`,
                schedule: { at: day, allowWhileIdle: true }, extra: { url: '/earnings' },
            });
        }
    }
    if (out.length) await LocalNotifications.schedule({ notifications: out.slice(0, 60) }).catch(() => {});
}
