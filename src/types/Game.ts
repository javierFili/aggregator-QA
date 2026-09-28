export interface Game {
  id: number;
  name: string;
  provider: string;
  media?: string;
  device: string[];
  /** ISO currency codes declared by opType 1071, upper-cased and de-duplicated. */
  currencies: string[];
  /** True when `currencies` was built by asking 1071 per currency, so an empty list really means "none". */
  currencyAvailabilityKnown?: boolean;
}
