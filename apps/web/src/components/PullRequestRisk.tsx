import React from 'react';
import { Alert, AlertDescription, AlertTitle, Badge, EmptyState, Hero } from '@lupin/ui';
import type { PullRequestRisk, PullRequestRiskHistory } from '@lupin/shared-contracts';
import { useResource } from '../hooks/useResource.js';
import { EVIDENCE_LABEL, RISK_BADGE, RISK_WORD, riskHero } from '../lib/change-risk.js';
import type { GithubClient } from '../lib/github-client.js';
import { formatRelative } from '../lib/intl.js';
import { Bdi, UserText } from './Bidi.js';
import { PageBody, PageFrame, PageHeader, Panel } from './kit.js';

/**
 * One pull request's change risk: the status band, every factor with its points and its own
 * sentence, what was not measured, how far the change reaches, and the history across heads.
 *
 * Nothing here is computed: the page shows what the gate assessed and stored, so the comment on
 * the pull request, the check run and this page say the same thing. A pull request the gate never
 * assessed says so and names the step that would, rather than showing an empty band.
 */
export function PullRequestRiskPage({
  projectId,
  number,
  github,
  now = () => new Date(),
}: {
  projectId: string;
  number: number;
  github: Pick<GithubClient, 'getPullRequestRisk'>;
  now?: () => Date;
}): React.ReactElement {
  const read = useResource(
    () => github.getPullRequestRisk(projectId, number),
    [github, projectId, number],
  );
  const title = `Pull request #${String(number)}`;
  return (
    <PageFrame>
      <PageHeader title={`${title} change risk`} />
      <PageBody label={`${title} change risk`}>
        {read.status === 'loading' ? (
          <p data-testid="pr-risk-loading" className="max-w-measure text-sm text-fg-muted">
            Reading the change risk of {title}…
          </p>
        ) : read.status === 'error' ? (
          <Alert variant="danger">
            <AlertTitle>The change risk could not be read</AlertTitle>
            <AlertDescription>{read.message}</AlertDescription>
          </Alert>
        ) : (
          <RiskBody history={read.value} now={now()} />
        )}
      </PageBody>
    </PageFrame>
  );
}

function RiskBody({ history, now }: { history: PullRequestRiskHistory; now: Date }) {
  const latest = history.latest;
  if (latest === null) {
    return (
      <EmptyState
        headingLevel={2}
        title="Not assessed yet"
        description={`The gate has not assessed #${String(history.pullRequest)}. Run lupin gate --pr ${String(history.pullRequest)} in this pull request's CI job, and its risk appears here, on the pull request and in its check run.`}
      />
    );
  }
  const hero = riskHero(latest);
  const risks = latest.risk.factors.filter((factor) => factor.kind === 'risk');
  return (
    <div className="flex flex-col gap-4">
      <Hero
        headingLevel={2}
        verdict={hero.verdict}
        word={hero.word}
        reason={<UserText>{hero.reason}</UserText>}
        eyebrow={`Pull request #${String(history.pullRequest)}`}
        facts={[
          { label: 'Score', value: String(latest.risk.score), unit: 'points' },
          { label: 'Factors', value: String(risks.length) },
          { label: 'Assessed', value: formatRelative(latest.assessedAt, now) },
        ]}
      />
      <p className="max-w-measure text-xs text-fg-muted">
        At head <Bdi className="font-mono">{latest.headSha.slice(0, 12)}</Bdi>, scored with{' '}
        <Bdi className="font-mono">{latest.risk.version}</Bdi>. Each point is a stated factor, so
        the score is their sum.
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        <FactorsPanel assessed={latest} />
        <ReachPanel assessed={latest} />
      </div>
      <HistoryPanel history={history.history} now={now} />
    </div>
  );
}

function FactorsPanel({ assessed }: { assessed: PullRequestRisk }) {
  const risks = assessed.risk.factors.filter((factor) => factor.kind === 'risk');
  const missing = assessed.risk.factors.filter((factor) => factor.kind === 'missing');
  return (
    <Panel title="Why">
      {risks.length === 0 ? (
        <p className="max-w-measure text-sm text-fg-muted">No factor adds to this change’s risk.</p>
      ) : (
        <ol data-page="" aria-label="Risk factors" className="flex flex-col gap-2">
          {risks.map((factor) => (
            <li key={factor.id} className="flex items-baseline gap-3 text-sm">
              <span className="w-10 shrink-0 text-end font-display tabular-nums text-fg">
                {String(factor.points)}
              </span>
              <UserText className="min-w-0 text-fg">{factor.detail}</UserText>
            </li>
          ))}
        </ol>
      )}
      {missing.length === 0 ? null : (
        <div className="mt-4">
          <h3 className="mb-1 text-xs font-medium text-fg-muted">Not measured</h3>
          <ul className="flex flex-col gap-1 text-sm">
            {missing.map((factor) => (
              <li key={factor.id}>
                <span className="font-medium text-fg">
                  {EVIDENCE_LABEL[factor.id] ?? factor.id}
                </span>
                {(assessed.risk.missing as readonly string[]).includes(factor.id)
                  ? ' (required)'
                  : ''}
                : <UserText className="text-fg-muted">{factor.detail}</UserText>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

function ReachPanel({ assessed }: { assessed: PullRequestRisk }) {
  const radius = assessed.blastRadius;
  if (radius === null) {
    return (
      <Panel title="Reach">
        <p className="max-w-measure text-sm text-fg-muted">
          The delivery sync has not read this pull request’s files, so its reach is not known.
        </p>
      </Panel>
    );
  }
  return (
    <Panel title="Reach">
      {radius.truncated ? (
        <p className="mb-2 max-w-measure text-xs text-warning">
          The change has more files than were read, so every count here is a lower bound.
        </p>
      ) : null}
      <dl className="flex flex-col gap-3 text-sm">
        <div>
          <dt className="text-xs font-medium text-fg-muted">Sensitive areas</dt>
          <dd>
            {radius.sensitiveAreas.length === 0
              ? 'None touched.'
              : radius.sensitiveAreas.map((touch) => (
                  <span key={touch.area} className="me-3 inline-flex items-baseline gap-1">
                    <span className="font-medium text-fg">{touch.area}</span>
                    <span className="text-fg-muted">
                      {String(touch.count)} {touch.count === 1 ? 'file' : 'files'}
                    </span>
                  </span>
                ))}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-fg-muted">Owning teams</dt>
          <dd>
            {radius.unownedPaths === null
              ? 'No CODEOWNERS file, so owners are not known.'
              : radius.teams.length === 0
                ? 'No team owns these files.'
                : radius.teams.map((team) => (
                    <Bdi key={team} className="me-2 font-mono">
                      {team}
                    </Bdi>
                  ))}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-fg-muted">Tests that failed with these files</dt>
          <dd>
            {radius.linkedTests.length === 0 ? (
              'None recorded.'
            ) : (
              <ul className="flex flex-col gap-1">
                {radius.linkedTests.map((test) => (
                  <li key={test.testStableId} className="flex items-baseline gap-2">
                    <Bdi className="min-w-0 truncate font-mono">{test.testStableId}</Bdi>
                    <span className="shrink-0 text-fg-muted">
                      {String(test.failures)} {test.failures === 1 ? 'failure' : 'failures'}
                    </span>
                  </li>
                ))}
                {radius.linkedTestsTotal > radius.linkedTests.length ? (
                  <li className="text-fg-muted">
                    …and {String(radius.linkedTestsTotal - radius.linkedTests.length)} more
                  </li>
                ) : null}
              </ul>
            )}
          </dd>
        </div>
      </dl>
    </Panel>
  );
}

function HistoryPanel({ history, now }: { history: readonly PullRequestRisk[]; now: Date }) {
  return (
    <Panel title="Across its heads">
      <ol data-page="" aria-label="Assessments, newest first" className="flex flex-col gap-1">
        {history.map((entry) => (
          <li key={entry.headSha} className="flex items-center gap-3 text-sm">
            <Bdi className="w-28 shrink-0 font-mono text-fg-muted">
              {entry.headSha.slice(0, 12)}
            </Bdi>
            <Badge variant={RISK_BADGE[entry.risk.level]} className="shrink-0">
              {RISK_WORD[entry.risk.level]}
            </Badge>
            <span className="tabular-nums text-fg">{String(entry.risk.score)} points</span>
            <span className="ms-auto text-xs text-fg-muted">
              {formatRelative(entry.assessedAt, now)}
            </span>
          </li>
        ))}
      </ol>
    </Panel>
  );
}
