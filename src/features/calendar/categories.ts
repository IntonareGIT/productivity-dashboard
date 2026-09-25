import type { EventCategory } from '../../types';

/**
 * Fixed (theme-independent) category colors, matching the requirement that
 * only color tokens change between themes — category hues stay constant.
 */
export interface CategoryMeta {
  value: EventCategory;
  label: string;
  /** pill/badge classes for event chips */
  badge: string;
  /** small dot classes for compact month cells */
  dot: string;
}

export const CATEGORIES: CategoryMeta[] = [
  {
    value: 'class',
    label: 'Class',
    badge: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
    dot: 'bg-sky-500',
  },
  {
    value: 'deadline',
    label: 'Deadline',
    badge: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
    dot: 'bg-rose-500',
  },
  {
    value: 'personal',
    label: 'Personal',
    badge: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
    dot: 'bg-emerald-500',
  },
  {
    value: 'work',
    label: 'Work',
    badge: 'bg-orange-500/15 text-orange-600 dark:text-orange-400',
    dot: 'bg-orange-500',
  },
];

export const CATEGORY_MAP: Record<EventCategory, CategoryMeta> = CATEGORIES.reduce(
  (acc, c) => ({ ...acc, [c.value]: c }),
  {} as Record<EventCategory, CategoryMeta>
);
