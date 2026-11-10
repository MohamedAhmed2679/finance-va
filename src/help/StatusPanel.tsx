import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, AlertTriangle, MinusCircle, RefreshCw } from 'lucide-react';
import { tx } from '../i18n/translations';
import { supabase, isSupabaseReady } from '../lib/supabase';
import { useStore } from '../store/useStore';
import { aiStatus } from '../services/zayloAI';
import { locale } from './format';

type Result = 'ok' | 'problem' | 'unknown';
interface Check { key: string; label: string; result: Result; detail: string }

const timeout = <T,>(p: PromiseLike<T>, ms: number) => Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

/**
 * Live checks made from this device, right now. It reports only what it measured:
 * there is no uptime history here, and no claim about other people's connections.
 */
export default function StatusPanel() {
    const lang = useStore(s => s.user?.language ?? 'en');
    const syncStatus = useStore(s => s.syncStatus);
    const [checks, setChecks] = useState<Check[] | null>(null);
    const [at, setAt] = useState<Date | null>(null);
    const [notices, setNotices] = useState<{ id: string; title: string; body: string; level: string }[]>([]);

    const run = useCallback(async () => {
        setChecks(null);
        const online = navigator.onLine !== false;
        const out: Check[] = [{ key: 'device', label: 'This device\'s internet connection', result: online ? 'ok' : 'problem', detail: online ? 'Connected' : 'Offline. Zaylo keeps working with the copy on this device.' }];
        if (!online || !isSupabaseReady() || !supabase) {
            out.push({ key: 'data', label: 'Zaylo accounts and data', result: 'unknown', detail: 'Can\'t be checked while this device is offline.' });
            out.push({ key: 'ai', label: 'Zaylo AI', result: 'unknown', detail: 'Can\'t be checked while this device is offline.' });
        } else {
            const t0 = performance.now();
            try {
                const { data, error } = await timeout(supabase.from('announcements').select('id, title, body, level').order('starts_at', { ascending: false }).limit(5), 8000);
                if (error) out.push({ key: 'data', label: 'Zaylo accounts and data', result: 'problem', detail: 'The server answered with an error. Your changes are kept on this device and sent when it recovers.' });
                else { out.push({ key: 'data', label: 'Zaylo accounts and data', result: 'ok', detail: `${tx('Responding')} (${Math.round(performance.now() - t0)} ms)` }); setNotices((data as typeof notices) || []); }
            } catch { out.push({ key: 'data', label: 'Zaylo accounts and data', result: 'problem', detail: 'No answer within 8 seconds. Your changes are kept on this device and sent when it recovers.' }); }
            const ai = await aiStatus();
            out.push({ key: 'ai', label: 'Zaylo AI', result: ai.ready ? 'ok' : 'problem', detail: ai.ready ? 'Available' : 'Not available right now. Everything else in Zaylo works without it.' });
        }
        out.push({ key: 'sync', label: 'Syncing on this device', result: syncStatus === 'synced' ? 'ok' : syncStatus === 'syncing' ? 'ok' : syncStatus === 'offline' ? 'unknown' : 'problem',
            detail: syncStatus === 'synced' ? 'Up to date' : syncStatus === 'syncing' ? 'Syncing now' : syncStatus === 'offline' ? 'Waiting for a connection' : 'The last sync failed. Reopen the app to try again.' });
        setChecks(out); setAt(new Date());
    }, [syncStatus]);

    // eslint-disable-next-line react-hooks/set-state-in-effect -- runs the checks once when the panel opens
    useEffect(() => { run(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const icon = (r: Result) => r === 'ok' ? <CheckCircle2 size={20} className="st-ok" aria-hidden /> : r === 'problem' ? <AlertTriangle size={20} className="st-bad" aria-hidden /> : <MinusCircle size={20} className="st-unk" aria-hidden />;
    const word = (r: Result) => r === 'ok' ? tx('Working') : r === 'problem' ? tx('Problem') : tx('Not checked');

    return (
        <div className="card help-status">
            <div className="card-head">
                <div>
                    <h2 className="card-title">{tx('Service status')}</h2>
                    <p className="form-hint" aria-live="polite">{at ? `${tx('Checked from this device at')} ${at.toLocaleTimeString(locale(lang), { hour: '2-digit', minute: '2-digit' })}` : tx('Checking…')}</p>
                </div>
                <button className="btn btn-secondary btn-sm" onClick={run} disabled={!checks}><RefreshCw size={14} className={!checks ? 'animate-spin' : ''} /> {tx('Check again')}</button>
            </div>
            <ul className="help-status-list">
                {(checks || [0, 1, 2, 3]).map((c, i) => typeof c === 'number'
                    ? <li key={i}><div className="skeleton" style={{ height: 20, width: `${60 - i * 8}%` }} /></li>
                    : <li key={c.key}>{icon(c.result)}<div><strong>{tx(c.label)}</strong><span>{tx(c.detail)}</span></div><span className="st-word">{word(c.result)}</span></li>)}
            </ul>
            {notices.length > 0 && (
                <>
                    <h3 className="help-subhead">{tx('Notices from the Zaylo team')}</h3>
                    <ul className="help-notices">{notices.map(n => <li key={n.id} translate="no"><strong>{n.title}</strong><span>{n.body}</span></li>)}</ul>
                </>
            )}
            <p className="form-hint">{tx('These checks run on your device when you open this page. They show whether Zaylo is reachable from here, not a history of past outages.')}</p>
        </div>
    );
}
