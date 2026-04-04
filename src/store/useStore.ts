import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { CATEGORIES, PAYMENT_METHODS } from '../constants';
import {
    syncExpenseToCloud, deleteExpenseFromCloud,
    syncIncomeToCloud, deleteIncomeFromCloud,
    syncBillToCloud, deleteBillFromCloud,
    syncSavingsGoalToCloud, deleteSavingsGoalFromCloud,
    syncWorkspaceToCloud, logActivityToCloud
} from '../services/supabaseSync';

export type CategoryKey = string;
export type PaymentMethod = string;
export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'viewer';
export type AppNotificationType = 'invite' | 'role_change' | 'workspace_archived' | 'workspace_deleted' | 'expense_added';

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
    id: string;
    name: string;
    email: string;
    phone?: string;
    avatar?: string;
    referralCode: string;
    defaultCurrency: string;
    language: string;
    theme: 'dark' | 'light';
    biometricEnabled: boolean;
    hideAmounts: boolean;
    storeOcr?: boolean;
    notifyDaily?: boolean;
    notifyMonthly?: boolean;
    notifyBudget?: boolean;
    monthlyBudget?: number;
    connectedClouds?: string[];
    backupInterval?: 'daily' | 'weekly' | 'monthly' | 'manual';
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
    source: 'manual' | 'ocr' | 'import';
    deleted: boolean;
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

function generateId() { return Math.random().toString(36).slice(2, 9) + Date.now().toString(36); }

const DEMO_USER: User = {
    id: 'user_demo_001',
    name: 'Alex Johnson',
    email: 'alex@example.com',
    referralCode: 'FV-AJ2024',
    defaultCurrency: 'USD',
    language: 'en',
    theme: 'dark',
    biometricEnabled: false,
    hideAmounts: false,
    createdAt: new Date().toISOString(),
};

const DEMO_EXPENSES: Expense[] = [
    { id: 'e1', workspaceId: 'ws1', createdByUid: 'user_demo_001', createdByName: 'Alex Johnson', createdAt: '2026-02-27T10:00:00Z', updatedAt: '2026-02-27T10:00:00Z', purchaseAt: '2026-02-27T09:30:00Z', amount: 124.56, currency: 'USD', merchant: 'Whole Foods Market', description: 'Weekly groceries', category: 'groceries', paymentMethod: 'card', last4: '4242', tags: [], notes: '', source: 'manual', deleted: false },
    { id: 'e2', workspaceId: 'ws1', createdByUid: 'user_demo_002', createdByName: 'Maria Garcia', createdAt: '2026-02-26T14:00:00Z', updatedAt: '2026-02-26T14:00:00Z', purchaseAt: '2026-02-26T13:30:00Z', amount: 15.75, currency: 'USD', merchant: 'Sweetgreen', description: 'Lunch', category: 'dining', paymentMethod: 'card', tags: [], notes: '', source: 'manual', deleted: false },
    { id: 'e3', workspaceId: 'ws1', createdByUid: 'user_demo_001', createdByName: 'Alex Johnson', createdAt: '2026-02-26T08:00:00Z', updatedAt: '2026-02-26T08:00:00Z', purchaseAt: '2026-02-26T07:45:00Z', amount: 2.90, currency: 'USD', merchant: 'MTA Omny', description: 'Subway fare', category: 'transport', paymentMethod: 'card', tags: [], notes: '', source: 'manual', deleted: false },
    { id: 'e4', workspaceId: 'ws1', createdByUid: 'user_demo_003', createdByName: 'Kenji Tanaka', createdAt: '2026-02-25T16:00:00Z', updatedAt: '2026-02-25T16:00:00Z', purchaseAt: '2026-02-25T15:30:00Z', amount: 78.99, currency: 'USD', merchant: 'Amazon', description: 'Tech accessories', category: 'shopping', paymentMethod: 'card', tags: [], notes: '', source: 'manual', deleted: false },
    { id: 'e5', workspaceId: 'ws1', createdByUid: 'user_demo_002', createdByName: 'Maria Garcia', createdAt: '2026-02-23T20:00:00Z', updatedAt: '2026-02-23T20:00:00Z', purchaseAt: '2026-02-23T19:00:00Z', amount: 15.49, currency: 'USD', merchant: 'Netflix', description: 'Monthly subscription', category: 'entertainment', paymentMethod: 'card', tags: [], notes: '', source: 'manual', deleted: false },
    { id: 'e6', workspaceId: 'ws1', createdByUid: 'user_demo_001', createdByName: 'Alex Johnson', createdAt: '2026-02-22T10:00:00Z', updatedAt: '2026-02-22T10:00:00Z', purchaseAt: '2026-02-22T09:00:00Z', amount: 88.20, currency: 'USD', merchant: 'Con Edison', description: 'Electric bill', category: 'utilities', paymentMethod: 'bank_transfer', tags: [], notes: '', source: 'manual', deleted: false },
    { id: 'e7', workspaceId: 'ws1', createdByUid: 'user_demo_003', createdByName: 'Kenji Tanaka', createdAt: '2026-02-21T12:00:00Z', updatedAt: '2026-02-21T12:00:00Z', purchaseAt: '2026-02-21T11:30:00Z', amount: 25.10, currency: 'USD', merchant: 'CVS Pharmacy', description: 'Vitamins', category: 'healthcare', paymentMethod: 'cash', tags: [], notes: '', source: 'manual', deleted: false },
    { id: 'e8', workspaceId: 'ws1', createdByUid: 'user_demo_001', createdByName: 'Alex Johnson', createdAt: '2023-10-20T10:00:00Z', updatedAt: '2023-10-20T10:00:00Z', purchaseAt: '2023-10-20T09:00:00Z', amount: 6.50, currency: 'USD', merchant: 'Starbucks', description: 'Morning coffee', category: 'dining', paymentMethod: 'wallet', tags: [], notes: '', source: 'manual', deleted: false },
];

const DEMO_INCOMES: Income[] = [
    { id: 'i1', workspaceId: 'ws1', createdByUid: 'user_demo_001', name: 'Software Engineer Salary', amount: 8500, currency: 'USD', type: 'fixed', date: '2026-03-01T00:00:00Z', createdAt: '2026-01-01T00:00:00Z' },
    { id: 'i2', workspaceId: 'ws1', createdByUid: 'user_demo_001', name: 'Freelance Website', amount: 1200, currency: 'USD', type: 'variable', date: '2026-03-10T00:00:00Z', createdAt: '2026-03-10T00:00:00Z' }
];

const DEMO_SAVINGS: SavingsGoal[] = [
    { id: 'sg1', workspaceId: 'ws1', name: 'Dream Vacation to Japan', reason: 'Visit Tokyo and Kyoto for 2 weeks', targetAmount: 5000, savedAmount: 1250, currency: 'USD', createdAt: '2024-01-01T00:00:00Z', color: '#7c3aed', icon: '✈️' },
    { id: 'sg2', workspaceId: 'ws1', name: 'New MacBook Pro', reason: 'For my design work and video editing', targetAmount: 2500, savedAmount: 2000, currency: 'USD', createdAt: '2024-02-01T00:00:00Z', color: '#06d6a0', icon: '💻' },
    { id: 'sg3', workspaceId: 'ws1', name: 'House Down Payment', reason: 'Buy my first home', targetAmount: 50000, savedAmount: 15000, currency: 'USD', createdAt: '2024-03-01T00:00:00Z', color: '#f59e0b', icon: '🏠' },
];

const DEMO_WORKSPACES: Workspace[] = [
    { id: 'ws1', name: 'Personal', type: 'personal', ownerId: 'user_demo_001', currency: 'USD', icon: '👤', color: '#7c3aed', members: [{ uid: 'user_demo_001', name: 'Alex Johnson', email: 'alex@example.com', role: 'owner', status: 'active', joinedAt: '2024-01-01T00:00:00Z' }], activityLog: [], createdAt: '2024-01-01T00:00:00Z', inviteLink: 'https://financeva.app/join/ws1abc' },
    { id: 'ws2', name: 'Family', type: 'shared', ownerId: 'user_demo_001', currency: 'USD', icon: '👨‍👩‍👧', color: '#06d6a0', members: [{ uid: 'user_demo_001', name: 'Alex Johnson', email: 'alex@example.com', role: 'owner', status: 'active', joinedAt: '2024-01-01T00:00:00Z' }, { uid: 'user_demo_002', name: 'Maria Garcia', email: 'maria@example.com', role: 'member', status: 'active', joinedAt: '2024-01-15T00:00:00Z' }], activityLog: [], createdAt: '2024-01-01T00:00:00Z', inviteLink: 'https://financeva.app/join/ws2def' },
    { id: 'ws3', name: 'Work Trip', type: 'shared', ownerId: 'user_demo_001', currency: 'USD', icon: '💼', color: '#f59e0b', members: [{ uid: 'user_demo_001', name: 'Alex Johnson', email: 'alex@example.com', role: 'owner', status: 'active', joinedAt: '2024-06-01T00:00:00Z' }, { uid: 'user_demo_003', name: 'Kenji Tanaka', email: 'kenji@example.com', role: 'member', status: 'active', joinedAt: '2024-06-05T00:00:00Z' }], activityLog: [], createdAt: '2024-06-01T00:00:00Z', inviteLink: 'https://financeva.app/join/ws3ghi' },
];

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

    // Actions
    login: (user: User) => void;
    logout: () => void;
    deleteAllData: () => void;
    updateUser: (data: Partial<User>) => void;
    completeOnboarding: () => void;
    setActiveWorkspace: (id: string) => void;
    addWorkspace: (ws: Omit<Workspace, 'id' | 'activityLog' | 'inviteLink'>) => void;
    updateWorkspace: (id: string, data: Partial<Workspace>) => void;
    deleteWorkspace: (id: string) => void;
    inviteMember: (workspaceId: string, email: string, name: string, role: WorkspaceRole) => void;
    removeMember: (workspaceId: string, uid: string) => void;
    updateMemberRole: (workspaceId: string, uid: string, role: WorkspaceRole) => void;
    acceptInvite: (workspaceId: string, uid: string, notificationId: string) => void;
    declineInvite: (workspaceId: string, uid: string, notificationId: string) => void;
    markNotificationActioned: (id: string) => void;
    addNotification: (n: Omit<AppNotification, 'id' | 'createdAt' | 'actioned'>) => void;
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
}

const defaultFilters: AppFilters = { search: '', categories: [], paymentMethods: [], sortBy: 'date_desc' };

export const useStore = create<AppState>()(
    persist(
        (set) => ({
            isAuthenticated: true,
            user: DEMO_USER,
            showOnboarding: false,
            workspaces: DEMO_WORKSPACES,
            activeWorkspaceId: 'ws1',
            notifications: [],
            bills: [],
            expenses: DEMO_EXPENSES,
            filters: defaultFilters,
            savingsGoals: DEMO_SAVINGS,
            incomes: DEMO_INCOMES,
            theme: 'dark',
            language: 'en',
            currency: 'USD',
            syncStatus: 'synced',
            categories: [...CATEGORIES],
            paymentMethods: [...PAYMENT_METHODS],

            login: (user) => set({ isAuthenticated: true, user, showOnboarding: true }),
            logout: () => set({ isAuthenticated: false, user: null }),
            deleteAllData: () => set({ expenses: [], savingsGoals: [] }),
            updateUser: (data) => set(s => ({ user: s.user ? { ...s.user, ...data } : null })),
            completeOnboarding: () => set({ showOnboarding: false }),
            setActiveWorkspace: (id) => set({ activeWorkspaceId: id }),
            addWorkspace: (ws) => {
                const id = generateId();
                const newWs: Workspace = { ...ws, id, activityLog: [], inviteLink: `https://financeva.app/join/${id.slice(0, 8)}` };
                syncWorkspaceToCloud(newWs).catch(console.error);
                set(s => ({ workspaces: [...s.workspaces, newWs] }));
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
                        syncWorkspaceToCloud(merged).catch(console.error);
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
                // Deletions cascade in cloud via RLS and direct constraints.
                return {
                    workspaces: newWorkspaces,
                    activeWorkspaceId: s.activeWorkspaceId === id ? (newWorkspaces[0]?.id || '') : s.activeWorkspaceId,
                    notifications: newNotif ? [newNotif, ...s.notifications] : s.notifications
                };
            }),
            inviteMember: (workspaceId, email, name, role) => {
                const uid = generateId(); // Simulated UID for the invited user
                const member: WorkspaceMember = { uid, name, email, role, status: 'invited', joinedAt: new Date().toISOString() };
                set(s => {
                    const ws = s.workspaces.find(w => w.id === workspaceId);
                    const newNotif: AppNotification | null = ws ? { id: generateId(), type: 'invite', workspaceId: ws.id, workspaceName: ws.name, message: `You have been invited to join "${ws.name}" as a ${role}.`, actioned: false, createdAt: new Date().toISOString(), senderName: s.user?.name || 'Someone', targetUid: uid } : null;
                    return {
                        workspaces: s.workspaces.map(w => w.id === workspaceId ? { ...w, members: [...w.members, member] } : w),
                        notifications: newNotif ? [newNotif, ...s.notifications] : s.notifications
                    };
                });
            },
            removeMember: (workspaceId, uid) => set(s => ({ workspaces: s.workspaces.map(w => w.id === workspaceId ? { ...w, members: w.members.filter(m => m.uid !== uid) } : w) })),
            updateMemberRole: (workspaceId, uid, role) => set(s => {
                const ws = s.workspaces.find(w => w.id === workspaceId);
                const member = ws?.members.find(m => m.uid === uid);
                const newNotif: AppNotification | null = ws && member ? { id: generateId(), type: 'role_change', workspaceId: ws.id, workspaceName: ws.name, message: `${member.name}'s role was changed to ${role} in "${ws.name}".`, actioned: false, createdAt: new Date().toISOString() } : null;
                return {
                    workspaces: s.workspaces.map(w => w.id === workspaceId ? { ...w, members: w.members.map(m => m.uid === uid ? { ...m, role } : m) } : w),
                    notifications: newNotif ? [newNotif, ...s.notifications] : s.notifications
                };
            }),
            acceptInvite: (workspaceId, uid, notificationId) => set(s => ({
                workspaces: s.workspaces.map(w => w.id === workspaceId ? { ...w, members: w.members.map(m => m.uid === uid ? { ...m, status: 'active' } : m) } : w),
                notifications: s.notifications.map(n => n.id === notificationId ? { ...n, actioned: true } : n)
            })),
            declineInvite: (workspaceId, uid, notificationId) => set(s => ({
                workspaces: s.workspaces.map(w => w.id === workspaceId ? { ...w, members: w.members.filter(m => m.uid !== uid) } : w),
                notifications: s.notifications.map(n => n.id === notificationId ? { ...n, actioned: true } : n)
            })),
            markNotificationActioned: (id) => set(s => ({ notifications: s.notifications.map(n => n.id === id ? { ...n, actioned: true } : n) })),
            addNotification: (n) => set(s => ({ notifications: [{ ...n, id: generateId(), actioned: false, createdAt: new Date().toISOString() }, ...s.notifications] })),
            addExpense: (exp) => set(s => {
                const now = new Date().toISOString();
                const newExp: Expense = { ...exp, id: generateId(), createdAt: now, updatedAt: now, deleted: false };
                const ws = s.workspaces.find(w => w.id === exp.workspaceId);
                const newNotif: AppNotification | null = ws ? { id: generateId(), type: 'expense_added', workspaceId: ws.id, workspaceName: ws.name, message: `New expense of ${exp.amount} ${exp.currency} added in "${ws.name}" by ${exp.createdByName}.`, actioned: false, createdAt: now } : null;

                syncExpenseToCloud(newExp).catch(console.error);

                return {
                    expenses: [newExp, ...s.expenses],
                    notifications: newNotif ? [newNotif, ...s.notifications] : s.notifications
                };
            }),
            updateExpense: (id, data) => set(s => {
                const exp = s.expenses.find(e => e.id === id);
                if (exp) {
                    const merged = { ...exp, ...data, updatedAt: new Date().toISOString() };
                    syncExpenseToCloud(merged).catch(console.error);
                }
                return { expenses: s.expenses.map(e => e.id === id ? { ...e, ...data, updatedAt: new Date().toISOString() } : e) };
            }),
            deleteExpense: (id) => set(s => {
                deleteExpenseFromCloud(id).catch(console.error);
                return { expenses: s.expenses.map(e => e.id === id ? { ...e, deleted: true } : e) };
            }),
            setFilters: (f) => set(s => ({ filters: { ...s.filters, ...f } })),
            resetFilters: () => set({ filters: defaultFilters }),

            // Bills Implementation
            addBill: (bill) => set(s => {
                const now = new Date().toISOString();
                const newBill = { ...bill, id: generateId(), createdAt: now };
                const ws = s.workspaces.find(w => w.id === bill.workspaceId);
                const log: ActivityEntry | null = ws ? { id: generateId(), uid: bill.createdByUid, userName: s.user?.name || 'User', action: 'added bill', entityType: 'bill', entityId: newBill.id, timestamp: now } : null;

                syncBillToCloud(newBill).catch(console.error);
                if (log) logActivityToCloud({ workspaceId: ws!.id, userId: log.uid, userName: log.userName, action: log.action, entityType: 'bill', entityId: newBill.id }).catch(console.error);

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

                deleteBillFromCloud(id).catch(console.error);

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
                    createdByUid: bill.createdByUid,
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
                syncSavingsGoalToCloud(newGoal).catch(console.error);
                return { savingsGoals: [...s.savingsGoals, newGoal] };
            }),
            addFundsToGoal: (id: string, amount: number) => set(s => {
                const goal = s.savingsGoals.find(g => g.id === id);
                if (goal) syncSavingsGoalToCloud({ ...goal, savedAmount: Math.min(goal.savedAmount + amount, goal.targetAmount) }).catch(console.error);
                return { savingsGoals: s.savingsGoals.map(g => g.id === id ? { ...g, savedAmount: Math.min(g.savedAmount + amount, g.targetAmount) } : g) };
            }),
            deleteSavingsGoal: (id) => set(s => {
                deleteSavingsGoalFromCloud(id).catch(console.error);
                return { savingsGoals: s.savingsGoals.filter(g => g.id !== id) };
            }),
            addIncome: (inc) => set(s => {
                const now = new Date().toISOString();
                const newInc = { ...inc, id: generateId(), createdAt: now };
                const ws = s.workspaces.find(w => w.id === inc.workspaceId);
                const log: ActivityEntry | null = ws ? { id: generateId(), uid: inc.createdByUid, userName: s.user?.name || 'User', action: `added ${inc.type} income`, entityType: 'income', entityId: newInc.id, timestamp: now } : null;

                syncIncomeToCloud(newInc).catch(console.error);

                return {
                    incomes: [newInc, ...s.incomes],
                    workspaces: log ? s.workspaces.map(w => w.id === ws?.id ? { ...w, activityLog: [log, ...w.activityLog] } : w) : s.workspaces
                };
            }),
            updateIncome: (id, data) => set(s => {
                const inc = s.incomes.find(i => i.id === id);
                if (inc) syncIncomeToCloud({ ...inc, ...data }).catch(console.error);
                return { incomes: s.incomes.map(i => i.id === id ? { ...i, ...data } : i) };
            }),
            deleteIncome: (id) => set(s => {
                deleteIncomeFromCloud(id).catch(console.error);
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
        }),
        { name: 'financeva-store', partialize: (s) => ({ user: s.user, workspaces: s.workspaces, notifications: s.notifications, bills: s.bills, expenses: s.expenses, savingsGoals: s.savingsGoals, incomes: s.incomes, theme: s.theme, language: s.language, currency: s.currency, activeWorkspaceId: s.activeWorkspaceId, isAuthenticated: s.isAuthenticated, showOnboarding: s.showOnboarding, categories: s.categories, paymentMethods: s.paymentMethods }) }
    )
);
