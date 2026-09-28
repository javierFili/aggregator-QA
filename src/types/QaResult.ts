export type CheckStatus = 'PASS' | 'FAIL' | 'REVIEW' | 'SKIPPED' | 'NOT_DECLARED' | 'NOT_DETECTED';

/** Overall status of one game × currency test. SKIPPED means nothing was actually tested. */
export type OverallStatus = 'PASS' | 'FAIL' | 'REVIEW' | 'SKIPPED';

export interface CheckResult {
  status: CheckStatus;
  /** Short human readable explanation (Spanish, shown in UI/report). */
  detail?: string;
  expected?: string | number;
  detected?: string | number;
  /** Where the detected value came from (detector name). */
  source?: string;
}

export type QaStep = 'catalog' | 'session' | 'launch' | 'provider-launch' | 'redirect' | 'browser' | 'currency' | 'limits' | 'internal';

export type QaErrorType =
  | 'HTTP_ERROR'
  | 'SEMANTIC_ERROR'
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'INVALID_RESPONSE'
  | 'EMPTY_CONTENT'
  | 'WAF_BLOCKED'
  | 'BROWSER_ERROR'
  | 'CURRENCY_MISMATCH'
  | 'LIMIT_MISMATCH'
  | 'EXCEPTION';

export interface QaError {
  step: QaStep;
  type: QaErrorType;
  description: string;
  httpStatus?: number;
  /** Always redacted before being stored. */
  url?: string;
  contentType?: string;
  /** Semantic error code when the provider returned one. */
  code?: string | number;
  /** True for problems that do not change the outcome (warnings). */
  warning?: boolean;
}

export interface GameQaResult {
  gameId: number;
  gameName: string;
  provider: string;
  currency: string;
  declared: boolean;
  /** Currency the aggregator actually assigned to the QA player, when it differs from `currency`. */
  playerCurrency?: string;

  launch: CheckResult;
  currencyCheck: CheckResult;

  minLimit: CheckResult;
  defaultLimit: CheckResult;
  maxLimit: CheckResult;

  overall: OverallStatus;
  durationMs: number;
  startedAt: string;
  errors: QaError[];

  /** Relative paths inside the run folder. */
  screenshot?: string;
  diagnostics?: string;
}
