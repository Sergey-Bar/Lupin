import { beforeEach, describe, expect, it } from 'vitest';
import type { Onboarding } from '@lupin/shared-contracts';
import { putOffSetup, setupPutOff, shouldOpenSetup } from './first-run.js';

function onboarding(repository: 'todo' | 'done' | 'skipped', dismissed = false): Onboarding {
  return {
    steps: [
      { id: 'workspace', title: 'W', who: 'admin', href: '/', state: 'done' },
      { id: 'repository', title: 'R', who: 'operator', href: '/', state: repository },
    ],
    done: repository === 'done' ? 2 : 1,
    total: 6,
    dismissed,
  };
}

describe('shouldOpenSetup', () => {
  beforeEach(() => localStorage.clear());

  it('remembers "Do this later" per browser', () => {
    expect(setupPutOff()).toBe(false);
    putOffSetup();
    expect(setupPutOff()).toBe(true);
  });

  it('opens setup on a fresh install: no repository yet and nothing put off', () => {
    expect(shouldOpenSetup(onboarding('todo'), false)).toBe(true);
  });

  it('stays home once a repository is connected or its step was skipped', () => {
    expect(shouldOpenSetup(onboarding('done'), false)).toBe(false);
    expect(shouldOpenSetup(onboarding('skipped'), false)).toBe(false);
  });

  it('respects "Do this later" and a dismissed checklist', () => {
    expect(shouldOpenSetup(onboarding('todo'), true)).toBe(false);
    expect(shouldOpenSetup(onboarding('todo', true), false)).toBe(false);
  });
});
