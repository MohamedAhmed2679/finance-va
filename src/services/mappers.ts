/**
 * Row mappers: Supabase returns snake_case rows, the app works with camelCase
 * objects. Every cloud read must pass through these so pages can rely on
 * fields like `workspaceId`, `purchaseAt` and `members` being present.
 */
import type { Expense, Income, MonthlyBill, SavingsGoal, Workspace, WorkspaceMember, AppNotification } from '../store/useStore';
import { WORKSPACE_COLORS } from '../constants';

/** Colours saved before the Zaylo rebrand map to their Zaylo equivalents. */
const OLD_PALETTE = ['#1E5B47', '#A87A22', '#2C6A8F', '#B5372F', '#6A52B0', '#1E8A80', '#C4622D', '#13201C'];
const brandColor = (c: string) => { const i = OLD_PALETTE.indexOf(c.toUpperCase()); return i >= 0 ? WORKSPACE_COLORS[i] : c; };


type Row = Record<string, any>;
const num = (v: unknown) => (v === null || v === undefined || v === '' ? 0 : Number(v));
const str = (v: unknown, d = '') => (v === null || v === undefined ? d : String(v));
const optNum = (v: unknown) => (v === null || v === undefined || v === '' ? undefined : Number(v));
const fx = (r: Row) => ({
    baseAmount: optNum(r.base_amount ?? r.baseAmount),
    baseCurrency: (r.base_currency ?? r.baseCurrency) || undefined,
    fxRate: optNum(r.fx_rate ?? r.fxRate),
});

export function mapExpense(r: Row): Expense {
    return {
        id: r.id,
        workspaceId: r.workspace_id ?? r.workspaceId,
        createdByUid: r.created_by ?? r.createdByUid ?? '',
        createdByName: r.created_by_name ?? r.createdByName ?? '',
        createdAt: str(r.created_at ?? r.createdAt, new Date().toISOString()),
        updatedAt: str(r.updated_at ?? r.updatedAt, new Date().toISOString()),
        purchaseAt: str(r.purchased_at ?? r.purchaseAt ?? r.created_at, new Date().toISOString()),
        amount: num(r.amount),
        currency: str(r.currency, 'USD'),
        merchant: str(r.merchant),
        description: str(r.description),
        category: str(r.category, 'other'),
        paymentMethod: str(r.payment_method ?? r.paymentMethod, 'cash'),
        last4: r.last4 ?? undefined,
        tags: Array.isArray(r.tags) ? r.tags : [],
        notes: str(r.notes),
        receiptUrl: r.receipt_url ?? r.receiptUrl ?? undefined,
        ocrText: r.ocr_text ?? r.ocrText ?? undefined,
        source: (r.source === 'bill' ? 'manual' : r.source) || 'manual',
        deleted: Boolean(r.is_deleted ?? r.deleted ?? false),
        ...fx(r),
        ...(r.cart_id || r.cartId ? { cartId: r.cart_id ?? r.cartId } : {}),
        ...((r.details?.kind === 'smart_cart') ? { details: r.details } : {}),
    };
}

export function mapIncome(r: Row): Income {
    return {
        id: r.id,
        workspaceId: r.workspace_id ?? r.workspaceId,
        createdByUid: r.created_by ?? r.createdByUid ?? '',
        name: str(r.name),
        amount: num(r.amount),
        currency: str(r.currency, 'USD'),
        type: r.type === 'variable' ? 'variable' : 'fixed',
        date: str(r.income_date ?? r.date ?? r.created_at, new Date().toISOString()),
        createdAt: str(r.created_at ?? r.createdAt, new Date().toISOString()),
        ...fx(r),
    };
}

export function mapBill(r: Row): MonthlyBill {
    return {
        id: r.id,
        workspaceId: r.workspace_id ?? r.workspaceId,
        createdByUid: r.created_by ?? r.createdByUid ?? '',
        name: str(r.name),
        amount: num(r.amount),
        currency: str(r.currency, 'USD'),
        category: str(r.category, 'other'),
        paymentMethod: r.payment_method ?? r.paymentMethod ?? undefined,
        dueDate: num(r.due_day ?? r.dueDate) || 1,
        lastPaidMonth: r.last_paid_month ?? r.lastPaidMonth ?? undefined,
        lastNotifiedMonth: r.last_notified_month ?? r.lastNotifiedMonth ?? undefined,
        createdAt: str(r.created_at ?? r.createdAt, new Date().toISOString()),
    };
}

export function mapGoal(r: Row): SavingsGoal {
    return {
        id: r.id,
        workspaceId: r.workspace_id ?? r.workspaceId,
        name: str(r.name),
        reason: str(r.reason),
        targetAmount: num(r.target_amount ?? r.targetAmount),
        savedAmount: num(r.saved_amount ?? r.savedAmount),
        currency: str(r.currency, 'USD'),
        createdAt: str(r.created_at ?? r.createdAt, new Date().toISOString()),
        color: brandColor(str(r.color, '#2563FF')),
        icon: str(r.icon, '🎯'),
    };
}

export function mapMember(r: Row, self?: { dbId?: string; name?: string; email?: string }): WorkspaceMember {
    const uid = r.user_id ?? r.uid;
    const isSelf = self?.dbId && uid === self.dbId;
    return {
        uid,
        name: str(r.name ?? (isSelf ? self?.name : '') ?? '', 'Member') || 'Member',
        email: str(r.email ?? (isSelf ? self?.email : '')),
        role: r.role ?? 'member',
        status: r.status === 'active' ? 'active' : 'invited',
        joinedAt: str(r.joined_at ?? r.joinedAt, new Date().toISOString()),
    };
}

export function mapWorkspace(r: Row, members: WorkspaceMember[] = []): Workspace {
    return {
        id: r.id,
        name: str(r.name, 'Personal'),
        type: r.type === 'shared' ? 'shared' : 'personal',
        ownerId: r.owner_id ?? r.ownerId ?? '',
        currency: str(r.currency, 'USD'),
        icon: str(r.icon, '👤'),
        color: brandColor(str(r.color, '#2563FF')),
        members: Array.isArray(r.members) ? r.members : members,
        activityLog: Array.isArray(r.activityLog) ? r.activityLog : [],
        createdAt: str(r.created_at ?? r.createdAt, new Date().toISOString()),
        inviteLink: r.invite_link ?? r.inviteLink ?? undefined,
        isArchived: Boolean(r.is_archived ?? r.isArchived ?? false),
        cycleStartDay: num(r.cycle_start_day ?? r.cycleStartDay) || 1,
    };
}

export function mapNotification(r: Row): AppNotification {
    return {
        id: r.id,
        type: r.type,
        workspaceId: r.workspace_id ?? r.workspaceId ?? '',
        workspaceName: str(r.workspace_name ?? r.workspaceName),
        message: str(r.message),
        actioned: Boolean(r.is_actioned ?? r.actioned ?? false),
        createdAt: str(r.created_at ?? r.createdAt, new Date().toISOString()),
        senderName: r.sender_name ?? r.senderName ?? undefined,
        targetUid: r.target_uid ?? r.targetUid ?? undefined,
    };
}
