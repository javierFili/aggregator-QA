/** Pure data collected from a loaded game. Detectors work on this so they can be unit-tested without a browser. */

export interface ElementInfo {
  tag: string;
  type?: string;
  id?: string;
  name?: string;
  className?: string;
  role?: string;
  text?: string;
  value?: string;
  attributes: Record<string, string>;
}

export interface FrameSnapshot {
  url: string;
  name?: string;
  depth: number;
  isMain: boolean;
  /** Visible text (innerText), truncated. */
  text: string;
  elementCount: number;
  visibleCanvasCount: number;
  videoCount: number;
  iframeCount: number;
  /** Elements whose identity/attributes suggest a bet / stake control. */
  betElements: ElementInfo[];
  /** Elements exposing ARIA values or labels. */
  ariaElements: ElementInfo[];
  error?: string;
}

export interface CapturedResponse {
  url: string;
  status: number;
  contentType: string;
  isNavigation: boolean;
  frameUrl?: string;
  /** Parsed JSON body (only for JSON responses under the size limit). */
  json?: unknown;
  /** Short text excerpt for navigation documents that are not HTML. */
  excerpt?: string;
}

export interface GameSnapshot {
  launchUrl: string;
  finalUrl: string;
  mainStatus?: number;
  navigationError?: string;
  frames: FrameSnapshot[];
  responses: CapturedResponse[];
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: Array<{ url: string; failure: string }>;
  loadTimeMs: number;
  /** When something was first rendered (ms from start). */
  renderedAtMs?: number;
  /** How "finished loading" was decided: game signal (currency seen), quiet network + stable screen, or timeout. */
  ready?: { reason: 'signal' | 'quiet' | 'timeout'; afterMs: number };
}
