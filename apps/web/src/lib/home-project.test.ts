import { afterEach, describe, expect, it } from 'vitest';
import { HOME_PROJECT_KEY, homeProject, rememberHomeProject } from './home-project.js';

afterEach(() => localStorage.removeItem(HOME_PROJECT_KEY));

describe('the project Home opens on', () => {
  it('is the one the link names, over the one remembered', () => {
    rememberHomeProject('p-saved');
    expect(homeProject('p-link')).toBe('p-link');
  });

  it('is the one this browser last chose, when the link names none', () => {
    rememberHomeProject('p-saved');
    expect(homeProject(undefined)).toBe('p-saved');
  });

  it('forgets on "every project", and ignores a stored value that is not an id', () => {
    rememberHomeProject('p-saved');
    rememberHomeProject(undefined);
    expect(homeProject(undefined)).toBeUndefined();
    localStorage.setItem(HOME_PROJECT_KEY, 'x'.repeat(500));
    expect(homeProject(undefined)).toBeUndefined();
  });
});
