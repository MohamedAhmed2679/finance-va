import { tx } from '../i18n/translations';
import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X, Megaphone, UserCheck } from 'lucide-react';
import { supabase, isSupabaseReady } from '../lib/supabase';
import { getImpersonation, endImpersonation } from '../services/adminApi';

interface Announcement { id: string; title: string; body: string; level: 'info' | 'success' | 'warning' }
const DISMISSED_KEY = 'fva_dismissed_announcements';

function readDismissed(): string[] {
    try { return JSON.parse(localStorage.getItem(DISMISSED_KEY) || '[]'); } catch { return []; }
}

/** Banner shown while an admin is signed in as another user. */
export function ImpersonationBar() {
    const info = getImpersonation();
    const [busy, setBusy] = useState(false);
    if (!info) return null;
    return (
        <div className="impersonation-bar" role="status">
            <UserCheck size={16} />
            <span>{tx('Admin view: you\'re signed in as')}{' '}{info.name}{info.email ? ` (${info.email})` : ''}{tx('. Changes you make are real and logged.')}</span>
            <button className="btn btn-sm" style={{ background: '#1b1405', color: '#fff' }} disabled={busy}
                onClick={async () => { setBusy(true); await endImpersonation(); }}>
                {tx('End and close')}
            </button>
        </div>
    );
}

/** Active announcements, dismissible per device. */
export function AnnouncementBanner() {
    const [items, setItems] = useState<Announcement[]>([]);
    const [dismissed, setDismissed] = useState<string[]>(readDismissed);

    useEffect(() => {
        if (!isSupabaseReady() || !supabase) return;
        const load = () => supabase!.from('announcements').select('id, title, body, level').eq('is_active', true).order('created_at', { ascending: false }).limit(3)
            .then(({ data }) => setItems((data as Announcement[]) || []));
        load();
        const ch = supabase.channel('announcements').on('postgres_changes', { event: '*', schema: 'public', table: 'announcements' }, load).subscribe();
        return () => { supabase?.removeChannel(ch); };
    }, []);

    const visible = items.filter(a => !dismissed.includes(a.id));
    const dismiss = (id: string) => {
        const next = [...dismissed, id];
        setDismissed(next);
        try { localStorage.setItem(DISMISSED_KEY, JSON.stringify(next.slice(-50))); } catch { /* storage unavailable */ }
    };

    return (
        <AnimatePresence initial={false}>
            {visible.map(a => (
                <motion.div key={a.id} className="app-banner" data-level={a.level} role="status"
                    initial={{ opacity: 0, height: 0, marginBottom: 0 }} animate={{ opacity: 1, height: 'auto', marginBottom: 18 }} exit={{ opacity: 0, height: 0, marginBottom: 0 }}>
                    <Megaphone size={18} style={{ flexShrink: 0, marginTop: 2 }} />
                    <div style={{ flex: 1 }}><strong>{a.title}</strong>{a.body && <span style={{ color: 'var(--ink-2)' }}>{a.body}</span>}</div>
                    <button className="icon-btn" style={{ width: 28, height: 28 }} aria-label={tx('Dismiss announcement')} onClick={() => dismiss(a.id)}><X size={15} /></button>
                </motion.div>
            ))}
        </AnimatePresence>
    );
}
