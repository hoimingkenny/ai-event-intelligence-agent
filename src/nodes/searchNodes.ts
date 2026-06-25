import { buildSearchQueries } from '../agents/searchPlannerAgent.js';
import { runCyberWebSearch } from '../tools/searchTool.js';
import { store } from '../storage/inMemoryStore.js';
import type { RawArticle } from '../types/domain.js';

export async function searchNode(userRequest: string): Promise<RawArticle[]> {
  const queries = await buildSearchQueries(userRequest);
  const results = (await Promise.all(queries.map((q) => runCyberWebSearch(q)))).flat();

  for (const article of results) {
    store.saveArticle(article);
  }

  return results;
}
