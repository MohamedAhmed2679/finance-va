import { useState, useEffect } from 'react';
import { useStore } from './store/useStore';
import { fetchUserProfile } from './services/supabaseSync';
import { onAuthStateChange } from './services/authProvider';
import Sidebar from './components/Sidebar';
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
import AddExpenseModal from './components/AddExpenseModal';
import QuickAddMenu from './components/QuickAddMenu';
import VoiceExpenseEntry from './components/VoiceExpenseEntry';
import SMSParser from './components/SMSParser';
import ExpenseConfirmationCards from './components/ExpenseConfirmationCards';
import LockScreen from './components/LockScreen';
import { initSessionManager, cleanupSessionManager } from './services/sessionManager';
import type { ParsedExpense } from './services/aiExpenseParser';

export default function App() {
  const { isAuthenticated, showOnboarding, theme, checkBillReminders, isLocked } = useStore();
  const [page, setPage] = useState('overview');
  const [showAdd, setShowAdd] = useState(false);
  const [showVoiceEntry, setShowVoiceEntry] = useState(false);
  const [showSMSParser, setShowSMSParser] = useState(false);
  const [pendingAIExpenses, setPendingAIExpenses] = useState<ParsedExpense[] | null>(null);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);

    // Inject CSS variable for titlebar height if in Electron
    if (navigator.userAgent.includes('Electron')) {
      document.documentElement.style.setProperty('--titlebar-height', '38px');
    } else {
      document.documentElement.style.setProperty('--titlebar-height', '0px');
    }

    // Restore session on boot
    const { user: storeUser, login, hydrateStore } = useStore.getState();
    if (!storeUser) {
        import('./lib/supabase').then(({ supabase, isSupabaseReady }) => {
            if (isSupabaseReady() && supabase) {
                supabase.auth.getSession().then(({ data }) => {
                    const sbUser = data.session?.user;
                    if (sbUser) {
                        // Fetch the full profile to restore preferences
                        fetchUserProfile(sbUser.id).then((profile: any) => {
                            // Even if profile is null (just signed up), the trigger is likely still running.
                            // We can use the login data and the store will try to fetch again during hydration if dbId is missing.
                            login({
                                id: sbUser.id,
                                dbId: profile?.id || '', // Capture internal ID
                                name: profile?.name || sbUser.user_metadata?.full_name || sbUser.email?.split('@')[0] || 'User',
                                email: sbUser.email || '',
                                phone: sbUser.phone,
                                referralCode: profile?.referral_code || `FV-${sbUser.id.slice(0, 6).toUpperCase()}`,
                                defaultCurrency: profile?.default_currency || 'USD',
                                language: profile?.language || 'en',
                                theme: profile?.theme || 'dark',
                                biometricEnabled: profile?.biometric_enabled || false,
                                hideAmounts: profile?.hide_amounts || false,
                                showOnboarding: profile ? (profile.show_onboarding ?? false) : true,
                                connectedClouds: [],
                                backupInterval: profile?.backup_interval || 'weekly',
                                createdAt: sbUser.created_at
                            });
                            // Hydrate the store to fetch all workspace data and trigger migration
                            hydrateStore();
                        });
                    }
                });
            }
        });
    }
  }, [theme]);

  useEffect(() => {
    if (isAuthenticated) {
      checkBillReminders();
      initSessionManager();
    }
    return () => cleanupSessionManager();
  }, [isAuthenticated, checkBillReminders]);

  useEffect(() => {
    // Listen for Supabase session changes globally
    const { unsubscribe } = onAuthStateChange((_event, user) => {
        if (!user && isAuthenticated) {
           // User was signed out remotely or token expired
           useStore.getState().logout();
        }
    });
    return () => unsubscribe();
  }, [isAuthenticated]);

  if (!isAuthenticated) {
    return <AuthPage onAuth={() => setPage('overview')} />;
  }

  if (showOnboarding) {
    return <OnboardingPage />;
  }

  const renderPage = () => {
    switch (page) {
      case 'overview': return <OverviewPage onNavigate={setPage} onAddExpense={() => setShowAdd(true)} />;
      case 'expenses': return <ExpensesPage />;
      case 'savings': return <SavingsPage />;
      case 'converter': return <ConverterPage />;
      case 'insights': return <InsightsPage />;
      case 'workspaces': return <WorkspacesPage />;
      case 'bills': return <BillsPage />;
      case 'earnings': return <EarningsPage />;
      case 'activity': return <ActivityPage />;
      case 'settings': return <SettingsPage />;
      default: return <OverviewPage onNavigate={setPage} onAddExpense={() => setShowAdd(true)} />;
    }
  };

  // Simple check to see if we are running in the Electron environment
  const isElectron = navigator.userAgent.includes('Electron');

  if (isLocked) {
    return <LockScreen />;
  }

  return (
    <div className={`app-shell ${isElectron ? 'electron-mode' : ''}`} data-theme={theme}>
      <div className="animated-bg" />
      <Sidebar active={page} onNavigate={setPage} />
      <main className="main-content">
        {renderPage()}
      </main>

      <QuickAddMenu 
        onManualAdd={() => setShowAdd(true)} 
        onVoiceAdd={() => setShowVoiceEntry(true)} 
        onScanAdd={() => setShowSMSParser(true)} 
        onAddIncome={() => setPage('earnings')}
      />
      {showAdd && <AddExpenseModal onClose={() => setShowAdd(false)} />}
      
      {showVoiceEntry && (
        <VoiceExpenseEntry 
          onClose={() => setShowVoiceEntry(false)} 
          onAdd={(expenses) => {
             setShowVoiceEntry(false);
             setPendingAIExpenses(expenses);
          }} 
        />
      )}

      {showSMSParser && (
        <SMSParser 
          onClose={() => setShowSMSParser(false)} 
          onAdd={(expenses) => {
             setShowSMSParser(false);
             setPendingAIExpenses(expenses);
          }} 
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
                    createdByUid: store.user?.id || 'guest',
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
