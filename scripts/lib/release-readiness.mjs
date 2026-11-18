/**
 * `pnpm release:readiness` — what still blocks the release named in
 * `docs/quality/release-journeys.json`?
 *
 * The release definition is data, not a sentence: every journey a QA engineer must be
 * able to complete names the spec files that prove it, and every connector names its
 * spec and its verification level. This module reads that file beside the findings
 * ledger and the capability register, and returns one problem per gap. It invents no
 * policy of its own about the ledger: a blocking band is the ledger's `Blocker` and
 * `Critical`, the same two bands `findings:check` refuses as debt.
 *
 * Dependency-free and pure apart from `existsSync`, which is injected so the tests can
 * prove each failure mode without touching the tree.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';

export const BLOCKING_BANDS = Object.freeze(['Blocker', 'Critical']);
export const VERIFICATION_LEVELS = Object.freeze(['none', 'fake-verified', 'live-verified']);
export const REQUIRED_LEVEL = 'fake-verified';

/**
 * @typedef {{ id: string, title?: string, specs?: unknown, capabilities?: unknown }} Journey
 * @typedef {{ id: string, specs?: unknown, verification?: unknown }} Connector
 * @typedef {{ release?: unknown, journeys?: unknown, connectors?: unknown }} JourneysDoc
 * @typedef {{ id: string, status: string, band: string }} LedgerRow
 */

/**
 * Parse the capability register's markdown table into `id -> status`.
 * A row is `| id | description | status | ... |`.
 * @param {string} markdown
 * @returns {Map<string, string>}
 */
export function parseCapabilityStatuses(markdown) {
  /** @type {Map<string, string>} */
  const statuses = new Map();
  for (const line of markdown.split(/\r?\n/)) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').map((cell) => cell.trim());
    const id = cells[1] ?? '';
    const status = cells[3] ?? '';
    if (isCapabilityId(id) && /^[a-z-]+$/.test(status)) {
      statuses.set(id, status);
    }
  }
  return statuses;
}

/**
 * `area.name`, lower case, at least two dot-separated segments. Checked per segment rather than
 * with one `(\.[a-z0-9-]+)+` pattern, which nests quantifiers and can backtrack.
 * @param {string} id
 */
function isCapabilityId(id) {
  const segments = id.split('.');
  return (
    segments.length >= 2 &&
    /^[a-z]/.test(id) &&
    segments.every((segment) => /^[a-z0-9-]+$/.test(segment))
  );
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function stringList(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}

/**
 * @param {(file: string) => boolean} exists
 * @param {string} root
 * @param {string} owner
 * @param {unknown} specs
 * @returns {string[]}
 */
function specProblems(exists, root, owner, specs) {
  const list = stringList(specs);
  if (list.length === 0) return [`${owner}: no spec proves it`];
  return list
    .filter((spec) => !exists(path.join(root, spec)))
    .map((spec) => `${owner}: spec ${spec} does not exist`);
}

/** @param {Map<string, string>} capabilities @param {string} owner @param {unknown} names */
function capabilityProblems(capabilities, owner, names) {
  return stringList(names).flatMap((capability) => {
    const status = capabilities.get(capability);
    if (status === undefined) return [`${owner}: capability ${capability} is not in the register`];
    return status === 'real' ? [] : [`${owner}: capability ${capability} is ${status}, not real`];
  });
}

/** @param {string} owner @param {unknown} verification */
function levelProblems(owner, verification) {
  const level = typeof verification === 'string' ? verification : 'none';
  const rank = VERIFICATION_LEVELS.indexOf(level);
  if (rank === -1) return [`${owner}: unknown verification level "${level}"`];
  return rank < VERIFICATION_LEVELS.indexOf(REQUIRED_LEVEL)
    ? [`${owner}: verification is ${level}, needs ${REQUIRED_LEVEL}`]
    : [];
}

/** @param {LedgerRow[]} rows */
function ledgerProblems(rows) {
  if (rows.length === 0) return ['findings ledger is empty'];
  return rows
    .filter(
      (row) =>
        BLOCKING_BANDS.includes(row.band) && (row.status === 'open' || row.status === 'debt'),
    )
    .map((row) => `ledger ${row.id}: ${row.band} is ${row.status}`);
}

/**
 * @param {{
 *   journeys: JourneysDoc,
 *   ledgerRows: LedgerRow[],
 *   capabilities: Map<string, string>,
 *   root: string,
 *   exists?: (file: string) => boolean,
 * }} input
 * @returns {string[]}
 */
export function auditReadiness(input) {
  const exists = input.exists ?? existsSync;
  const journeys = Array.isArray(input.journeys.journeys)
    ? /** @type {Journey[]} */ (input.journeys.journeys)
    : [];
  const connectors = Array.isArray(input.journeys.connectors)
    ? /** @type {Connector[]} */ (input.journeys.connectors)
    : [];
  return [
    // A definition that names nothing would be a green gate that measured nothing.
    ...(journeys.length === 0 ? ['release-journeys.json lists no journeys'] : []),
    ...(connectors.length === 0 ? ['release-journeys.json lists no connectors'] : []),
    ...journeys.flatMap((journey) => [
      ...specProblems(exists, input.root, `journey ${journey.id}`, journey.specs),
      ...capabilityProblems(input.capabilities, `journey ${journey.id}`, journey.capabilities),
    ]),
    ...connectors.flatMap((connector) => [
      ...specProblems(exists, input.root, `connector ${connector.id}`, connector.specs),
      ...levelProblems(`connector ${connector.id}`, connector.verification),
    ]),
    ...ledgerProblems(input.ledgerRows),
  ];
}
