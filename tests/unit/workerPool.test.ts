import { describe, expect, it } from 'vitest';
import { WorkerPool } from '../../src/qa/WorkerPool.js';
import { sleep } from '../../src/util/time.js';

describe('WorkerPool', () => {
  it('processes every item exactly once without exceeding the concurrency', async () => {
    const items = Array.from({ length: 50 }, (_, i) => i);
    const seen: number[] = [];
    let running = 0;
    let peak = 0;
    const pool = new WorkerPool<number>({ concurrency: 7 });
    const { processed } = await pool.run(items, async (item) => {
      running++;
      peak = Math.max(peak, running);
      await sleep(Math.random() * 5);
      seen.push(item);
      running--;
    });
    expect(processed).toBe(50);
    expect([...seen].sort((a, b) => a - b)).toEqual(items);
    expect(peak).toBeLessThanOrEqual(7);
    expect(pool.peakConcurrency).toBe(7);
  });

  it('respects maxConcurrency and never starts more workers than items', async () => {
    const workers = new Set<number>();
    await new WorkerPool<number>({ concurrency: 50, maxConcurrency: 3 }).run([1, 2, 3, 4, 5, 6], async (_i, workerId) => {
      workers.add(workerId);
      await sleep(2);
    });
    expect(workers.size).toBe(3);
    const few = new Set<number>();
    await new WorkerPool<number>({ concurrency: 10 }).run([1, 2], async (_i, id) => void few.add(id));
    expect(few.size).toBe(2);
  });

  it('keeps going when a handler throws', async () => {
    const done: number[] = [];
    const errors: number[] = [];
    await new WorkerPool<number>({ concurrency: 2 }).run(
      [1, 2, 3, 4],
      async (i) => {
        if (i === 2) throw new Error('boom');
        done.push(i);
      },
      (_e, item) => errors.push(item),
    );
    expect(done.sort()).toEqual([1, 3, 4]);
    expect(errors).toEqual([2]);
  });

  it('stop() lets running items finish but starts no new ones', async () => {
    const started: number[] = [];
    const finished: number[] = [];
    const pool = new WorkerPool<number>({ concurrency: 2 });
    const run = pool.run(Array.from({ length: 10 }, (_, i) => i), async (i) => {
      started.push(i);
      if (i === 1) pool.stop();
      await sleep(10);
      finished.push(i);
    });
    const result = await run;
    expect(result.stopped).toBe(true);
    expect(started).toEqual([0, 1]);
    expect(finished.sort()).toEqual([0, 1]);
  });

  it('rejects invalid concurrency', () => {
    expect(() => new WorkerPool({ concurrency: 0 })).toThrow();
  });
});
