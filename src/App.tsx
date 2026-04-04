import { useState, useEffect } from 'react';
import { useStore } from './store/useStore';
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
import SocialShareMenu from './components/SocialShareMenu';

export default function App() {
  const { isAuthenticated, showOnboarding, theme, checkBillReminders } = useStore();
  const [page, setPage] = useState('overview');
  const [showAdd, setShowAdd] = useState(false);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);

    // Inject CSS variable for titlebar height if in Electron
    if (navigator.userAgent.includes('Electron')) {
      document.documentElement.style.setProperty('--titlebar-height', '38px');
    } else {
      document.documentElement.style.setProperty('--titlebar-height', '0px');
    }
  }, [theme]);

  // Check for bill reminders on app load
  useEffect(() => {
    if (isAuthenticated) {
      checkBillReminders();
    }
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

  return (
    <div className={`app-shell ${isElectron ? 'electron-mode' : ''}`} data-theme={theme}>
      <div className="animated-bg" />
      <Sidebar active={page} onNavigate={setPage} />
      <main className="main-content">
        {renderPage()}
      </main>

      {/* FAB for adding expense */}
      {(page === 'overview' || page === 'expenses') && (
        <button className="fab" onClick={() => setShowAdd(true)} title="Add Expense" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
        </button>
      )}

      {showAdd && <AddExpenseModal onClose={() => setShowAdd(false)} />}
      <SocialShareMenu />
    </div>
  );
}
