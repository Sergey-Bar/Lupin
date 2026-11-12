import { render, screen } from '@testing-library/react';
import { Timestamp } from './Timestamp.js';
import { formatDateTime } from '../lib/intl.js';

const NOW = new Date('2026-11-09T12:00:00.000Z');

describe('Timestamp', () => {
  it('reads short and relative, and keeps the full zoned time on hover and in markup', () => {
    render(<Timestamp value="2026-11-09T11:55:00.000Z" now={NOW} empty="Unknown" />);
    const time = screen.getByText('5 minutes ago');
    expect(time.tagName).toBe('TIME');
    expect(time).toHaveAttribute('dateTime', '2026-11-09T11:55:00.000Z');
    expect(time).toHaveAttribute('title', formatDateTime(new Date('2026-11-09T11:55:00.000Z')));
  });

  it("says the caller's empty word when there is no time, and draws no <time>", () => {
    const { container } = render(<Timestamp value={null} now={NOW} empty="Not started" />);
    expect(container).toHaveTextContent('Not started');
    expect(container.querySelector('time')).toBeNull();
  });

  it('treats an unparseable value as empty rather than as a sentence about a date', () => {
    const { container } = render(<Timestamp value="not a date" now={NOW} empty="Unknown" />);
    expect(container).toHaveTextContent('Unknown');
    expect(container).not.toHaveTextContent('Invalid');
  });

  it('never wraps, so a narrow column keeps one line per time', () => {
    render(<Timestamp value="2026-11-09T11:55:00.000Z" now={NOW} empty="" />);
    expect(screen.getByText('5 minutes ago')).toHaveClass('whitespace-nowrap');
  });
});
