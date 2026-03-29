import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router';
import { useSettingsStore } from './stores/settings-store';
import TabLayout from './components/layout/TabLayout';
import AccountsPage from './pages/AccountsPage';
import CategoriesPage from './pages/CategoriesPage';
import TransactionsPage from './pages/TransactionsPage';
import BudgetPage from './pages/BudgetPage';
import OverviewPage from './pages/OverviewPage';
import SettingsPage from './pages/SettingsPage';
import OnboardingPage from './pages/OnboardingPage';

function AppRoutes() {
  const navigate = useNavigate();
  const { load, isLoaded, hasCompletedOnboarding, startupScreen } = useSettingsStore();

  useEffect(() => {
    load();
  }, [load]);

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
      <Route path="transactions/new" element={<TransactionsPage />} />
      <Route path="transactions/:id/edit" element={<TransactionsPage />} />
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
