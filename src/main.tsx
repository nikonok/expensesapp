import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./i18n/index";
import "./styles/index.css";
import App from "./App";
import { registerSW } from "./sw-register";
import { ErrorBoundary } from "./components/shared/ErrorBoundary";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element not found");

createRoot(rootElement).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);

registerSW();
