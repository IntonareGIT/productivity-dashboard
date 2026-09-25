/**
 * Fixed subject-card color palette. Deliberately independent of the active
 * theme (spec: subject colors are user-chosen and never themed).
 */
export const SUBJECT_PALETTE: { hex: string; name: string }[] = [
  { hex: '#6366f1', name: 'Indigo' },
  { hex: '#3b82f6', name: 'Blue' },
  { hex: '#0ea5e9', name: 'Sky' },
  { hex: '#14b8a6', name: 'Teal' },
  { hex: '#10b981', name: 'Emerald' },
  { hex: '#84cc16', name: 'Lime' },
  { hex: '#eab308', name: 'Yellow' },
  { hex: '#f97316', name: 'Orange' },
  { hex: '#ef4444', name: 'Red' },
  { hex: '#ec4899', name: 'Pink' },
  { hex: '#d946ef', name: 'Fuchsia' },
  { hex: '#8b5cf6', name: 'Violet' },
];

export const DEFAULT_SUBJECT_COLOR = SUBJECT_PALETTE[0].hex;
