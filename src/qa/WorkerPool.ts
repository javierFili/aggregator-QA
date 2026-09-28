export interface WorkerPoolOptions {
  concurrency: number;
  maxConcurrency?: number;
}

export type WorkerHandler<T> = (item: T, workerId: number, index: number) => Promise<void>;

/**
 * Fixed-size pool consuming a shared queue. Items are handed out one at a time, so each item is processed
 * exactly once; a failing handler never stops the other workers. `stop()` prevents new items from starting
 * while letting in-flight items finish.
 */
export class WorkerPool<T> {
  private stopped = false;
  private next = 0;
  private active = 0;
  private peak = 0;

  constructor(private readonly options: WorkerPoolOptions) {
    if (!Number.isInteger(options.concurrency) || options.concurrency < 1) throw new Error('concurrency must be a positive integer');
  }

  get size(): number {
    return Math.min(this.options.concurrency, this.options.maxConcurrency ?? Number.POSITIVE_INFINITY);
  }

  get isStopped(): boolean {
    return this.stopped;
  }

  /** Highest number of handlers observed running at the same time. */
  get peakConcurrency(): number {
    return this.peak;
  }

  stop(): void {
    this.stopped = true;
  }

  async run(items: readonly T[], handler: WorkerHandler<T>, onError?: (error: unknown, item: T) => void): Promise<{ processed: number; stopped: boolean }> {
    let processed = 0;
    const workers = Array.from({ length: Math.min(this.size, items.length) }, (_, i) => i + 1);
    await Promise.all(
      workers.map(async (workerId) => {
        while (!this.stopped) {
          const index = this.next++;
          if (index >= items.length) return;
          const item = items[index]!;
          this.active++;
          this.peak = Math.max(this.peak, this.active);
          try {
            await handler(item, workerId, index);
          } catch (error) {
            onError?.(error, item);
          } finally {
            this.active--;
            processed++;
          }
        }
      }),
    );
    return { processed, stopped: this.stopped };
  }
}
