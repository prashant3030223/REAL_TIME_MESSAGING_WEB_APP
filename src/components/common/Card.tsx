import React from 'react';
import { cn } from '../../utils/cn';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  glow?: boolean;
  hoverEffect?: boolean;
}

export const Card: React.FC<CardProps> = ({
  children,
  className,
  glow = false,
  hoverEffect = false,
  ...props
}) => {
  return (
    <div
      className={cn(
        'rounded-xl border border-brand-border bg-brand-card/90 backdrop-blur-md p-5 text-brand-text shadow-sm',
        hoverEffect &&
          'transition-all duration-200 hover:border-brand-borderLight hover:bg-brand-surface/60 hover:shadow-md',
        glow && 'border-indigo-500/30 shadow-glow-primary',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
};
