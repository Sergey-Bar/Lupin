import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ErrorState } from './ErrorState.js';
import { LoadingState } from '../LoadingState/LoadingState.js';

describe('ErrorState', () => {
  it('says what failed and why, as one alert, with one way out', () => {
    render(
      <ErrorState
        title="Could not load the runs"
        description="The server did not answer. Try again in a moment."
        action={<button type="button">Try again</button>}
      />,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Could not load the runs');
    expect(alert).toHaveTextContent('The server did not answer');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.queryByText('Technical details')).toBeNull();
  });

  it('keeps the technical detail behind a fold', () => {
    render(<ErrorState title="Failed" description="Try again." detail="HTTP 502 Bad Gateway" />);
    expect(screen.getByText('Technical details')).toBeInTheDocument();
    expect(screen.getByText('HTTP 502 Bad Gateway').closest('details')).not.toBeNull();
  });
});

describe('LoadingState', () => {
  it('announces what is loading, politely', () => {
    render(<LoadingState label="runs" />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Loading runs…');
    expect(status).toHaveAttribute('aria-live', 'polite');
  });

  it('says only "Loading…" with no label', () => {
    render(<LoadingState />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading…');
  });
});
