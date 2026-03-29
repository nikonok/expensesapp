import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router';
import { useSettingsStore } from './stores/settings-store';
import { scheduleDailyReminder } from './services/notification.service';
import TabLayout from './components/layout/TabLayout';
import AccountsPage from './pages/AccountsPage';
import CategoriesPage from './pages/CategoriesPage';
import TransactionsPage from './pages/TransactionsPage';
import BudgetPage from './pages/BudgetPage';
import OverviewPage from './pages/OverviewPage';
import SettingsPage from './pages/SettingsPage';
import OnboardingPage from './pages/OnboardingPage';
import TrashedAccounts from './components/accounts/TrashedAccounts';
import TransactionInput from './components/transactions/TransactionInput';

function AppRoutes() {
  const navigate = useNavigate();
  const { load, isLoaded, hasCompletedOnboarding, startupScreen, notificationEnabled, notificationTime } = useSettingsStore();

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!isLoaded) return;
    if (notificationEnabled) {
      scheduleDailyReminder(notificationTime || '20:00');
    }
  }, [isLoaded, notificationEnabled, notificationTime]);

  useEffect(() => {
    if (!isLoaded) return;
    if (!hasCompletedOnboarding) {
      navigate('/onboarding', { replace: true });
    }
  }, [isLoaded, hasCompletedOnboarding, navigate]);

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

  return (
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
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}
