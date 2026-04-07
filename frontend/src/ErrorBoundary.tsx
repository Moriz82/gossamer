import { Component, ErrorInfo, ReactNode } from "react";

type Props = { children: ReactNode };

type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Gossamer UI error:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="error-boundary">
          <div className="error-card">
            <h1>Thread broken</h1>
            <p className="error-subtitle">Something went wrong in the application.</p>
            <pre className="error-stack">{this.state.error.message}</pre>
            <details className="error-details">
              <summary>Stack trace</summary>
              <pre className="error-stack-full">{this.state.error.stack}</pre>
            </details>
            <button type="button" className="primary" onClick={() => window.location.reload()}>
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
