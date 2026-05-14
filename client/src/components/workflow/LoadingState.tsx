import { Loader2 } from 'lucide-react';

interface LoadingStateProps {
  message?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const LoadingState = ({
  message = 'Loading...',
  size = 'md',
  className = '',
}: LoadingStateProps) => {
  const sizeClasses = {
    sm: 'w-4 h-4',
    md: 'w-6 h-6',
    lg: 'w-8 h-8',
  };

  const textSizes = {
    sm: 'text-sm',
    md: 'text-base',
    lg: 'text-lg',
  };

  return (
    <div
      className={`flex flex-col items-center justify-center p-8 ${className}`}
    >
      <Loader2
        className={`animate-spin text-blue-600 mb-3 ${sizeClasses[size]}`}
      />
      <p className={`${textSizes[size]} text-gray-600 font-medium`}>
        {message}
      </p>
    </div>
  );
};

export default LoadingState;
