/// <reference types="vitest/globals" />
import { render, screen, waitFor } from '@testing-library/react';
import { lazyPage } from './lazy-page.js';

describe('lazyPage', () => {
  it('shows a busy loading status, then the page, and forwards its props', async () => {
    let resolve: (module: {
      Page: (props: { label: string }) => React.ReactElement;
    }) => void = () => undefined;
    const load = () =>
      new Promise<{ Page: (props: { label: string }) => React.ReactElement }>((r) => {
        resolve = r;
      });
    const Page = lazyPage(load, 'Page');

    render(<Page label="hello" />);

    // Before the chunk resolves, the reader sees a labelled, busy status — not a blank frame.
    const loading = screen.getByTestId('page-loading');
    expect(loading).toHaveAttribute('role', 'status');
    expect(loading).toHaveAttribute('aria-busy', 'true');

    resolve({ Page: ({ label }) => <p>page: {label}</p> });

    // Once loaded, the real page renders with the props it was given.
    await waitFor(() => expect(screen.getByText('page: hello')).toBeInTheDocument());
    expect(screen.queryByTestId('page-loading')).toBeNull();
  });

  it('names the wrapper after the export, so it is identifiable in a component tree', () => {
    const Page = lazyPage(
      () => Promise.resolve({ Settings: () => <div /> }),
      'Settings',
    ) as unknown as { displayName: string };
    expect(Page.displayName).toBe('Lazy(Settings)');
  });
});
