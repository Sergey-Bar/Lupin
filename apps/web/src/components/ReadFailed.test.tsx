/// <reference types="vitest/globals" />
import React from 'react';
import { render, screen } from '@testing-library/react';
import { ReadFailed } from './ReadFailed';

describe('ReadFailed', () => {
  it('leads with the plain sentence and keeps the code under Technical details', () => {
    render(
      <ReadFailed
        failure={{
          status: 'error',
          message: "Lupin's server isn't answering right now. Try again in a moment.",
          detail: 'HTTP 502',
        }}
      />,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent("Lupin's server isn't answering right now.");
    expect(alert.querySelector('details')).toHaveTextContent('HTTP 502');
  });

  it('shows the server’s own sentence alone when it explains itself', () => {
    render(<ReadFailed failure={{ status: 'error', message: 'No such project' }} />);
    expect(screen.getByRole('alert')).toHaveTextContent('No such project');
    expect(screen.getByRole('alert').querySelector('details')).toBeNull();
  });
});
