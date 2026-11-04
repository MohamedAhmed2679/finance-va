import { LayoutDashboard, Receipt, Target, ArrowLeftRight, Settings, CalendarDays, TrendingUp, FolderOpen, PieChart, Bell } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface NavEntry { key: string; labelKey: string; icon: LucideIcon; group: 'money' | 'plan' | 'account' }

export const NAV: NavEntry[] = [
    { key: 'overview', labelKey: 'overview', icon: LayoutDashboard, group: 'money' },
    { key: 'expenses', labelKey: 'expenses', icon: Receipt, group: 'money' },
    { key: 'earnings', labelKey: 'earnings', icon: TrendingUp, group: 'money' },
    { key: 'bills', labelKey: 'bills_commitments', icon: CalendarDays, group: 'money' },
    { key: 'savings', labelKey: 'savings', icon: Target, group: 'plan' },
    { key: 'insights', labelKey: 'insights', icon: PieChart, group: 'plan' },
    { key: 'converter', labelKey: 'converter', icon: ArrowLeftRight, group: 'plan' },
    { key: 'workspaces', labelKey: 'workspaces', icon: FolderOpen, group: 'account' },
    { key: 'activity', labelKey: 'activity', icon: Bell, group: 'account' },
    { key: 'settings', labelKey: 'settings', icon: Settings, group: 'account' },
];

export const PAGE_KEYS = NAV.map(n => n.key);

/** Tabs shown directly in the mobile bar; the rest live under "More". */
export const TAB_KEYS = ['overview', 'expenses', 'bills'];
