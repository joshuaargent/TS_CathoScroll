import { forwardRef, type HTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

// ============================================
// Types
// ============================================

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'accent' | 'outline';

  size?: 'sm' | 'md' | 'lg';
}

// ============================================
// Styles
// ============================================

const variantStyles = {
  default: 'bg-bg-secondary text-text-secondary border border-border',

  accent: 'bg-accent-light text-accent',

  outline: 'border border-border text-text-secondary',
};

const sizeStyles = {
  sm: 'px-2 py-0.5 text-xs',

  md: 'px-2.5 py-0.5 text-xs',

  lg: 'px-3 py-1 text-sm',
};

// ============================================
// Component
// ============================================

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant = 'default', size = 'md', ...props }, ref) => {
    return (
      <span
        ref={ref}
        className={cn(
          'inline-flex items-center rounded-full font-medium transition-colors',
          variantStyles[variant],
          sizeStyles[size],
          className
        )}
        {...props}
      />
    );
  }
);

Badge.displayName = 'Badge';
