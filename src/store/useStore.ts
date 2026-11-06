import { withBase } from '../utils/money';
import { enqueue, flushOutbox, pendingChanges, setOutboxOwner } from '../services/outbox';
import { dispatchPush } from '../services/push';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { CATEGORIES, PAYMENT_METHODS, WORKSPACE_COLORS } from '../constants';
import {
    fetchExpensesFromCloud, fetchIncomesFromCloud, fetchBillsFromCloud, fetchSavingsGoalsFromCloud,
    syncWorkspaceToCloud, syncWorkspaceMemberToCloud, logActivityToCloud, fetchNotifications,
    updateUserProfile, fetchWorkspacesByEmail, fetchUserProfile,
    fetchAccessibleWorkspaces, fetchWorkspaceMembers, deleteWorkspaceFromCloud,
    fetchWorkspaceMemberList, addWorkspaceMemberRemote, claimPendingInvites, type AddMemberResult, removeWorkspaceMemberRemote, setWorkspaceMemberRoleRemote, ensureProfile, markNotificationRead
} from '../services/supabaseSync';
import { mapExpense, mapIncome, mapBill, mapGoal, mapWorkspace, mapMember, mapNotification } from '../services/mappers';
import { signOut as supabaseSignOut } from '../services/authProvider';
import toast from 'react-hot-toast';
import { isSupabaseReady } from '../lib/supabase';

let lastSyncToast = 0;
// Per-account memory of the last workspace and whether the account ever had one.
const lsGet = (k: string) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };
function rememberWorkspace(authId: string | undefined, wsId: string) { if (authId && wsId) lsSet(`zaylo_last_ws_${authId}`, wsId); }
function recalledWorkspace(authId: string | undefined) { return authId ? lsGet(`zaylo_last_ws_${authId}`) : ''; }
function markHasWorkspaces(userId: string) { lsSet(`zaylo_has_ws_${userId}`, '1'); }
function hadWorkspaces(userId: string) { return lsGet(`zaylo_has_ws_${userId}`) === '1'; }

/** Marks the store as out of sync and tells the user once per burst of failures. */
function reportSyncError(err: unknown) {
    console.error('[Sync]', err);
    useStore.setState({ syncStatus: navigator.onLine === false ? 'offline' : 'error' });
    if (Date.now() - lastSyncToast > 8000) {
        lastSyncToast = Date.now();
        toast.error(navigator.onLine === false
            ? "You're offline. Your changes are saved and will sync automatically when you're back online."
            : "Couldn't save to the cloud yet. Your change is kept and will retry automatically.", { id: 'sync-error' });
    }
}

export type CategoryKey = string;
export type PaymentMethod = string;
export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'viewer';
export type AppNotificationType = 'invite' | 'join_request' | 'role_change' | 'workspace_archived' | 'workspace_deleted' | 'expense_added' | 'member_added' | 'member_joined' | 'admin_notice' | 'admin_message';

export interface CategoryDef {
    key: string;
    label: string;
    emoji: string;
    color: string;
}

export interface PaymentMethodDef {
    key: string;
    label: string;
    emoji: string;
}

export interface User {
    id: string; // Auth ID (Supabase)
    dbId?: string; // Internal User UUID (public.users)
    isAdmin?: boolean;
    name: string;
    email: string;
    phone?: string;
    avatar?: string;
    referralCode: string;
    defaultCurrency: string;
    language: string;
    theme: 'dark' | 'light';
    biometricEnabled: boolean;
    pin?: string;
    lockTimeout?: number;
    voiceEnabled?: boolean;
    smsEnabled?: boolean;
    hideAmounts: boolean;
    showOnboarding?: boolean;
    storeOcr?: boolean;
    notifyDaily?: boolean;
    notifyMonthly?: boolean;
    notifyBudget?: boolean;
    monthlyBudget?: number;
    connectedClouds?: string[];
    backupInterval?: 'daily' | 'weekly' | 'monthly' | 'manual';
    geminiKey?: string;
    createdAt: string;
}

export interface Workspace {
    id: string;
    name: string;
    type: 'personal' | 'shared';
    ownerId: string;
    currency: string;
    icon: string;
    color: string;
    members: WorkspaceMember[];
    activityLog: ActivityEntry[];
    createdAt: string;
    inviteLink?: string;
    isArchived?: boolean;
    cycleStartDay?: number; // Day of the month (1-31)
}

export interface WorkspaceMember {
    uid: string;
    name: string;
    email: string;
    avatar?: string;
    role: WorkspaceRole;
    status: 'invited' | 'active';
    joinedAt: string;
}

export interface ActivityEntry {
    id: string;
    uid: string;
    userName: string;
    action: string;
    entityType: string;
    entityId: string;
    timestamp: string;
}

export interface AppNotification {
    id: string;
    type: AppNotificationType;
    workspaceId: string;
    workspaceName: string;
    message: string;
    actioned: boolean;
    createdAt: string;
    senderName?: string;
    targetUid?: string;
}

export interface Expense {
    id: string;
    workspaceId: string;
    createdByUid: string;
    createdByName: string;
    createdAt: string;
    updatedAt: string;
    purchaseAt: string;
    amount: number;
    currency: string;
    merchant: string;
    description: string;
    category: CategoryKey;
    paymentMethod: PaymentMethod;
    last4?: string;
    tags: string[];
    notes: string;
    receiptUrl?: string;
    ocrText?: string;
    source: 'manual' | 'ocr' | 'import' | 'smart_cart';
    deleted: boolean;
    /** Value in the workspace currency at entry time (multi-currency). */
    baseAmount?: number;
    baseCurrency?: string;
    fxRate?: number;
    /** Set when the expense was confirmed from a Smart Cart. */
    cartId?: string;
    details?: SmartCartExpenseDetails;
}

/** Itemized snapshot saved with a Smart Cart purchase (never changes after confirmation). */
export interface SmartCartExpenseDetails {
    kind: 'smart_cart';
    version: number;
    cartId: string;
    cartName: string | null;
    storeName: string | null;
    currency: string;
    vatMode: 'none' | 'add' | 'included';
    vatRateBp: number;
    subtotalMinor: number;
    taxableMinor: number;
    exemptMinor: number;
    vatMinor: number;
    beforeVatMinor: number;
    estimatedTotalMinor: number;
    actualTotalMinor: number | null;
    differenceMinor: number | null;
    recordedMinor: number;
    itemCount: number;
    totalQtyMilli: number;
    confirmedAt: string;
    items: {
        name: string; unitPriceMinor: number; qtyMilli: number; unitBasis: string; lineMinor: number; vatExempt: boolean;
        packSize: string | null; barcode: string | null; productionDate: string | null; expiryDate: string | null;
        notes: string | null; source: string; imagePaths: string[];
    }[];
}

export interface MonthlyBill {
    id: string;
    workspaceId: string;
    createdByUid: string;
    name: string;
    amount: number;
    currency: string;
    category: CategoryKey;
    paymentMethod?: PaymentMethod;
    dueDate: number; // Day of the month (1-31)
    lastPaidMonth?: string; // e.g., '2026-03'
    lastNotifiedMonth?: string; // e.g., '2026-03'
    createdAt: string;
}

export interface SavingsGoal {
    id: string;
    workspaceId: string;
    name: string;
    reason: string;
    targetAmount: number;
    savedAmount: number;
    currency: string;
    createdAt: string;
    color: string;
    icon: string;
}

export interface Income {
    id: string;
    workspaceId: string;
    createdByUid: string;
    name: string;
    amount: number;
    currency: string;
    type: 'fixed' | 'variable';
    date: string; // ISO date string for variable income, or just the creation date for fixed
    createdAt: string;
    baseAmount?: number;
    baseCurrency?: string;
    fxRate?: number;
}

export interface AppFilters {
    search: string;
    categories: CategoryKey[];
    dateFrom?: string;
    dateTo?: string;
    paymentMethods: PaymentMethod[];
    amountMin?: number;
    amountMax?: number;
    userId?: string;
    hasReceipt?: boolean;
    sortBy: 'date_desc' | 'date_asc' | 'amount_desc' | 'amount_asc';
}

function generateId(): string {
    // crypto.randomUUID() produces valid v4 UUIDs matching Supabase UUID columns
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    // Fallback for older environments
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}

// Demo data removed to ensure clean start for all users.

interface AppState {
    // Auth
    isAuthenticated: boolean;
    user: User | null;
    showOnboarding: boolean;
    // Workspaces
    workspaces: Workspace[];
    activeWorkspaceId: string;
    // Notifications
    notifications: AppNotification[];
    // Bills & Commitments
    bills: MonthlyBill[];
    // Expenses
    expenses: Expense[];
    filters: AppFilters;
    // Savings & Income
    savingsGoals: SavingsGoal[];
    incomes: Income[];
    // UI
    theme: 'dark' | 'light';
    language: string;
    currency: string;
    syncStatus: 'synced' | 'syncing' | 'offline' | 'error';
    categories: CategoryDef[];
    paymentMethods: PaymentMethodDef[];

    login: (user: User) => void;
    logout: () => void;
    
    // Security
    isLocked: boolean;
    setLocked: (locked: boolean) => void;
    deleteAllData: () => void;
    updateUser: (data: Partial<User>) => void;
    completeOnboarding: () => void;
    setActiveWorkspace: (id: string) => void;
    loadWorkspaceData: (wsId: string) => Promise<void>;
    addWorkspace: (ws: Omit<Workspace, 'id' | 'activityLog' | 'inviteLink'>) => string;
    updateWorkspace: (id: string, data: Partial<Workspace>) => void;
    deleteWorkspace: (id: string) => void;
    inviteMember: (workspaceId: string, identifier: string, name: string, role: WorkspaceRole) => Promise<AddMemberResult>;
    removeMember: (workspaceId: string, uid: string) => Promise<void>;
    updateMemberRole: (workspaceId: string, uid: string, role: WorkspaceRole) => Promise<void>;
    refreshMembers: (workspaceId: string) => Promise<void>;
    acceptInvite: (workspaceId: string, uid: string, notificationId: string) => void;
    declineInvite: (workspaceId: string, uid: string, notificationId: string) => void;
    markNotificationActioned: (id: string) => void;
    addNotification: (n: Omit<AppNotification, 'id' | 'createdAt' | 'actioned'>) => void;
    
    // Join Requests
    requestJoin: (workspaceId: string) => void;
    acceptJoinRequest: (notificationId: string) => void;
    declineJoinRequest: (notificationId: string) => void;

    addExpense: (exp: Omit<Expense, 'id' | 'createdAt' | 'updatedAt' | 'deleted'>) => void;
    updateExpense: (id: string, data: Partial<Expense>) => void;
    deleteExpense: (id: string) => void;
    setFilters: (f: Partial<AppFilters>) => void;
    resetFilters: () => void;

    // Bills Actions
    addBill: (bill: Omit<MonthlyBill, 'id' | 'createdAt'>) => void;
    updateBill: (id: string, data: Partial<MonthlyBill>) => void;
    deleteBill: (id: string) => void;
    markBillPaid: (id: string, currentMonth: string) => void;
    checkBillReminders: () => void;

    // Savings Goals
    addSavingsGoal: (goal: Omit<SavingsGoal, 'id' | 'createdAt'>) => void;
    addFundsToGoal: (id: string, amount: number) => void;
    deleteSavingsGoal: (id: string) => void;

    // Income
    addIncome: (inc: Omit<Income, 'id' | 'createdAt'>) => void;
    updateIncome: (id: string, data: Partial<Income>) => void;
    deleteIncome: (id: string) => void;

    setTheme: (t: 'dark' | 'light') => void;
    setLanguage: (l: string) => void;
    setCurrency: (c: string) => void;
    addCategory: (cat: CategoryDef) => void;
    updateCategory: (key: string, data: Partial<CategoryDef>) => void;
    deleteCategory: (key: string) => void;
    addPaymentMethod: (pm: PaymentMethodDef) => void;
    updatePaymentMethod: (key: string, data: Partial<PaymentMethodDef>) => void;
    deletePaymentMethod: (key: string) => void;

    hydrateStore: () => Promise<void>;
}

const defaultFilters: AppFilters = { search: '', categories: [], paymentMethods: [], sortBy: 'date_desc' };

export const useStore = create<AppState>()(
    persist(
        (set, get) => ({
            isAuthenticated: false,
            user: null,
            showOnboarding: false,
            workspaces: [],
            activeWorkspaceId: '',
            notifications: [],
            bills: [],
            expenses: [],
            filters: defaultFilters,
            savingsGoals: [],
            incomes: [],
            theme: 'light',
            language: 'en',
            currency: 'USD',
            syncStatus: 'synced',
            categories: [...CATEGORIES],
            paymentMethods: [...PAYMENT_METHODS],
            isLocked: false,

            login: (user) => {
                // Clear any existing local state to prevent leakage between accounts
                set({ 
                    isAuthenticated: true, 
                    user, 
                    // showOnboarding: true, // REMOVED: Don't force onboarding every time
                    workspaces: [],
                    expenses: [],
                    incomes: [],
                    bills: [],
                    savingsGoals: [],
                    notifications: [],
                    activeWorkspaceId: ''
                });
                get().hydrateStore();
            },
            logout: () => {
                // Unsent changes stay in the outbox and are sent the next time this user signs in.
                flushOutbox().catch(() => {}).finally(() => setOutboxOwner(''));
                supabaseSignOut().catch(() => {});
                set({ 
                isAuthenticated: false, 
                user: null, 
                workspaces: [], 
                expenses: [], 
                incomes: [], 
                bills: [], 
                savingsGoals: [], 
                notifications: [],
                activeWorkspaceId: ''
            });
            },
            setLocked: (locked) => set({ isLocked: locked }),
            deleteAllData: () => set({ expenses: [], savingsGoals: [], incomes: [], bills: [], notifications: [] }),
            completeOnboarding: () => {
                const s = get();
                if (!s.user) return;
                s.updateUser({ showOnboarding: false });
            },
            setActiveWorkspace: (id) => {
                set({ activeWorkspaceId: id });
                rememberWorkspace(get().user?.id, id);
                get().loadWorkspaceData(id).catch(reportSyncError);
            },
            loadWorkspaceData: async (wsId) => {
                if (!wsId || !isSupabaseReady()) return;
                set({ syncStatus: 'syncing' });
                const [expenses, incomes, bills, goals] = await Promise.all([
                    fetchExpensesFromCloud(wsId), fetchIncomesFromCloud(wsId), fetchBillsFromCloud(wsId), fetchSavingsGoalsFromCloud(wsId),
                ]);
                if (expenses === null && incomes === null && bills === null && goals === null) {
                    set({ syncStatus: 'error' });
                    return;
                }
                // The cloud is the source of truth for this workspace; other workspaces' rows are untouched.
                // Rows with changes still waiting in the outbox keep their local version.
                set(s => {
                    const merge = <T extends { id: string; workspaceId: string }>(local: T[], cloud: T[] | null, kind: 'expense' | 'income' | 'bill' | 'goal') => {
                        if (cloud === null) return local;
                        const { rows, deleted } = pendingChanges<T>(kind, wsId);
                        const keepIds = new Set(rows.map(r => r.id));
                        const fromCloud = cloud.filter(c => !keepIds.has(c.id) && !deleted.has(c.id));
                        return [...rows, ...fromCloud, ...local.filter(l => l.workspaceId !== wsId)];
                    };
                    return {
                        expenses: merge(s.expenses, expenses ? expenses.map(mapExpense) : null, 'expense'),
                        incomes: merge(s.incomes, incomes ? incomes.map(mapIncome) : null, 'income'),
                        bills: merge(s.bills, bills ? bills.map(mapBill) : null, 'bill'),
                        savingsGoals: merge(s.savingsGoals, goals ? goals.map(mapGoal) : null, 'goal'),
                        syncStatus: 'synced',
                    };
                });
            },
            addWorkspace: (ws) => {
                const s = get();
                const id = generateId();
                const userId = s.user?.dbId || s.user?.id || '';
                const newWs: Workspace = { 
                    ...ws, 
                    id, 
                    ownerId: userId,
                    activityLog: [], 
                    inviteLink: `https://financeva.app/join/${id.slice(0, 8)}`,
                    members: [{
                        uid: userId,
                        name: s.user?.name || 'User',
                        email: s.user?.email || '',
                        role: 'owner',
                        status: 'active',
                        joinedAt: new Date().toISOString()
                    }]
                };
                
                // The membership row references the workspace, so it must be written after it.
                syncWorkspaceToCloud(newWs)
                    .then(() => syncWorkspaceMemberToCloud({ workspaceId: id, userId, role: 'owner', status: 'active' }))
                    .catch(reportSyncError);

                set(state => ({ workspaces: [...state.workspaces, newWs] }));
                return id;
            },
            updateWorkspace: (id, data) => set(s => {
                const ws = s.workspaces.find(w => w.id === id);
                let newNotifs = s.notifications;
                if (data.isArchived !== undefined && ws) {
                    newNotifs = [{ id: generateId(), type: 'workspace_archived', workspaceId: id, workspaceName: ws.name, message: `Workspace "${ws.name}" has been ${data.isArchived ? 'archived' : 'unarchived'}.`, actioned: false, createdAt: new Date().toISOString() }, ...s.notifications];
                }
                const newWorkspaces = s.workspaces.map(w => {
                    if (w.id === id) {
                        const merged = { ...w, ...data };
                        enqueue('workspace', 'upsert', merged.id, merged).catch(reportSyncError);
                        return merged;
                    }
                    return w;
                });
                return {
                    workspaces: newWorkspaces,
                    notifications: newNotifs
                };
            }),
            deleteWorkspace: (id) => set(s => {
                const ws = s.workspaces.find(w => w.id === id);
                const newWorkspaces = s.workspaces.filter(w => w.id !== id);
                const newNotif: AppNotification | null = ws ? { id: generateId(), type: 'workspace_deleted', workspaceId: id, workspaceName: ws.name, message: `Workspace "${ws.name}" was deleted.`, actioned: false, createdAt: new Date().toISOString() } : null;
                // Expenses, bills, goals and memberships cascade from the workspace row.
                deleteWorkspaceFromCloud(id).catch(reportSyncError);
                return {
                    workspaces: newWorkspaces,
                    activeWorkspaceId: s.activeWorkspaceId === id ? (newWorkspaces[0]?.id || '') : s.activeWorkspaceId,
                    notifications: newNotif ? [newNotif, ...s.notifications] : s.notifications
                };
            }),
            inviteMember: async (workspaceId, identifier, _name, role) => {
                const result = await addWorkspaceMemberRemote(workspaceId, identifier.trim(), role === 'owner' ? 'admin' : role);
                if (result === 'added') { dispatchPush(); await get().refreshMembers(workspaceId); }
                return result;
            },
            removeMember: async (workspaceId, uid) => {
                await removeWorkspaceMemberRemote(workspaceId, uid);
                dispatchPush();
                set(s => ({ workspaces: s.workspaces.map(w => w.id === workspaceId ? { ...w, members: w.members.filter(m => m.uid !== uid) } : w) }));
            },
            updateMemberRole: async (workspaceId, uid, role) => {
                await setWorkspaceMemberRoleRemote(workspaceId, uid, role);
                dispatchPush();
                set(s => ({ workspaces: s.workspaces.map(w => w.id === workspaceId ? { ...w, members: w.members.map(m => m.uid === uid ? { ...m, role } : m) } : w) }));
            },
            refreshMembers: async (workspaceId) => {
                const rows = await fetchWorkspaceMemberList(workspaceId);
                if (!rows) return;
                const members: WorkspaceMember[] = rows.map(r => ({ uid: r.user_id, name: r.name || 'Member', email: r.email || '', role: r.role as WorkspaceRole, status: r.status === 'active' ? 'active' : 'invited', joinedAt: r.joined_at }));
                set(s => ({ workspaces: s.workspaces.map(w => w.id === workspaceId ? { ...w, members, type: members.length > 1 ? 'shared' : w.type } : w) }));
            },
            acceptInvite: (workspaceId, uid, notificationId) => set(s => ({
                workspaces: s.workspaces.map(w => w.id === workspaceId ? { ...w, members: w.members.map(m => m.uid === uid ? { ...m, status: 'active' } : m) } : w),
                notifications: s.notifications.map(n => n.id === notificationId ? { ...n, actioned: true } : n)
            })),
            declineInvite: (workspaceId, uid, notificationId) => set(s => ({
                workspaces: s.workspaces.map(w => w.id === workspaceId ? { ...w, members: w.members.filter(m => m.uid !== uid) } : w),
                notifications: s.notifications.map(n => n.id === notificationId ? { ...n, actioned: true } : n)
            })),
            markNotificationActioned: (id) => {
                markNotificationRead(id).catch(() => {});
                set(s => ({ notifications: s.notifications.map(n => n.id === id ? { ...n, actioned: true } : n) }));
            },
            addNotification: (n) => set(s => ({ notifications: [{ ...n, id: generateId(), actioned: false, createdAt: new Date().toISOString() }, ...s.notifications] })),
            
            requestJoin: (workspaceId) => set(s => {
                const ws = s.workspaces.find(w => w.id === workspaceId);
                if (!ws || !s.user) return s;
                
                // Don't duplicate requests
                const existing = s.notifications.find(n => n.workspaceId === workspaceId && n.targetUid === s.user?.id && n.type === 'join_request' && !n.actioned);
                if (existing) return s;

                const newNotif: AppNotification = {
                    id: generateId(),
                    type: 'join_request',
                    workspaceId: ws.id,
                    workspaceName: ws.name,
                    message: `${s.user.name} has requested to join "${ws.name}".`,
                    actioned: false,
                    createdAt: new Date().toISOString(),
                    senderName: s.user.name,
                    targetUid: s.user.id // The requester
                };
                return { notifications: [newNotif, ...s.notifications] };
            }),

            acceptJoinRequest: (notificationId) => set(s => {
                const notif = s.notifications.find(n => n.id === notificationId);
                if (!notif || !notif.workspaceId || !notif.targetUid) return s;

                const ws = s.workspaces.find(w => w.id === notif.workspaceId);
                if (!ws) return s;

                const newMember: WorkspaceMember = {
                    uid: notif.targetUid,
                    name: notif.senderName || 'Anonymous',
                    email: '', // In a real app we'd fetch this from the user ID
                    role: 'viewer', // Default role for new members
                    status: 'active',
                    joinedAt: new Date().toISOString()
                };

                return {
                    workspaces: s.workspaces.map(w => w.id === ws.id ? { ...w, members: [...w.members.filter(m => m.uid !== newMember.uid), newMember] } : w),
                    notifications: s.notifications.map(n => n.id === notificationId ? { ...n, actioned: true } : n)
                };
            }),

            declineJoinRequest: (notificationId) => set(s => ({
                notifications: s.notifications.map(n => n.id === notificationId ? { ...n, actioned: true } : n)
            })),

            addExpense: (exp) => set(s => {
                const now = new Date().toISOString();
                const userId = s.user?.dbId || s.user?.id || '';
                
                if (import.meta.env.DEV && s.user && !s.user.dbId) {
                    console.warn('[Store] Adding expense without dbId');
                }

                const ws = s.workspaces.find(w => w.id === exp.workspaceId);
                const newExp: Expense = withBase({ ...exp, id: generateId(), createdByUid: userId, createdAt: now, updatedAt: now, deleted: false }, ws?.currency);
                const newNotif: AppNotification | null = ws ? { id: generateId(), type: 'expense_added', workspaceId: ws.id, workspaceName: ws.name, message: `New expense of ${exp.amount} ${exp.currency} added in "${ws.name}" by ${exp.createdByName}.`, actioned: false, createdAt: now } : null;

                enqueue('expense', 'upsert', newExp.id, newExp).catch(reportSyncError);

                return {
                    expenses: [newExp, ...s.expenses],
                    notifications: newNotif ? [newNotif, ...s.notifications] : s.notifications
                };
            }),
            updateExpense: (id, data) => set(s => {
                const exp = s.expenses.find(e => e.id === id);
                if (!exp) return {};
                let merged: Expense = { ...exp, ...data, updatedAt: new Date().toISOString() };
                if (data.amount !== undefined || data.currency !== undefined) {
                    const ws = s.workspaces.find(w => w.id === merged.workspaceId);
                    merged = withBase(merged, ws?.currency);
                }
                enqueue('expense', 'upsert', merged.id, merged).catch(reportSyncError);
                return { expenses: s.expenses.map(e => e.id === id ? merged : e) };
            }),
            deleteExpense: (id) => set(s => {
                enqueue('expense', 'delete', id).catch(reportSyncError);
                return { expenses: s.expenses.map(e => e.id === id ? { ...e, deleted: true } : e) };
            }),
            setFilters: (f) => set(s => ({ filters: { ...s.filters, ...f } })),
            resetFilters: () => set({ filters: defaultFilters }),

            // Bills Implementation
            addBill: (bill) => set(s => {
                const now = new Date().toISOString();
                const userId = s.user?.dbId || s.user?.id || '';
                
                if (import.meta.env.DEV && s.user && !s.user.dbId) {
                    console.warn('[Store] Adding bill without dbId');
                }

                const newBill = { ...bill, id: generateId(), createdByUid: userId, createdAt: now };
                const ws = s.workspaces.find(w => w.id === bill.workspaceId);
                const log: ActivityEntry | null = ws ? { id: generateId(), uid: bill.createdByUid, userName: s.user?.name || 'User', action: 'added bill', entityType: 'bill', entityId: newBill.id, timestamp: now } : null;

                enqueue('bill', 'upsert', newBill.id, newBill).catch(reportSyncError);
                if (log) logActivityToCloud({ workspaceId: ws!.id, userId: log.uid, userName: log.userName, action: log.action, entityType: 'bill', entityId: newBill.id }).catch(reportSyncError);

                return {
                    bills: [newBill, ...s.bills],
                    workspaces: (log && ws) ? s.workspaces.map(w => w.id === ws.id ? { ...w, activityLog: [log, ...w.activityLog] } : w) : s.workspaces
                };
            }),
            updateBill: (id, data) => set(s => {
                const bill = s.bills.find(b => b.id === id);
                if (!bill) return s;
                const now = new Date().toISOString();
                const log: ActivityEntry = { id: generateId(), uid: s.user?.id || 'sys', userName: s.user?.name || 'User', action: `updated bill '${data.name || bill.name}'`, entityType: 'bill', entityId: id, timestamp: now };

                enqueue('bill', 'upsert', bill.id, { ...bill, ...data }).catch(reportSyncError);
                return {
                    bills: s.bills.map(b => b.id === id ? { ...b, ...data } : b),
                    workspaces: s.workspaces.map(w => w.id === bill.workspaceId ? { ...w, activityLog: [log, ...w.activityLog] } : w)
                };
            }),
            deleteBill: (id) => set(s => {
                const bill = s.bills.find(b => b.id === id);
                if (!bill) return s;
                const now = new Date().toISOString();
                const log: ActivityEntry = { id: generateId(), uid: s.user?.id || 'sys', userName: s.user?.name || 'User', action: `deleted bill '${bill.name}'`, entityType: 'bill', entityId: id, timestamp: now };

                enqueue('bill', 'delete', id).catch(reportSyncError);

                return {
                    bills: s.bills.filter(b => b.id !== id),
                    workspaces: s.workspaces.map(w => w.id === bill.workspaceId ? { ...w, activityLog: [log, ...w.activityLog] } : w)
                };
            }),
            markBillPaid: (id, currentMonth) => set(s => {
                const bill = s.bills.find(b => b.id === id);
                if (!bill) return s;

                // Create the automatic expense
                const now = new Date().toISOString();
                const newExp: Expense = {
                    id: generateId(),
                    workspaceId: bill.workspaceId,
                    createdByUid: s.user?.dbId || bill.createdByUid,
                    createdByName: s.user?.name || 'User',
                    amount: bill.amount,
                    currency: bill.currency,
                    merchant: bill.name,
                    description: `Auto-paid monthly bill: ${bill.name}`,
                    category: bill.category,
                    paymentMethod: bill.paymentMethod || s.paymentMethods[0]?.key || 'cash',
                    tags: ['bill'],
                    notes: '',
                    source: 'manual',
                    createdAt: now,
                    updatedAt: now,
                    purchaseAt: now,
                    deleted: false
                };

                // Sync the auto-created expense and the updated bill to cloud
                enqueue('expense', 'upsert', newExp.id, newExp).catch(reportSyncError);
                enqueue('bill', 'upsert', bill.id, { ...bill, lastPaidMonth: currentMonth }).catch(reportSyncError);

                return {
                    bills: s.bills.map(b => b.id === id ? { ...b, lastPaidMonth: currentMonth } : b),
                    expenses: [newExp, ...s.expenses]
                };
            }),
            checkBillReminders: () => set(s => {
                const now = new Date();
                const currentMonth = now.toISOString().slice(0, 7);
                const currentDay = now.getDate();
                let newNotifs = [...s.notifications];
                let billsUpdated = false;

                const updatedBills = s.bills.map(b => {
                    const ws = s.workspaces.find(w => w.id === b.workspaceId);
                    if (!ws || b.lastPaidMonth === currentMonth || b.lastNotifiedMonth === currentMonth) return b;

                    const daysUntilDue = b.dueDate - currentDay;
                    if (daysUntilDue <= 7 && daysUntilDue >= -31) {
                        newNotifs = [
                            {
                                id: generateId(),
                                type: 'expense_added',
                                workspaceId: b.workspaceId,
                                workspaceName: ws.name,
                                message: `Bill Reminder: "${b.name}" (${b.amount} ${b.currency}) is ${daysUntilDue < 0 ? 'overdue' : daysUntilDue === 0 ? 'due today' : `due in ${daysUntilDue} days`}.`,
                                actioned: false,
                                createdAt: now.toISOString()
                            },
                            ...newNotifs
                        ];
                        billsUpdated = true;
                        return { ...b, lastNotifiedMonth: currentMonth };
                    }
                    return b;
                });

                if (billsUpdated) {
                    return { bills: updatedBills, notifications: newNotifs };
                }
                return s;
            }),

            addSavingsGoal: (goal: Omit<SavingsGoal, 'id' | 'createdAt'>) => set(s => {
                const newGoal = { ...goal, id: generateId(), createdAt: new Date().toISOString() };
                
                if (import.meta.env.DEV && s.user && !s.user.dbId) {
                    console.warn('[Store] Adding savings goal without dbId');
                }

                enqueue('goal', 'upsert', newGoal.id, newGoal).catch(reportSyncError);
                return { savingsGoals: [...s.savingsGoals, newGoal] };
            }),
            addFundsToGoal: (id: string, amount: number) => set(s => {
                const goal = s.savingsGoals.find(g => g.id === id);
                if (goal) enqueue('goal', 'upsert', goal.id, { ...goal, savedAmount: Math.min(goal.savedAmount + amount, goal.targetAmount) }).catch(reportSyncError);
                return { savingsGoals: s.savingsGoals.map(g => g.id === id ? { ...g, savedAmount: Math.min(g.savedAmount + amount, g.targetAmount) } : g) };
            }),
            deleteSavingsGoal: (id) => set(s => {
                enqueue('goal', 'delete', id).catch(reportSyncError);
                return { savingsGoals: s.savingsGoals.filter(g => g.id !== id) };
            }),
            addIncome: (inc) => set(s => {
                const now = new Date().toISOString();
                const userId = s.user?.dbId || s.user?.id || '';
                
                if (import.meta.env.DEV && s.user && !s.user.dbId) {
                    console.warn('[Store] Adding income without dbId');
                }

                const ws = s.workspaces.find(w => w.id === inc.workspaceId);
                const newInc: Income = withBase({ ...inc, id: generateId(), createdByUid: userId, createdAt: now }, ws?.currency);
                const log: ActivityEntry | null = ws ? { id: generateId(), uid: userId, userName: s.user?.name || 'User', action: `added ${inc.type} income`, entityType: 'income', entityId: newInc.id, timestamp: now } : null;

                enqueue('income', 'upsert', newInc.id, newInc).catch(reportSyncError);

                return {
                    incomes: [newInc, ...s.incomes],
                    workspaces: log ? s.workspaces.map(w => w.id === ws?.id ? { ...w, activityLog: [log, ...w.activityLog] } : w) : s.workspaces
                };
            }),
            updateIncome: (id, data) => set(s => {
                const inc = s.incomes.find(i => i.id === id);
                if (!inc) return {};
                let merged: Income = { ...inc, ...data };
                if (data.amount !== undefined || data.currency !== undefined) merged = withBase(merged, s.workspaces.find(w => w.id === merged.workspaceId)?.currency);
                enqueue('income', 'upsert', merged.id, merged).catch(reportSyncError);
                return { incomes: s.incomes.map(i => i.id === id ? merged : i) };
            }),
            deleteIncome: (id) => set(s => {
                enqueue('income', 'delete', id).catch(reportSyncError);
                return { incomes: s.incomes.filter(i => i.id !== id) };
            }),
            setTheme: (t) => { set({ theme: t }); document.documentElement.setAttribute('data-theme', t); },
            setLanguage: (l) => set({ language: l }),
            setCurrency: (c) => set({ currency: c }),
            addCategory: (cat) => set(s => ({ categories: [...s.categories, cat] })),
            updateCategory: (key, data) => set(s => ({ categories: s.categories.map(c => c.key === key ? { ...c, ...data } : c) })),
                deleteCategory: (key) => set(s => ({ categories: s.categories.filter(c => c.key !== key) })),
            addPaymentMethod: (pm) => set(s => ({ paymentMethods: [...s.paymentMethods, pm] })),
            updatePaymentMethod: (key, data) => set(s => ({ paymentMethods: s.paymentMethods.map(p => p.key === key ? { ...p, ...data } : p) })),
            deletePaymentMethod: (key) => set(s => ({ paymentMethods: s.paymentMethods.filter(p => p.key !== key) })),

            updateUser: async (updates) => {
                const { user } = get();
                if (!user) return;
                
                // Merge into local state immediately
                const newUser = { ...user, ...updates };
                const newShowOnboarding = updates.showOnboarding !== undefined ? updates.showOnboarding : get().showOnboarding;
                set({ user: newUser, showOnboarding: newShowOnboarding });

                // Map camelCase app keys to snake_case DB columns
                const dbUpdates: Record<string, any> = {};
                if (updates.name !== undefined) dbUpdates.name = updates.name;
                if (updates.defaultCurrency !== undefined) dbUpdates.default_currency = updates.defaultCurrency;
                if (updates.language !== undefined) dbUpdates.language = updates.language;
                if (updates.theme !== undefined) dbUpdates.theme = updates.theme;
                if (updates.biometricEnabled !== undefined) dbUpdates.biometric_enabled = updates.biometricEnabled;
                if (updates.hideAmounts !== undefined) dbUpdates.hide_amounts = updates.hideAmounts;
                if (updates.showOnboarding !== undefined) dbUpdates.show_onboarding = updates.showOnboarding;
                if (updates.backupInterval !== undefined) dbUpdates.backup_interval = updates.backupInterval;

                if (Object.keys(dbUpdates).length > 0) {
                    await updateUserProfile(user.id, dbUpdates);
                }
            },

            hydrateStore: async () => {
                const s = get();
                if (!s.user) return;
                set({ syncStatus: 'syncing' });

                // Always refresh the profile: it carries the internal id and the admin flag.
                let userId: string = s.user.dbId || '';
                if (isSupabaseReady()) {
                    const profile = (await fetchUserProfile(s.user.id)) || (await ensureProfile());
                    if (profile) {
                        userId = profile.id;
                        set(state => ({ user: state.user ? {
                            ...state.user,
                            dbId: profile.id,
                            isAdmin: Boolean(profile.is_admin),
                            name: profile.name || state.user.name,
                            phone: profile.phone || state.user.phone,
                            referralCode: profile.referral_code || state.user.referralCode,
                        } : null }));
                    } else if (!userId) {
                        set({ syncStatus: 'error' });
                        toast.error("Couldn't load your profile. Check your connection and reload.", { id: 'profile-error' });
                        return;
                    }
                }
                if (!userId) userId = s.user.id;
                // Send anything this user changed but couldn't sync before (even from a previous session).
                setOutboxOwner(userId);
                await flushOutbox().catch(() => {});

                try {
                    // Join any workspaces this email was invited to before the account existed.
                    if (isSupabaseReady()) {
                        const joined = await claimPendingInvites();
                        if (joined > 0) dispatchPush();
                        if (joined > 0) toast.success(joined === 1 ? 'You were added to a shared workspace.' : `You were added to ${joined} shared workspaces.`);
                    }
                    let ws = await fetchAccessibleWorkspaces(userId);
                    
                    // AGGRESSIVE MIGRATION: Check for orphaned workspaces by email,
                    // even if the UUID account already exists.
                    if (s.user.email) {
                        try {
                            const orphaned = await fetchWorkspacesByEmail(s.user.email);
                            if (orphaned && orphaned.length > 0) {
                                if (import.meta.env.DEV) console.log('[Sync] Found orphaned workspaces, checking migration...');
                                for (const w of orphaned) {
                                    // Only migrate if it's NOT already correctly owned by this internal ID
                                    if (w.owner_id === s.user.email || w.owner_id === s.user.id) {
                                        await syncWorkspaceToCloud({ ...mapWorkspace(w), ownerId: userId });
                                    }
                                }
                                // Re-fetch to get the merged list for the right ID
                                ws = await fetchAccessibleWorkspaces(userId);
                            }
                        } catch (e) {
                            console.error('[Sync] Migration check failed (safe skip):', e);
                        }
                    }

                    if (ws && ws.length > 0) {
                        const self = { dbId: userId, name: s.user.name, email: s.user.email };
                        const memberRows = await fetchWorkspaceMembers(ws.map(w => w.id));
                        const workspaces = ws.map(w => mapWorkspace(w, memberRows.filter(m => m.workspace_id === w.id).map(m => mapMember(m, self))));
                        // Keep the workspace the user was last on, if it still exists
                        const current = get().activeWorkspaceId || recalledWorkspace(s.user.id);
                        const activeId = workspaces.some(w => w.id === current) ? current : workspaces[0].id;
                        rememberWorkspace(s.user.id, activeId);
                        markHasWorkspaces(userId);
                        set({ workspaces, activeWorkspaceId: activeId, showOnboarding: false });
                        workspaces.forEach(w => { get().refreshMembers(w.id).catch(() => {}); });

                        const [notifs] = await Promise.all([
                            fetchNotifications(userId),
                            get().loadWorkspaceData(activeId),
                        ]);
                        if (notifs) set({ notifications: notifs.map(mapNotification) });
                    } else if (ws === null && isSupabaseReady()) {
                        // Network/DB failure: keep the cached data instead of creating a duplicate workspace
                        set({ syncStatus: navigator.onLine === false ? 'offline' : 'error' });
                        return;
                    } else if (hadWorkspaces(userId)) {
                        // This account had workspaces before: an empty answer is a glitch, never a reason
                        // to start over with a blank workspace.
                        set({ syncStatus: 'error' });
                        toast.error("Couldn't load your workspaces. Your data is safe — pull to refresh or reload.", { id: 'ws-load' });
                        return;
                    } else {
                        // Create a default workspace for new user using the safe internal ID
                        if (import.meta.env.DEV) console.log('[Sync] Creating default workspace');
                        const wsId = generateId();
                        const personalWs: Workspace = {
                            id: wsId,
                            name: 'Personal',
                            type: 'personal',
                            ownerId: userId,
                            currency: s.user.defaultCurrency || 'USD',
                            icon: '👤',
                            color: '#2563FF',
                            members: [{
                                uid: userId,
                                name: s.user.name,
                                email: s.user.email,
                                role: 'owner',
                                status: 'active',
                                joinedAt: new Date().toISOString()
                            }],
                            activityLog: [],
                            createdAt: new Date().toISOString()
                        };
                        await syncWorkspaceToCloud(personalWs);
                        await syncWorkspaceMemberToCloud({
                            workspaceId: wsId,
                            userId: userId,
                            role: 'owner',
                            status: 'active'
                        });
                        set({ workspaces: [personalWs], activeWorkspaceId: wsId, showOnboarding: true });
                    }
                    if (get().syncStatus === 'syncing') set({ syncStatus: 'synced' });
                } catch (e) {
                    console.error('Hydration failed', e);
                    set({ syncStatus: 'error' });
                }
            }
        }),
        {
            name: 'financeva-store',
            version: 3,
            // v2/v3: refresh built-in category and workspace colours to the current (Zaylo) palette
            migrate: (persisted: any) => {
                const OLD_WS = ['#1E5B47', '#A87A22', '#2C6A8F', '#B5372F', '#6A52B0', '#1E8A80', '#C4622D', '#13201C'];
                if (persisted?.workspaces) {
                    persisted.workspaces = persisted.workspaces.map((w: Workspace) => {
                        const i = OLD_WS.indexOf(String(w.color).toUpperCase());
                        return i >= 0 ? { ...w, color: WORKSPACE_COLORS[i] } : w;
                    });
                }
                if (persisted?.categories) {
                    persisted.categories = persisted.categories.map((c: CategoryDef) => {
                        const def = CATEGORIES.find(d => d.key === c.key);
                        return def ? { ...c, color: def.color } : c;
                    });
                }
                return persisted;
            },
            partialize: (s) => ({ user: s.user, workspaces: s.workspaces, notifications: s.notifications, bills: s.bills, expenses: s.expenses, savingsGoals: s.savingsGoals, incomes: s.incomes, theme: s.theme, language: s.language, currency: s.currency, activeWorkspaceId: s.activeWorkspaceId, isAuthenticated: s.isAuthenticated, showOnboarding: s.showOnboarding, categories: s.categories, paymentMethods: s.paymentMethods }) }
    )
);
