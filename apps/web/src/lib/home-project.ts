/**
 * The project Home opens on: the one the link names, else the one this browser last chose.
 * Per browser, like the Triage/Release choice, because each device is one person's desk. A
 * stored value is read only if it could be an id, since anything can write local storage.
 */
export const HOME_PROJECT_KEY = 'lupin-home-project';
const ID = /^[\w-]{1,100}$/u;

export function homeProject(fromLink: string | undefined): string | undefined {
  if (fromLink !== undefined) return fromLink;
  try {
    const saved = localStorage.getItem(HOME_PROJECT_KEY);
    return saved !== null && ID.test(saved) ? saved : undefined;
  } catch {
    return undefined;
  }
}

export function rememberHomeProject(projectId: string | undefined): void {
  try {
    if (projectId === undefined) localStorage.removeItem(HOME_PROJECT_KEY);
    else localStorage.setItem(HOME_PROJECT_KEY, projectId);
  } catch {
    // Storage refused (private mode, quota): Home still works, it just forgets.
  }
}
