import { useEffect, useRef, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router';
import { useSettingsStore } from './stores/settings-store';
import { scheduleDailyReminder, cancelDailyReminder } from './services/notification.service';
import { registerPeriodicSync, unregisterPeriodicSync } from './sw-register';
import { ToastProvider } from './components/shared/Toast';
import TabLayout from './components/layout/TabLayout';
import AccountsPage from './pages/AccountsPage';
import CategoriesPage from './pages/CategoriesPage';
import TransactionsPage from './pages/TransactionsPage';
import SettingsPage from './pages/SettingsPage';
import OnboardingPage from './pages/OnboardingPage';
import TrashedAccounts from './components/accounts/TrashedAccounts';
const BudgetPage = lazy(() => import('./pages/BudgetPage'));
const OverviewPage = lazy(() => import('./pages/OverviewPage'));
const TransactionInput = lazy(() => import('./components/transactions/TransactionInput'));

function AppRoutes() {
  const navigate = useNavigate();
  const { load, isLoaded, hasCompletedOnboarding, startupScreen, notificationEnabled, notificationTime } = useSettingsStore();
  const coldStartPathRef = useRef(window.location.pathname);

  useEffect(() => {
    load().catch((err) => {
      if (import.meta.env.DEV) console.error('Failed to load settings:', err);
      useSettingsStore.setState({ isLoaded: true });
    });
  }, [load]);

  useEffect(() => {
    const handleBackupRestored = () => navigate('/accounts', { replace: true });
    window.addEventListener('backup-restored', handleBackupRestored);
    return () => window.removeEventListener('backup-restored', handleBackupRestored);
  }, [navigate]);

  useEffect(() => {
    if (!isLoaded) return;
    if (notificationEnabled) {
      scheduleDailyReminder(notificationTime || '20:00');
      registerPeriodicSync();
      return () => cancelDailyReminder();
    } else {
      cancelDailyReminder();
      unregisterPeriodicSync();
    }
  }, [isLoaded, notificationEnabled, notificationTime]);

  useEffect(() => {
    if (!isLoaded) return;
    if (!hasCompletedOnboarding) {
      navigate('/onboarding', { replace: true });
      return;
    }
    // PWA cold-start fix: Android restores the last-visited URL from session
    // history. If that URL is a full-screen transaction route, redirect to the
    // user's configured startup tab instead.
    const path = coldStartPathRef.current;
    if (path === '/transactions/new' || /^\/transactions\/[^/]+\/edit$/.test(path)) {
      coldStartPathRef.current = '';
      navigate(`/${startupScreen}`, { replace: true });
    }
  }, [isLoaded, hasCompletedOnboarding, navigate, startupScreen]);

  if (!isLoaded) {
    return (
      <div
        style={{
          display: 'flex',
          height: '100dvh',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--color-bg)',
        }}
      />
    );
  }

  const startupPath = `/${startupScreen}`;

  const lazySuspenseFallback = <div style={{ background: 'var(--color-bg)', height: '100vh' }} />;

  return (
    <Suspense fallback={lazySuspenseFallback}>
      <Routes>
        <Route path="/" element={<Navigate to={startupPath} replace />} />
        <Route element={<TabLayout />}>
          <Route path="accounts" element={<AccountsPage />}>
            <Route path="trash" element={<AccountsPage />} />
            <Route path="new" element={<AccountsPage />} />
            <Route path=":id" element={<AccountsPage />} />
          </Route>
          <Route path="categories" element={<CategoriesPage />}>
            <Route path="trash" element={<CategoriesPage />} />
          </Route>
          <Route path="transactions" element={<TransactionsPage />} />
          <Route path="budget" element={<BudgetPage />} />
          <Route path="overview" element={<OverviewPage />} />
        </Route>
        <Route path="accounts/trash" element={<TrashedAccounts />} />
        <Route path="transactions/new" element={<TransactionInput />} />
        <Route path="transactions/:id/edit" element={<TransactionInput />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="onboarding" element={<OnboardingPage />} />
        <Route path="*" element={<Navigate to="/accounts" replace />} />
      </Routes>
    </Suspense>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AppRoutes />
      </ToastProvider>
    </BrowserRouter>
  );
}
