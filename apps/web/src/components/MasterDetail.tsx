import React from 'react';
import { ChevronLeft, cn } from '@lupin/ui';
import { PagerControls, Panel, useFitCount, usePager } from './kit.js';

/**
 * A list that fits its panel, with the selected item laid out in full beside it.
 *
 * Nothing scrolls: the list shows as many fixed-height rows as the panel has room for (measured,
 * so a taller window shows more) and pages the rest, and what the reader wants to know about a
 * row is on screen the moment the row is selected, not behind a click-through.
 *
 * Selection follows focus. `j` / `k` (the app's row walk) focus a row, focusing selects it, and
 * `Enter` clicks the row's button, so the keyboard browses the way a pointer does. The detail has
 * no `<li>` in it on purpose: those keys walk every `li` under `[data-page]`.
 *
 * Below `lg` there is room for one of the two, so a row opens its detail in place of the list and
 * a back button returns.
 */
export function MasterDetail<T>({
  label,
  title,
  action,
  items,
  getKey,
  rowPx,
  renderRow,
  renderLead,
  renderDetail,
  listHeader,
  footer,
  fallbackRows = 8,
}: {
  /** What the list holds, plural and lower case: names the paging and the regions. */
  label: string;
  title: string;
  action?: React.ReactNode;
  items: readonly T[];
  getKey: (item: T) => string;
  /** The height every row has, in pixels: the page size is the panel's height over this. */
  rowPx: number;
  renderRow: (item: T) => React.ReactNode;
  /** Beside the row's button and not in it, for a checkbox. */
  renderLead?: (item: T) => React.ReactNode;
  renderDetail: (item: T) => React.ReactNode;
  listHeader?: React.ReactNode;
  footer?: React.ReactNode;
  fallbackRows?: number;
}): React.ReactElement {
  const [fit, setList] = useFitCount(rowPx, fallbackRows);
  const pager = usePager(items, fit);
  const [selectedKey, setSelectedKey] = React.useState<string | null>(null);
  const [showDetail, setShowDetail] = React.useState(false);
  const selected = items.find((item) => getKey(item) === selectedKey) ?? items[0];

  return (
    <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)]">
      <Panel title={title} action={action} className={cn(showDetail && 'hidden lg:flex')}>
        {listHeader}
        <ul ref={setList} className="m-0 min-h-0 flex-1 list-none overflow-hidden p-0">
          {pager.items.map((item) => {
            const key = getKey(item);
            const isSelected = selected !== undefined && getKey(selected) === key;
            return (
              <li
                key={key}
                style={{ height: rowPx }}
                onFocus={() => setSelectedKey(key)}
                className="flex items-stretch border-b border-border last:border-b-0"
              >
                {renderLead === undefined ? null : (
                  <div className="flex w-10 shrink-0 items-center justify-center">
                    {renderLead(item)}
                  </div>
                )}
                <button
                  type="button"
                  aria-current={isSelected ? 'true' : undefined}
                  onClick={() => {
                    setSelectedKey(key);
                    setShowDetail(true);
                  }}
                  className={cn(
                    'min-w-0 flex-1 border-s-2 px-3 text-start transition-colors duration-200 motion-reduce:transition-none hover:bg-surface-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-border-focus',
                    isSelected ? 'border-primary bg-surface-muted' : 'border-transparent',
                  )}
                >
                  {renderRow(item)}
                </button>
              </li>
            );
          })}
        </ul>
        <PagerControls pager={pager} label={label} />
        {footer}
      </Panel>
      <section
        aria-label={`Selected ${label.replace(/s$/u, '')}`}
        className={cn(
          'min-h-0 min-w-0 flex-col overflow-auto rounded-lg border border-border bg-surface p-5',
          showDetail ? 'flex' : 'hidden lg:flex',
        )}
      >
        <button
          type="button"
          onClick={() => setShowDetail(false)}
          className="mb-3 inline-flex min-h-11 items-center gap-1 self-start text-sm text-fg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus lg:hidden"
        >
          <ChevronLeft size={16} aria-hidden="true" />
          Back to the list
        </button>
        {selected === undefined ? null : renderDetail(selected)}
      </section>
    </div>
  );
}
