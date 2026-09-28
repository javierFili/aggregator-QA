import type { BrowserContext, Frame, Page, Response } from 'playwright';
import { Redactor, globalRedactor } from '../util/Redactor.js';
import { sleep, withTimeout } from '../util/time.js';
import type { BrowserManager } from './BrowserManager.js';
import { FRAME_COLLECTOR_SOURCE } from './frameCollector.js';
import type { CapturedResponse, ElementInfo, FrameSnapshot, GameSnapshot } from './GameSnapshot.js';

const MAX_JSON_BYTES = 256 * 1024;
const MAX_CAPTURED_RESPONSES = 150;
const MAX_FRAME_TEXT = 20_000;
const MAX_LIST = 50;

export interface OpenGameOptions {
  mobile?: boolean;
  locale?: string;
  /** Hard limit for navigation. */
  timeoutMs: number;
  /** Max time to wait, after DOMContentLoaded, for the game to show something (canvas / video). */
  settleMs: number;
  /** Extra headers sent ONLY to these hosts (never to game providers). */
  hostHeaders?: { hosts: readonly string[]; headers: Record<string, string> };
  /**
   * After the first render, keep waiting (up to this many ms) until the game has really finished loading:
   * `readyWhen` says so (e.g. the expected currency is visible), or the network is quiet and the screen stable.
   */
  readyTimeoutMs?: number;
  /** Game-specific "ready" signal, evaluated on partial data while waiting (e.g. currency detected). */
  readyWhen?: (partial: Pick<GameSnapshot, 'frames' | 'responses'>) => Promise<boolean>;
}

const QUIET_MS = 2_500;
const MIN_QUIET_WAIT_MS = 10_000;
const POLL_MS = 1_500;

/** Cheap check evaluated in every frame while waiting: has the game rendered anything yet? */
const RENDERED_PROBE = `(() => {
  for (const el of document.querySelectorAll('canvas,video')) {
    const r = el.getBoundingClientRect();
    if (r.width * r.height > 10000) return true;
  }
  return false;
})()`;

/** A game opened in its own browser context. Always call close() (use try/finally). */
export class GameBrowserSession {
  constructor(
    private readonly context: BrowserContext,
    readonly page: Page,
    readonly snapshot: GameSnapshot,
  ) {}

  async screenshot(path: string): Promise<boolean> {
    try {
      await this.page.screenshot({ path, timeout: 10_000, animations: 'disabled' });
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    await this.context.close().catch(() => undefined);
  }
}

/** Two low-quality JPEGs of the screen are "the same" if their sizes differ by less than 1 %. */
function similar(a: Buffer, b: Buffer): boolean {
  if (a.equals(b)) return true;
  return Math.abs(a.length - b.length) / Math.max(a.length, b.length) < 0.01;
}

function frameDepth(frame: Frame): number {
  let depth = 0;
  for (let f = frame.parentFrame(); f; f = f.parentFrame()) depth++;
  return depth;
}

/**
 * Level 2 (browser) inspection: opens the launch URL in an isolated context, lets the game settle,
 * and captures DOM/text of every frame plus console, network and JSON responses.
 */
export class GameBrowser {
  constructor(
    private readonly manager: BrowserManager,
    private readonly redactor: Redactor = globalRedactor,
  ) {}

  async open(launchUrl: string, options: OpenGameOptions): Promise<GameBrowserSession> {
    const context = await this.manager.newContext({ mobile: options.mobile ?? false, locale: options.locale ?? 'en-US' });
    try {
      const own = options.hostHeaders;
      if (own && own.hosts.length) {
        await context.route('**/*', (route) => {
          let host = '';
          try {
            host = new URL(route.request().url()).hostname;
          } catch {
            /* data:, blob: … */
          }
          if (own.hosts.includes(host)) void route.continue({ headers: { ...route.request().headers(), ...own.headers } }).catch(() => undefined);
          else void route.continue().catch(() => undefined);
        });
      }
      const page = await context.newPage();
      page.setDefaultTimeout(options.timeoutMs);
      const snapshot = await this.load(page, launchUrl, options);
      return new GameBrowserSession(context, page, snapshot);
    } catch (err) {
      await context.close().catch(() => undefined);
      throw err;
    }
  }

  private async load(page: Page, launchUrl: string, options: OpenGameOptions): Promise<GameSnapshot> {
    const r = this.redactor;
    const snapshot: GameSnapshot = {
      launchUrl: r.url(launchUrl),
      finalUrl: '',
      frames: [],
      responses: [],
      consoleErrors: [],
      pageErrors: [],
      failedRequests: [],
      loadTimeMs: 0,
    };
    const pending: Array<Promise<unknown>> = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error' && snapshot.consoleErrors.length < MAX_LIST) snapshot.consoleErrors.push(r.text(msg.text()).slice(0, 500));
    });
    page.on('pageerror', (err) => {
      if (snapshot.pageErrors.length < MAX_LIST) snapshot.pageErrors.push(r.text(err.message).slice(0, 500));
    });
    page.on('requestfailed', (req) => {
      const failure = req.failure()?.errorText ?? 'failed';
      if (failure.includes('ERR_ABORTED')) return; // navigations replaced by the app itself
      if (snapshot.failedRequests.length < MAX_LIST) snapshot.failedRequests.push({ url: r.url(req.url()), failure });
    });
    let lastRequestAt = Date.now();
    page.on('request', () => {
      lastRequestAt = Date.now();
    });
    page.on('response', (response) => {
      if (snapshot.responses.length >= MAX_CAPTURED_RESPONSES) return;
      pending.push(this.capture(response).then((captured) => captured && snapshot.responses.push(captured)).catch(() => undefined));
    });

    const started = Date.now();
    try {
      const response = await page.goto(launchUrl, { waitUntil: 'domcontentloaded', timeout: options.timeoutMs });
      if (response) snapshot.mainStatus = response.status();
    } catch (err) {
      snapshot.navigationError = r.text((err as Error).message.split('\n')[0] ?? 'navigation error');
    }

    if (!snapshot.navigationError) {
      // Slow games: poll until something is rendered (canvas / video) or the settle time is over.
      // Anti-bot interstitials that resolve by themselves are also given this time.
      const deadline = Date.now() + options.settleMs;
      let rendered = false;
      while (Date.now() < deadline) {
        if ((rendered = await this.hasRendered(page))) break;
        await sleep(1_000);
      }
      await sleep(1_500); // let canvases paint / late iframes attach
      snapshot.renderedAtMs = rendered ? Date.now() - started : undefined;

      // Loading screens also render: wait until the game is really ready.
      if (rendered && (options.readyTimeoutMs ?? 0) > 0) {
        snapshot.ready = await this.waitUntilReady(page, snapshot, options, () => lastRequestAt, started);
      }
    }
    await withTimeout(Promise.allSettled(pending), 5_000, 'response capture').catch(() => undefined);
    snapshot.loadTimeMs = Date.now() - started;
    snapshot.finalUrl = r.url(page.url());
    snapshot.frames = await this.collectFrames(page);
    return snapshot;
  }

  /**
   * Readiness, checked every ~1.5 s until `readyTimeoutMs`:
   *  1. `readyWhen` (e.g. expected currency visible in the game or in its network data) → ready immediately;
   *  2. otherwise: no new network request for 2.5 s AND the screen did not change between two checks → ready;
   *  3. otherwise the timeout wins (the snapshot is taken anyway).
   */
  private async waitUntilReady(
    page: Page,
    snapshot: GameSnapshot,
    options: OpenGameOptions,
    lastRequestAt: () => number,
    started: number,
  ): Promise<NonNullable<GameSnapshot['ready']>> {
    const waitStart = Date.now();
    const deadline = waitStart + (options.readyTimeoutMs ?? 0);
    // With a game signal to wait for (currency), a quiet+static screen may still be a splash/loading screen:
    // only accept it after a minimum time and several identical screens in a row.
    const minQuietWait = options.readyWhen ? Math.min(MIN_QUIET_WAIT_MS, options.readyTimeoutMs ?? 0) : 0;
    const stableNeeded = options.readyWhen ? 3 : 2;
    let previousShot: Buffer | undefined;
    let stableCount = 0;
    while (Date.now() < deadline) {
      if (options.readyWhen) {
        const frames = await this.collectTexts(page);
        const ok = await options.readyWhen({ frames, responses: snapshot.responses }).catch(() => false);
        if (ok) return { reason: 'signal', afterMs: Date.now() - started };
      }
      const quiet = Date.now() - lastRequestAt() >= QUIET_MS;
      const shot = await page.screenshot({ type: 'jpeg', quality: 30, scale: 'css', timeout: 3_000 }).catch(() => undefined);
      stableCount = shot && previousShot && similar(shot, previousShot) ? stableCount + 1 : 1;
      previousShot = shot;
      if (quiet && stableCount >= stableNeeded && Date.now() - waitStart >= minQuietWait) return { reason: 'quiet', afterMs: Date.now() - started };
      await sleep(POLL_MS);
    }
    return { reason: 'timeout', afterMs: Date.now() - started };
  }

  /** Lightweight per-frame visible text, used while waiting for readiness. */
  private async collectTexts(page: Page): Promise<FrameSnapshot[]> {
    const frames = page.frames().slice(0, 30);
    return Promise.all(
      frames.map(async (frame): Promise<FrameSnapshot> => {
        const text = await withTimeout(frame.evaluate(`(document.body && document.body.innerText || '').slice(0, 20000)`) as Promise<string>, 1_500, 'text').catch(() => '');
        return { url: frame.url(), depth: frameDepth(frame), isMain: frame === page.mainFrame(), text, elementCount: 0, visibleCanvasCount: 0, videoCount: 0, iframeCount: 0, betElements: [], ariaElements: [] };
      }),
    );
  }

  private async hasRendered(page: Page): Promise<boolean> {
    const checks = page.frames().slice(0, 30).map((f) => withTimeout(f.evaluate(RENDERED_PROBE) as Promise<boolean>, 1_500, 'probe').catch(() => false));
    return (await Promise.all(checks)).some(Boolean);
  }

  private async capture(response: Response): Promise<CapturedResponse | undefined> {
    const request = response.request();
    const isNavigation = request.isNavigationRequest();
    const contentType = (await response.headerValue('content-type').catch(() => null)) ?? '';
    const isJson = contentType.toLowerCase().includes('json');
    if (!isNavigation && !isJson && response.status() < 400) return undefined;
    if (!isNavigation && !isJson) {
      // only keep failed sub-resources of type document/xhr/fetch/script
      if (!['document', 'xhr', 'fetch', 'script'].includes(request.resourceType())) return undefined;
    }
    const captured: CapturedResponse = {
      url: this.redactor.url(response.url()),
      status: response.status(),
      contentType,
      isNavigation,
    };
    const frame = response.frame();
    if (frame) captured.frameUrl = this.redactor.url(frame.url() || response.url());
    if (response.status() >= 300 && response.status() < 400) return captured;
    const lengthHeader = Number((await response.headerValue('content-length').catch(() => null)) ?? '0');
    if (lengthHeader > MAX_JSON_BYTES) return captured;
    if (isJson || (isNavigation && !contentType.toLowerCase().includes('html'))) {
      const body = await response.text().catch(() => '');
      if (body.length <= MAX_JSON_BYTES) {
        try {
          captured.json = JSON.parse(body);
        } catch {
          if (isNavigation) captured.excerpt = this.redactor.text(body.slice(0, 800));
        }
      }
    }
    return captured;
  }

  private async collectFrames(page: Page): Promise<FrameSnapshot[]> {
    const frames = page.frames().slice(0, 30);
    const results = await Promise.all(
      frames.map(async (frame): Promise<FrameSnapshot> => {
        const base: FrameSnapshot = {
          url: this.redactor.url(frame.url()),
          depth: frameDepth(frame),
          isMain: frame === page.mainFrame(),
          text: '',
          elementCount: 0,
          visibleCanvasCount: 0,
          videoCount: 0,
          iframeCount: 0,
          betElements: [],
          ariaElements: [],
        };
        if (frame.name()) base.name = frame.name();
        try {
          const data = await withTimeout(
            frame.evaluate(`(${FRAME_COLLECTOR_SOURCE})(${MAX_FRAME_TEXT})`) as Promise<Omit<FrameSnapshot, 'url' | 'depth' | 'isMain'>>,
            5_000,
            'frame evaluation timeout',
          );
          return {
            ...base,
            ...data,
            text: this.redactor.text(data.text),
            betElements: data.betElements as ElementInfo[],
            ariaElements: data.ariaElements as ElementInfo[],
          };
        } catch (err) {
          return { ...base, error: (err as Error).message.split('\n')[0] ?? 'evaluation failed' };
        }
      }),
    );
    return results;
  }
}
