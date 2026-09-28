import { env } from '../config/environment.js';
import { globalRedactor } from './Redactor.js';

type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export type LogListener = (entry: LogEntry) => void;
export interface LogEntry {
  time: string;
  level: Level;
  scope?: string;
  message: string;
}

const listeners = new Set<LogListener>();

export function onLog(listener: LogListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(level: Level, scope: string | undefined, message: string): void {
  if (ORDER[level] < ORDER[env.logLevel]) return;
  const entry: LogEntry = { time: new Date().toISOString(), level, message: globalRedactor.text(message) };
  if (scope) entry.scope = scope;
  const line = `${entry.time} [${level.toUpperCase()}]${scope ? ` [${scope}]` : ''} ${entry.message}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
  for (const listener of listeners) listener(entry);
}

export interface Logger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  child(scope: string): Logger;
}

export function createLogger(scope?: string): Logger {
  return {
    debug: (m) => emit('debug', scope, m),
    info: (m) => emit('info', scope, m),
    warn: (m) => emit('warn', scope, m),
    error: (m) => emit('error', scope, m),
    child: (s) => createLogger(scope ? `${scope}:${s}` : s),
  };
}

export const logger = createLogger();
