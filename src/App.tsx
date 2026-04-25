import { useEffect, useRef, useState, lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from "react-router";
import { useSettingsStore } from "./stores/settings-store";
import { scheduleDailyReminder, cancelDailyReminder } from "./services/notification.service";
import { registerPeriodicSync, unregisterPeriodicSync } from "./sw-register";
import { ToastProvider, useToast } from "./components/shared/Toast";
import { checkDatabaseIntegrity } from "./services/integrity.service";
import { checkAndRunAutoBackup, setAutoBackupSchedule } from "./services/backup.service";
import { logger } from "./services/log.service";
import { IntegrityErrorScreen } from "./components/shared/IntegrityErrorScreen";
import TabLayout from "./components/layout/TabLayout";
import AccountsPage from "./pages/AccountsPage";
import CategoriesPage from "./pages/CategoriesPage";
import TransactionsPage from "./pages/TransactionsPage";
import SettingsPage from "./pages/SettingsPage";
import OnboardingPage from "./pages/OnboardingPage";
import TrashedAccounts from "./components/accounts/TrashedAccounts";
import { InstallPopup } from "./components/shared/InstallPopup";
import { OnboardingCompletePopup } from "./components/shared/OnboardingCompletePopup";
const BudgetPage = lazy(() => import("./pages/BudgetPage"));
const OverviewPage = lazy(() => import("./pages/OverviewPage"));
const TransactionInput = lazy(() => import("./components/transactions/TransactionInput"));

function AppRoutes() {
  const navigate = useNavigate();
  const {
    load,
    isLoaded,
    hasCompletedOnboarding,
    startupScreen,
    notificationEnabled,
    notificationTime,
  } = useSettingsStore();
  const [integrityError, setIntegrityError] = useState(false);
  const coldStartPathRef = useRef(window.location.pathname);

  useEffect(() => {
    (async () => {
      logger.info('app.boot');
      const integrity = await checkDatabaseIntegrity();
      if (!integrity.ok) {
        if (import.meta.env.DEV) console.error('Database integrity check failed:', integrity.error);
        logger.error('app.integrity.failed', { error: String(integrity.error) });
        setIntegrityError(true);
        return;
      }
      try {
        await load();
        logger.info('app.startup');
      } catch (err) {
        logger.error('app.settings.load.failed', { error: err instanceof Error ? err.message : String(err) });
        useSettingsStore.setState({ isLoaded: true });
      }
    })();
  }, [load]);

  useEffect(() => {
    const DEXIE_ERRORS = new Set([
      'DexieError', 'OpenFailedError', 'VersionError',
      'InvalidStateError', 'QuotaExceededError', 'UpgradeError',
    ]);
    const onUnhandled = (e: PromiseRejectionEvent) => {
      const reason = e.reason;
      if (reason?.name && DEXIE_ERRORS.has(reason.name)) {
        logger.error('db.error', {
          name: reason.name,
          message: String(reason.message ?? reason),
        });
      }
    };
    window.addEventListener('unhandledrejection', onUnhandled);
    return () => window.removeEventListener('unhandledrejection', onUnhandled);
  }, []);

  useEffect(() => {
    if (!isLoaded || integrityError) return;
    checkAndRunAutoBackup().catch((err) => {
      logger.error('backup.auto.startup.failed', { error: err instanceof Error ? err.message : String(err) });
    });
    logger.trimOldLogs().catch((err) => {
      logger.error('log.trim.failed', { error: err instanceof Error ? err.message : String(err) });
    });
    const intervalHours = useSettingsStore.getState().autoBackupIntervalHours;
    setAutoBackupSchedule(intervalHours);
  }, [isLoaded, integrityError]);

  useEffect(() => {
    const handleBackupRestored = () => window.location.reload();
    window.addEventListener("backup-restored", handleBackupRestored);
    return () => window.removeEventListener("backup-restored", handleBackupRestored);
  }, []);

  const { show: showToast } = useToast();
  useEffect(() => {
    const handleUpdate = () => showToast("App updated — restart to apply", "info", 6000);
    window.addEventListener("sw-update-available", handleUpdate);
    return () => window.removeEventListener("sw-update-available", handleUpdate);
  }, [showToast]);

  useEffect(() => {
    if (!isLoaded) return;
    if (notificationEnabled) {
      scheduleDailyReminder(notificationTime || "20:00");
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
      navigate("/onboarding", { replace: true });
      return;
    }
    // On PWA cold start, always redirect to the configured startup tab unless already on it.
    const path = coldStartPathRef.current;
    if (path && path !== `/${startupScreen}`) {
      coldStartPathRef.current = "";
      navigate(`/${startupScreen}`, { replace: true });
    }
  }, [isLoaded, hasCompletedOnboarding, navigate, startupScreen]);

  if (integrityError) {
    return <IntegrityErrorScreen />;
  }

  if (!isLoaded) {
    return (
      <div
        style={{
          display: "flex",
          height: "100dvh",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--color-bg)",
        }}
      >
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: "50%",
            border: "2px solid var(--color-border)",
            borderTopColor: "var(--color-primary)",
            animation: "spin 0.75s linear infinite",
          }}
        />
      </div>
    );
  }

  const startupPath = `/${startupScreen}`;

  const lazySuspenseFallback = (
    <div
      style={{
        display: "flex",
        height: "100dvh",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--color-bg)",
      }}
    >
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: "50%",
          border: "2px solid var(--color-border)",
          borderTopColor: "var(--color-primary)",
          animation: "spin 0.75s linear infinite",
        }}
      />
    </div>
  );

  return (
    <Suspense fallback={lazySuspenseFallback}>
      <Routes>
        <Route path="/" element={<Navigate to={startupPath} replace />} />
        <Route element={<TabLayout />}>
          <Route path="accounts" element={<AccountsPage />}>
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
        <InstallPopup />
        <OnboardingCompletePopup />
      </ToastProvider>
    </BrowserRouter>
  );
}
