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
      className={`card-surface bg-bg-surface border border-border rounded-2xl p-5 sm:p-6 transition-all duration-200 hover:-translate-y-px ${className}`}
    >
      {(title || action) && (
        <div className="flex items-center justify-between mb-4 pb-3 border-b border-border/40">
          <div>
            {title && <h3 className="font-semibold text-base sm:text-lg tracking-tight text-content-primary">{title}</h3>}
            {subtitle && <p className="text-[11px] uppercase tracking-wider text-accent-text/70 mt-1">{subtitle}</p>}
          </div>
          {action && <div>{action}</div>}
        </div>
      )}
      {children}
    </div>
  );
};
