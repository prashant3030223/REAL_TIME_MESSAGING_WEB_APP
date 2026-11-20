import React, { useState } from 'react';
import { cn } from '../../utils/cn';
import { getInitials } from '../../utils/formatters';
import { UserStatus } from '../../types';

export interface AvatarProps {
  name: string;
  src?: string;
  status?: UserStatus;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  showStatus?: boolean;
}

export const Avatar: React.FC<AvatarProps> = ({
  name,
  src,
  status,
  size = 'md',
  className,
  showStatus = false,
}) => {
  const [imageError, setImageError] = useState(false);

  const sizeStyles = {
    xs: 'w-6 h-6 text-[10px]',
    sm: 'w-8 h-8 text-xs',
    md: 'w-10 h-10 text-sm',
    lg: 'w-12 h-12 text-base',
    xl: 'w-16 h-16 text-lg',
  };

  const statusSizeStyles = {
    xs: 'w-1.5 h-1.5 border-[1px] -bottom-0.5 -right-0.5',
    sm: 'w-2 h-2 border-[1.5px] bottom-0 right-0',
    md: 'w-2.5 h-2.5 border-2 bottom-0 right-0',
    lg: 'w-3.5 h-3.5 border-2 bottom-0.5 right-0.5',
    xl: 'w-4 h-4 border-2 bottom-1 right-1',
  };

  const statusColors: Record<UserStatus, string> = {
    online: 'bg-emerald-500',
    offline: 'bg-slate-500',
    away: 'bg-amber-400',
    busy: 'bg-rose-500',
  };

  // Generate deterministic gradient background for avatar fallback based on name
  const getGradient = (str: string) => {
    const gradients = [
      'from-indigo-600 to-purple-600',
      'from-blue-600 to-cyan-600',
      'from-emerald-600 to-teal-600',
      'from-purple-600 to-pink-600',
      'from-amber-600 to-orange-600',
    ];
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash) % gradients.length;
    return gradients[index];
  };

  return (
    <div className={cn('relative inline-flex shrink-0 select-none', className)}>
      <div
        className={cn(
          'rounded-full flex items-center justify-center font-semibold overflow-hidden border border-white/10 shadow-sm',
          sizeStyles[size],
          !src || imageError
            ? cn('bg-gradient-to-tr text-white', getGradient(name))
            : 'bg-brand-surface'
        )}
      >
        {src && !imageError ? (
          <img
            src={src}
            alt={name}
            className="w-full h-full object-cover"
            onError={() => setImageError(true)}
            loading="lazy"
          />
        ) : (
          <span>{getInitials(name)}</span>
        )}
      </div>

      {showStatus && status && (
        <span
          title={`Status: ${status}`}
          className={cn(
            'absolute rounded-full border-brand-bg transition-colors duration-200',
            statusSizeStyles[size],
            statusColors[status]
          )}
        />
      )}
    </div>
  );
};
