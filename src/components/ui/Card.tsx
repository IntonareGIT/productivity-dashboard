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
      className={`card-enter bg-bg-surface border border-border rounded-xl p-5 sm:p-6 ${className}`}
    >
      {(title || action) && (
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 mb-4">
          <div className="min-w-0 flex-1 basis-40">
            {title && <h3 className="font-semibold text-base text-content-primary">{title}</h3>}
            {subtitle && <p className="text-xs text-content-tertiary mt-0.5">{subtitle}</p>}
          </div>
          {action && <div>{action}</div>}
        </div>
      )}
      {children}
    </div>
  );
};
