'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { ArticleNotIgnorableError, requeueArticleForFilter } from '../../../../../src/workspace/article-requeue';
import { getDb } from '../../../../lib/db';
import { requireAnalyst } from '../../../../lib/require-analyst';

export async function requeueArticleForFilterAction(formData: FormData) {
  const gate = await requireAnalyst();
  if (!gate.ok) {
    redirect(gate.reason === 'unauthenticated' ? '/login' : '/auth/denied');
  }

  const articleId = String(formData.get('articleId') ?? '').trim();
  if (!articleId) {
    redirect('/workspace?error=missing_article_id');
  }

  try {
    await requeueArticleForFilter(getDb(), articleId);
  } catch (error) {
    if (error instanceof ArticleNotIgnorableError) {
      const params = new URLSearchParams({ error: 'article_not_ignorable', article: articleId });
      redirect(`/workspace/articles/${articleId}?${params.toString()}`);
    }
    throw error;
  }

  revalidatePath(`/workspace/articles/${articleId}`);
  revalidatePath('/workspace');
  redirect(`/workspace/articles/${articleId}?requeued=1`);
}