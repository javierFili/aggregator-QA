import 'dotenv/config';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Environment {
  host: string;
  port: number;
  playwrightHeadless: boolean;
  defaultWorkers: number;
  maxWorkers: number;
  requestTimeoutMs: number;
  browserTimeoutMs: number;
  gameSettleTimeoutMs: number;
  /** Default extra wait until a game has finished loading (currency visible / quiet + stable). */
  defaultReadyTimeoutMs: number;
  reportsDir: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  /** Fake seamless wallet (answers the aggregator's 2051/2052 calls). */
  fakeWallet: { enabled: boolean; defaultBalance: number; balances: string; apiKey?: string };
  rootDir: string;
}

function intFrom(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function boolFrom(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

/** Walks up from this module until it finds the package root (works from src/ and dist/). */
function findRootDir(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    if (existsSync(path.join(dir, 'package.json'))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}

export function loadEnvironment(source: NodeJS.ProcessEnv = process.env): Environment {
  const rootDir = findRootDir();
  const maxWorkers = intFrom(source.MAX_WORKERS, 20, 1, 100);
  const level = (source.LOG_LEVEL ?? 'info').toLowerCase();
  return {
    host: source.HOST?.trim() || '127.0.0.1',
    port: intFrom(source.PORT, 3000, 1, 65535),
    playwrightHeadless: boolFrom(source.PLAYWRIGHT_HEADLESS, true),
    defaultWorkers: intFrom(source.DEFAULT_WORKERS, 5, 1, maxWorkers),
    maxWorkers,
    requestTimeoutMs: intFrom(source.REQUEST_TIMEOUT, 30_000, 1_000, 300_000),
    browserTimeoutMs: intFrom(source.BROWSER_TIMEOUT, 45_000, 5_000, 600_000),
    gameSettleTimeoutMs: intFrom(source.GAME_SETTLE_TIMEOUT, 25_000, 0, 180_000),
    defaultReadyTimeoutMs: intFrom(source.GAME_READY_TIMEOUT, 30_000, 0, 180_000),
    reportsDir: path.resolve(rootDir, source.REPORTS_DIR?.trim() || 'reports'),
    logLevel: (['debug', 'info', 'warn', 'error'].includes(level) ? level : 'info') as Environment['logLevel'],
    rootDir,
    fakeWallet: {
      enabled: boolFrom(source.FAKE_WALLET, true),
      defaultBalance: Math.max(0, Number(source.FAKE_WALLET_BALANCE ?? 100) || 0),
      balances: source.FAKE_WALLET_BALANCES ?? '',
      ...(source.FAKE_WALLET_API_KEY ? { apiKey: source.FAKE_WALLET_API_KEY } : {}),
    },
  };
}

export const env: Environment = loadEnvironment();
