import React from 'react';

/**
 * The first Tab stop on every page: "Skip to content", hidden until focused, so a keyboard
 * reader does not walk the sidebar and the tab row before reaching the page (WCAG 2.4.1).
 * It focuses `<main id="main">` directly, because a hash change alone does not move focus
 * inside a single-page app.
 */
export function SkipLink(): React.ReactElement {
  return (
    <a
      href="#main"
      onClick={(event) => {
        const main = document.getElementById('main');
        if (main === null) return;
        event.preventDefault();
        main.focus();
      }}
      className="sr-only rounded-md bg-surface-raised px-4 py-2 text-sm font-medium text-fg focus:not-sr-only focus:absolute focus:start-2 focus:top-2 focus:z-popover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
    >
      Skip to content
    </a>
  );
}
