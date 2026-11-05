import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { BellRing, BellOff, X } from 'lucide-react';
import { useStore } from '../store/useStore';
import { disablePush, enablePush, pushState, sendTestPush, deviceKind, type PushState } from '../services/push';

const WHAT = ['Payments due today or tomorrow', 'Payday and new budget cycle', 'New chat messages', 'Added to or removed from a workspace, role changes', 'Messages from the Zaylo team'];

const deniedHelp = () => {
    const k = deviceKind();
    if (k === 'android' || k === 'ios') return 'Notifications are blocked for Zaylo. Turn them on in your phone Settings → Apps → Zaylo → Notifications.';
    return 'Notifications are blocked for zaylo.cc. Click the lock icon next to the address, allow Notifications, then reload.';
};

function useToggle() {
    const user = useStore(s => s.user);
    const [state, setState] = useState<PushState | 'loading'>('loading');
    const [busy, setBusy] = useState(false);
    useEffect(() => { pushState().then(setState).catch(() => setState('unsupported')); }, []);
    async function turnOn() {
        if (!user?.dbId) return;
        setBusy(true);
        try {
            const s = await enablePush(user.dbId);
            setState(s);
            if (s === 'on') toast.success('Notifications are on for this device');
            else if (s === 'denied') toast.error(deniedHelp(), { duration: 8000 });
        } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't turn on notifications."); }
        finally { setBusy(false); }
    }
    async function turnOff() {
        setBusy(true);
        try { await disablePush(); setState(await pushState()); toast.success('Notifications are off for this device'); }
        finally { setBusy(false); }
    }
    return { state, busy, turnOn, turnOff };
}

/** Settings → Notifications: connect this device. */
export default function PushSettings() {
    const { state, busy, turnOn, turnOff } = useToggle();
    const k = deviceKind();
    return (
        <section className="push-panel" aria-label="Notifications on this device">
            <div className="push-head">
                <span className={`push-ico ${state === 'on' ? 'on' : ''}`}>{state === 'on' ? <BellRing size={20} /> : <BellOff size={20} />}</span>
                <div className="flex-1">
                    <h3>Notifications on this {k === 'web' ? 'browser' : k === 'desktop' ? 'computer' : 'phone'}</h3>
                    <p>{state === 'on' ? "On. You'll be notified even when Zaylo is closed." : state === 'denied' ? deniedHelp() : state === 'unsupported' ? "This browser can't receive notifications. On iPhone, add Zaylo to your Home Screen first (Share → Add to Home Screen)." : 'Off'}</p>
                </div>
                {state === 'on'
                    ? <button className="btn btn-secondary btn-sm" onClick={turnOff} disabled={busy || k === 'android' || k === 'ios'}>Turn off</button>
                    : state !== 'unsupported' && state !== 'loading' && <button className="btn btn-primary btn-sm" onClick={turnOn} disabled={busy}>{busy ? 'Turning on…' : 'Turn on'}</button>}
            </div>
            <ul className="push-what">{WHAT.map(w => <li key={w}>{w}</li>)}</ul>
            {state === 'on' && k === 'web' && <button className="btn btn-ghost btn-sm" onClick={() => sendTestPush().then(r => toast.success(r.sent ? 'Test sent. Switch to another tab to see it.' : 'No device received it yet. Try again in a moment.')).catch(e => toast.error(e.message))}>Send a test notification</button>}
        </section>
    );
}

const DISMISS_KEY = 'zaylo_push_prompt_dismissed';

/** One-time prompt on the Overview until the device is connected or the user says no. */
export function PushPrompt() {
    const { state, busy, turnOn } = useToggle();
    const [hidden, setHidden] = useState(() => { try { return Boolean(localStorage.getItem(DISMISS_KEY)); } catch { return false; } });
    if (hidden || state !== 'off') return null;
    const dismiss = () => { try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* ignore */ } setHidden(true); };
    return (
        <div className="push-prompt card" role="region" aria-label="Turn on notifications">
            <span className="push-ico on"><BellRing size={20} /></span>
            <div className="flex-1">
                <strong>Never miss a payment or payday</strong>
                <p>Get notified about bills due, payday, chats and workspace changes.</p>
            </div>
            <button className="btn btn-primary btn-sm" onClick={() => turnOn().then(dismiss)} disabled={busy}>Turn on</button>
            <button className="icon-btn" onClick={dismiss} aria-label="Not now"><X size={16} /></button>
        </div>
    );
}
