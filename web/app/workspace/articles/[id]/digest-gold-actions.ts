'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { listActiveMonitoredInventory } from '../../../../../src/db/monitored-inventory';
import { DIGEST_GOLD_CLEAN_TEXT_SLICE } from '../../../../../src/evaluation/digest/digest-gold-types';
import { proposeDigestGoldAssist } from '../../../../../src/evaluation/digest/digest-label-assist';
import {
  DigestGoldWriteFailedError,
  type DigestGoldWriteError,
  upsertDigestGold,
} from '../../../../../src/workspace/workspace-digest-gold-writes';
import { getDb } from '../../../../lib/db';
import { requireAnalyst } from '../../../../lib/require-analyst';

function parseBoolean(value: FormDataEntryValue | null): boolean {
  return value === 'true' || value === 'on' || value === '1';
}

function parseList(value: FormDataEntryValue | null): string[] {
  if (typeof value !== 'string' || !value.trim()) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseCves(value: FormDataEntryValue | null): string[] {
  if (typeof value !== 'string' || !value.trim()) return [];
  return value
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

async function gateAnalyst(articleId: string) {
  const gate = await requireAnalyst();
  if (!gate.ok) {
    redirect(
      gate.reason === 'unauthenticated'
        ? `/login?callbackUrl=${encodeURIComponent(`/workspace/articles/${articleId}`)}`
        : '/auth/denied'
    );
  }
  return gate;
}

function redirectWithDigestGoldStatus(
  articleId: string,
  params: { saved?: boolean; error?: DigestGoldWriteError; assistError?: string }
) {
  const search = new URLSearchParams();
  if (params.saved) search.set('gold_saved', '1');
  if (params.error) search.set('gold_error', params.error);
  if (params.assistError) search.set('assist_error', params.assistError);
  const suffix = search.toString();
  redirect(`/workspace/articles/${articleId}${suffix ? `?${suffix}` : ''}`);
}

export async function saveDigestGoldAction(formData: FormData) {
  const articleId = String(formData.get('articleId') ?? '').trim();
  if (!articleId) {
    redirect('/workspace/eval/digest?error=missing_article');
  }

  const gate = await gateAnalyst(articleId);

  try {
    await upsertDigestGold(
      {
        articleId,
        relatedToMonitoredInventory: parseBoolean(formData.get('relatedToMonitoredInventory')),
        matchedVendors: parseList(formData.get('matchedVendors')),
        matchedProducts: parseList(formData.get('matchedProducts')),
        cves: parseCves(formData.get('cves')),
        humanReason: String(formData.get('humanReason') ?? '').trim() || null,
        labeledBy: gate.session.user.githubLogin ?? gate.session.user.name ?? null,
      },
      getDb()
    );
  } catch (error) {
    if (error instanceof DigestGoldWriteFailedError) {
      redirectWithDigestGoldStatus(articleId, { error: error.code });
    }
    throw error;
  }

  revalidatePath(`/workspace/articles/${articleId}`);
  revalidatePath('/workspace/eval/digest');
  redirectWithDigestGoldStatus(articleId, { saved: true });
}

export type DigestGoldAssistActionResult =
  | {
      relatedToMonitoredInventory: boolean;
      matchedVendors: string[];
      matchedProducts: string[];
      cves: string[];
      reasoning: string;
    }
  | { error: string };

export async function proposeDigestGoldAssistAction(
  articleId: string
): Promise<DigestGoldAssistActionResult> {
  await gateAnalyst(articleId);

  const db = getDb();
  const articleResult = await db.query<{
    title: string | null;
    source_name: string | null;
    rss_summary: string | null;
    clean_text: string | null;
    llm_article_digest: unknown;
    processing_status: string;
  }>(
    `
      SELECT title, source_name, rss_summary, clean_text, llm_article_digest, processing_status
      FROM articles
      WHERE id = $1
    `,
    [articleId]
  );
  const article = articleResult.rows[0];
  if (!article) {
    return { error: 'Article not found.' };
  }

  const eligible =
    article.processing_status === 'DIGESTED' || article.llm_article_digest != null;
  if (!eligible) {
    return { error: 'Article must be DIGESTED or have an LLM digest before assist.' };
  }

  const inventory = await listActiveMonitoredInventory(db);
  const clean = article.clean_text?.trim() ? article.clean_text : null;

  try {
    const draft = await proposeDigestGoldAssist({
      article: {
        title: article.title,
        sourceName: article.source_name,
        rssSummary: article.rss_summary,
        cleanText: clean ? clean.slice(0, DIGEST_GOLD_CLEAN_TEXT_SLICE) : null,
      },
      inventory,
      storedDigest: article.llm_article_digest,
    });
    return draft;
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Assist failed.',
    };
  }
}
