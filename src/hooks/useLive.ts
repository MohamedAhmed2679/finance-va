import { useEffect, useRef } from 'react';
import toast from 'react-hot-toast';
import { useStore } from '../store/useStore';
import { supabase, isSupabaseReady } from '../lib/supabase';
import { mapNotification } from '../services/mappers';
import { notifyDevice } from '../services/push';

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
                // A new invitation to answer, or someone declined mine
                if (n.type === 'workspace_invite') useStore.getState().loadInvitations();
                if (n.type === 'member_declined' && n.workspaceId) useStore.getState().refreshMembers(n.workspaceId).catch(() => {});
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
    useEffect(() => { pageRef.current = currentPage; }, [currentPage]);
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
