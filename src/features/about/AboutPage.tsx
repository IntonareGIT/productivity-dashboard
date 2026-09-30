import React, { useState } from 'react';
import { ChevronDown, Compass, Rocket } from 'lucide-react';
import {
  APP_TAGLINE, APP_VERSION, BUILD_DATE, HELP_FOOTER, HELP_SECTIONS, QUICK_START,
  type HelpBullet,
} from './helpContent';

/** A "2026-01-31T…" build stamp rendered as a plain date. */
const buildDateLabel = (iso: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[Number(m[2]) - 1] ?? m[2];
  return `${Number(m[3])} ${month} ${m[1]}`;
};

const Bullets: React.FC<{ items: HelpBullet[] }> = ({ items }) => (
  <ul className="space-y-1.5">
    {items.map((item, i) => (
      <li key={`${item.lead ?? 'b'}-${i}`} className="flex gap-2 text-sm leading-relaxed">
        <span aria-hidden className="text-content-tertiary shrink-0 mt-[3px]">•</span>
        <span className="min-w-0 break-words">
          {item.lead && <span className="font-semibold text-content-primary">{item.lead}: </span>}
          <span className="text-content-secondary">{item.text}</span>
        </span>
      </li>
    ))}
  </ul>
);

/**
 * One collapsible section.
 *
 * Uses native `<details>`/`<summary>` so it is keyboard accessible and works as a
 * disclosure for free (find-in-page, deep-linking via the fragment id) with no
 * ARIA wiring to keep in sync. A 44px+ touch target on the summary row keeps it
 * usable with a thumb.
 */
const Section: React.FC<{ section: (typeof HELP_SECTIONS)[number]; defaultOpen: boolean }> = ({ section, defaultOpen }) => (
  <details
    id={section.id}
    open={defaultOpen}
    className="group rounded-xl border border-border bg-bg-surface overflow-hidden scroll-mt-20"
  >
    <summary className="flex items-start gap-3 p-4 min-h-[56px] cursor-pointer list-none hover:bg-bg-elevated/40 transition-colors">
      <ChevronDown className="w-4 h-4 mt-1 shrink-0 text-content-tertiary transition-transform group-open:rotate-180" />
      <span className="min-w-0">
        <span className="block text-sm font-bold text-content-primary">{section.title}</span>
        <span className="block text-xs text-content-tertiary leading-relaxed mt-0.5">{section.summary}</span>
      </span>
    </summary>
    <div className="px-4 pb-4 space-y-4">
      {section.bullets && section.bullets.length > 0 && <Bullets items={section.bullets} />}
      {section.groups?.map((group) => (
        <div key={group.heading}>
          <h3 className="text-xs font-bold uppercase tracking-wide text-content-tertiary mb-1.5">{group.heading}</h3>
          <Bullets items={group.bullets} />
        </div>
      ))}
    </div>
  </details>
);

/**
 * About / Help.
 *
 * ALL copy lives in `helpContent.ts` — this file is layout and interaction
 * only. See the maintenance rule at the top of that file: a feature change must
 * update the content in the same commit.
 */
export const AboutPage: React.FC = () => {
  // Library and Notes open by default, because they are what most people open
  // the app for; the rest start collapsed so the page is scannable on a phone.
  const openByDefault = new Set(['library', 'notes']);

  return (
    <div className="max-w-2xl mx-auto space-y-4 pb-6">
      {/* ---- header ---- */}
      <header className="space-y-1.5">
        <div className="flex items-center gap-2.5">
          <Compass className="w-6 h-6 text-accent shrink-0" />
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-content-primary">About &amp; Help</h1>
        </div>
        <p className="text-sm text-content-secondary leading-relaxed">{APP_TAGLINE}</p>
        <p className="text-[11px] text-content-tertiary">
          Version {APP_VERSION} · built {buildDateLabel(BUILD_DATE)}
        </p>
      </header>

      {/* ---- quick start ---- */}
      <section className="rounded-xl border border-accent/40 bg-accent-subtle p-4">
        <h2 className="flex items-center gap-2 text-sm font-bold text-content-primary mb-2">
          <Rocket className="w-4 h-4 text-accent shrink-0" />
          Quick start
        </h2>
        <Bullets items={QUICK_START} />
      </section>

      {/* ---- the sections ---- */}
      <div className="space-y-2">
        {HELP_SECTIONS.map((section) => (
          <Section key={section.id} section={section} defaultOpen={openByDefault.has(section.id)} />
        ))}
      </div>

      <p className="text-[11px] text-content-tertiary leading-relaxed pt-1">{HELP_FOOTER}</p>
    </div>
  );
};
