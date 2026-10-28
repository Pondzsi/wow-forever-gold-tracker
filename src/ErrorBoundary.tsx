import { Component, type ReactNode } from 'react';

/**
 * Catches a crash inside one page, so the menu keeps working and the rest of
 * the app stays usable. Resets when you go to another page (resetKey changes).
 */
export class ErrorBoundary extends Component<{ resetKey: string; children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="card" role="alert">
        <h3>Something went wrong on this page</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          Your data is safe. Try again, or open another page from the menu. If it keeps happening, the message below
          helps find the cause.
        </p>
        <pre className="small" style={{ whiteSpace: 'pre-wrap', color: 'var(--bad)' }}>
          {this.state.error.message}
        </pre>
        <button onClick={() => this.setState({ error: null })}>Try again</button>
      </div>
    );
  }
}
