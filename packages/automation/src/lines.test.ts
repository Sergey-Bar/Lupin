import { describe, expect, it } from 'vitest';
import { parseJsonLine, readLines, withTimeout } from './lines.js';

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function collect(lines: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const line of lines) out.push(line);
  return out;
}

describe('readLines', () => {
  it('joins a line split across chunks and keeps the unterminated tail (G-1)', async () => {
    await expect(collect(readLines(streamOf('a\r\nb', 'c\nlast')))).resolves.toEqual([
      'a',
      'bc',
      'last',
    ]);
  });

  it('yields nothing extra for a body that ends on a newline', async () => {
    await expect(collect(readLines(streamOf('one\n')))).resolves.toEqual(['one']);
  });

  it('releases the reader when the consumer stops early (G-2)', async () => {
    const body = streamOf('first\nsecond\n');
    for await (const line of readLines(body)) {
      expect(line).toBe('first');
      break;
    }
    // A stream whose lock was never released would refuse a second reader.
    expect(body.locked).toBe(false);
  });

  it('does not let a rejected cancel replace the error the consumer is propagating', async () => {
    const failure = new Error('consumer failed');
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new TextEncoder().encode('line\n'));
      },
      cancel() {
        throw new Error('cancel rejected');
      },
    });
    const consume = async (): Promise<void> => {
      for await (const _line of readLines(body)) throw failure;
    };
    await expect(consume()).rejects.toBe(failure);
  });
});

describe('parseJsonLine', () => {
  it('returns an object line parsed', () => {
    expect(parseJsonLine('  {"a":1}  ')).toEqual({ a: 1 });
  });

  it.each([[''], ['   '], ['[1,2]'], ['null'], ['42'], ['data: not json'], ['{"cut":']])(
    'returns undefined for %j rather than throwing (G-7)',
    (line) => {
      expect(parseJsonLine(line)).toBeUndefined();
    },
  );
});

describe('withTimeout', () => {
  it('aborts on the deadline when the caller passes no signal', async () => {
    const signal = withTimeout(undefined, 5);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(signal.aborted).toBe(true);
  });

  it("keeps the caller's cancellation: aborting the caller aborts the request", () => {
    const caller = new AbortController();
    const signal = withTimeout(caller.signal, 60_000);
    expect(signal.aborted).toBe(false);
    caller.abort(new Error('stop'));
    expect(signal.aborted).toBe(true);
  });
});
