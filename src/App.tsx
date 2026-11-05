import { useState, useEffect, useCallback } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import { Toaster } from 'react-hot-toast';
import { useStore } from './store/useStore';
import { fetchUserProfile } from './services/supabaseSync';
import { onAuthStateChange, initNativeAuthListener } from './services/authProvider';
import { consumeImpersonationLink } from './services/adminApi';
import Sidebar from './components/Sidebar';
import TabBar from './components/TabBar';
import { PAGE_KEYS } from './components/nav';
import AuthPage from './pages/AuthPage';
import OnboardingPage from './pages/OnboardingPage';
import OverviewPage from './pages/OverviewPage';
import ExpensesPage from './pages/ExpensesPage';
import SavingsPage from './pages/SavingsPage';
import ConverterPage from './pages/ConverterPage';
import InsightsPage from './pages/InsightsPage';
import WorkspacesPage from './pages/WorkspacesPage';
import BillsPage from './pages/BillsPage';
import EarningsPage from './pages/EarningsPage';
import ActivityPage from './pages/ActivityPage';
import SettingsPage from './pages/SettingsPage';
import ChatPage from './pages/ChatPage';
import MessagesPage from './pages/MessagesPage';
import { AnnouncementBanner, ImpersonationBar, useLiveNotifications } from './components/LiveLayer';
import { ZayloLogo } from './components/brand/Brand';
import AddExpenseModal from './components/AddExpenseModal';
import QuickAddMenu from './components/QuickAddMenu';
import VoiceExpenseEntry from './components/VoiceExpenseEntry';
import SMSParser from './components/SMSParser';
import ExpenseConfirmationCards from './components/ExpenseConfirmationCards';
import LockScreen from './components/LockScreen';
import { initSessionManager, cleanupSessionManager } from './services/sessionManager';
import type { ParsedExpense } from './services/aiExpenseParser';

let restoring: Promise<void> | null = null;
let refreshedThisBoot = false;

/** Restores a Supabase session into the store (boot, OAuth return, deep link). */
function restoreSession(): Promise<void> {
    if (!restoring) restoring = doRestore().finally(() => { restoring = null; });
    return restoring;
}

async function doRestore() {
    const { supabase, isSupabaseReady } = await import('./lib/supabase');
    if (!isSupabaseReady() || !supabase) return;
    await consumeImpersonationLink();
    const { data } = await supabase.auth.getSession();
    const sbUser = data.session?.user;
    if (!sbUser) return;

    if (useStore.getState().user?.id === sbUser.id) {
        // Same account already in the store: refresh its data from the cloud once per boot.
        if (!refreshedThisBoot) { refreshedThisBoot = true; useStore.getState().hydrateStore(); }
        return;
    }

    const profile: any = await fetchUserProfile(sbUser.id);
    const { user: storeUser, login } = useStore.getState();
    if (storeUser?.id === sbUser.id) return;
    refreshedThisBoot = true;
    login({
        id: sbUser.id,
        dbId: profile?.id || '',
        name: profile?.name || sbUser.user_metadata?.full_name || sbUser.user_metadata?.name || sbUser.email?.split('@')[0] || 'User',
        email: sbUser.email || '',
        phone: sbUser.phone,
        referralCode: profile?.referral_code || `FV-${sbUser.id.slice(0, 6).toUpperCase()}`,
        defaultCurrency: profile?.default_currency || 'USD',
        language: profile?.language || 'en',
        theme: profile?.theme || useStore.getState().theme || 'light',
        biometricEnabled: profile?.biometric_enabled || false,
        hideAmounts: profile?.hide_amounts || false,
        showOnboarding: profile ? (profile.show_onboarding ?? false) : true,
        connectedClouds: [],
        backupInterval: profile?.backup_interval || 'weekly',
        createdAt: sbUser.created_at,
    });
}

const pageMotion = {
    initial: { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0, transition: { duration: 0.26, ease: [0.22, 1, 0.36, 1] as const } },
    exit: { opacity: 0, y: -4, transition: { duration: 0.12 } },
};

function Shell() {
    const location = useLocation();
    const navigate = useNavigate();
    const [showAdd, setShowAdd] = useState(false);
    const [showVoiceEntry, setShowVoiceEntry] = useState(false);
    const [showSMSParser, setShowSMSParser] = useState(false);
    const [pendingAIExpenses, setPendingAIExpenses] = useState<ParsedExpense[] | null>(null);

    const active = location.pathname.split('/')[1] || 'overview';
    const go = useCallback((page: string) => {
        navigate(`/${PAGE_KEYS.includes(page) ? page : 'overview'}`);
        window.scrollTo({ top: 0 });
    }, [navigate]);

    const isElectron = navigator.userAgent.includes('Electron');

    const pages: Record<string, React.ReactElement> = {
        overview: <OverviewPage onNavigate={go} onAddExpense={() => setShowAdd(true)} />,
        expenses: <ExpensesPage />,
        earnings: <EarningsPage />,
        bills: <BillsPage />,
        savings: <SavingsPage />,
        insights: <InsightsPage />,
        converter: <ConverterPage />,
        workspaces: <WorkspacesPage />,
        activity: <ActivityPage />,
        settings: <SettingsPage />,
        chat: <ChatPage />,
        messages: <MessagesPage />,
    };
    useLiveNotifications();

    return (
        <div className={`app-shell ${isElectron ? 'electron-mode' : ''}`}>
            <Sidebar active={active} onNavigate={go} />
            <main className="main-content">
                <ImpersonationBar />
                <div className="mobile-brand"><ZayloLogo size={24} /></div>
                <div className="banner-slot"><AnnouncementBanner /></div>
                <AnimatePresence mode="wait" initial={false}>
                    <motion.div key={active} {...pageMotion}>
                        <Routes location={location}>
                            <Route path="/" element={<Navigate to="/overview" replace />} />
                            {Object.entries(pages).map(([key, el]) => <Route key={key} path={`/${key}`} element={el} />)}
                            <Route path="*" element={<Navigate to="/overview" replace />} />
                        </Routes>
                    </motion.div>
                </AnimatePresence>
            </main>
            <TabBar active={active} onNavigate={go} />

            {!['chat', 'messages'].includes(active) && <QuickAddMenu
                onManualAdd={() => setShowAdd(true)}
                onVoiceAdd={() => setShowVoiceEntry(true)}
                onScanAdd={() => setShowSMSParser(true)}
                onAddIncome={() => go('earnings')}
            />}
            {showAdd && <AddExpenseModal onClose={() => setShowAdd(false)} />}

            {showVoiceEntry && (
                <VoiceExpenseEntry
                    onClose={() => setShowVoiceEntry(false)}
                    onAdd={(expenses) => { setShowVoiceEntry(false); setPendingAIExpenses(expenses); }}
                />
            )}

            {showSMSParser && (
                <SMSParser
                    onClose={() => setShowSMSParser(false)}
                    onAdd={(expenses) => { setShowSMSParser(false); setPendingAIExpenses(expenses); }}
                />
            )}

            {pendingAIExpenses && (
                <ExpenseConfirmationCards
                    expenses={pendingAIExpenses}
                    onCancel={() => setPendingAIExpenses(null)}
                    onConfirm={(expenses) => {
                        const store = useStore.getState();
                        expenses.forEach(exp => {
                            store.addExpense({
                                workspaceId: store.activeWorkspaceId,
                                createdByUid: store.user?.dbId || store.user?.id || 'guest',
                                createdByName: store.user?.name || 'Guest',
                                purchaseAt: new Date().toISOString(),
                                merchant: exp.merchant,
                                description: exp.description,
                                amount: exp.amount,
                                currency: exp.currency || store.currency,
                                category: exp.category,
                                paymentMethod: 'cash',
                                tags: [],
                                notes: 'Added via AI Entry',
                                source: 'import',
                            });
                        });
                        setPendingAIExpenses(null);
                    }}
                />
            )}
        </div>
    );
}

export default function App() {
    const { isAuthenticated, showOnboarding, theme, checkBillReminders, isLocked, user } = useStore();
    const lang = user?.language ?? 'en';

    // Theme, writing direction and Electron title bar
    useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme);
        const meta = document.querySelector('meta[name="theme-color"]');
        meta?.setAttribute('content', theme === 'dark' ? '#0B0F1A' : '#F4F6FA');
        document.documentElement.style.setProperty('--titlebar-height', navigator.userAgent.includes('Electron') ? '38px' : '0px');
    }, [theme]);

    useEffect(() => {
        document.documentElement.lang = lang;
        document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    }, [lang]);

    // Session restore on boot + native deep-link OAuth return
    useEffect(() => {
        restoreSession().catch(console.error);
        const stop = initNativeAuthListener(() => { restoreSession().catch(console.error); });
        return () => { stop(); };
    }, []);

    useEffect(() => {
        if (isAuthenticated) {
            checkBillReminders();
            initSessionManager();
        }
        return () => cleanupSessionManager();
    }, [isAuthenticated, checkBillReminders]);

    useEffect(() => {
        const { unsubscribe } = onAuthStateChange((event, sbUser) => {
            if (sbUser && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION')) {
                restoreSession().catch(console.error);
            } else if (!sbUser && event === 'SIGNED_OUT' && useStore.getState().isAuthenticated) {
                useStore.getState().logout();
            }
        });
        return () => unsubscribe();
    }, []);

    // Clean OAuth params from the address bar once Supabase has consumed them
    useEffect(() => {
        const url = new URL(window.location.href);
        if (url.searchParams.has('code') || url.searchParams.has('error')) {
            if (url.searchParams.has('error')) console.error('[Auth] OAuth error:', url.searchParams.get('error_description'));
            const t = setTimeout(() => window.history.replaceState({}, '', url.pathname === '/' ? '/overview' : url.pathname), 1200);
            return () => clearTimeout(t);
        }
    }, []);

    let content: React.ReactElement;
    if (!isAuthenticated) content = <AuthPage onAuth={() => window.history.replaceState({}, '', '/overview')} />;
    else if (showOnboarding) content = <OnboardingPage />;
    else if (isLocked) content = <LockScreen />;
    else content = <BrowserRouter><Shell /></BrowserRouter>;

    return (
        <MotionConfig reducedMotion="user">
            {content}
            <Toaster position="top-center" toastOptions={{
                style: { background: 'var(--ink)', color: 'var(--paper)', borderRadius: 12, fontSize: 14, fontWeight: 500, maxWidth: 420 },
                success: { iconTheme: { primary: 'var(--note)', secondary: 'var(--paper)' } },
            }} />
        </MotionConfig>
    );
}
