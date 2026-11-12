import { describe, expect, it } from 'vitest';
import { InMemoryExecutionStore } from './in-memory-store.js';
import { pollReportSchedules } from './scheduler.js';
import type { ReportSchedule } from './types.js';

/**
 * A report schedule queues a delivery, not a run.
 *
 * The worker has the database and the clock, and not the vault: a bot token never reaches
 * this process. So the worker's whole part in a scheduled report is one row in
 * `report_deliveries`, keyed `schedule:<id>:<dueAt>`, and the API's dispatcher does the rest.
 */
const report = (overrides: Partial<ReportSchedule> = {}): ReportSchedule => ({
  id: 'report:sub-1',
  workspaceId: 'ws-1',
  subscriptionId: 'sub-1',
  cronExpr: '0 9 * * *',
  timezone: 'UTC',
  nextRunAt: '2026-10-20T09:00:00.000Z',
  quietHours: null,
  ...overrides,
});

describe('pollReportSchedules', () => {
  it('queues one delivery for a due report and points the schedule at the next one', async () => {
    const store = new InMemoryExecutionStore();
    store.addReportSchedule(report());
    expect(await pollReportSchedules(store, new Date('2026-10-20T09:00:30.000Z'), 10)).toBe(1);
    expect(store.listReportDeliveries()).toEqual([
      {
        workspaceId: 'ws-1',
        subscriptionId: 'sub-1',
        scheduledFor: '2026-10-20T09:00:00.000Z',
        idempotencyKey: 'schedule:report:sub-1:2026-10-20T09:00:00.000Z',
        notBefore: '2026-10-20T09:00:30.000Z',
        status: 'pending',
      },
    ]);
    expect(await store.listDueReportSchedules(new Date('2026-10-20T09:01:00.000Z'), 10)).toEqual(
      [],
    );
  });

  it('sends one catch-up after downtime, never a backlog', async () => {
    // Down for five days: a daily report must not arrive five times on the sixth.
    const store = new InMemoryExecutionStore();
    store.addReportSchedule(report());
    expect(await pollReportSchedules(store, new Date('2026-10-25T12:00:00.000Z'), 10)).toBe(1);
    expect(store.listReportDeliveries()).toHaveLength(1);
    const [next] = await store.listDueReportSchedules(new Date('2026-10-26T09:00:00.000Z'), 10);
    expect(next?.nextRunAt).toBe('2026-10-26T09:00:00.000Z');
  });

  it('polled twice for the same occurrence, queues it once', async () => {
    const store = new InMemoryExecutionStore();
    store.addReportSchedule(report());
    const due = await store.listDueReportSchedules(new Date('2026-10-20T09:00:30.000Z'), 10);
    const input = {
      schedule: due[0] as ReportSchedule,
      scheduledFor: '2026-10-20T09:00:00.000Z',
      nextRunAt: '2026-10-21T09:00:00.000Z',
      idempotencyKey: 'schedule:report:sub-1:2026-10-20T09:00:00.000Z',
      notBefore: '2026-10-20T09:00:30.000Z',
    };
    expect(await store.enqueueScheduledReport(input)).toBe(true);
    expect(await store.enqueueScheduledReport(input)).toBe(false);
    expect(store.listReportDeliveries()).toHaveLength(1);
  });

  it('honours the schedule’s timezone', async () => {
    const store = new InMemoryExecutionStore();
    store.addReportSchedule(
      report({ timezone: 'Asia/Jerusalem', nextRunAt: '2026-10-20T06:00:00.000Z' }),
    );
    await pollReportSchedules(store, new Date('2026-10-20T06:00:10.000Z'), 10);
    const [next] = await store.listDueReportSchedules(new Date('2026-10-22T00:00:00.000Z'), 10);
    // 09:00 in Jerusalem, three hours ahead of UTC in October.
    expect(next?.nextRunAt).toBe('2026-10-21T06:00:00.000Z');
  });

  it('refuses a schedule with a timezone that does not exist', async () => {
    const store = new InMemoryExecutionStore();
    store.addReportSchedule(report({ timezone: 'Mars/Olympus' }));
    await expect(
      pollReportSchedules(store, new Date('2026-10-20T09:00:30.000Z'), 10),
    ).rejects.toThrow(/timezone/u);
  });

  it('does nothing for a store that has no report schedules', async () => {
    const store = new InMemoryExecutionStore();
    expect(await pollReportSchedules(store, new Date(), 10)).toBe(0);
    // A store that can list but not queue is treated as one that has none.
    const halfway = { listDueReportSchedules: store.listDueReportSchedules.bind(store) };
    expect(await pollReportSchedules(halfway as never, new Date(), 10)).toBe(0);
  });

  it('counts only what it queued, and refuses an unknown schedule', async () => {
    const store = new InMemoryExecutionStore();
    store.addReportSchedule(report());
    const taken = Object.assign(Object.create(store) as InMemoryExecutionStore, {
      enqueueScheduledReport: async () => false,
    });
    expect(await pollReportSchedules(taken, new Date('2026-10-20T09:00:30.000Z'), 10)).toBe(0);
    expect(
      await store.enqueueScheduledReport({
        schedule: report({ id: 'report:unknown' }),
        scheduledFor: '2026-10-20T09:00:00.000Z',
        nextRunAt: '2026-10-21T09:00:00.000Z',
        idempotencyKey: 'k',
        notBefore: '2026-10-20T09:00:00.000Z',
      }),
    ).toBe(false);
  });

  it('holds a report due in quiet hours until they end, in the subscription’s timezone', async () => {
    const store = new InMemoryExecutionStore();
    store.addReportSchedule(
      report({
        cronExpr: '0 23 * * *',
        timezone: 'Europe/Berlin',
        // 23:00 in Berlin, UTC+1 after the October change: 22:00 UTC.
        nextRunAt: '2026-10-27T22:00:00.000Z',
        quietHours: { start: 22, end: 7 },
      }),
    );
    await pollReportSchedules(store, new Date('2026-10-27T22:00:10.000Z'), 10);
    // Queued at once, but not to be sent before 07:00 in Berlin, 06:00 UTC.
    expect(store.listReportDeliveries().map((delivery) => delivery.notBefore)).toEqual([
      '2026-10-28T06:00:00.000Z',
    ]);
  });

  it('sends at once outside quiet hours', async () => {
    const store = new InMemoryExecutionStore();
    store.addReportSchedule(report({ quietHours: { start: 22, end: 7 } }));
    await pollReportSchedules(store, new Date('2026-10-20T09:00:30.000Z'), 10);
    expect(store.listReportDeliveries()[0]?.notBefore).toBe('2026-10-20T09:00:30.000Z');
  });

  it('folds an occurrence into a report still waiting, so a quiet night ends in one report', async () => {
    const store = new InMemoryExecutionStore();
    store.addReportSchedule(
      report({
        cronExpr: '0 * * * *',
        nextRunAt: '2026-10-20T23:00:00.000Z',
        quietHours: { start: 22, end: 7 },
      }),
    );
    // Every hour of the night comes due; only the first is queued, held until 07:00.
    for (let hour = 0; hour < 8; hour += 1) {
      await pollReportSchedules(
        store,
        new Date(Date.parse('2026-10-20T23:00:30.000Z') + hour * 3_600_000),
        10,
      );
    }
    expect(store.listReportDeliveries()).toHaveLength(1);
    // Once that report is sent, the next occurrence is queued as usual.
    store.markReportSent('schedule:report:sub-1:2026-10-20T23:00:00.000Z');
    await pollReportSchedules(store, new Date('2026-10-21T08:00:30.000Z'), 10);
    expect(store.listReportDeliveries()).toHaveLength(2);
  });

  it('serves the oldest due report first, up to the batch', async () => {
    const store = new InMemoryExecutionStore();
    store.addReportSchedule(report({ id: 'report:late', nextRunAt: '2026-10-20T10:00:00.000Z' }));
    store.addReportSchedule(report({ id: 'report:early', nextRunAt: '2026-10-20T08:00:00.000Z' }));
    const due = await store.listDueReportSchedules(new Date('2026-10-20T11:00:00.000Z'), 1);
    expect(due.map((schedule) => schedule.id)).toEqual(['report:early']);
  });
});
