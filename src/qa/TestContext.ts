import type { AggregatorClient } from '../aggregator/AggregatorClient.js';
import type { PlayerProvisioner } from '../aggregator/PlayerProvisioner.js';
import type { GameBrowser } from '../browser/GameBrowser.js';
import type { Logger } from '../util/logger.js';
import type { DetectorRegistry } from './detectors/DetectorRegistry.js';
import type { EvidenceWriter } from './EvidenceWriter.js';
import type { LaunchChainFollower } from './launch/LaunchChainFollower.js';
import type { QaRunConfig } from './QaConfig.js';

/** Shared, run-scoped dependencies handed to every game test. */
export interface RunServices {
  config: QaRunConfig;
  client: AggregatorClient;
  players: PlayerProvisioner;
  follower: LaunchChainFollower;
  /** Undefined when browser checks are disabled. */
  browser?: GameBrowser;
  detectors: DetectorRegistry;
  evidence: EvidenceWriter;
  timeouts: { browserMs: number; settleMs: number };
  /** Headers only for the aggregator's own hosts (WAF allow rule). */
  hostHeaders?: { hosts: string[]; headers: Record<string, string> };
  log: Logger;
}

export type ProgressStep = 'session' | 'http-launch' | 'browser' | 'currency' | 'limits' | 'evidence';
export type StepListener = (step: ProgressStep, currency: string) => void;
