import { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import { Toaster } from 'react-hot-toast';
import { useStore } from './store/useStore';
import { fetchUserProfile } from './services/supabaseSync';
import { onAuthStateChange, initNativeAuthListener } from './services/authProvider';
import { consumeImpersonationLink } from './services/adminApi';
import Sidebar from './components/Sidebar';
import TabBar from './components/TabBar';
import { PAGE_KEYS, REDIRECTS, rememberPage } from './components/nav';
import SectionTabs from './components/SectionTabs';
import AiConsentDialog from './components/AiConsentDialog';
import { refreshAiConsent } from './services/aiConsent';
import AppSignInPage from './pages/AppSignInPage';
import AuthPage from './pages/AuthPage';
import OnboardingPage from './pages/OnboardingPage';
import OverviewPage from './pages/OverviewPage';
import { AnnouncementBanner, ImpersonationBar } from './components/LiveLayer';
import { useLiveNotifications, useLiveChatAlerts } from './hooks/useLive';
import AddExpenseModal from './components/AddExpenseModal';
import QuickAddMenu from './components/QuickAddMenu';
import SmartCapture, { type CaptureMode } from './components/SmartCapture';
import MobileTopBar from './components/MobileTopBar';
import { setTxLanguage } from './i18n/translations';
import { startDomTranslation } from './i18n/domTranslate';
import { initPush, scheduleReminders } from './services/push';
import JoinInvite from './components/JoinInvite';
import { captureJoinLink } from './services/joinLink';

// zaylo.cc/join/<token>: remember the invite before routing or sign-in take over the URL
captureJoinLink();
import ExpenseConfirmationCards from './components/ExpenseConfirmationCards';
import LockScreen from './components/LockScreen';
import OfflineBanner from './components/OfflineBanner';
import InvitationsBar from './components/InvitationsBar';
import { useRememberSignedInAccount } from './hooks/useRememberAccount';
import { useAutoTrackDevice } from './autotrack/useAutoTrackDevice';
import { initSessionManager, cleanupSessionManager } from './services/sessionManager';
import type { ParsedExpense } from './services/aiExpenseParser';

// Pages other than the first screen load when first opened; the service worker keeps them for offline use.
const ExpensesPage = lazy(() => import('./pages/ExpensesPage'));
const SavingsPage = lazy(() => import('./pages/SavingsPage'));
const ConverterPage = lazy(() => import('./pages/ConverterPage'));
const InsightsPage = lazy(() => import('./pages/InsightsPage'));
const WorkspacesPage = lazy(() => import('./pages/WorkspacesPage'));
const BillsPage = lazy(() => import('./pages/BillsPage'));
const EarningsPage = lazy(() => import('./pages/EarningsPage'));
const ActivityPage = lazy(() => import('./pages/ActivityPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const ChatPage = lazy(() => import('./pages/ChatPage'));
const HelpPage = lazy(() => import('./pages/HelpPage'));
const AssistantPage = lazy(() => import('./pages/AssistantPage'));
const HistoryPage = lazy(() => import('./pages/HistoryPage'));
const SmartCartPage = lazy(() => import('./pages/SmartCartPage'));
const AutoTrackPage = lazy(() => import('./pages/AutoTrackPage'));

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

    const profile = await fetchUserProfile(sbUser.id);
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
    initial: { opacity: 0, y: 4 },
    animate: { opacity: 1, y: 0, transition: { duration: 0.18, ease: [0.22, 1, 0.36, 1] as const } },
    exit: { opacity: 0, transition: { duration: 0.1 } },
};

function Shell() {
    const location = useLocation();
    const navigate = useNavigate();
    const [showAdd, setShowAdd] = useState(false);
    const [capture, setCapture] = useState<CaptureMode | null>(null);
    const [captureSource, setCaptureSource] = useState<string>('text');
    const [pendingAIExpenses, setPendingAIExpenses] = useState<ParsedExpense[] | null>(null);

    const active = location.pathname.split('/')[1] || 'overview';
    const go = useCallback((page: string) => {
        const target = REDIRECTS[page] || page;
        navigate(`/${PAGE_KEYS.includes(target) ? target : 'overview'}`);
        window.scrollTo({ top: 0 });
    }, [navigate]);
    useEffect(() => { rememberPage(active); }, [active]);
    const hasAdd = !['chat', 'help', 'assistant', 'smart-cart', 'autotrack', 'settings'].includes(active);

    const isElectron = navigator.userAgent.includes('Electron');

    const pages: Record<string, React.ReactElement> = {
        overview: <OverviewPage onNavigate={go} onAddExpense={() => setShowAdd(true)} />,
        expenses: <ExpensesPage />,
        'smart-cart': <SmartCartPage />,
        autotrack: <AutoTrackPage onOpenSettings={() => navigate('/settings?section=autotrack')} />,
        earnings: <EarningsPage />,
        bills: <BillsPage />,
        savings: <SavingsPage />,
        insights: <InsightsPage />,
        converter: <ConverterPage />,
        workspaces: <WorkspacesPage />,
        activity: <ActivityPage />,
        history: <HistoryPage />,
        settings: <SettingsPage />,
        chat: <ChatPage />,
        assistant: <AssistantPage />,
        help: <HelpPage />,
    };
    useLiveNotifications();
    useLiveChatAlerts(active);
    useAutoTrackDevice(navigate);
    useRememberSignedInAccount();

    // Device notifications: tapping one opens the right page
    useEffect(() => { initPush(path => navigate(path)); }, [navigate]);

    // Phone app: keep payment and payday reminders scheduled on the device
    const { bills, workspaces, incomes } = useStore();
    const notifyDaily = useStore(s => Boolean(s.user?.notifyDaily));
    useEffect(() => {
        const wsName = (id: string) => workspaces.find(w => w.id === id)?.name || '';
        const t = setTimeout(() => scheduleReminders(
            bills.map(b => ({ id: b.id, name: b.name, amount: b.amount, currency: b.currency, dueDate: b.dueDate, lastPaidMonth: b.lastPaidMonth, workspaceName: wsName(b.workspaceId) })),
            workspaces.filter(w => !w.isArchived).map(w => {
                const fixed = incomes.filter(i => i.workspaceId === w.id && i.type === 'fixed').reduce((s, i) => s + (i.baseCurrency === w.currency && i.baseAmount != null ? i.baseAmount : i.amount), 0);
                return { workspaceId: w.id, workspaceName: w.name, day: w.cycleStartDay || 1, expected: fixed ? `${w.currency} ${fixed.toLocaleString()}` : undefined };
            }),
            { daily: notifyDaily },
        ).catch(() => {}), 1500);
        return () => clearTimeout(t);
    }, [bills, workspaces, incomes, notifyDaily]);

    return (
        <div className={`app-shell ${isElectron ? 'electron-mode' : ''}`}>
            <Sidebar active={active} onNavigate={go} />
            <main className="main-content">
                <ImpersonationBar />
                <MobileTopBar onNavigate={go} />
                <div className="banner-slot"><AnnouncementBanner /></div>
                <InvitationsBar />
                <SectionTabs active={active} onNavigate={go} />
                <AnimatePresence mode="wait" initial={false}>
                    <motion.div key={active} {...pageMotion}>
                        <Suspense fallback={<div className="page" aria-busy="true"><div className="skeleton" style={{ height: 28, width: 220, marginBottom: 20 }} /><div className="skeleton" style={{ height: 180 }} /></div>}>
                        <Routes location={location}>
                            <Route path="/" element={<Navigate to="/overview" replace />} />
                            {Object.entries(pages).map(([key, el]) => <Route key={key} path={`/${key}`} element={el} />)}
                            {Object.entries(REDIRECTS).map(([from, to]) => <Route key={from} path={`/${from}`} element={<Navigate to={`/${to}`} replace />} />)}
                            <Route path="*" element={<Navigate to="/overview" replace />} />
                        </Routes>
                        </Suspense>
                    </motion.div>
                </AnimatePresence>
            </main>
            <TabBar active={active} onNavigate={go} addSlot={hasAdd} />
            <JoinInvite />

            {hasAdd && <QuickAddMenu
                onManualAdd={() => setShowAdd(true)}
                onVoiceAdd={() => setCapture('voice')}
                onScanAdd={() => setCapture('scan')}
                onPasteAdd={() => setCapture('text')}
                onAddIncome={() => go('earnings')}
                onSmartCart={() => go('smart-cart')}
            />}
            {showAdd && <AddExpenseModal onClose={() => setShowAdd(false)} />}

            {capture && (
                <SmartCapture
                    initialMode={capture}
                    onClose={() => setCapture(null)}
                    onResult={(expenses, source) => { setCapture(null); setCaptureSource(source); setPendingAIExpenses(expenses); }}
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
                                purchaseAt: exp.date && exp.date !== new Date().toISOString().slice(0, 10) ? new Date(`${exp.date}T12:00:00`).toISOString() : new Date().toISOString(),
                                merchant: exp.merchant,
                                description: exp.description,
                                amount: exp.amount,
                                currency: exp.currency || store.currency,
                                category: exp.category,
                                paymentMethod: exp.paymentMethod || 'card',
                                tags: [],
                                notes: captureSource === 'voice' ? 'Added by voice with Zaylo AI' : captureSource === 'scan' || captureSource === 'upload' ? 'Read from a receipt by Zaylo AI' : 'Added with Zaylo AI',
                                source: captureSource === 'scan' || captureSource === 'upload' ? 'ocr' : 'import',
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
    // tx() reads the language synchronously while rendering, so set it before any child renders
    setTxLanguage(lang);

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
        return startDomTranslation(lang);
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
            refreshAiConsent().catch(() => {});   // pick up a permission given or withdrawn on another device
            // Desktop app: save last month's backup into iCloud Drive / OneDrive folder if it isn't there yet
            const t = setTimeout(() => {
                import('./services/cloudBackup').then(m => m.desktopMonthlyCatchUp()).then(r => {
                    if (r) import('react-hot-toast').then(({ default: toast }) => toast.success(`Zaylo backup for ${r.month} saved`));
                }).catch(e => console.warn('[backup] desktop', e));
            }, 8000);
            return () => { clearTimeout(t); cleanupSessionManager(); };
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
    if (window.location.pathname === '/app-signin') content = <AppSignInPage />;
    else if (!isAuthenticated) content = <AuthPage onAuth={() => window.history.replaceState({}, '', '/overview')} />;
    else if (showOnboarding) content = <OnboardingPage />;
    else if (isLocked) content = <LockScreen />;
    else content = <BrowserRouter><Shell /></BrowserRouter>;

    return (
        <MotionConfig reducedMotion="user">
            {content}
            <OfflineBanner />
            {isAuthenticated && <AiConsentDialog />}
            <Toaster position="top-center" toastOptions={{
                style: { background: 'var(--ink)', color: 'var(--paper)', borderRadius: 12, fontSize: 14, fontWeight: 500, maxWidth: 420 },
                success: { iconTheme: { primary: 'var(--note)', secondary: 'var(--paper)' } },
            }} />
        </MotionConfig>
    );
}
