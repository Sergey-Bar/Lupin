import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Bdi, UserText } from './Bidi.js';

describe('UserText', () => {
  it('lets the browser pick the direction of what a person wrote', () => {
    render(
      <>
        <UserText>إصلاح خطأ تسجيل الدخول</UserText>
        <UserText>Fix the login bug</UserText>
        <UserText>תיקון באג בהתחברות</UserText>
      </>,
    );
    for (const text of ['إصلاح خطأ تسجيل الدخول', 'Fix the login bug', 'תיקון באג בהתחברות']) {
      expect(screen.getByText(text)).toHaveAttribute('dir', 'auto');
    }
  });

  it('is a span by default and a block when asked, and keeps the caller’s classes', () => {
    render(
      <>
        <UserText>inline</UserText>
        <UserText as="p" className="truncate">
          block
        </UserText>
      </>,
    );
    expect(screen.getByText('inline').tagName).toBe('SPAN');
    expect(screen.getByText('block').tagName).toBe('P');
    expect(screen.getByText('block')).toHaveClass('truncate');
  });
});

describe('Bdi', () => {
  it('keeps an identifier left to right and isolated inside a right-to-left sentence', () => {
    render(<Bdi>feature/login-fix</Bdi>);
    const node = screen.getByText('feature/login-fix');
    expect(node.tagName).toBe('BDI');
    expect(node).toHaveAttribute('dir', 'ltr');
  });
});
