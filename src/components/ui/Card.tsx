import React from 'react';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  title?: string;
  subtitle?: string;
  action?: React.ReactNode;
}

export const Card: React.FC<CardProps> = ({
  children,
  className = '',
  title,
  subtitle,
  action,
}) => {
  return (
    <div
      className={`bg-bg-surface border border-border rounded-2xl p-4 sm:p-5 shadow-sm transition-all ${className}`}
    >
      {(title || action) && (
        <div className="flex items-center justify-between mb-3.5 pb-2.5 border-b border-border/50">
          <div>
            {title && <h3 className="font-semibold text-sm sm:text-base text-content-primary">{title}</h3>}
            {subtitle && <p className="text-xs text-content-tertiary mt-0.5">{subtitle}</p>}
          </div>
          {action && <div>{action}</div>}
        </div>
      )}
      {children}
    </div>
  );
};
