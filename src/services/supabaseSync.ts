/**
 * Finance VA — Supabase Data Sync Layer
 *
 * Provides CRUD operations that work with Supabase when available,
 * falling back to the Zustand store for offline-first behaviour.
 *
 * The pattern is:
 * 1. Always write to Zustand (instant UI update)
 * 2. If Supabase is ready, also sync to the database
 * 3. On app start, pull latest from Supabase and merge with local
 */

import { supabase, isSupabaseReady } from '../lib/supabase';

// ─── Expenses ────────────────────────────────────────────────────

export async function syncExpenseToCloud(expense: {
    id: string;
    workspaceId: string;
    createdByUid: string;
    amount: number;
    currency: string;
    merchant: string;
    description: string;
    category: string;
    paymentMethod: string;
    tags: string[];
    notes: string;
    purchaseAt: string;
    source?: string;
}) {
    if (!isSupabaseReady() || !supabase) return;

    await supabase.from('expenses').upsert({
        id: expense.id,
        workspace_id: expense.workspaceId,
        created_by: expense.createdByUid,
        amount: expense.amount,
        currency: expense.currency,
        merchant: expense.merchant,
        description: expense.description,
        category: expense.category,
        payment_method: expense.paymentMethod,
        tags: expense.tags,
        notes: expense.notes,
        purchased_at: expense.purchaseAt,
        source: expense.source || 'manual',
    });
}

export async function deleteExpenseFromCloud(id: string) {
    if (!isSupabaseReady() || !supabase) return;
    await supabase.from('expenses').update({ is_deleted: true }).eq('id', id);
}

export async function fetchExpensesFromCloud(workspaceId: string) {
    if (!isSupabaseReady() || !supabase) return null;

    const { data, error } = await supabase
        .from('expenses')
        .select('*')
        .eq('workspace_id', workspaceId)
        .eq('is_deleted', false)
        .order('purchased_at', { ascending: false });

    if (error) {
        console.error('[Sync] Failed to fetch expenses:', error.message);
        return null;
    }

    return data;
}

// ─── Incomes ─────────────────────────────────────────────────────

export async function syncIncomeToCloud(income: {
    id: string;
    workspaceId: string;
    createdByUid: string;
    name: string;
    amount: number;
    currency: string;
    type: 'fixed' | 'variable';
    date: string;
}) {
    if (!isSupabaseReady() || !supabase) return;

    await supabase.from('incomes').upsert({
        id: income.id,
        workspace_id: income.workspaceId,
        created_by: income.createdByUid,
        name: income.name,
        amount: income.amount,
        currency: income.currency,
        type: income.type,
        income_date: income.date,
    });
}

export async function deleteIncomeFromCloud(id: string) {
    if (!isSupabaseReady() || !supabase) return;
    await supabase.from('incomes').delete().eq('id', id);
}

// ─── Bills ───────────────────────────────────────────────────────

export async function syncBillToCloud(bill: {
    id: string;
    workspaceId: string;
    createdByUid: string;
    name: string;
    amount: number;
    currency: string;
    category: string;
    dueDate: number;
    lastPaidMonth?: string;
}) {
    if (!isSupabaseReady() || !supabase) return;

    await supabase.from('monthly_bills').upsert({
        id: bill.id,
        workspace_id: bill.workspaceId,
        created_by: bill.createdByUid,
        name: bill.name,
        amount: bill.amount,
        currency: bill.currency,
        category: bill.category,
        due_day: bill.dueDate,
        last_paid_month: bill.lastPaidMonth,
    });
}

export async function deleteBillFromCloud(id: string) {
    if (!isSupabaseReady() || !supabase) return;
    await supabase.from('monthly_bills').delete().eq('id', id);
}

// ─── Savings Goals ───────────────────────────────────────────────

export async function syncSavingsGoalToCloud(goal: {
    id: string;
    workspaceId: string;
    name: string;
    reason: string;
    targetAmount: number;
    savedAmount: number;
    currency: string;
    color: string;
    icon: string;
}) {
    if (!isSupabaseReady() || !supabase) return;

    await supabase.from('savings_goals').upsert({
        id: goal.id,
        workspace_id: goal.workspaceId,
        name: goal.name,
        reason: goal.reason,
        target_amount: goal.targetAmount,
        saved_amount: goal.savedAmount,
        currency: goal.currency,
        color: goal.color,
        icon: goal.icon,
    });
}

export async function deleteSavingsGoalFromCloud(id: string) {
    if (!isSupabaseReady() || !supabase) return;
    await supabase.from('savings_goals').delete().eq('id', id);
}

// ─── Workspaces ──────────────────────────────────────────────────

export async function syncWorkspaceToCloud(workspace: {
    id: string;
    name: string;
    type: string;
    ownerId: string;
    currency: string;
    icon: string;
    color: string;
    cycleStartDay?: number;
}) {
    if (!isSupabaseReady() || !supabase) return;

    await supabase.from('workspaces').upsert({
        id: workspace.id,
        name: workspace.name,
        type: workspace.type,
        owner_id: workspace.ownerId,
        currency: workspace.currency,
        icon: workspace.icon,
        color: workspace.color,
        cycle_start_day: workspace.cycleStartDay || 1,
    });
}

export async function syncWorkspaceMemberToCloud(member: {
    id?: string;
    workspaceId: string;
    userId: string;
    role: string;
    status: string;
}) {
    if (!isSupabaseReady() || !supabase) return;

    await supabase.from('workspace_members').upsert({
        workspace_id: member.workspaceId,
        user_id: member.userId,
        role: member.role,
        status: member.status,
    }, { onConflict: 'workspace_id,user_id' });
}

// ─── Notifications ───────────────────────────────────────────────

export async function syncNotificationToCloud(notification: {
    id: string;
    userId: string;
    type: string;
    message: string;
    workspaceId?: string;
    workspaceName?: string;
    targetUid?: string;
    actioned: boolean;
}) {
    if (!isSupabaseReady() || !supabase) return;

    await supabase.from('notifications').upsert({
        id: notification.id,
        user_id: notification.userId,
        type: notification.type,
        message: notification.message,
        workspace_id: notification.workspaceId,
        workspace_name: notification.workspaceName,
        target_uid: notification.targetUid,
        is_actioned: notification.actioned,
    });
}

// ─── Activity Log ────────────────────────────────────────────────

export async function logActivityToCloud(activity: {
    workspaceId: string;
    userId: string;
    userName: string;
    action: string;
    entityType: string;
    entityId?: string;
}) {
    if (!isSupabaseReady() || !supabase) return;

    await supabase.from('activity_log').insert({
        workspace_id: activity.workspaceId,
        user_id: activity.userId,
        user_name: activity.userName,
        action: activity.action,
        entity_type: activity.entityType,
        entity_id: activity.entityId,
    });
}

// ─── User Profile ────────────────────────────────────────────────

export async function updateUserProfile(authId: string, updates: Record<string, any>) {
    if (!isSupabaseReady() || !supabase) return;

    await supabase
        .from('users')
        .update(updates)
        .eq('auth_id', authId);
}

export async function fetchUserProfile(authId: string) {
    if (!isSupabaseReady() || !supabase) return null;

    const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('auth_id', authId)
        .single();

    if (error) {
        console.error('[Sync] Failed to fetch user profile:', error.message);
        return null;
    }

    return data;
}

export async function fetchIncomesFromCloud(workspaceId: string) {
    if (!isSupabaseReady() || !supabase) return null;
    const { data, error } = await supabase.from('incomes').select('*').eq('workspace_id', workspaceId);
    if (error) return null;
    return data;
}

export async function fetchBillsFromCloud(workspaceId: string) {
    if (!isSupabaseReady() || !supabase) return null;
    const { data, error } = await supabase.from('monthly_bills').select('*').eq('workspace_id', workspaceId);
    if (error) return null;
    return data;
}

export async function fetchSavingsGoalsFromCloud(workspaceId: string) {
    if (!isSupabaseReady() || !supabase) return null;
    const { data, error } = await supabase.from('savings_goals').select('*').eq('workspace_id', workspaceId);
    if (error) return null;
    return data;
}

export async function fetchUserWorkspaces(userId: string) {
    if (!isSupabaseReady() || !supabase) return null;
    // Ensure userId is a valid UUID format before querying the owner_id column
    // to prevent 500 status errors on the database side.
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId);
    if (!isUuid) return [];

    const { data, error } = await supabase.from('workspaces').select('*').eq('owner_id', userId);
    if (error) return null;
    return data;
}

export async function fetchWorkspacesByEmail(email: string) {
    if (!isSupabaseReady() || !supabase || !email) return [];
    
    // Find workspaces where this email is a member (safest way to find legacy links)
    const { data: memberEntries, error: mErr } = await supabase
        .from('workspace_members')
        .select('workspace_id')
        .eq('email', email);
        
    if (mErr || !memberEntries || memberEntries.length === 0) {
        return [];
    }

    const wsIds = memberEntries.map(m => m.workspace_id);
    const { data, error } = await supabase
        .from('workspaces')
        .select('*')
        .in('id', wsIds);
        
    if (error) {
        console.error('[Sync] Error fetching workspaces for email members:', error.message);
        return [];
    }
    return data || [];
}

export async function fetchNotifications(userId: string) {
    if (!isSupabaseReady() || !supabase) return null;
    const { data, error } = await supabase.from('notifications').select('*').eq('user_id', userId).order('created_at', { ascending: false });
    if (error) return null;
    return data;
}
