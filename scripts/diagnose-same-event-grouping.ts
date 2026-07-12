/**
 * Tight feedback loop for: "same-event articles split into separate events".
 *
 * Loads the SailPoint cluster from manual-articles.jsonl, embeds title+rssSummary,
 * then simulates the event-grouping ladder with event vectors copied from the
 * creating article vector (ADR-0001).
 *
 * Exit 0 = one event (green). Exit 2 = split (red).
 *
 *   npx tsx scripts/diagnose-same-event-grouping.ts
 */
import { join } from 'node:path';
import { embed } from '../src/config/embeddings.js';
import { env } from '../src/config/env.js';
import { buildArticleEmbeddingText } from '../src/embedding/embedding-client.js';
import {
  decideEventGrouping,
  EMBEDDING_ATTACH_DISTANCE,
  EMBEDDING_UNCERTAIN_DISTANCE,
  type SimilarEvent,
} from '../src/events/grouping-decision.js';
import { loadManualArticles } from '../eval/utils/manualArticles.js';

const CLUSTER_URLS = [
  'https://www.securityweek.com/sailpoint-discloses-github-repository-hack/',
  'https://www.scworld.com/news/sailpoint-github-repo-hit-by-third-party-cyberattack',
  'https://securityaffairs.com/191997/data-breach/identity-security-firm-sailpoint-discloses-github-repository-breach.html',
] as const;

function cosineDistance(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  if (denom === 0) return 1;
  return 1 - dot / denom;
}

async function main(): Promise<void> {
  const path = join(process.cwd(), 'eval/datasets/manual-articles.jsonl');
  const all = await loadManualArticles(path);
  const articles = CLUSTER_URLS.map((url) => {
    const hit = all.find((article) => article.url === url);
    if (!hit) throw new Error(`Missing manual article for ${url}`);
    return hit;
  });

  console.log(
    JSON.stringify(
      {
        provider: env.embeddingProvider,
        dimensions: env.embeddingDimensions,
        eventVectorMode: 'copy_creating_article_vector',
        attachThreshold: EMBEDDING_ATTACH_DISTANCE,
        uncertainThreshold: EMBEDDING_UNCERTAIN_DISTANCE,
        articles: articles.map((a) => ({ source: a.sourceName, title: a.title })),
      },
      null,
      2
    )
  );

  const articleTexts = articles.map((article) =>
    buildArticleEmbeddingText({ title: article.title, rssSummary: article.rssSummary })
  );
  const articleVectors = await embed(articleTexts, 'db');

  type OpenEvent = {
    id: string;
    title: string;
    summary: string;
    vector: number[];
    memberTitles: string[];
  };

  const openEvents: OpenEvent[] = [];
  const decisions: Array<Record<string, unknown>> = [];

  for (let i = 0; i < articles.length; i += 1) {
    const article = articles[i]!;
    const articleVector = articleVectors[i]!;

    const similarEvents: SimilarEvent[] = openEvents
      .map((event) => ({
        id: event.id,
        groupingKey: 'unknown',
        eventTitle: event.title,
        eventSummary: event.summary,
        eventStatus: 'open' as const,
        severity: 'medium' as const,
        urgency: 'P3' as const,
        confidence: 0.5,
        affectedVendors: [],
        affectedProducts: [],
        cves: [],
        attackTypes: [],
        distance: cosineDistance(articleVector, event.vector),
      }))
      .sort((a, b) => a.distance - b.distance);

    const decision = decideEventGrouping({
      groupingKey: 'unknown',
      keyMatch: null,
      similarEvents,
    });

    if (decision.kind === 'attach') {
      const event = openEvents.find((item) => item.id === decision.event.id)!;
      event.memberTitles.push(article.title);
      decisions.push({
        title: article.title,
        kind: 'attach',
        method: decision.method,
        distance: similarEvents[0]?.distance ?? null,
        eventId: event.id,
      });
      continue;
    }

    if (decision.kind === 'uncertain') {
      decisions.push({
        title: article.title,
        kind: 'uncertain_treated_as_create',
        distance: decision.candidate.distance,
        nearestEventId: decision.candidate.id,
      });
    } else {
      decisions.push({
        title: article.title,
        kind: 'create',
        method: decision.method,
        nearestDistance: similarEvents[0]?.distance ?? null,
      });
    }

    openEvents.push({
      id: `event-${openEvents.length + 1}`,
      title: article.title,
      summary: (article.rssSummary ?? article.title).slice(0, 500),
      vector: articleVector,
      memberTitles: [article.title],
    });
  }

  const eventCount = openEvents.length;
  const report = {
    eventCount,
    expectedEventCount: 1,
    decisions,
    events: openEvents.map((event) => ({
      id: event.id,
      members: event.memberTitles,
    })),
  };
  console.log(JSON.stringify(report, null, 2));

  if (eventCount !== 1) {
    console.error(
      `\nRED: same-event cluster split into ${eventCount} events (expected 1).`
    );
    process.exit(2);
  }

  console.error('\nGREEN: cluster collapsed to 1 event.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
