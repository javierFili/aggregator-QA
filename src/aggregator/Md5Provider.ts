import { createHash } from 'node:crypto';

export const md5 = (value: string): string => createHash('md5').update(value, 'utf8').digest('hex');

/**
 * Produces the `md5` field of opType 1050. In the aggregator (LocalBusiness / FeedhBusiness) this value is the
 * player's stored password: players registered through 1053 are saved with `md5(password)`, so login must send
 * exactly `md5(password)`. Kept behind an interface so another rule can be plugged in if a partner needs it.
 */
export interface Md5Provider {
  generate(password: string): string;
}

export class PasswordMd5Provider implements Md5Provider {
  generate(password: string): string {
    return md5(password);
  }
}

/**
 * Deterministic password for an automatic QA player: derived from the partner API key and the username, so the same
 * player can log in again in later runs without storing anything. Never logged (registered with the redactor).
 */
export function derivePassword(apiKey: string, username: string): string {
  return createHash('sha256').update(`qa-runner:${apiKey}:${username}`, 'utf8').digest('hex').slice(0, 24);
}
