import { tx } from '../i18n/translations';
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { BellRing, BellOff, X } from 'lucide-react';
import { useStore } from '../store/useStore';
import { disablePush, enablePush, pushState, sendTestPush, deviceKind, type PushState } from '../services/push';

const WHAT = ['Payments due today or tomorrow', 'Payday and new budget cycle', 'New chat messages', 'Added to or removed from a workspace, role changes', 'Messages from the Zaylo team'];

const deniedHelp = () => {
    const k = deviceKind();
    if (k === 'android' || k === 'ios') return 'Notifications are blocked for Zaylo. Turn them on in your phone Settings → Apps → Zaylo → Notifications.';
    if (k === 'desktop') return 'Notifications are blocked for Zaylo. Allow them in Windows Settings → System → Notifications (on a Mac: System Settings → Notifications), then restart Zaylo.';
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
            if (s === 'on') toast.success(tx('Notifications are on for this device'), { id: 'push-state' });
            else if (s === 'denied') toast.error(deniedHelp(), { duration: 8000, id: 'push-state' });
        } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't turn on notifications.", { id: 'push-state' }); }
        finally { setBusy(false); }
    }
    async function turnOff() {
        setBusy(true);
        try {
            await disablePush();
            const s = await pushState();
            setState(s);
            if (s === 'on') toast.error(tx("Couldn't turn off notifications. Try again."), { id: 'push-state' });
            else toast.success(tx('Notifications are off for this device'), { id: 'push-state' });
        } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't turn off notifications.", { id: 'push-state' }); }
        finally { setBusy(false); }
    }
    return { state, busy, turnOn, turnOff };
}

/** Settings → Notifications: connect this device. */
export default function PushSettings() {
    const { state, busy, turnOn, turnOff } = useToggle();
    const k = deviceKind();
    return (
        <section className="push-panel" aria-label={tx('Notifications on this device')}>
            <div className="push-head">
                <span className={`push-ico ${state === 'on' ? 'on' : ''}`}>{state === 'on' ? <BellRing size={20} /> : <BellOff size={20} />}</span>
                <div className="flex-1">
                    <h3>{tx('Notifications on this')}{' '}{k === 'web' ? tx('browser') : k === 'desktop' ? tx('computer') : tx('phone')}</h3>
                    <p>{state === 'on' ? (k === 'desktop' ? tx('On. You\'ll be notified while Zaylo is open, even in the background.') : tx('On. You\'ll be notified even when Zaylo is closed.')) : state === 'denied' ? deniedHelp() : state === 'unsupported' ? tx('This browser can\'t receive notifications. On iPhone, add Zaylo to your Home Screen first (Share → Add to Home Screen).') : tx('Off')}</p>
                </div>
                {state === 'on'
                    ? <button className="btn btn-secondary btn-sm" onClick={turnOff} disabled={busy}>{busy ? tx('Turning off…') : tx('Turn off')}</button>
                    : state !== 'unsupported' && state !== 'loading' && <button className="btn btn-primary btn-sm" onClick={turnOn} disabled={busy}>{busy ? tx('Turning on…') : tx('Turn on')}</button>}
            </div>
            <ul className="push-what">{WHAT.map(w => <li key={w}>{w}</li>)}</ul>
            {state === 'on' && k === 'web' && <button className="btn btn-ghost btn-sm" onClick={() => sendTestPush().then(r => toast.success(r.sent ? 'Test sent. Switch to another tab to see it.' : 'No device received it yet. Try again in a moment.')).catch(e => toast.error(e.message))}>{tx('Send a test notification')}</button>}
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
        <div className="push-prompt card" role="region" aria-label={tx('Turn on notifications')}>
            <span className="push-ico on"><BellRing size={20} /></span>
            <div className="flex-1">
                <strong>{tx('Never miss a payment or payday')}</strong>
                <p>{tx('Get notified about bills due, payday, chats and workspace changes.')}</p>
            </div>
            <button className="btn btn-primary btn-sm" onClick={() => turnOn().then(dismiss)} disabled={busy}>{tx('Turn on')}</button>
            <button className="icon-btn" onClick={dismiss} aria-label={tx('Not now')}><X size={16} /></button>
        </div>
    );
}
