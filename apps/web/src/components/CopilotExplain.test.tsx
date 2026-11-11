import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CopilotExplain, testAnchor } from './CopilotExplain.js';
import type { CopilotClient, RunExplanation } from '../lib/copilot-client.js';

const ANSWER: RunExplanation = {
  runId: 'run-1',
  source: 'rules',
  summary: '2 of 3 tests failed, all for one cause.',
  causes: [{ message: 'expected 200, got 500', count: 2, tests: ['t1', 't2'] }],
  citations: [{ kind: 'run', id: 'run-1' }],
  actions: [],
};

function client(explainRun: CopilotClient['explainRun']): CopilotClient {
  return { explainRun };
}

describe('CopilotExplain', () => {
  it('asks for nothing until the reader asks', () => {
    const explainRun = vi.fn(async () => ANSWER);
    render(<CopilotExplain runId="run-1" client={client(explainRun)} />);
    expect(explainRun).not.toHaveBeenCalled();
    expect(screen.queryByTestId('copilot-answer')).toBeNull();
  });

  it('announces the answer in a live region and links every cited test to its row', async () => {
    render(<CopilotExplain runId="run-1" client={client(async () => ANSWER)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Explain this run' }));
    const answer = await screen.findByTestId('copilot-answer');
    expect(screen.getByRole('status')).toContainElement(answer);
    expect(answer).toHaveTextContent('2 of 3 tests failed');
    const links = screen.getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      `#${testAnchor('t1')}`,
      `#${testAnchor('t2')}`,
    ]);
  });

  it('says it could not answer, and claims nothing, when the request fails', async () => {
    render(
      <CopilotExplain
        runId="run-1"
        client={client(async () => {
          throw new Error('404');
        })}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Explain this run' }));
    expect(await screen.findByText(/could not explain/u)).toBeInTheDocument();
    expect(screen.queryByTestId('copilot-answer')).toBeNull();
  });

  it('acts only after one confirmation, and says what it did', async () => {
    const act = vi.fn(async () => 'Retry started');
    const withAction: RunExplanation = {
      ...ANSWER,
      actions: [
        { kind: 'retry', runId: 'run-1', scope: 'failed', label: 'Retry the 2 failed tests' },
      ],
    };
    render(<CopilotExplain runId="run-1" client={client(async () => withAction)} act={act} />);
    fireEvent.click(screen.getByRole('button', { name: 'Explain this run' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Retry the 2 failed tests' }));
    expect(act).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(act).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry the 2 failed tests' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText('Retry started')).toBeInTheDocument();
    expect(act).toHaveBeenCalledTimes(1);
    expect(act).toHaveBeenCalledWith(withAction.actions[0]);
  });

  it('says when a configured model wrote the answer, and names the model', async () => {
    const withModel: RunExplanation = {
      ...ANSWER,
      narration: { source: 'model', model: 'gpt-x', text: 'On main, 2 of 3 tests failed.' },
    };
    render(<CopilotExplain runId="run-1" client={client(async () => withModel)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Explain this run' }));
    const answer = await screen.findByTestId('copilot-answer');
    expect(answer).toHaveTextContent('On main, 2 of 3 tests failed.');
    expect(answer).toHaveTextContent('Written by gpt-x from this run');
  });

  it('explains on e, but not while the reader is typing in a field', async () => {
    const explainRun = vi.fn(async () => ANSWER);
    render(
      <>
        <input aria-label="search" />
        <CopilotExplain runId="run-1" client={client(explainRun)} />
      </>,
    );
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'search' }), { key: 'e' });
    expect(explainRun).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'e', ctrlKey: true });
    expect(explainRun).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'e' });
    expect(await screen.findByTestId('copilot-answer')).toBeInTheDocument();
    expect(explainRun).toHaveBeenCalledWith('run-1');
  });
});
