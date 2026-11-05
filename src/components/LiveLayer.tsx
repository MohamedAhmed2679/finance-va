import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { X, Megaphone, UserCheck } from 'lucide-react';
import { useStore } from '../store/useStore';
import { supabase, isSupabaseReady } from '../lib/supabase';
import { getImpersonation, endImpersonation } from '../services/adminApi';
import { mapNotification } from '../services/mappers';
import { notifyDevice } from '../services/push';

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
            <span>Admin view: you're signed in as {info.name}{info.email ? ` (${info.email})` : ''}. Changes you make are real and logged.</span>
            <button className="btn btn-sm" style={{ background: '#1b1405', color: '#fff' }} disabled={busy}
                onClick={async () => { setBusy(true); await endImpersonation(); }}>
                End and close
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
                    <button className="icon-btn" style={{ width: 28, height: 28 }} aria-label="Dismiss announcement" onClick={() => dismiss(a.id)}><X size={15} /></button>
                </motion.div>
            ))}
        </AnimatePresence>
    );
}

/** Live notifications: adds to the store and pops a toast. Also keeps last_seen_at fresh. */
export function useLiveNotifications() {
    const dbId = useStore(s => s.user?.dbId);
    useEffect(() => {
        if (!dbId || !isSupabaseReady() || !supabase) return;
        supabase.from('users').update({ last_seen_at: new Date().toISOString() }).eq('id', dbId).then(() => {});
        const ch = supabase.channel(`notif:${dbId}`)
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${dbId}` }, p => {
                const n = mapNotification(p.new as Record<string, unknown>);
                useStore.setState(s => s.notifications.some(x => x.id === n.id) ? s : { notifications: [n, ...s.notifications] });
                toast(n.message, { icon: '🔔', duration: 6000 });
                const raw = p.new as Record<string, unknown>;
                notifyDevice(n.workspaceName ? `Zaylo · ${n.workspaceName}` : 'Zaylo', n.message, String(raw.link || '/activity'));
                // Added to (or joined) a workspace: load it right away so it shows in the switcher.
                if (n.type === 'member_added' || n.type === 'member_joined') useStore.getState().hydrateStore();
            })
            .subscribe();
        return () => { supabase?.removeChannel(ch); };
    }, [dbId]);
}

/** Chat messages in any of my workspaces: a toast when I'm elsewhere in the app, a device notification when Zaylo is in the background. */
export function useLiveChatAlerts(currentPage: string) {
    const dbId = useStore(s => s.user?.dbId);
    const wsKey = useStore(s => s.workspaces.map(w => w.id).sort().join(','));
    const pageRef = useRef(currentPage);
    pageRef.current = currentPage;
    useEffect(() => {
        if (!dbId || !wsKey || !isSupabaseReady() || !supabase) return;
        const ch = supabase.channel(`chat-alerts:${dbId}`)
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `workspace_id=in.(${wsKey})` }, p => {
                const m = p.new as { user_id: string; workspace_id: string; sender_name?: string; body?: string; attachments?: unknown[] };
                if (m.user_id === dbId) return;
                const s = useStore.getState();
                const ws = s.workspaces.find(w => w.id === m.workspace_id);
                const text = m.body || (Array.isArray(m.attachments) && m.attachments.length ? 'Sent a file' : 'New message');
                const title = `${m.sender_name || 'Someone'} · ${ws?.name || 'Chat'}`;
                const viewing = pageRef.current === 'chat' && s.activeWorkspaceId === m.workspace_id;
                if (!viewing && document.visibilityState === 'visible') toast(`${title}: ${text.slice(0, 90)}`, { icon: '💬', duration: 5000 });
                notifyDevice(title, text.slice(0, 200), '/chat');
            })
            .subscribe();
        return () => { supabase?.removeChannel(ch); };
    }, [dbId, wsKey]);
}
