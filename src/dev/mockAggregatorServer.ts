import { createMockAggregator, MOCK_API_KEY } from './mockAggregator.js';

/** `npm run mock:aggregator` — starts the fake aggregator on 127.0.0.1:4000 for manual demos. */
const port = Number(process.env.MOCK_PORT ?? 4000);
createMockAggregator(process.env.MOCK_DRIVER === 'local' ? { driver: 'local', currencyViaParameter: true } : {}).listen(port, '127.0.0.1', () => {
  console.log(`Mock aggregator on http://127.0.0.1:${port}  ·  partner: alpha-test  ·  Api-Key: ${MOCK_API_KEY}`);
  console.log('Games: 4182 Crazy Time (works), 4170 XXXTreme Lightning Roulette (HTTP 200 + JSON error), 4200 Blank Slot (renders nothing)');
});
