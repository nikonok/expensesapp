import { Component, ErrorInfo, ReactNode } from "react";
import { logger } from "@/services/log.service";

interface Props {
  children: ReactNode;
}
interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };
  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }
  componentDidCatch(error: Error, info: ErrorInfo): void {
    logger.error("react.uncaught", {
      name: error.name,
      message: error.message,
      stack: error.stack,
      componentStack: info.componentStack,
    });
  }
  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            padding: "2rem",
            color: "var(--color-text)",
            fontFamily: "DM Sans, sans-serif",
            background: "var(--color-bg)",
            minHeight: "100vh",
          }}
        >
          <h2 style={{ fontFamily: "Syne, sans-serif", color: "var(--color-expense)" }}>
            Something went wrong
          </h2>
          <p style={{ color: "var(--color-text-secondary)" }}>
            {import.meta.env.DEV
              ? this.state.error?.message
              : "An unexpected error occurred. Please reload the app."}
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: "1rem",
              padding: "0.75rem 1.5rem",
              background: "var(--color-primary)",
              color: "var(--color-bg)",
              border: "none",
              borderRadius: "var(--radius-btn)",
              cursor: "pointer",
              fontFamily: "Syne, sans-serif",
            }}
          >
            Reload App
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
