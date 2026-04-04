import { useMemo } from 'react';
import { useStore } from '../store/useStore';
import { t } from '../i18n/translations';
import { CheckCircle, Bell, Clock, UserPlus, Shield, Receipt, Archive, Edit, Trash2, DollarSign, PiggyBank, Briefcase } from 'lucide-react';

interface TimelineItem {
    id: string;
    type: string;
    message: string;
    timestamp: string;
    workspaceName?: string;
    actioned: boolean;
    isInvite: boolean;
    targetUid?: string;
    workspaceId?: string;
}

export default function ActivityPage() {
    const { user, notifications, workspaces, activeWorkspaceId, acceptInvite, declineInvite, markNotificationActioned } = useStore();
    const lang = user?.language ?? 'en';

    // Merge notifications + workspace activity logs into a single timeline
    const timeline = useMemo(() => {
        const items: TimelineItem[] = [];

        // Add notifications
        notifications.forEach(n => {
            items.push({
                id: n.id,
                type: n.type,
                message: n.message,
                timestamp: n.createdAt,
                workspaceName: n.workspaceName,
                actioned: n.actioned,
                isInvite: n.type === 'invite' && !n.actioned,
                targetUid: n.targetUid,
                workspaceId: n.workspaceId,
            });
        });

        // Add workspace activity logs (edits, deletes, income additions, etc.)
        const ws = workspaces.find(w => w.id === activeWorkspaceId);
        if (ws?.activityLog) {
            ws.activityLog.forEach(log => {
                // Avoid duplicates if the notification system already covers this
                if (!items.some(i => i.id === log.id)) {
                    items.push({
                        id: log.id,
                        type: log.entityType || 'activity',
                        message: `${log.userName} ${log.action}`,
                        timestamp: log.timestamp,
                        workspaceName: ws.name,
                        actioned: true,
                        isInvite: false,
                    });
                }
            });
        }

        // Sort newest first
        items.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
        return items;
    }, [notifications, workspaces, activeWorkspaceId]);

    const pendingInvites = timeline.filter(t => t.isInvite);
    const logHistory = timeline.filter(t => !t.isInvite);

    function getIconForType(type: string) {
        switch (type) {
            case 'invite': return <UserPlus size={16} />;
            case 'role_change': return <Shield size={16} />;
            case 'expense_added':
            case 'expense': return <Receipt size={16} />;
            case 'expense_edited': return <Edit size={16} />;
            case 'expense_deleted': return <Trash2 size={16} />;
            case 'workspace_archived': return <Archive size={16} />;
            case 'income': return <Briefcase size={16} />;
            case 'savings': return <PiggyBank size={16} />;
            case 'bill': return <DollarSign size={16} />;
            default: return <Bell size={16} />;
        }
    }

    function getIconColor(type: string) {
        switch (type) {
            case 'expense_deleted': return 'var(--danger)';
            case 'expense_edited': return 'var(--warning)';
            case 'income': return '#22c55e';
            case 'invite': return 'var(--primary-light)';
            default: return 'var(--text-muted)';
        }
    }

    function formatTimestamp(ts: string) {
        const d = new Date(ts);
        const now = new Date();
        const diff = now.getTime() - d.getTime();
        const mins = Math.floor(diff / 60000);
        if (mins < 1) return 'Just now';
        if (mins < 60) return `${mins}m ago`;
        const hrs = Math.floor(mins / 60);
        if (hrs < 24) return `${hrs}h ago`;
        const days = Math.floor(hrs / 24);
        if (days < 7) return `${days}d ago`;
        return d.toLocaleDateString();
    }

    return (
        <div className="page animate-fadeIn">
            <header className="page-header">
                <div>
                    <h1 className="page-title">{t(lang, 'activity')}</h1>
                    <p className="page-subtitle">Workspace activity, requests, and log history</p>
                </div>
                <div className="badge" style={{ background: 'var(--primary-soft)', color: 'var(--primary-light)' }}>
                    {timeline.length} events
                </div>
            </header>

            {/* Pending Invites */}
            {pendingInvites.length > 0 && (
                <div className="mb-6">
                    <h2 className="activity-section-title">
                        <Bell size={18} className="activity-section-icon" style={{ color: 'var(--accent)' }} />
                        {t(lang, 'pending_actions')}
                        <span className="badge badge-primary" style={{ marginLeft: 8 }}>{pendingInvites.length}</span>
                    </h2>
                    <div className="activity-invite-grid">
                        {pendingInvites.map(n => (
                            <div key={n.id} className="card activity-invite-card">
                                <div className="activity-invite-msg">{n.message}</div>
                                <div className="activity-invite-time">{formatTimestamp(n.timestamp)}</div>
                                <div className="activity-invite-actions">
                                    <button className="btn btn-secondary w-full" onClick={() => declineInvite(n.workspaceId!, n.targetUid!, n.id)}>Decline</button>
                                    <button className="btn btn-primary w-full" onClick={() => acceptInvite(n.workspaceId!, n.targetUid!, n.id)}>Accept</button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Activity Log Timeline */}
            <div>
                <h2 className="activity-section-title">
                    <Clock size={18} className="activity-section-icon" style={{ color: 'var(--text-muted)' }} />
                    {t(lang, 'activity_log')}
                </h2>

                {logHistory.length === 0 ? (
                    <div className="card empty-state" style={{ textAlign: 'center', padding: 40 }}>
                        <Bell size={48} style={{ color: 'var(--text-disabled)', marginBottom: 16 }} />
                        <div className="empty-title">No recent activity</div>
                        <div className="empty-desc">Actions like adding expenses, editing entries, and managing income will appear here.</div>
                    </div>
                ) : (
                    <div className="card activity-timeline-card">
                        {logHistory.map((log, i) => (
                            <div key={log.id} className={`activity-timeline-item ${!log.actioned ? 'unread' : ''}`}
                                style={{ borderBottom: i < logHistory.length - 1 ? '1px solid var(--border)' : 'none' }}>
                                <div className="activity-timeline-icon" style={{ color: getIconColor(log.type) }}>
                                    {getIconForType(log.type)}
                                </div>
                                <div className="activity-timeline-body">
                                    <div className={`activity-timeline-msg ${!log.actioned ? 'unread' : ''}`}>
                                        {log.message}
                                    </div>
                                    <div className="activity-timeline-meta">
                                        <span>{formatTimestamp(log.timestamp)}</span>
                                        {log.workspaceName && (
                                            <span className="badge" style={{ background: 'var(--bg-shell)', color: 'var(--text-muted)', fontSize: 10 }}>{log.workspaceName}</span>
                                        )}
                                    </div>
                                </div>
                                {!log.actioned && !log.isInvite && (
                                    <button className="btn btn-ghost btn-sm btn-icon" onClick={() => markNotificationActioned(log.id)} title="Mark as read">
                                        <CheckCircle size={16} style={{ color: 'var(--accent)' }} />
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
