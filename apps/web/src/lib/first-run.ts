import type { Onboarding } from '@lupin/shared-contracts';

/**
 * Whether Home should hand a reader to full-screen setup instead: only on a fresh install,
 * where there is no repository and so nothing for Home to judge. Once the repository step is
 * done or skipped, setup was dismissed, or the reader chose "Do this later", Home stays Home.
 */
export function shouldOpenSetup(onboarding: Onboarding, later: boolean): boolean {
  if (later || onboarding.dismissed) return false;
  return onboarding.steps.find((step) => step.id === 'repository')?.state === 'todo';
}

/** "Do this later", kept per browser so Home stops sending the reader back to setup. */
export const SETUP_LATER_KEY = 'lupin-setup-later';

export function setupPutOff(): boolean {
  try {
    return localStorage.getItem(SETUP_LATER_KEY) === '1';
  } catch {
    return false;
  }
}

export function putOffSetup(): void {
  try {
    localStorage.setItem(SETUP_LATER_KEY, '1');
  } catch {
    // Private mode: the choice lasts this visit only.
  }
}
