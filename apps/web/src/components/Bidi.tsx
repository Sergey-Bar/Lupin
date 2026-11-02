import React from 'react';

/**
 * Text direction for content the dashboard does not write.
 *
 * The interface is English and left to right. What it shows is not always: a pull request title,
 * an issue, a label or an author's name can be Arabic or Hebrew, and the browser's bidi algorithm
 * will reorder its punctuation and put it on the wrong edge unless told what it is looking at.
 * Two rules cover every case:
 *
 *  - **What a person wrote** ({@link UserText}) takes `dir="auto"`: the browser reads the first
 *    strong character and lays the text out that way, so an Arabic title aligns to the right and
 *    an English one to the left, in the same list.
 *  - **What a machine named** ({@link Bdi}) is an identifier: a repository, branch, path or ref.
 *    It is isolated and forced left to right, because `feature/login-fix` is written that way in
 *    every language and reordering it turns a name into a different name.
 */
export function UserText({
  as: Tag = 'span',
  className,
  children,
}: {
  as?: 'span' | 'p' | 'div';
  className?: string | undefined;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <Tag dir="auto" className={className}>
      {children}
    </Tag>
  );
}

export function Bdi({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string | undefined;
}): React.ReactElement {
  return (
    <bdi dir="ltr" className={className}>
      {children}
    </bdi>
  );
}
