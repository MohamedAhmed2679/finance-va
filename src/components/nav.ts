import { Sparkles, LayoutDashboard, Receipt, Target, ArrowLeftRight, Settings, CalendarDays, TrendingUp, FolderOpen, PieChart, Bell, MessagesSquare, LifeBuoy, History } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface NavEntry { key: string; labelKey: string; label?: string; icon: LucideIcon; group: 'money' | 'plan' | 'people' | 'account' | 'admin'; adminOnly?: boolean }

export const NAV: NavEntry[] = [
    { key: 'overview', labelKey: 'overview', icon: LayoutDashboard, group: 'money' },
    { key: 'assistant', labelKey: 'ask_zaylo', label: 'Ask Zaylo', icon: Sparkles, group: 'money' },
    { key: 'expenses', labelKey: 'expenses', icon: Receipt, group: 'money' },
    { key: 'earnings', labelKey: 'earnings', icon: TrendingUp, group: 'money' },
    { key: 'bills', labelKey: 'bills_commitments', icon: CalendarDays, group: 'money' },
    { key: 'savings', labelKey: 'savings', icon: Target, group: 'plan' },
    { key: 'insights', labelKey: 'insights', icon: PieChart, group: 'plan' },
    { key: 'converter', labelKey: 'converter', icon: ArrowLeftRight, group: 'plan' },
    { key: 'chat', labelKey: 'chat', label: 'Workspace chat', icon: MessagesSquare, group: 'people' },
    { key: 'workspaces', labelKey: 'workspaces', icon: FolderOpen, group: 'people' },
    { key: 'activity', labelKey: 'activity', icon: Bell, group: 'account' },
    { key: 'history', labelKey: 'history', label: 'History', icon: History, group: 'account' },
    { key: 'messages', labelKey: 'messages', label: 'Messages', icon: LifeBuoy, group: 'account' },
    { key: 'settings', labelKey: 'settings', icon: Settings, group: 'account' },
];

export const navFor = (isAdmin?: boolean) => NAV.filter(n => !n.adminOnly || isAdmin);

export const PAGE_KEYS = NAV.map(n => n.key);

/** The admin console is a separate app, served at /console (and its own domain when configured). */
export const ADMIN_CONSOLE_URL = import.meta.env.VITE_ADMIN_CONSOLE_URL
    || (typeof window !== 'undefined' && window.location.hostname === 'zaylo.cc' ? 'https://admin.zaylo.cc' : '/console');

/** Tabs shown directly in the mobile bar; the rest live under "More". */
export const TAB_KEYS = ['overview', 'expenses', 'chat'];
