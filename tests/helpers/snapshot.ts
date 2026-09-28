import type { FrameSnapshot, GameSnapshot } from '../../src/browser/GameSnapshot.js';

export function snapshot(partial: Partial<GameSnapshot> = {}): GameSnapshot {
  return { launchUrl: '', finalUrl: '', frames: [], responses: [], consoleErrors: [], pageErrors: [], failedRequests: [], loadTimeMs: 0, ...partial };
}

export function frame(text: string, extra: Partial<FrameSnapshot> = {}): FrameSnapshot {
  return { url: 'https://g.test', depth: 1, isMain: false, text, elementCount: 100, visibleCanvasCount: 1, videoCount: 0, iframeCount: 0, betElements: [], ariaElements: [], ...extra };
}
