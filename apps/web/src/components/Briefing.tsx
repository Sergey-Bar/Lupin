import React from 'react';
import { Button, ButtonLink, cn } from '@lupin/ui';
import {
  BRIEFING_SECTIONS,
  BRIEFING_SECTION_TITLES,
  type Briefing,
  type BriefingItem,
  type BriefingResponse,
} from '@lupin/shared-contracts';
import { useResource, type Resource } from '../hooks/useResource.js';
import type { HealthClient } from '../lib/health-client.js';
import { plainError } from '../lib/plain-error.js';
import { UserText } from './Bidi.js';
import { PageBody, PageFrame, PageHeader, Panel, Segmented } from './kit.js';
import { SHAPE_TONE, SHAPE_WORD } from './Phases.js';

/**
 * The briefing on screen: what happened over the window, every line cited.
 *
 * Home carries the card (the headline and the worst lines); `/dashboard/briefing` the whole
 * thing, section by section, with each line's evidence one fold away. A narration is only ever
 * asked for by the reader, and drawn beside the lines it rewords, never in place of them.
 */

const TONE_CLASS: Readonly<Record<BriefingItem['tone'], string>> = {
  good: SHAPE_TONE.good,
  caution: SHAPE_TONE.caution,
  bad: SHAPE_TONE.bad,
  neutral: SHAPE_TONE.unknown,
};

const TONE_WORD: Readonly<Record<BriefingItem['tone'], string>> = {
  good: 'Good',
  caution: 'Caution',
  bad: 'Bad',
  neutral: 'Note',
};

const TONE_RANK: Readonly<Record<BriefingItem['tone'], number>> = {
  bad: 0,
  caution: 1,
  good: 2,
  neutral: 3,
};

export function briefingPath(projectId: string | undefined): string {
  return projectId === undefined
    ? '/dashboard/briefing'
    : `/dashboard/briefing?project=${encodeURIComponent(projectId)}`;
}

/** The worst lines first, ties kept in the briefing's own order. */
export function worstItems(briefing: Briefing, limit: number): BriefingItem[] {
  return briefing.items
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => TONE_RANK[a.entry.tone] - TONE_RANK[b.entry.tone] || a.index - b.index)
    .slice(0, limit)
    .map(({ entry }) => entry);
}

function ItemLine({
  item,
  showEvidence,
}: {
  item: BriefingItem;
  showEvidence: boolean;
}): React.ReactElement {
  return (
    <li className="flex flex-col gap-1 text-sm" data-testid={`briefing-item-${item.id}`}>
      <div className="flex items-start gap-2">
        <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-xs', TONE_CLASS[item.tone])}>
          {TONE_WORD[item.tone]}
        </span>
        {item.link === null ? (
          <UserText className="min-w-0 text-fg">{item.text}</UserText>
        ) : (
          <a
            href={item.link}
            className="min-w-0 text-fg underline decoration-border-strong underline-offset-4 hover:decoration-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
          >
            <UserText>{item.text}</UserText>
          </a>
        )}
      </div>
      {showEvidence ? (
        <details className="ms-14 text-xs text-fg-muted">
          <summary className="cursor-pointer">Read from</summary>
          <ul className="mt-1 flex flex-col gap-0.5 font-mono">
            {item.evidence.map((source) => (
              <li key={source}>{source}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </li>
  );
}

function ShapeChip({ briefing }: { briefing: Briefing }): React.ReactElement {
  return (
    <span
      data-testid="briefing-shape"
      className={cn('rounded-full px-2 py-0.5 text-xs font-medium', SHAPE_TONE[briefing.shape])}
    >
      {SHAPE_WORD[briefing.shape]}
    </span>
  );
}

/** Home's card: the shape, the headline, and the three worst lines. */
export function BriefingCard({
  read,
  projectId,
}: {
  read: Resource<BriefingResponse>;
  projectId: string | undefined;
}): React.ReactElement {
  return (
    <Panel
      title="While you were away"
      data-testid="briefing-card"
      action={
        <ButtonLink variant="outline" size="sm" href={briefingPath(projectId)}>
          Open the briefing
        </ButtonLink>
      }
    >
      {read.status === 'loading' ? (
        <p className="max-w-measure text-sm text-fg-muted">Reading the briefing…</p>
      ) : read.status === 'error' ? (
        <p role="alert" className="max-w-measure text-sm text-danger">
          The briefing could not be read: {read.message}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="flex max-w-measure items-start gap-2 text-sm text-fg">
            <ShapeChip briefing={read.value.briefing} />
            <UserText>{read.value.briefing.headline}</UserText>
          </p>
          <ul aria-label="The worst of it" className="flex flex-col gap-2">
            {worstItems(read.value.briefing, 3).map((item) => (
              <ItemLine key={item.id} item={item} showEvidence={false} />
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

/** Every section that has a line, in the briefing's order. */
export function BriefingSections({ briefing }: { briefing: Briefing }): React.ReactElement {
  return (
    <div className="flex flex-col gap-4">
      {BRIEFING_SECTIONS.map((section) => {
        const items = briefing.items.filter((item) => item.section === section);
        if (items.length === 0) return null;
        return (
          <Panel key={section} title={BRIEFING_SECTION_TITLES[section]}>
            <ul
              data-page=""
              aria-label={BRIEFING_SECTION_TITLES[section]}
              className="flex flex-col gap-2"
            >
              {items.map((item) => (
                <ItemLine key={item.id} item={item} showEvidence />
              ))}
            </ul>
          </Panel>
        );
      })}
    </div>
  );
}

type NarrationRead = NonNullable<BriefingResponse['narration']>;

function NarrationBody({
  narration,
  briefing,
}: {
  narration: NarrationRead;
  briefing: Briefing;
}): React.ReactElement {
  if (narration.status === 'unavailable') {
    return <p className="max-w-measure text-sm text-fg-muted">{narration.reason}</p>;
  }
  if (narration.status === 'rejected') {
    return (
      <p className="max-w-measure text-sm text-warning">
        The model’s wording was thrown away: {narration.reason} The lines below stand as written.
      </p>
    );
  }
  const titles = new Map(
    briefing.items.map((item) => [item.id, BRIEFING_SECTION_TITLES[item.section]]),
  );
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-2">
        {narration.narration.sentences.map((sentence, index) => (
          <li key={index} className="max-w-measure text-sm text-fg">
            <UserText>{sentence.text}</UserText>{' '}
            <span className="text-xs text-fg-muted">
              ({[...new Set(sentence.cites.map((id) => titles.get(id) ?? id))].join(', ')})
            </span>
          </li>
        ))}
      </ul>
      <p className="max-w-measure text-xs text-fg-muted">
        Worded by {narration.model} from the lines below, and checked against them.
      </p>
    </div>
  );
}

const WINDOWS = [
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
] as const;
type WindowValue = (typeof WINDOWS)[number]['value'];

/** `/dashboard/briefing`: the whole briefing, for one repository or the portfolio. */
export function BriefingPage({
  health,
  projectId,
}: {
  health: HealthClient;
  projectId: string | undefined;
}): React.ReactElement {
  const [days, setDays] = React.useState<WindowValue>('7');
  const read = useResource(
    () => health.getBriefing(projectId ?? null, { days: Number(days) }),
    [health, projectId, days],
  );
  const [narration, setNarration] = React.useState<
    { status: 'idle' } | { status: 'asking' } | { status: 'done'; value: NarrationRead }
  >({ status: 'idle' });
  React.useEffect(() => setNarration({ status: 'idle' }), [projectId, days]);
  const ask = async () => {
    setNarration({ status: 'asking' });
    try {
      const answer = await health.getBriefing(projectId ?? null, {
        days: Number(days),
        narrate: true,
      });
      setNarration({
        status: 'done',
        value: answer.narration ?? { status: 'unavailable', reason: 'No wording came back.' },
      });
    } catch (error) {
      setNarration({
        status: 'done',
        value: {
          status: 'unavailable',
          reason: plainError(error instanceof Error ? error.message : String(error)),
        },
      });
    }
  };
  return (
    <PageFrame data-testid="briefing-page" className="gap-4">
      <PageHeader
        title="Briefing"
        subtitle={
          read.status === 'ready'
            ? read.value.briefing.scope.kind === 'repository'
              ? read.value.briefing.scope.name
              : `Every repository (${String(read.value.briefing.scope.projects)})`
            : undefined
        }
        actions={
          <Segmented<WindowValue>
            label="Window"
            options={WINDOWS}
            value={days}
            onChange={setDays}
          />
        }
      />
      <PageBody label="Briefing">
        {read.status === 'loading' ? (
          <p className="max-w-measure text-sm text-fg-muted">Reading the briefing…</p>
        ) : read.status === 'error' ? (
          <p role="alert" className="max-w-measure text-sm text-danger">
            The briefing could not be read: {read.message}
          </p>
        ) : (
          <>
            <Panel
              title="In short"
              data-testid="briefing-headline"
              action={
                <Button
                  variant="outline"
                  size="sm"
                  loading={narration.status === 'asking'}
                  onClick={() => void ask()}
                >
                  Word it for me
                </Button>
              }
            >
              <div className="flex flex-col gap-3">
                <p className="flex max-w-measure items-start gap-2 text-sm text-fg">
                  <ShapeChip briefing={read.value.briefing} />
                  <UserText>{read.value.briefing.headline}</UserText>
                </p>
                {narration.status === 'done' ? (
                  <div data-testid="briefing-narration">
                    <NarrationBody narration={narration.value} briefing={read.value.briefing} />
                  </div>
                ) : null}
              </div>
            </Panel>
            <BriefingSections briefing={read.value.briefing} />
          </>
        )}
      </PageBody>
    </PageFrame>
  );
}
