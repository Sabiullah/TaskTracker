import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  info: ErrorInfo | null;
}

/**
 * Catches render-time errors in a single page view so one broken page
 * doesn't blank the whole app. Renders the error message and stack so
 * the issue can be reported and fixed. Reset via the "Retry" button,
 * which forces a remount of the child tree.
 */
export default class PageErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null };
  private resetKey = 0;

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ error, info });
    console.error("[PageErrorBoundary] ", error, info);
  }

  private retry = () => {
    this.resetKey += 1;
    this.setState({ error: null, info: null });
  };

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div
          role="alert"
          style={{
            padding: 24,
            margin: 16,
            border: "1px solid #fecaca",
            background: "#fef2f2",
            borderRadius: 8,
            fontFamily: "system-ui, sans-serif",
            color: "#7f1d1d",
          }}
        >
          <h2 style={{ margin: "0 0 8px", fontSize: 18 }}>
            This page failed to render
          </h2>
          <p style={{ margin: "0 0 12px" }}>
            The rest of the app is still working. Try navigating to another
            tab or click Retry. If the error keeps coming back, share this
            text with the maintainer.
          </p>
          <pre
            style={{
              whiteSpace: "pre-wrap",
              background: "#fff",
              padding: 12,
              borderRadius: 4,
              border: "1px solid #fecaca",
              fontSize: 12,
              maxHeight: 300,
              overflow: "auto",
            }}
          >
            {this.state.error.message}
            {"\n\n"}
            {this.state.error.stack ?? ""}
            {this.state.info?.componentStack ?? ""}
          </pre>
          <button
            type="button"
            onClick={this.retry}
            style={{
              marginTop: 12,
              padding: "6px 16px",
              border: "none",
              background: "#dc2626",
              color: "#fff",
              borderRadius: 4,
              cursor: "pointer",
            }}
          >
            Retry
          </button>
        </div>
      );
    }
    return <div key={this.resetKey}>{this.props.children}</div>;
  }
}
