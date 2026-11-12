import React from 'react';
import { BookOpen, ChevronRight } from '@lupin/ui';
import { routeFor } from '../route-manifest.js';
import { pageGuidance } from '../page-guidance.js';

/**
 * The page's guide: a book icon, and the guide in a panel over the page when it is opened.
 *
 * It used to be a bar of its own above every page, about 50px of a screen that is laid out to fit
 * without scrolling. The icon takes no height: it sits in the padding `main` already leaves above
 * the page, and the open guide covers the page rather than pushing it down. The words are still
 * there for a screen reader ("How to use Runs") and still the summary of a native disclosure, so
 * the keyboard and the browser's own open and close behaviour are unchanged.
 */
export function PageGuide({ pathname }: { pathname: string }): React.ReactElement | null {
  const route = routeFor(pathname);
  if (!route) return null;
  const guide = pageGuidance[route.id];
  return (
    <div className="relative z-popover h-0 shrink-0" data-chrome="secondary">
      {/* On the page's first row, at its end: the toolbar reserves the space (`PageHeader`). */}
      <details key={route.id} className="absolute end-0 top-0">
        <summary
          title={`How to use ${route.label}`}
          className="relative flex h-10 w-10 cursor-pointer list-none items-center justify-center rounded-md text-fg-muted transition-colors duration-100 hover:bg-surface-raised hover:text-fg motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus [&::-webkit-details-marker]:hidden"
        >
          <BookOpen size={16} aria-hidden="true" />
          <strong className="sr-only">How to use {route.label}</strong>
        </summary>
        <div className="absolute end-0 top-12 w-[min(52rem,calc(100vw-3rem))] rounded-lg border border-border-strong bg-surface p-4 shadow-elevation-3 animate-fade-in">
          <p className="max-w-measure text-sm leading-relaxed text-fg-muted">{guide.purpose}</p>
          <ol className="mt-4 grid gap-3 md:grid-cols-3">
            {guide.steps.map((step, index) => (
              <li
                key={step}
                className="flex gap-3 rounded-md border border-border bg-surface-sunken p-3"
              >
                <span className="font-mono text-sm text-fg-muted">0{index + 1}</span>
                <p className="flex-1 text-sm leading-relaxed">{step}</p>
                {index < 2 ? (
                  <ChevronRight size={16} className="shrink-0 text-fg-muted" aria-hidden="true" />
                ) : null}
              </li>
            ))}
          </ol>
          <p className="mt-4 max-w-measure text-sm leading-relaxed text-fg-muted">
            <strong className="text-fg">Keep in mind: </strong>
            {guide.remember}
          </p>
        </div>
      </details>
    </div>
  );
}
