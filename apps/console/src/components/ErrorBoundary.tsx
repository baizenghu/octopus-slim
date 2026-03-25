import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[ErrorBoundary] Caught error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          minHeight: '100vh', padding: '2rem', fontFamily: 'system-ui, sans-serif',
          background: '#0a0a0a', color: '#e5e5e5'
        }}>
          <h1 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>😵 页面出错了</h1>
          <p style={{ color: '#a1a1aa', marginBottom: '1.5rem', textAlign: 'center', maxWidth: '400px' }}>
            应用遇到了一个意外错误，请刷新页面重试。
          </p>
          <pre style={{
            background: '#1a1a2e', padding: '1rem', borderRadius: '8px',
            fontSize: '0.75rem', maxWidth: '600px', overflow: 'auto', color: '#f87171',
            marginBottom: '1.5rem'
          }}>
            {this.state.error?.message || 'Unknown error'}
          </pre>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '0.5rem 1.5rem', borderRadius: '6px',
              background: '#4f46e5', color: 'white', border: 'none',
              cursor: 'pointer', fontSize: '0.875rem'
            }}
          >
            刷新页面
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
