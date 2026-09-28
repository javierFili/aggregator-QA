import { describe, expect, it } from 'vitest';
import { combineLaunch } from '../../src/qa/GameTester.js';
import { check, computeOverall, countResults, skipped } from '../../src/qa/TestResult.js';
import { BrowserLaunchEvaluator } from '../../src/qa/tests/LaunchTest.js';
import type { CheckStatus, GameQaResult } from '../../src/types/QaResult.js';
import { frame, snapshot } from '../helpers/snapshot.js';

const r = (launch: CheckStatus, currency: CheckStatus = 'SKIPPED', min: CheckStatus = 'SKIPPED', def: CheckStatus = 'SKIPPED', max: CheckStatus = 'SKIPPED') => ({
  launch: check(launch),
  currencyCheck: check(currency),
  minLimit: check(min),
  defaultLimit: check(def),
  maxLimit: check(max),
});

describe('computeOverall', () => {
  it.each([
    [r('PASS'), 'PASS'],
    [r('FAIL'), 'FAIL'],
    [r('PASS', 'PASS', 'FAIL'), 'FAIL'],
    [r('PASS', 'FAIL'), 'FAIL'],
    [r('PASS', 'NOT_DETECTED'), 'REVIEW'],
    [r('PASS', 'PASS', 'NOT_DETECTED', 'PASS', 'PASS'), 'REVIEW'],
    [r('REVIEW', 'PASS'), 'REVIEW'],
    [r('PASS', 'PASS', 'PASS', 'SKIPPED', 'PASS'), 'PASS'],
    [r('SKIPPED', 'NOT_DECLARED'), 'SKIPPED'],
    [r('PASS', 'SKIPPED'), 'PASS'],
    [r('FAIL', 'NOT_DETECTED'), 'FAIL'],
  ])('%j → %s', (input, expected) => expect(computeOverall(input)).toBe(expected));

  it('counts results', () => {
    const results = [{ overall: 'PASS' }, { overall: 'FAIL' }, { overall: 'PASS' }, { overall: 'SKIPPED' }] as GameQaResult[];
    expect(countResults(results)).toEqual({ PASS: 2, FAIL: 1, REVIEW: 0, SKIPPED: 1 });
  });
});

describe('BrowserLaunchEvaluator', () => {
  const evaluator = new BrowserLaunchEvaluator();

  it('fails on a JSON error document inside a frame (4170 in the browser)', () => {
    const s = snapshot({
      mainStatus: 200,
      responses: [{ url: 'https://s-endpoint.royal7.test/launch/?token=***', status: 200, contentType: 'application/json', isNavigation: true, json: { error: { code: -1, description: 'Error: Game not found' } } }],
      frames: [frame('', { isMain: true, depth: 0, elementCount: 6, visibleCanvasCount: 0 }), frame('{"error":{"code":-1,"description":"Error: Game not found"}}', { elementCount: 4, visibleCanvasCount: 0 })],
    });
    const e = evaluator.evaluate(s);
    expect(e.check.status).toBe('FAIL');
    expect(e.errors[0]).toMatchObject({ step: 'provider-launch', type: 'SEMANTIC_ERROR', httpStatus: 200 });
  });

  it('passes when a frame renders a canvas', () => {
    const s = snapshot({ mainStatus: 200, frames: [frame('', { isMain: true, depth: 0, elementCount: 5, visibleCanvasCount: 0 }), frame('', { visibleCanvasCount: 1 })] });
    expect(evaluator.evaluate(s).check.status).toBe('PASS');
  });

  it('reviews blank games and fails navigation errors', () => {
    const blank = snapshot({ mainStatus: 200, frames: [frame('', { isMain: true, depth: 0, elementCount: 5, visibleCanvasCount: 0 })] });
    expect(evaluator.evaluate(blank).check.status).toBe('REVIEW');
    expect(evaluator.evaluate(snapshot({ navigationError: 'page.goto: Timeout 45000ms exceeded.' })).errors[0]!.type).toBe('TIMEOUT');
    expect(evaluator.evaluate(snapshot({ mainStatus: 500 })).check.status).toBe('FAIL');
  });

  it('fails on a small frame showing an error message', () => {
    const s = snapshot({ mainStatus: 200, frames: [frame('Session expired, please log in again', { elementCount: 8, visibleCanvasCount: 0 })] });
    expect(evaluator.evaluate(s).check.status).toBe('FAIL');
  });
});

describe('combineLaunch', () => {
  const ok = { check: check('PASS', 'ok'), errors: [] };
  it('explicit HTTP semantic errors always fail', () => {
    const http = { check: check('FAIL', 'x'), errors: [], semanticError: { category: 'GAME_NOT_FOUND' as const, description: 'Game not found' } };
    expect(combineLaunch(http, ok).check.status).toBe('FAIL');
  });
  it('HTTP-only failures not reproduced in the browser become REVIEW', () => {
    expect(combineLaunch({ check: check('FAIL', 'HTTP 403'), errors: [] }, ok).check.status).toBe('REVIEW');
  });
  it('the browser verdict wins otherwise', () => {
    expect(combineLaunch({ check: check('REVIEW'), errors: [] }, ok).check.status).toBe('PASS');
    expect(combineLaunch(ok, { check: check('FAIL'), errors: [] }).check.status).toBe('FAIL');
    expect(combineLaunch(ok, { check: skipped(), errors: [] }).check.status).toBe('SKIPPED');
  });
});
