import { chromium, devices, type Browser, type BrowserContext, type BrowserContextOptions } from 'playwright';
import { createLogger } from '../util/logger.js';

const log = createLogger('browser');

export interface ContextRequest {
  mobile?: boolean;
  locale?: string;
}

/**
 * Owns a single Chromium process shared by all workers; every game test gets its own isolated BrowserContext.
 * Tracks open contexts so they can all be closed on stop/shutdown.
 */
export class BrowserManager {
  private browser: Browser | undefined;
  private launching: Promise<Browser> | undefined;
  private readonly contexts = new Set<BrowserContext>();

  constructor(private readonly options: { headless: boolean }) {}

  get openContexts(): number {
    return this.contexts.size;
  }

  private async getBrowser(): Promise<Browser> {
    if (this.browser?.isConnected()) return this.browser;
    if (!this.launching) {
      log.info(`Launching Chromium (headless=${this.options.headless})`);
      this.launching = chromium
        .launch({ headless: this.options.headless, args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] })
        .then((browser) => {
          this.browser = browser;
          browser.on('disconnected', () => {
            if (this.browser === browser) this.browser = undefined;
            this.contexts.clear();
          });
          return browser;
        })
        .finally(() => {
          this.launching = undefined;
        });
    }
    return this.launching;
  }

  async newContext(request: ContextRequest = {}): Promise<BrowserContext> {
    const browser = await this.getBrowser();
    const base: BrowserContextOptions = request.mobile
      ? { ...devices['iPhone 13'] }
      : { viewport: { width: 1366, height: 768 }, userAgent: undefined };
    const context = await browser.newContext({
      ...base,
      locale: request.locale ?? 'en-US',
      ignoreHTTPSErrors: false,
      acceptDownloads: false,
      serviceWorkers: 'block',
    });
    this.contexts.add(context);
    context.on('close', () => this.contexts.delete(context));
    return context;
  }

  async closeAllContexts(): Promise<void> {
    await Promise.allSettled([...this.contexts].map((c) => c.close()));
    this.contexts.clear();
  }

  async close(): Promise<void> {
    await this.closeAllContexts();
    const browser = this.browser ?? (await this.launching?.catch(() => undefined));
    this.browser = undefined;
    if (browser) {
      await browser.close().catch(() => undefined);
      log.info('Chromium closed');
    }
  }
}
