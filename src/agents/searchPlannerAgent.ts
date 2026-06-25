import { z } from 'zod';
import { monitoredVendors } from '../storage/vendorInventory.js';
import { callLLMWithSchema } from './llmHelpers.js';

const queriesSchema = z.object({
  queries: z.array(z.string().min(3)).min(1).max(20),
});

function deterministicQueries(userRequest: string): string[] {
  const baseTerms = [
    'cyber attack today',
    'active exploitation today',
    'zero day exploited today',
    'ransomware attack today',
    'data breach today',
    'vendor security advisory today',
  ];

  const vendorTerms = monitoredVendors.flatMap((item) => [
    `${item.vendor} exploit today`,
    `${item.vendor} breach today`,
    `${item.product} vulnerability exploited today`,
    `${item.product} security advisory today`,
  ]);

  if (/latest|today|urgent|attack/i.test(userRequest)) {
    return [...baseTerms, ...vendorTerms];
  }
  return vendorTerms;
}

export async function buildSearchQueries(userRequest: string): Promise<string[]> {
  const vendorList = monitoredVendors
    .map((v) => `${v.vendor} ${v.product}`)
    .join(', ');

  const systemPrompt = `You are a cyber-threat-intelligence search planner. Given a user request and a list of monitored vendors/products, generate a focused set of time-sensitive web search queries. Prefer queries that include "today" or "this week" to bias toward fresh signals. Return JSON: { "queries": string[] }.`;
  const userPrompt = `User request: ${userRequest}\n\nMonitored vendors/products: ${vendorList}\n\nGenerate 5-15 search queries.`;

  try {
    const { queries } = await callLLMWithSchema(systemPrompt, userPrompt, queriesSchema);
    return queries;
  } catch {
    return deterministicQueries(userRequest);
  }
}
