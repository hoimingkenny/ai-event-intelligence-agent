import { searchNode } from './nodes/searchNodes.js';
import { triageArticle } from './nodes/triageNodes.js';

/**
 * This is intentionally kept as a simple orchestrator for the scaffold.
 * Replace this with a formal LangGraph StateGraph once your package versions are fixed internally.
 */
export async function runThreatWatchGraph(userRequest: string) {
  const articles = await searchNode(userRequest);
  const events = [];

  for (const article of articles) {
    const event = await triageArticle(article);
    if (event) events.push(event);
  }

  return {
    request: userRequest,
    generatedAt: new Date().toISOString(),
    articlesCollected: articles.length,
    events,
  };
}
