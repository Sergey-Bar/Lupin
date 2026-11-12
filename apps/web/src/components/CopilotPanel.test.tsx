import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CopilotProvider, useCopilot } from './CopilotPanel.js';
import type { QuestionAnswer } from '../lib/copilot-client.js';

function AskButton({ question }: { question: string }) {
  const copilot = useCopilot();
  return <button onClick={() => copilot?.ask(question)}>ask</button>;
}

const answer = (text: string): QuestionAnswer => ({
  source: 'rules',
  answer: text,
  citations: [],
  links: [{ label: 'Open the run', to: '/dashboard/runs/r1' }],
});

describe('CopilotPanel', () => {
  it('is closed until something is asked', () => {
    render(
      <CopilotProvider askImpl={async () => answer('x')}>
        <AskButton question="q" />
      </CopilotProvider>,
    );
    expect(screen.queryByTestId('copilot-panel')).toBeNull();
  });

  it('keeps the thread, oldest first, and answers a follow-up in the same log', async () => {
    render(
      <CopilotProvider askImpl={async (q) => answer(`answer to ${q}`)}>
        <AskButton question="what is failing" />
      </CopilotProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'ask' }));
    expect(await screen.findByText('answer to what is failing')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Ask a follow-up'), {
      target: { value: 'which are flaky' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    expect(await screen.findByText('answer to which are flaky')).toBeInTheDocument();
    const log = screen.getByRole('log');
    expect(log.textContent?.indexOf('what is failing')).toBeLessThan(
      log.textContent?.indexOf('which are flaky') ?? 0,
    );
    expect(screen.getAllByRole('link', { name: 'Open the run' })[0]).toHaveAttribute(
      'href',
      '/dashboard/runs/r1',
    );
  });

  it('closes on Escape and on the close button, and says so when an answer fails', async () => {
    render(
      <CopilotProvider
        askImpl={async () => {
          throw new Error('down');
        }}
      >
        <AskButton question="q" />
      </CopilotProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'ask' }));
    expect(await screen.findByText(/could not answer/u)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close the copilot' }));
    expect(screen.queryByTestId('copilot-panel')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'ask' }));
    fireEvent.keyDown(screen.getByTestId('copilot-panel'), { key: 'Escape' });
    expect(screen.queryByTestId('copilot-panel')).toBeNull();
  });
});
