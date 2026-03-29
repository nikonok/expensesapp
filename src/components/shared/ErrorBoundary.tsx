import { Component, ReactNode } from 'react';

interface Props { children: ReactNode; }
interface State { hasError: boolean; error?: Error; }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };
  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '2rem', color: 'var(--color-text)', fontFamily: 'DM Sans, sans-serif', background: 'var(--color-bg)', minHeight: '100vh' }}>
          <h2 style={{ fontFamily: 'Syne, sans-serif', color: 'var(--color-expense)' }}>Something went wrong</h2>
          <p style={{ color: 'var(--color-text-secondary)' }}>{this.state.error?.message}</p>
          <button onClick={() => window.location.reload()} style={{ marginTop: '1rem', padding: '0.75rem 1.5rem', background: 'var(--color-primary)', color: 'var(--color-bg)', border: 'none', borderRadius: 'var(--radius-btn)', cursor: 'pointer', fontFamily: 'Syne, sans-serif' }}>
            Reload App
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
