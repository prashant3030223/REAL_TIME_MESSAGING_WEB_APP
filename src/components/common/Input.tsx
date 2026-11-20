import React, { forwardRef } from 'react';
import { cn } from '../../utils/cn';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, helperText, leftIcon, rightIcon, className, id, ...props }, ref) => {
    const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);

    return (
      <div className="w-full space-y-1.5 text-left">
        {label && (
          <label htmlFor={inputId} className="block text-xs font-medium text-brand-muted tracking-wide">
            {label}
          </label>
        )}
        <div className="relative flex items-center">
          {leftIcon && (
            <div className="absolute left-3.5 flex items-center pointer-events-none text-brand-dim">
              {leftIcon}
            </div>
          )}
          <input
            id={inputId}
            ref={ref}
            className={cn(
              'w-full rounded-lg bg-brand-surface/70 border border-brand-border text-sm text-brand-text placeholder-brand-dim/70',
              'transition-all duration-200 outline-none',
              'focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 focus:bg-brand-surface',
              leftIcon ? 'pl-10' : 'pl-3.5',
              rightIcon ? 'pr-10' : 'pr-3.5',
              'py-2.5',
              error && 'border-red-500/70 focus:border-red-500 focus:ring-red-500/40 text-red-200',
              props.disabled && 'opacity-60 cursor-not-allowed bg-brand-card',
              className
            )}
            {...props}
          />
          {rightIcon && (
            <div className="absolute right-3 flex items-center text-brand-dim">
              {rightIcon}
            </div>
          )}
        </div>
        {error ? (
          <p className="text-xs text-red-400 font-medium tracking-wide flex items-center gap-1">
            <span className="inline-block w-1 h-1 rounded-full bg-red-400"></span>
            {error}
          </p>
        ) : helperText ? (
          <p className="text-xs text-brand-dim">{helperText}</p>
        ) : null}
      </div>
    );
  }
);

Input.displayName = 'Input';
