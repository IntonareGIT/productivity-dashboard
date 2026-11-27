import React from 'react';

interface Props {
  label: string;
  value: string;
  sub?: string;
  onClick: () => void;
}

/** Small square bento tile: one label, one big number, one line of context. */
export const BentoTile: React.FC<Props> = ({ label, value, sub, onClick }) => (
  <button
    onClick={onClick}
    className="card-enter text-left rounded-2xl border border-border bg-bg-surface p-4 flex flex-col justify-between hover:border-border-strong min-w-0"
  >
    <p className="text-xs text-content-tertiary">{label}</p>
    <div className="min-w-0">
      <p className="text-xl md:text-3xl font-semibold tracking-tight text-content-primary leading-none truncate">{value}</p>
      {sub && <p className="text-xs text-content-secondary mt-1.5 line-clamp-2">{sub}</p>}
    </div>
  </button>
);
