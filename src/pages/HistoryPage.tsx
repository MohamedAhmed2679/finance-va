import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { History, RotateCcw, CloudUpload, RefreshCw } from 'lucide-react';
import { useStore } from '../store/useStore';
import { supabase, isSupabaseReady } from '../lib/supabase';
import { flushOutbox, onOutboxChange } from '../services/outbox';
import { formatCurrency } from '../constants';

interface Checkpoint {
    id: number; table_name: string; row_id: string; workspace_id: string | null;
    op: 'INSERT' | 'UPDATE' | 'DELETE'; old_row: Record<string, any> | null; new_row: Record<string, any> | null;
    changed_by: string | null; changed_at: string;
}

const KIND: Record<string, string> = { expenses: 'Expense', incomes: 'Income', monthly_bills: 'Bill', savings_goals: 'Savings goal', workspaces: 'Workspace', users: 'Profile' };
const FIELD: Record<string, string> = {
    amount: 'amount', currency: 'currency', merchant: 'merchant', description: 'description', category: 'category', payment_method: 'payment method',
    notes: 'notes', purchased_at: 'date', name: 'name', type: 'type', income_date: 'date', due_day: 'due day', target_amount: 'target', saved_amount: 'saved',
    default_currency: 'default currency', language: 'language', theme: 'theme', hide_amounts: 'hide amounts', cycle_start_day: 'cycle start', color: 'colour', icon: 'icon', is_archived: 'archived',
};
const IGNORE = new Set(['updated_at', 'created_at', 'id', 'workspace_id', 'created_by', 'base_amount', 'base_currency', 'fx_rate', 'last_seen_at', 'last_sign_in_at']);

function title(c: Checkpoint) {
    const r = c.new_row || c.old_row || {};
    const label = r.merchant || r.name || r.description || KIND[c.table_name];
    const money = r.amount != null && r.currency ? ` · ${formatCurrency(Number(r.amount), r.currency, false)}` : '';
    return `${label}${money}`;
}

function describe(c: Checkpoint): { verb: string; detail: string; canRestore: boolean; action: string } {
    const kind = KIND[c.table_name] || c.table_name;
    if (c.op === 'INSERT') return { verb: `${kind} added`, detail: '', canRestore: ['expenses', 'incomes'].includes(c.table_name), action: 'Undo add' };
    if (c.op === 'DELETE') return { verb: `${kind} deleted`, detail: '', canRestore: true, action: 'Bring back' };
    const o = c.old_row || {}, n = c.new_row || {};
    if (!o.is_deleted && n.is_deleted) return { verb: `${kind} deleted`, detail: '', canRestore: true, action: 'Bring back' };
    if (o.is_deleted && !n.is_deleted) return { verb: `${kind} restored`, detail: '', canRestore: true, action: 'Delete again' };
    const changed = Object.keys(n).filter(k => !IGNORE.has(k) && JSON.stringify(o[k]) !== JSON.stringify(n[k]));
    const detail = changed.slice(0, 3).map(k => {
        const f = FIELD[k] || k.replace(/_/g, ' ');
        const fmt = (v: any) => v == null || v === '' ? '—' : typeof v === 'boolean' ? (v ? 'on' : 'off') : String(v).slice(0, 40);
        return `${f}: ${fmt(o[k])} → ${fmt(n[k])}`;
    }).join(' · ') + (changed.length > 3 ? ` · +${changed.length - 3} more` : '');
    return { verb: `${kind} edited`, detail, canRestore: true, action: 'Restore previous' };
}

const dayLabel = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

/** Every change in this workspace and to your profile, with one-tap restore. */
export default function HistoryPage() {
    const { user, workspaces, activeWorkspaceId, loadWorkspaceData, hydrateStore } = useStore();
    const ws = workspaces.find(w => w.id === activeWorkspaceId);
    const [items, setItems] = useState<Checkpoint[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState<number | null>(null);
    const [pending, setPending] = useState(0);
    const [filter, setFilter] = useState<'all' | 'deleted' | 'edited'>('all');
    const names = useMemo(() => {
        const m: Record<string, string> = {};
        workspaces.forEach(w => w.members.forEach(x => { m[x.uid] = x.name; }));
        return m;
    }, [workspaces]);

    useEffect(() => onOutboxChange(setPending), []);

    const load = useCallback(async () => {
        if (!isSupabaseReady() || !supabase || !ws) { setLoading(false); return; }
        setLoading(true); setError('');
        const profileFilter = user?.dbId ? `,and(table_name.eq.users,row_id.eq.${user.dbId})` : '';
        const { data, error: err } = await supabase.from('change_history').select('*')
            .or(`workspace_id.eq.${ws.id}${profileFilter}`)
            .order('changed_at', { ascending: false }).limit(300);
        if (err) setError(/change_history|does not exist|schema cache/i.test(err.message) ? 'Checkpoints need the latest database update.' : "Couldn't load history.");
        setItems((data as Checkpoint[]) || []);
        setLoading(false);
    }, [ws?.id, user?.dbId]);  // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => { load(); }, [load]);

    async function restore(c: Checkpoint, action: string) {
        if (!supabase) return;
        if (!confirm(`${action}: ${title(c)}?`)) return;
        setBusy(c.id);
        const { error: err } = await supabase.rpc('restore_checkpoint', { p_history_id: c.id });
        setBusy(null);
        if (err) { toast.error(err.message.replace(/^.*?:\s*/, '') || "Couldn't restore that."); return; }
        toast.success('Restored');
        if (c.table_name === 'users' || c.table_name === 'workspaces') await hydrateStore(); else if (ws) await loadWorkspaceData(ws.id);
        load();
    }

    const shown = items.filter(c => {
        if (filter === 'all') return true;
        const d = describe(c).verb;
        return filter === 'deleted' ? /deleted/.test(d) : /edited/.test(d);
    });
    const groups = useMemo(() => {
        const m = new Map<string, Checkpoint[]>();
        shown.forEach(c => { const k = dayLabel(c.changed_at); m.set(k, [...(m.get(k) || []), c]); });
        return [...m.entries()];
    }, [shown]);

    return (
        <div className="page">
            <div className="page-header">
                <div>
                    <h1 className="page-title">History</h1>
                    <p className="page-subtitle">Every change in {ws?.name || 'this workspace'} and to your profile is saved as a checkpoint. Restore any of them.</p>
                </div>
                <button className="btn btn-secondary btn-sm" onClick={load} disabled={loading}><RefreshCw size={14} /> Refresh</button>
            </div>

            {pending > 0 && (
                <div className="card history-pending" role="status">
                    <CloudUpload size={18} />
                    <div><strong>{pending} {pending === 1 ? 'change is' : 'changes are'} waiting to sync.</strong> They're saved on this device and send automatically when the connection is back.</div>
                    <button className="btn btn-primary btn-sm" onClick={() => flushOutbox().then(() => ws && loadWorkspaceData(ws.id))}>Sync now</button>
                </div>
            )}

            <div className="seg history-filter" role="tablist" aria-label="Show">
                {(['all', 'edited', 'deleted'] as const).map(f => (
                    <button key={f} role="tab" aria-selected={filter === f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>{f === 'all' ? 'All changes' : f === 'edited' ? 'Edits' : 'Deleted'}</button>
                ))}
            </div>

            <div className="card" style={{ padding: '6px 20px 14px' }}>
                {loading && <div className="skeleton" style={{ height: 48, margin: '14px 0' }} />}
                {!loading && error && <div className="empty-state"><div className="empty-title">{error}</div></div>}
                {!loading && !error && shown.length === 0 && (
                    <div className="empty-state"><History size={22} /><div className="empty-title">No checkpoints yet</div><div className="empty-desc">Add, edit or delete something and it will appear here.</div></div>
                )}
                {groups.map(([day, list]) => (
                    <section key={day}>
                        <h3 className="history-day">{day}</h3>
                        <div className="ledger">
                            {list.map(c => {
                                const d = describe(c);
                                const who = c.changed_by && c.changed_by === user?.id ? 'You' : names[(c.new_row || c.old_row)?.created_by] || 'Someone in this workspace';
                                return (
                                    <div key={c.id} className="ledger-row history-row">
                                        <div style={{ minWidth: 0 }}>
                                            <div className="ledger-title">{title(c)}</div>
                                            <div className="ledger-sub">{d.verb} · {who} · {new Date(c.changed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                                            {d.detail && <div className="history-detail">{d.detail}</div>}
                                        </div>
                                        {d.canRestore && <button className="btn btn-ghost btn-sm" disabled={busy === c.id} onClick={() => restore(c, d.action)}><RotateCcw size={14} /> {busy === c.id ? 'Restoring…' : d.action}</button>}
                                    </div>
                                );
                            })}
                        </div>
                    </section>
                ))}
            </div>
        </div>
    );
}
