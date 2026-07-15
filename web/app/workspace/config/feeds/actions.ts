'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  createFeed,
  setFeedActive,
  updateFeed,
  WorkspaceFeedWriteError,
  type FeedTrustLevel,
} from '../../../../../src/workspace/workspace-feed-writes';
import { getDb } from '../../../../lib/db';
import { requireAnalyst } from '../../../../lib/require-analyst';

const FEEDS_PATH = '/workspace/config/feeds';

async function gateAnalyst() {
  const gate = await requireAnalyst();
  if (!gate.ok) {
    redirect(
      gate.reason === 'unauthenticated' ? `/login?callbackUrl=${FEEDS_PATH}` : '/auth/denied'
    );
  }
}

function requiredString(formData: FormData, name: string): string {
  return String(formData.get(name) ?? '').trim();
}

function redirectWriteError(error: unknown, feedId: string): never {
  if (error instanceof WorkspaceFeedWriteError) {
    const params = new URLSearchParams({ error: error.code, feed: feedId });
    redirect(`${FEEDS_PATH}?${params.toString()}`);
  }
  throw error;
}

function revalidateConfig() {
  revalidatePath('/workspace/config');
  revalidatePath(FEEDS_PATH);
}

export async function createFeedAction(formData: FormData) {
  await gateAnalyst();
  try {
    await createFeed(getDb(), {
      sourceName: requiredString(formData, 'sourceName'),
      feedUrl: requiredString(formData, 'feedUrl'),
      trustLevel: requiredString(formData, 'trustLevel') as FeedTrustLevel,
      isActive: formData.get('isActive') === 'true',
    });
  } catch (error) {
    redirectWriteError(error, 'new');
  }

  revalidateConfig();
  redirect(`${FEEDS_PATH}?created=1`);
}

export async function updateFeedAction(formData: FormData) {
  await gateAnalyst();
  const feedId = requiredString(formData, 'feedId');
  try {
    await updateFeed(getDb(), feedId, {
      sourceName: requiredString(formData, 'sourceName'),
      feedUrl: requiredString(formData, 'feedUrl'),
      trustLevel: requiredString(formData, 'trustLevel') as FeedTrustLevel,
    });
  } catch (error) {
    redirectWriteError(error, feedId || 'unknown');
  }

  revalidateConfig();
  redirect(`${FEEDS_PATH}?updated=1`);
}

export async function setFeedActiveAction(formData: FormData) {
  await gateAnalyst();
  const feedId = requiredString(formData, 'feedId');
  const isActive = formData.get('isActive') === 'true';
  try {
    await setFeedActive(getDb(), feedId, isActive);
  } catch (error) {
    redirectWriteError(error, feedId || 'unknown');
  }

  revalidateConfig();
  redirect(`${FEEDS_PATH}?${isActive ? 'activated' : 'deactivated'}=1`);
}
