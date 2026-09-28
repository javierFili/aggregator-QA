import { describe, expect, it } from 'vitest';
import { SemanticErrorDetector } from '../../src/qa/detectors/SemanticErrorDetector.js';

const d = new SemanticErrorDetector();

describe('SemanticErrorDetector', () => {
  it('detects the known provider error (4170)', () => {
    const e = d.detectJson({ error: { code: -1, description: 'Error: Game not found' } });
    expect(e).toMatchObject({ category: 'GAME_NOT_FOUND', code: -1, description: 'Error: Game not found' });
  });

  it.each([
    [{ status: false, message: 'ERR-0000: Generic error.' }, 'AGGREGATOR_ERROR'],
    [{ success: false, message: 'Invalid token' }, 'INVALID_TOKEN'],
    [{ errorCode: 401, message: 'Unauthorized' }, 'UNAUTHORIZED'],
    [{ error: 'Session expired' }, 'SESSION_EXPIRED'],
    [{ code: -5, message: 'Currency not supported' }, 'CURRENCY_ERROR'],
    [{ data: { error: { message: 'Provider unavailable' } } }, 'PROVIDER_UNAVAILABLE'],
    [{ status: 'error', msg: 'Juego no encontrado' }, 'GAME_NOT_FOUND'],
    [{ errors: [{ message: 'Forbidden' }] }, 'FORBIDDEN'],
    [{ result: 'fail', reason: 'Configuration error' }, 'CONFIGURATION_ERROR'],
    [{ error: { code: 42, message: 'kaboom' } }, 'GENERIC'],
  ])('detects %j', (body, category) => {
    expect(d.detectJson(body)?.category).toBe(category);
  });

  it.each([
    [{ status: true, message: { token: 'x' } }],
    [{ error: null, data: { url: 'https://x' } }],
    [{ error: { code: 0, message: 'OK' } }],
    [{ errors: [] }],
    [{ minBet: 0.1, maxBet: 100, currency: 'EUR' }],
    [{ code: 0, description: 'ok' }],
    [[{ error: 'in array is ignored' }]],
  ])('does not flag %j', (body) => {
    expect(d.detectJson(body)).toBeUndefined();
  });

  it('detects errors in short texts, in several languages', () => {
    expect(d.detectText('Sesión expirada. Vuelva a entrar.')?.category).toBe('SESSION_EXPIRED');
    expect(d.detectText('Jocul nu a fost găsit')?.category).toBe('GAME_NOT_FOUND');
    expect(d.detectText('An error occurred')?.category).toBe('GENERIC');
    expect(d.detectText('{"error":{"code":-1,"description":"Error: Game not found"}}')?.category).toBe('GAME_NOT_FOUND');
  });

  it('does not match the generic word "error" in long texts', () => {
    const long = `Welcome to the game. ${'Spin the wheel and win big prizes. '.repeat(20)} If an error happens contact support.`;
    expect(d.detectText(long)).toBeUndefined();
    expect(d.detectText('Loading…')).toBeUndefined();
  });

  it('detectBody routes by content type', () => {
    expect(d.detectBody('{"error":"Game unavailable"}', 'application/json')?.category).toBe('GAME_UNAVAILABLE');
    expect(d.detectBody('not json', 'application/json')?.category).toBe('GENERIC');
    expect(d.detectBody('<html>fine</html>', 'text/html')).toBeUndefined();
  });
});
