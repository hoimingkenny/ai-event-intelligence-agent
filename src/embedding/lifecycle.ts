import { currentEmbeddingProvenance } from '../config/embeddings.js';
import { env } from '../config/env.js';
import { ArticleRepository } from '../db/repositories/article.repository.js';
import { EventRepository } from '../db/repositories/event.repository.js';
import type { Queryable } from '../db/repositories/types.js';
import {
  buildArticleEmbeddingText,
  MiniMaxEmbeddingClient,
  type EmbeddingClient,
} from './embedding-client.js';

export interface EmbeddingLifecycleResult {
  reviewed: number;
  embedded: number;
  skipped: number;
  failed: number;
}

export interface EmbeddingLifecycle {
  embedArticles(options?: {
    limit?: number;
    client?: EmbeddingClient;
    minTextLength?: number;
    batchSize?: number;
  }): Promise<EmbeddingLifecycleResult>;
  copyArticleEmbeddingToEvent(eventId: string, articleId: string): Promise<void>;
  sweepMissingEventEmbeddings(options?: { limit?: number }): Promise<EmbeddingLifecycleResult>;
  reembedForModelChange(): Promise<{ articlesRewound: number; eventsCleared: number }>;
}

export function createEmbeddingLifecycle(db: Queryable): EmbeddingLifecycle {
  const articles = new ArticleRepository(db);
  const events = new EventRepository(db);
  const provenance = () => currentEmbeddingProvenance();
  const maxRetries = Math.max(1, env.embeddingMaxRetries);

  return {
    async embedArticles(options = {}) {
      const candidates = await articles.listByProcessingStatuses(
        ['ENTITY_EXTRACTED', 'EMBEDDING_PENDING'],
        options.limit ?? 20
      );
      const client = options.client ?? new MiniMaxEmbeddingClient();
      const minTextLength = options.minTextLength ?? 100;
      const batchSize = Math.max(1, options.batchSize ?? env.embeddingBatchSize);
      let embedded = 0;
      let skipped = 0;
      let failed = 0;
      const eligible: Array<{ id: string; text: string }> = [];

      for (const article of candidates) {
        const text = buildArticleEmbeddingText(article);
        if (text.length < minTextLength) {
          await articles.updateProcessingStatus(article.id, 'IGNORED', 'embedding_text_too_short');
          skipped += 1;
          continue;
        }
        eligible.push({ id: article.id, text });
      }

      for (const batch of chunk(eligible, batchSize)) {
        let vectors: number[][];
        try {
          vectors = await client.embedDocuments(batch.map((item) => item.text));
          if (vectors.length !== batch.length) {
            throw new Error(
              `Embedding response count mismatch: expected ${batch.length}, got ${vectors.length}`
            );
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          for (const item of batch) {
            await articles.recordEmbeddingFailure(item.id, message, maxRetries);
            failed += 1;
          }
          continue;
        }

        for (const [index, item] of batch.entries()) {
          const vector = vectors[index];
          try {
            if (!vector) {
              throw new Error(`Embedding response missing vector at index ${index}`);
            }
            await articles.saveEmbedding(item.id, vector, provenance());
            embedded += 1;
          } catch (error) {
            await articles.recordEmbeddingFailure(
              item.id,
              error instanceof Error ? error.message : String(error),
              maxRetries
            );
            failed += 1;
          }
        }
      }

      return { reviewed: candidates.length, embedded, skipped, failed };
    },

    async copyArticleEmbeddingToEvent(eventId, articleId) {
      const { model, dims } = provenance();
      const vector = await articles.getEligibleEmbedding(articleId, model, dims);
      if (!vector) {
        throw new Error(
          `Article ${articleId} has no current-model embedding to copy to event ${eventId}`
        );
      }
      await events.saveEventEmbedding(eventId, vector, { model, dims });
    },

    async sweepMissingEventEmbeddings(options = {}) {
      const candidates = await events.listEventsMissingEmbedding(options.limit ?? 20, maxRetries);
      let embedded = 0;
      let skipped = 0;
      let failed = 0;
      const { model, dims } = provenance();

      for (const event of candidates) {
        const members = await events.listArticlesForEvent(event.id);
        const primary =
          members.find((article) =>
            ['EMBEDDED', 'GROUPED', 'CLASSIFIED'].includes(article.processingStatus)
          ) ?? members[0];
        if (!primary) {
          await events.recordEventEmbeddingFailure(event.id, 'no_member_article');
          skipped += 1;
          continue;
        }
        try {
          const vector = await articles.getEligibleEmbedding(primary.id, model, dims);
          if (!vector) {
            throw new Error(`primary article ${primary.id} has no current-model embedding`);
          }
          await events.saveEventEmbedding(event.id, vector, { model, dims });
          embedded += 1;
        } catch (error) {
          await events.recordEventEmbeddingFailure(
            event.id,
            error instanceof Error ? error.message : String(error)
          );
          failed += 1;
        }
      }

      return { reviewed: candidates.length, embedded, skipped, failed };
    },

    async reembedForModelChange() {
      const articleResult = await db.query(
        `
          UPDATE articles
          SET embedding = NULL,
            embedding_model = NULL,
            embedding_dims = NULL,
            embedded_at = NULL,
            retry_count = 0,
            processing_error = NULL,
            processing_status = CASE
              WHEN processing_status IN ('EMBEDDED', 'GROUPED', 'CLASSIFIED') THEN 'ENTITY_EXTRACTED'
              ELSE processing_status
            END,
            updated_at = now()
          WHERE embedding IS NOT NULL
            AND (embedding_model IS DISTINCT FROM $1 OR embedding_dims IS DISTINCT FROM $2)
        `,
        [provenance().model, provenance().dims]
      );
      const eventResult = await db.query(
        `
          UPDATE cyber_events
          SET event_embedding = NULL,
            event_embedding_model = NULL,
            event_embedding_dims = NULL,
            event_embedded_at = NULL,
            event_embedding_retry_count = 0,
            event_embedding_error = NULL,
            updated_at = now()
          WHERE event_embedding IS NOT NULL
            AND (event_embedding_model IS DISTINCT FROM $1 OR event_embedding_dims IS DISTINCT FROM $2)
        `,
        [provenance().model, provenance().dims]
      );
      return {
        articlesRewound: articleResult.rowCount ?? 0,
        eventsCleared: eventResult.rowCount ?? 0,
      };
    },
  };
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}
