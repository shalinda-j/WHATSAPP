import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
  errorInfo?: ErrorInfo;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({
      error,
      errorInfo
    });

    // Log error to monitoring service in production
    console.error('Workflow Builder Error:', error, errorInfo);
    
    // In production, you would send this to your error tracking service
    if (import.meta.env.PROD) {
      // Example: Sentry.captureException(error, { contexts: { react: { componentStack: errorInfo.componentStack } } });
    }
  }

  handleReset = () => {
    this.setState({ hasError: false, error: undefined, errorInfo: undefined });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex flex-col items-center justify-center min-h-[400px] p-8 bg-red-50 border border-red-200 rounded-lg">
          <div className="flex flex-col items-center max-w-md text-center">
            <AlertTriangle className="w-12 h-12 text-red-500 mb-4" />
            <h2 className="text-xl font-semibold text-red-800 mb-2">
              Workflow Builder Error
            </h2>
            <p className="text-red-600 mb-4">
              Something went wrong while building your workflow. We've been notified and are working on a fix.
            </p>
            
            {import.meta.env.DEV && this.state.error && (
              <details className="w-full mb-4 text-left">
                <summary className="cursor-pointer text-sm font-mono bg-red-100 p-2 rounded">
                  Error Details
                </summary>
                <pre className="mt-2 p-2 bg-red-100 rounded text-xs overflow-auto max-h-32">
                  {this.state.error.toString()}
                  {this.state.errorInfo?.componentStack}
                </pre>
              </details>
            )}
            
            <button
              onClick={this.handleReset}
              className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
            >
              <RefreshCw size={16} />
              Try Again
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
