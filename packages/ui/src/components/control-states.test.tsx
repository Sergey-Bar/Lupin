import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Button } from './Button/Button.js';
import { Input } from './Input/Input.js';
import { Select } from './Select/Select.js';
import { Textarea } from './Textarea/Textarea.js';

/**
 * Every control state, for every control, as one matrix.
 *
 * A primitive is finished when each of its states is drawn on purpose: resting, hover,
 * focus-visible, disabled, invalid and — for a button — busy. These cases are written across
 * the controls rather than per component, because the defect they caught was a disagreement:
 * the three text fields drew their only edge in the *decorative* border, which `theme.test.ts`
 * holds below 3:1 on purpose, while `theme.css` said in as many words that a field's edge is
 * the strong border. A field nobody can see the edge of fails WCAG 1.4.11.
 */
const OPTIONS = [{ value: 'main', label: 'main' }];

const fields = [
  ['Input', (error?: string) => render(<Input aria-label="Name" error={error} />), 'textbox'],
  [
    'Select',
    (error?: string) => render(<Select aria-label="Branch" options={OPTIONS} error={error} />),
    'combobox',
  ],
  [
    'Textarea',
    (error?: string) => render(<Textarea aria-label="Notes" error={error} />),
    'textbox',
  ],
] as const;

describe('the field states', () => {
  it.each(fields)(
    'draws a resting %s edge in the strong border, which clears 3:1',
    (_n, mount, role) => {
      mount();
      const field = screen.getByRole(role);
      expect(field).toHaveClass('border-border-strong');
      expect(field).not.toHaveClass('border-border-default');
      expect(field).not.toHaveClass('border-border');
    },
  );

  it.each(fields)('answers the pointer on a resting %s', (_n, mount, role) => {
    mount();
    expect(screen.getByRole(role).className).toMatch(/\bhover:border-fg-muted\b/);
  });

  it.each(fields)(
    'draws the focus ring on a %s in every state, including invalid',
    (_n, mount, role) => {
      for (const error of [undefined, 'Required']) {
        const { unmount } = mount(error);
        expect(screen.getByRole(role).className).toMatch(/\bfocus-visible:outline-border-focus\b/);
        unmount();
      }
    },
  );

  it.each(fields)(
    'marks an invalid %s for assistive technology and in its edge',
    (_n, mount, role) => {
      mount('Required');
      const field = screen.getByRole(role);
      expect(field).toHaveAttribute('aria-invalid', 'true');
      expect(field.className).toMatch(/\bborder-(error|danger)\b/);
      expect(field).not.toHaveClass('hover:border-fg-muted');
    },
  );

  it.each(fields)('dims a disabled %s and refuses the pointer', (_n, mount, role) => {
    mount();
    expect(screen.getByRole(role).className).toMatch(/\bdisabled:opacity-50\b/);
    expect(screen.getByRole(role).className).toMatch(/\bdisabled:cursor-not-allowed\b/);
  });
});

describe('the button states', () => {
  it('announces a loading button as busy and keeps its label', () => {
    render(<Button loading>Save</Button>);
    const button = screen.getByRole('button', { name: /save/i });
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toBeDisabled();
  });

  it('is not busy at rest', () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole('button')).not.toHaveAttribute('aria-busy');
  });

  it.each(['primary', 'secondary', 'outline', 'ghost', 'destructive', 'link'] as const)(
    'draws the focus ring and the press on a %s button',
    (variant) => {
      render(<Button variant={variant}>Go</Button>);
      const button = screen.getByRole('button');
      expect(button.className).toMatch(/\bfocus-visible:outline-border-focus\b/);
      expect(button.className).toMatch(/\bactive:scale-press\b/);
    },
  );
});
