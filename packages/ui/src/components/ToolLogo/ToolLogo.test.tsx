import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ToolLogo, toolIconFor } from './ToolLogo.js';

describe('ToolLogo', () => {
  it('draws a catalog tool with its own mark', () => {
    const { container } = render(<ToolLogo name="Vitest" />);
    expect(container.firstElementChild).toHaveAttribute('data-tool-logo', 'vitest');
    expect(container.querySelector('svg path')?.getAttribute('d')?.length).toBeGreaterThan(20);
  });

  it('finds the tool a script runs from its command', () => {
    expect(toolIconFor('lint', 'eslint . --max-warnings=0')?.slug).toBe('eslint');
    expect(toolIconFor('test:unit', 'vitest run')?.slug).toBe('vitest');
    expect(toolIconFor('typecheck', 'tsc --noEmit')?.slug).toBe('typescript');
  });

  it('falls back to a monogram, never a blank, for a tool with no mark', () => {
    const { container } = render(<ToolLogo name="mabl" />);
    expect(container.firstElementChild).toHaveAttribute('data-tool-logo', 'monogram');
    expect(container).toHaveTextContent('M');
  });

  it('is drawn in the text colour, so a screen of logos stays one calm set', () => {
    const { container } = render(<ToolLogo name="Snyk" />);
    expect(container.querySelector('svg')).toHaveAttribute('fill', 'currentColor');
  });
});
