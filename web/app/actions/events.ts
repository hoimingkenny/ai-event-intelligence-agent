'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  approveEvent,
  attachArticleToEvent,
  createEventFromArticles,
  detachArticleFromEvent,
  moveArticleBetweenEvents,
  unpublishEvent,
  updateEventFields,
} from '../../../src/events/event-editorial';
import { getDb } from '../../lib/db';
import { requireAnalyst } from '../../lib/require-analyst';

function parseList(value: FormDataEntryValue | null): string[] {
  if (typeof value !== 'string' || !value.trim()) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function emptyToNull(value: FormDataEntryValue | null): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function articleIdsFromForm(formData: FormData): string[] {
  return formData
    .getAll('articleIds')
    .map((value) => String(value).trim())
    .filter(Boolean);
}

function revalidateCatalogue(eventId?: string) {
  revalidatePath('/workspace');
  revalidatePath('/workspace/new');
  revalidatePath('/events');
  revalidatePath('/articles');
  if (eventId) {
    revalidatePath(`/workspace/events/${eventId}`);
    revalidatePath(`/events/${eventId}`);
  }
}

async function gateAnalyst() {
  const gate = await requireAnalyst();
  if (!gate.ok) {
    redirect(gate.reason === 'unauthenticated' ? '/login?callbackUrl=/workspace' : '/auth/denied');
  }
}

export async function saveEventFieldsAction(formData: FormData) {
  await gateAnalyst();
  const eventId = String(formData.get('eventId') ?? '');
  if (!eventId) {
    throw new Error('eventId is required');
  }

  await updateEventFields(getDb(), eventId, {
    eventTitle: String(formData.get('eventTitle') ?? '').trim() || 'Untitled event',
    eventSummary: emptyToNull(formData.get('eventSummary')),
    severity: emptyToNull(formData.get('severity')),
    urgency: emptyToNull(formData.get('urgency')),
    affectedVendors: parseList(formData.get('affectedVendors')),
    affectedProducts: parseList(formData.get('affectedProducts')),
    cves: parseList(formData.get('cves')),
    attackTypes: parseList(formData.get('attackTypes')),
  });

  revalidateCatalogue(eventId);
  redirect(`/workspace/events/${eventId}?saved=1`);
}

export async function approveEventAction(formData: FormData) {
  await gateAnalyst();
  const eventId = String(formData.get('eventId') ?? '');
  if (!eventId) {
    throw new Error('eventId is required');
  }

  await approveEvent(getDb(), eventId);
  revalidateCatalogue(eventId);
  redirect(`/workspace/events/${eventId}?approved=1`);
}

export async function unpublishEventAction(formData: FormData) {
  await gateAnalyst();
  const eventId = String(formData.get('eventId') ?? '');
  if (!eventId) {
    throw new Error('eventId is required');
  }

  await unpublishEvent(getDb(), eventId);
  revalidateCatalogue(eventId);
  redirect(`/workspace/events/${eventId}?unpublished=1`);
}

export async function createEventFromArticlesAction(formData: FormData) {
  await gateAnalyst();
  const articleIds = articleIdsFromForm(formData);
  const event = await createEventFromArticles(getDb(), {
    articleIds,
    eventTitle: emptyToNull(formData.get('eventTitle')) ?? undefined,
    eventSummary: emptyToNull(formData.get('eventSummary')),
  });

  revalidateCatalogue(event.id);
  redirect(`/workspace/events/${event.id}?created=1`);
}

export async function attachArticleAction(formData: FormData) {
  await gateAnalyst();
  const eventId = String(formData.get('eventId') ?? '');
  const articleId = String(formData.get('articleId') ?? '').trim();
  if (!eventId || !articleId) {
    throw new Error('eventId and articleId are required');
  }

  await attachArticleToEvent(getDb(), eventId, articleId);
  revalidateCatalogue(eventId);
  redirect(`/workspace/events/${eventId}?attached=1`);
}

export async function detachArticleAction(formData: FormData) {
  await gateAnalyst();
  const eventId = String(formData.get('eventId') ?? '');
  const articleId = String(formData.get('articleId') ?? '').trim();
  if (!eventId || !articleId) {
    throw new Error('eventId and articleId are required');
  }

  await detachArticleFromEvent(getDb(), eventId, articleId);
  revalidateCatalogue(eventId);
  redirect(`/workspace/events/${eventId}?detached=1`);
}

export async function moveArticleAction(formData: FormData) {
  await gateAnalyst();
  const fromEventId = String(formData.get('fromEventId') ?? '');
  const toEventId = String(formData.get('toEventId') ?? '').trim();
  const articleId = String(formData.get('articleId') ?? '').trim();
  if (!fromEventId || !toEventId || !articleId) {
    throw new Error('fromEventId, toEventId, and articleId are required');
  }

  await moveArticleBetweenEvents(getDb(), { articleId, fromEventId, toEventId });
  revalidateCatalogue(fromEventId);
  revalidateCatalogue(toEventId);
  redirect(`/workspace/events/${toEventId}?moved=1`);
}
