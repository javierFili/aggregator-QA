import { describe, expect, it } from 'vitest';
import { Redactor } from '../../src/util/Redactor.js';

describe('Redactor', () => {
  it('masks registered secrets everywhere', () => {
    const r = new Redactor();
    r.register('super-secret-api-key');
    expect(r.text('Api-Key: super-secret-api-key used')).not.toContain('super-secret-api-key');
    expect(r.value({ nested: ['x super-secret-api-key y'] })).toEqual({ nested: ['x *** y'] });
  });

  it('masks sensitive query params, opaque path segments and credentials in URLs', () => {
    const r = new Redactor();
    const url = r.url('https://u:p@integration.test/alpha/launch/4182/abcdef0123456789abcdef0123456789?lang=en&token=xyz&md5=abc');
    expect(url).toBe('https://***@integration.test/alpha/launch/4182/***?lang=en&token=***&md5=***');
  });

  it('masks sensitive keys in objects and free text', () => {
    const r = new Redactor();
    expect(r.value({ token: 'abc', md5: 'x', Authorization: 'Bearer y', ok: 1 })).toEqual({ token: '***', md5: '***', Authorization: '***', ok: 1 });
    expect(r.text('{"token":"abcd1234","other":"x"}')).toBe('{"token":"***","other":"x"}');
    expect(r.text('see https://p.test/launch/?token=abc123 now')).toBe('see https://p.test/launch/?token=*** now');
  });

  it('forgets secrets', () => {
    const r = new Redactor();
    r.register('temporary-token');
    r.forget('temporary-token');
    expect(r.text('temporary-token')).toBe('temporary-token');
  });
});
