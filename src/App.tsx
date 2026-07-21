import { useEffect, useRef, useState, lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from "react-router";
import { useSettingsStore } from "./stores/settings-store";
import { scheduleDailyReminder, cancelDailyReminder } from "./services/notification.service";
import { registerPeriodicSync, unregisterPeriodicSync } from "./sw-register";
import {
  registerCatchUpPeriodicSync,
  setupForegroundCatchUp,
  setupBroadcastChannelListener,
  teardownBackgroundSync,
} from "./services/sync/background-sync";
import { startLiveSync, flushOutbox } from "./services/sync/engine";
import { getLocalFamilyId } from "./services/family/active-family";
import { ToastProvider } from "./components/shared/Toast";
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
import { DeviceJoinedBanner } from "./components/shared/DeviceJoinedBanner";
import { useAuthStore } from "./services/auth/session";
const BudgetPage = lazy(() => import("./pages/BudgetPage"));
const OverviewPage = lazy(() => import("./pages/OverviewPage"));
const TransactionInput = lazy(() => import("./components/transactions/TransactionInput"));
const DeviceJoinWaiting = lazy(() => import("./pages/DeviceJoinWaiting"));
const AdminPage = lazy(() => import("./pages/AdminPage"));
const CryptoDemoPage = import.meta.env.DEV ? lazy(() => import("./pages/CryptoDemoPage")) : null;

const TAB_PATHS = new Set(["/accounts", "/categories", "/transactions", "/budget", "/overview"]);

function AdminRoute() {
  const isAdmin = useAuthStore((s) => s.user?.isAdmin ?? false);
  const sessionResolved = useAuthStore((s) => s.sessionResolved);
  // Wait for the session-restore call to settle before deciding — otherwise a
  // cold-started admin bookmarks/deep-link would bounce to /accounts before
  // refreshMe() has a chance to report the real isAdmin state.
  if (!sessionResolved) return null;
  if (!isAdmin) return <Navigate to="/accounts" replace />;
  return (
    <Suspense fallback={null}>
      <AdminPage />
    </Suspense>
  );
}

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
  const { isSignedIn, awaitingEnvelope, sessionResolved } = useAuthStore();
  const [integrityError, setIntegrityError] = useState(false);
  const coldStartPathRef = useRef(window.location.pathname);
  const liveSyncDisconnectRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    (async () => {
      logger.info("app.boot");
      const integrity = await checkDatabaseIntegrity();
      if (!integrity.ok) {
        if (import.meta.env.DEV) console.error("Database integrity check failed:", integrity.error);
        logger.error("app.integrity.failed", { error: String(integrity.error) });
        setIntegrityError(true);
        return;
      }
      try {
        await load();
        logger.info("app.startup");
      } catch (err) {
        logger.error("app.settings.load.failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        useSettingsStore.setState({ isLoaded: true });
      }
    })();
  }, [load]);

  // Restore the session on cold start — the auth store is otherwise purely
  // in-memory and resets on every reload, so without this a returning
  // signed-in user (or a device still awaiting envelope approval) would
  // render as a brand-new anonymous/solo user until their next network call.
  useEffect(() => {
    void useAuthStore.getState().refreshMe();
  }, []);

  useEffect(() => {
    const DEXIE_ERRORS = new Set([
      "DexieError",
      "OpenFailedError",
      "VersionError",
      "InvalidStateError",
      "QuotaExceededError",
      "UpgradeError",
    ]);
    const onUnhandled = (e: PromiseRejectionEvent) => {
      const reason = e.reason;
      if (reason?.name && DEXIE_ERRORS.has(reason.name)) {
        logger.error("db.error", {
          name: reason.name,
          message: String(reason.message ?? reason),
        });
      }
    };
    window.addEventListener("unhandledrejection", onUnhandled);
    return () => window.removeEventListener("unhandledrejection", onUnhandled);
  }, []);

  useEffect(() => {
    if (!isLoaded || integrityError) return;
    checkAndRunAutoBackup().catch((err) => {
      logger.error("backup.auto.startup.failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    });
    logger.trimOldLogs().catch((err) => {
      logger.error("log.trim.failed", { error: err instanceof Error ? err.message : String(err) });
    });
    const intervalHours = useSettingsStore.getState().autoBackupIntervalHours;
    setAutoBackupSchedule(intervalHours);
  }, [isLoaded, integrityError]);

  useEffect(() => {
    const handleBackupRestored = () => window.location.reload();
    window.addEventListener("backup-restored", handleBackupRestored);
    return () => window.removeEventListener("backup-restored", handleBackupRestored);
  }, []);

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

  // Connects the live SSE stream for whatever family the session currently
  // belongs to and flushes any queued outbox uploads. `getLocalFamilyId()`
  // itself falls back to the `family.id` hydrated by `refreshMe()` when the
  // local sync-cursor table has no row yet — true for a brand-new/pending
  // device that has never completed a pull, which otherwise could never
  // receive the `device.activated` SSE event that completes its own join.
  const connectLiveSync = async () => {
    if (liveSyncDisconnectRef.current) return; // already connected
    try {
      const familyId = await getLocalFamilyId();
      if (!familyId) return;
      liveSyncDisconnectRef.current = startLiveSync(familyId);
      // Flush anything that was queued while offline / signed out.
      flushOutbox().catch((err) => {
        logger.warn(
          "sync.flush.startup.failed",
          err instanceof Error ? err : new Error(String(err)),
        );
      });
    } catch (err) {
      logger.warn(
        "sync.liveSync.start.failed",
        err instanceof Error ? err : new Error(String(err)),
      );
    }
  };

  // ── Background catch-up sync (Phase 12) ──────────────────────────────────
  // Set up foreground visibilitychange catch-up and BroadcastChannel listener
  // whenever the user is signed in. The PBS registration is also attempted here.
  // Also connects the live SSE stream and flushes any pending outbox uploads
  // queued while offline. On sign-out everything is torn down.
  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      teardownBackgroundSync();
      return;
    }
    setupForegroundCatchUp();
    setupBroadcastChannelListener();
    registerCatchUpPeriodicSync().catch(() => {});

    let cancelled = false;
    void (async () => {
      if (!cancelled) await connectLiveSync();
    })();

    return () => {
      cancelled = true;
      if (liveSyncDisconnectRef.current) {
        liveSyncDisconnectRef.current();
        liveSyncDisconnectRef.current = null;
      }
      teardownBackgroundSync();
    };
  }, [isLoaded, isSignedIn]);

  // Leaving a family / accepting an invite changes the active family without
  // toggling `isSignedIn`, so the effect above never reruns on its own. Those
  // flows dispatch this event right after clearing local family state so the
  // stale SSE connection (still bound to the old family) is torn down here.
  // Deliberately does NOT auto-reconnect: `refreshMe()` would report this
  // device's real (already-active) status and could clobber an
  // intentionally-set `awaitingEnvelope` flag from the accept-invite handoff
  // (see FamilySettings.tsx). The next natural reconnect point is the
  // `/devices/waiting` → `/accounts` transition once envelope handling
  // completes, or a future sign-in/reload.
  useEffect(() => {
    const handleFamilySyncReset = () => {
      if (liveSyncDisconnectRef.current) {
        liveSyncDisconnectRef.current();
        liveSyncDisconnectRef.current = null;
      }
      teardownBackgroundSync();
    };
    window.addEventListener("family-sync-reset", handleFamilySyncReset);
    return () => window.removeEventListener("family-sync-reset", handleFamilySyncReset);
  }, []);

  useEffect(() => {
    if (!isLoaded || !sessionResolved) return;
    // New device waiting for envelope — takes priority over every other
    // redirect, including the onboarding gate below (a device joining an
    // existing family never runs onboarding).
    if (isSignedIn && awaitingEnvelope) {
      navigate("/devices/waiting", { replace: true });
      return;
    }
    if (!hasCompletedOnboarding) {
      navigate("/onboarding", { replace: true });
      return;
    }
    // On PWA cold start, redirect to the configured startup tab only when the
    // cold-start path IS a tab route (or "/") — deep links (settings, admin,
    // sign-in, a transaction edit URL, a push-notification URL, etc.) must be
    // left alone.
    const path = coldStartPathRef.current;
    if (path) {
      coldStartPathRef.current = "";
      const isTabRoute = path === "/" || TAB_PATHS.has(path);
      if (isTabRoute && path !== `/${startupScreen}`) {
        navigate(`/${startupScreen}`, { replace: true });
      }
    }
  }, [
    isLoaded,
    sessionResolved,
    hasCompletedOnboarding,
    isSignedIn,
    awaitingEnvelope,
    navigate,
    startupScreen,
  ]);

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
        <Route path="admin" element={<AdminRoute />} />
        <Route path="onboarding" element={<OnboardingPage />} />
        <Route path="signin" element={<OnboardingPage initialStep="sign-in" />} />
        <Route path="devices/waiting" element={<DeviceJoinWaiting />} />
        {import.meta.env.DEV && CryptoDemoPage && (
          <Route path="dev/crypto-demo" element={<CryptoDemoPage />} />
        )}
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
        <DeviceJoinedBanner />
      </ToastProvider>
    </BrowserRouter>
  );
}
