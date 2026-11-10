import React, { createRef } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Button, ButtonLink } from './Button.js';

describe('Button Component', () => {
  it('renders with children', () => {
    render(<Button>Click Me</Button>);
    expect(screen.getByText('Click Me')).toBeInTheDocument();
  });

  it('applies variant class', () => {
    render(<Button variant="destructive">Delete</Button>);
    const button = screen.getByRole('button', { name: 'Delete' });
    expect(button).toHaveClass('bg-error');
  });

  it('disabled prevents click', () => {
    const handleClick = vi.fn();
    render(
      <Button disabled onClick={handleClick}>
        Disabled
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Disabled' });

    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-disabled', 'true');

    fireEvent.click(button);
    expect(handleClick).not.toHaveBeenCalled();
  });

  it('accessible with aria attributes', () => {
    render(<Button aria-label="Custom Label">Icon</Button>);
    const button = screen.getByRole('button', { name: 'Custom Label' });
    expect(button).toBeInTheDocument();
  });

  it('forwards ref', () => {
    const ref = createRef<HTMLButtonElement>();
    render(<Button ref={ref}>Ref Button</Button>);
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
  });
});

describe('ButtonLink', () => {
  it('is a link that looks exactly like the button of the same variant', () => {
    render(
      <>
        <Button variant="secondary">As a button</Button>
        <ButtonLink href="/dashboard/setup" variant="secondary">
          As a link
        </ButtonLink>
      </>,
    );
    const link = screen.getByRole('link', { name: 'As a link' });
    expect(link).toHaveAttribute('href', '/dashboard/setup');
    expect(link.className).toBe(screen.getByRole('button', { name: 'As a button' }).className);
  });

  it('is the primary fill by default', () => {
    render(<ButtonLink href="/x">Go</ButtonLink>);
    expect(screen.getByRole('link', { name: 'Go' })).toHaveClass(
      'bg-primary-gradient',
      'text-on-fill',
    );
  });
});
