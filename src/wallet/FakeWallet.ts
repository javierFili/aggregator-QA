import express, { type Request, type Response, Router } from 'express';
import { createLogger } from '../util/logger.js';
import { globalRedactor } from '../util/Redactor.js';

const log = createLogger('wallet');

/**
 * Fake seamless wallet ("account platform") for QA on staging partners.
 *
 * Seamless partners make the aggregator call the partner's own endpoint to get the player balance before a game
 * opens (`2051`), and for transactions (`2052`…). This answers those calls with a fictitious balance (100 by default,
 * configurable per currency) so games can load. It holds no real money: balances only live in memory.
 *
 * Wire format (from the aggregator: Feedh Driver + AbstractService::describeCall):
 *   POST <endpoint>   Content-Type: application/json   Api-Key: <site driver apiKey>
 *   {"opType":2051,"token":"…","user_id":"qa-runner-eur-w01"}   →   {"status":true,"message":100}
 */
export interface FakeWalletOptions {
  defaultBalance: number;
  /** Per-currency starting balance, e.g. { EUR: 100, USD: 100 }. */
  balances: Record<string, number>;
  /** If set, requests must carry this `Api-Key` header. */
  apiKey?: string;
}

export interface WalletStats {
  calls: Record<string, number>;
  lastCallAt?: string;
  lastUserId?: string;
}

const OP_NAMES: Record<number, string> = { 2050: 'check_session', 2051: 'balance', 2052: 'credit_transfer', 2053: 'pending_transfer', 2054: 'cancel_credit_transfer' };

/** `qa-runner-eur-w01` → `EUR` */
export function currencyFromUserId(userId: string): string | undefined {
  const m = /-([a-z]{3})-w\d{2}$/i.exec(userId);
  return m?.[1]?.toUpperCase();
}

export function parseBalances(text: string | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const part of (text ?? '').split(/[,;\s]+/).filter(Boolean)) {
    const [code, amount] = part.split(':');
    const value = Number(amount);
    if (code && /^[A-Za-z]{3}$/.test(code) && Number.isFinite(value) && value >= 0) out[code.toUpperCase()] = value;
  }
  return out;
}

export class FakeWallet {
  private readonly balances = new Map<string, number>();
  private readonly seenTransactions = new Map<string, number>();
  readonly stats: WalletStats = { calls: {} };

  constructor(private readonly options: FakeWalletOptions) {}

  startingBalance(userId: string): number {
    const currency = currencyFromUserId(userId);
    const perCurrency = currency ? this.options.balances[currency] : undefined;
    return perCurrency ?? this.options.defaultBalance;
  }

  private balanceOf(userId: string): number {
    if (!this.balances.has(userId)) this.balances.set(userId, this.startingBalance(userId));
    return this.balances.get(userId)!;
  }

  handle(body: Record<string, unknown>): { status: boolean; message: unknown } {
    const opType = Number(body.opType);
    const userId = String(body.user_id ?? body.username ?? body.token ?? 'unknown');
    const name = OP_NAMES[opType] ?? `op_${opType}`;
    this.stats.calls[name] = (this.stats.calls[name] ?? 0) + 1;
    this.stats.lastCallAt = new Date().toISOString();
    this.stats.lastUserId = userId;

    switch (opType) {
      case 2050:
      case 2051:
        return { status: true, message: round(this.balanceOf(userId)) };
      case 2052: {
        // Fictitious money only: apply bet/win to the in-memory balance, idempotent per transaction id.
        const tranid = String(body.tranid ?? '');
        if (tranid && this.seenTransactions.has(tranid)) return { status: true, message: this.seenTransactions.get(tranid) };
        const bet = Number(body.bet ?? 0) || 0;
        const win = Number(body.win ?? 0) || 0;
        const current = this.balanceOf(userId);
        if (bet > current) return { status: false, message: 'ERR-0003: Not enough money.' };
        const next = round(current - bet + win);
        this.balances.set(userId, next);
        if (tranid) this.seenTransactions.set(tranid, next);
        return { status: true, message: next };
      }
      case 2053:
      case 2054:
        return { status: true, message: round(this.balanceOf(userId)) };
      default:
        return { status: false, message: `ERR-0000: Operation ${String(body.opType)} not supported by the QA fake wallet.` };
    }
  }

  router(): Router {
    const router = Router();
    router.use(express.json({ limit: '50kb' }));
    const handler = (req: Request, res: Response): void => {
      if (this.options.apiKey && req.get('Api-Key') !== this.options.apiKey) {
        res.json({ status: false, message: 'ERR-0001: Invalid Api-Key.' });
        return;
      }
      const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
      const answer = this.handle(body);
      log.info(`${OP_NAMES[Number(body.opType)] ?? body.opType} user=${String(body.user_id ?? '?')} → ${answer.status ? `balance ${String(answer.message)}` : String(answer.message)}`);
      if (body.token) globalRedactor.register(String(body.token));
      res.json(answer);
    };
    router.post('/', handler);
    router.post('/:partner', handler);
    return router;
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
