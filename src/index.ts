import pino from 'pino';
import { runThreatWatchGraph } from './graph.js';

const logger = pino({
  transport: {
    target: 'pino-pretty',
  },
});

const userRequest = process.argv.slice(2).join(' ') || 'Find latest cyber attack news of today';
const report = await runThreatWatchGraph(userRequest);

logger.info({ report }, 'Cyber early-warning report generated');

console.log('\n=== Analyst Triage Report ===\n');
console.log(`Request: ${report.request}`);
console.log(`Generated at: ${report.generatedAt}`);
console.log(`Articles collected: ${report.articlesCollected}`);
console.log(`Events: ${report.events.length}\n`);

for (const event of report.events) {
  console.log(`[${event.severity.toUpperCase()}] ${event.canonicalTitle}`);
  console.log(`Type: ${event.eventType}`);
  console.log(`Vendors: ${event.vendors.join(', ') || 'Unknown'}`);
  console.log(`Products: ${event.products.join(', ') || 'Unknown'}`);
  console.log(`Confidence: ${event.confidence}`);
  console.log(`Summary: ${event.summary}`);
  console.log('Recommended actions:');
  for (const action of event.recommendedActions) console.log(`- ${action}`);
  console.log('');
}
