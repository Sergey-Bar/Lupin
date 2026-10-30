import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Button } from './Button/Button.js';
import { Input } from './Input/Input.js';
import { Select } from './Select/Select.js';
import { Textarea } from './Textarea/Textarea.js';

/**
 * Every default-size control has one shape: 44px tall and the 6px control radius.
 *
 * 44px is the touch target WCAG 2.5.5 and Apple's HIG name, and it is the height the
 * Lupin site's buttons already have, so a console button and a site button are the same
 * object. 6px (`rounded-md`) is the control radius; 8px (`rounded-lg`) belongs to panels,
 * and a field drawn at the panel radius reads as a card with a cursor in it.
 *
 * One test across the controls rather than one per component, because the claim is that
 * they agree — a Button at 44px beside a Select at 40px is the defect, whichever is right.
 */
describe('the default control shape', () => {
  const controls = [
    ['Button', () => render(<Button>Save</Button>), () => screen.getByRole('button')],
    ['Input', () => render(<Input aria-label="Name" />), () => screen.getByRole('textbox')],
    [
      'Select',
      () => render(<Select aria-label="Branch" options={[{ value: 'main', label: 'main' }]} />),
      () => screen.getByRole('combobox'),
    ],
  ] as const;

  it.each(controls)('draws %s 44px tall', (_name, mount, find) => {
    mount();
    expect(find()).toHaveClass('h-11');
  });

  it.each(controls)(
    'draws %s at the control radius, not the panel radius',
    (_name, mount, find) => {
      mount();
      expect(find()).toHaveClass('rounded-md');
      expect(find()).not.toHaveClass('rounded-lg');
    },
  );

  it('draws a Textarea at the control radius', () => {
    render(<Textarea aria-label="Notes" />);
    expect(screen.getByRole('textbox')).toHaveClass('rounded-md');
  });
});
