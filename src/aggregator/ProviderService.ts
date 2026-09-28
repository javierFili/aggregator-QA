import type { Provider } from '../types/Provider.js';
import type { AggregatorClient } from './AggregatorClient.js';

export const OP_GET_PROVIDERS = 1070;

export function parseProviders(message: unknown): Provider[] {
  const list = Array.isArray(message)
    ? message
    : message && typeof message === 'object' && Array.isArray((message as { providers?: unknown }).providers)
      ? (message as { providers: unknown[] }).providers
      : null;
  if (!list) throw new Error('Respuesta 1070 inválida: se esperaba una lista de proveedores');

  const providers: Provider[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const code = typeof r.code === 'string' ? r.code.trim() : '';
    if (!code) continue;
    const provider: Provider = {
      id: Number(r.id ?? 0) || 0,
      code,
      name: typeof r.name === 'string' && r.name.trim() ? r.name.trim() : code,
    };
    if (typeof r.image === 'string') provider.image = r.image;
    providers.push(provider);
  }
  return providers;
}

export class ProviderService {
  constructor(private readonly client: AggregatorClient) {}

  async getProviders(): Promise<Provider[]> {
    return parseProviders(await this.client.call<unknown>({ opType: OP_GET_PROVIDERS }));
  }
}
