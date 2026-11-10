import { LayoutDashboard, Receipt, Target, ArrowLeftRight, CalendarDays, TrendingUp, FolderOpen, PieChart, MessagesSquare, LifeBuoy, History, ShoppingCart, MessageSquareText, ArrowUpDown, ClipboardList, Users, Sparkles } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { t, tx } from '../i18n/translations';

export interface NavEntry { key: string; labelKey: string; label?: string; icon: LucideIcon }
export interface NavGroup { key: string; label: string; icon: LucideIcon; items: NavEntry[] }

/**
 * Six destinations. A group with more than one page shows its pages only while it is open,
 * so the menu never lists every feature at once.
 * Settings, notifications, appearance and the admin console are not destinations:
 * they live in the account menu and the notification bell.
 */
export const GROUPS: NavGroup[] = [
    { key: 'home', label: 'Home', icon: LayoutDashboard, items: [
        { key: 'overview', labelKey: 'overview', icon: LayoutDashboard },
    ] },
    { key: 'transactions', label: 'Transactions', icon: ArrowUpDown, items: [
        { key: 'expenses', labelKey: 'expenses', icon: Receipt },
        { key: 'earnings', labelKey: 'earnings', icon: TrendingUp },
        { key: 'autotrack', labelKey: 'autotrack', label: 'AutoTrack', icon: MessageSquareText },
        { key: 'history', labelKey: 'history', label: 'History', icon: History },
    ] },
    { key: 'planning', label: 'Planning', icon: ClipboardList, items: [
        { key: 'bills', labelKey: 'bills_commitments', icon: CalendarDays },
        { key: 'savings', labelKey: 'savings', icon: Target },
        { key: 'smart-cart', labelKey: 'smart_cart', label: 'Smart Cart', icon: ShoppingCart },
    ] },
    { key: 'insights', label: 'Insights', icon: PieChart, items: [
        { key: 'insights', labelKey: 'insights_reports', label: 'Reports and trends', icon: PieChart },
        { key: 'converter', labelKey: 'converter', icon: ArrowLeftRight },
    ] },
    { key: 'workspaces', label: 'Workspaces', icon: Users, items: [
        { key: 'workspaces', labelKey: 'workspaces', icon: FolderOpen },
        { key: 'chat', labelKey: 'chat', label: 'Workspace chat', icon: MessagesSquare },
    ] },
    { key: 'help', label: 'Help', icon: LifeBuoy, items: [
        { key: 'help', labelKey: 'help_support', label: 'Help and support', icon: LifeBuoy },
        { key: 'assistant', labelKey: 'zaylo_ai_assistant', label: 'Zaylo AI Assistant', icon: Sparkles },
    ] },
];

export const NAV: NavEntry[] = GROUPS.flatMap(g => g.items);

/** Pages that are reached from the account menu or the bell, not from a group. */
export const SECONDARY_KEYS = ['activity', 'settings'];
export const PAGE_KEYS = [...NAV.map(n => n.key), ...SECONDARY_KEYS];

/** Old addresses that still arrive from saved links and notifications. */
export const REDIRECTS: Record<string, string> = { messages: 'help' };

export const groupOf = (page: string) => GROUPS.find(g => g.items.some(i => i.key === page));
export const navLabel = (lang: string, n: NavEntry) => (n.label && t(lang, n.labelKey) === n.labelKey ? tx(n.label) : t(lang, n.labelKey));

// Remember the last page opened in each group, so coming back to a group returns to where the person was.
const lastKey = (g: string) => `zaylo_nav_${g}`;
export function rememberPage(page: string) {
    const g = groupOf(page);
    if (g) try { sessionStorage.setItem(lastKey(g.key), page); } catch { /* optional */ }
}
export function groupTarget(g: NavGroup): string {
    try { const last = sessionStorage.getItem(lastKey(g.key)); if (last && g.items.some(i => i.key === last)) return last; } catch { /* optional */ }
    return g.items[0].key;
}

/** The admin console is a separate app, served at /console (and its own domain when configured). */
export const ADMIN_CONSOLE_URL = import.meta.env.VITE_ADMIN_CONSOLE_URL
    || (typeof window !== 'undefined' && window.location.hostname === 'zaylo.cc' ? 'https://admin.zaylo.cc' : '/console');

/** Groups shown directly in the phone bar (around the add button); the rest live under "More". */
export const TAB_GROUPS = ['home', 'transactions', 'planning'];
