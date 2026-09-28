import type { GameSnapshot } from '../../browser/GameSnapshot.js';
import type { Game } from '../../types/Game.js';

/** Everything a detector may inspect about a loaded game. Pure data: detectors never drive the browser. */
export interface GameBrowserContext {
  game: Game;
  currency: string;
  lang: string;
  snapshot: GameSnapshot;
}

/** Recursively visits JSON values, calling `visit(key, value, parent)` for every property. Bounded in depth and size. */
export function walkJson(root: unknown, visit: (key: string, value: unknown, parent: Record<string, unknown>) => void, maxDepth = 8, maxNodes = 5_000): void {
  let nodes = 0;
  const walk = (value: unknown, depth: number): void => {
    if (depth > maxDepth || nodes > maxNodes || !value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 200)) walk(item, depth + 1);
      return;
    }
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      nodes++;
      visit(key, child, value as Record<string, unknown>);
      walk(child, depth + 1);
    }
  };
  walk(root, 0);
}

export const normalizeKey = (key: string): string => key.toLowerCase().replace(/[^a-z0-9]/g, '');

/** All visible text of the game, frame by frame (including ARIA labels and bet element texts). */
export function allTexts(context: GameBrowserContext): string[] {
  const texts: string[] = [];
  for (const frame of context.snapshot.frames) {
    if (frame.text) texts.push(frame.text);
    for (const el of [...frame.betElements, ...frame.ariaElements]) {
      const parts = [el.attributes['aria-label'], el.attributes['aria-valuetext'], el.attributes.title, el.text].filter(Boolean);
      if (parts.length) texts.push(parts.join(' '));
    }
  }
  return texts;
}
