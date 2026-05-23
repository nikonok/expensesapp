import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./i18n/index";
import "./styles/index.css";
import App from "./App";
import { registerSW } from "./sw-register";
import { ErrorBoundary } from "./components/shared/ErrorBoundary";

// Register install prompt listeners before React mounts so beforeinstallprompt is never missed.
registerSW();

// DEV-only: expose auth store for Playwright e2e tests that need to bypass the GIS popup.
if (import.meta.env.DEV) {
  import("./services/auth/session").then(({ useAuthStore }) => {
    (window as any).__authStore = useAuthStore;
  });
}

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element not found");

createRoot(rootElement).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
