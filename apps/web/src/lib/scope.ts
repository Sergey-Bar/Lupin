/**
 * The one project scope: which repository the pages are about, or every project.
 *
 * The address is the authority (`?project=`), so a link names what it was about; when the
 * address names none, the reader's last choice in this browser stands. Before this module
 * there were two remembered choices (Home's and the project screens'), and moving between
 * pages could switch the subject without anyone choosing it.
 *
 * Choosing is done in one place, the sidebar; a screen's own switcher writes here too, and
 * every listener in the page hears the change through {@link SCOPE_EVENT}.
 */

export const SCOPE_KEY = 'lupin-project';
/** Where Home remembered its project before there was one scope; read once, then removed. */
export const LEGACY_HOME_KEY = 'lupin-home-project';
export const SCOPE_EVENT = 'lupin-scope';

const ID = /^[\w-]{1,100}$/u;

/**
 * The pages that read `?project=`. A page whose project is in its path (a pull request, a
 * repository's 360) is about that project whatever the scope says, and so is not listed.
 */
const SCOPED_PAGES: ReadonlySet<string> = new Set([
  'now',
  'metric',
  'briefing',
  'prs',
  'issues',
  'supply-chain',
  'delivery',
  'ai-code',
  'agents',
]);

const valid = (value: string | null | undefined): string | undefined =>
  typeof value === 'string' && ID.test(value) ? value : undefined;

function storage(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

export function readScope(): string | undefined {
  const store = storage();
  if (store === null) return undefined;
  try {
    const current = valid(store.getItem(SCOPE_KEY));
    if (current !== undefined) return current;
    const legacy = valid(store.getItem(LEGACY_HOME_KEY));
    store.removeItem(LEGACY_HOME_KEY);
    if (legacy !== undefined) store.setItem(SCOPE_KEY, legacy);
    return legacy;
  } catch {
    return undefined;
  }
}

/** Remembers the choice (`undefined` is every project) and tells the page, once per change. */
export function writeScope(projectId: string | undefined): void {
  const next = valid(projectId);
  if (next === readScope()) return;
  try {
    if (next === undefined) storage()?.removeItem(SCOPE_KEY);
    else storage()?.setItem(SCOPE_KEY, next);
  } catch {
    // A storage that refuses writes keeps the choice in the address only.
  }
  window.dispatchEvent(new CustomEvent(SCOPE_EVENT, { detail: next ?? null }));
}

/** The scope a page reads: the address's, else the remembered one, else every project. */
export function resolveScope(fromAddress: string | undefined): string | undefined {
  return fromAddress === undefined ? readScope() : valid(fromAddress);
}

export function isScopedPage(pageId: string | undefined): boolean {
  return pageId !== undefined && SCOPED_PAGES.has(pageId);
}

/** The search a link to a page carries, so following it keeps the scope. */
export function scopeSearch(
  pageId: string | undefined,
  projectId: string | undefined,
): { project?: string } {
  return projectId !== undefined && isScopedPage(pageId) ? { project: projectId } : {};
}
