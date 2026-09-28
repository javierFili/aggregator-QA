import express from 'express';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { currencyFromUserId, FakeWallet, parseBalances } from '../../src/wallet/FakeWallet.js';

describe('FakeWallet', () => {
  const wallet = () => new FakeWallet({ defaultBalance: 100, balances: { GBP: 50 } });

  it('answers 2051 with the fictitious balance, per currency of the QA player', () => {
    const w = wallet();
    expect(w.handle({ opType: 2051, token: 't', user_id: 'qa-runner-eur-w01' })).toEqual({ status: true, message: 100 });
    expect(w.handle({ opType: '2051', token: 't', user_id: 'qa-runner-gbp-w02' })).toEqual({ status: true, message: 50 });
    expect(w.handle({ opType: 2050, token: 't', user_id: 'someone-else' })).toEqual({ status: true, message: 100 });
    expect(w.stats.calls).toMatchObject({ balance: 2, check_session: 1 });
  });

  it('2052 applies bet/win to fictitious money, idempotent per tranid, never below zero', () => {
    const w = wallet();
    expect(w.handle({ opType: 2052, user_id: 'qa-runner-eur-w01', bet: 1, win: 0.5, tranid: 'a' })).toEqual({ status: true, message: 99.5 });
    expect(w.handle({ opType: 2052, user_id: 'qa-runner-eur-w01', bet: 1, win: 0.5, tranid: 'a' })).toEqual({ status: true, message: 99.5 });
    expect(w.handle({ opType: 2052, user_id: 'qa-runner-eur-w01', bet: 1000, win: 0, tranid: 'b' }).status).toBe(false);
  });

  it('parses config and player currency', () => {
    expect(parseBalances('EUR:100, usd:200;GBP:x')).toEqual({ EUR: 100, USD: 200 });
    expect(currencyFromUserId('qa-runner-usd-w03')).toBe('USD');
    expect(currencyFromUserId('player1')).toBeUndefined();
  });

  it('HTTP endpoint speaks the aggregator wire format and can require an Api-Key', async () => {
    const app = express();
    app.use('/wallet', new FakeWallet({ defaultBalance: 100, balances: {}, apiKey: 'wk' }).router());
    const server = app.listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/wallet`;
    const call = (key: string) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Api-Key': key }, body: JSON.stringify({ opType: 2051, token: 'tok', user_id: 'qa-runner-eur-w01' }) }).then((r) => r.json());
    expect(await call('wk')).toEqual({ status: true, message: 100 });
    expect(await call('bad')).toMatchObject({ status: false });
    server.close();
  });
});
