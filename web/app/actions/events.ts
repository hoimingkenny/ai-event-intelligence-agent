'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  approveEvent,
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

  revalidatePath('/workspace');
  revalidatePath(`/workspace/events/${eventId}`);
  revalidatePath('/events');
  revalidatePath(`/events/${eventId}`);
  revalidatePath('/articles');
  redirect(`/workspace/events/${eventId}?saved=1`);
}

export async function approveEventAction(formData: FormData) {
  await gateAnalyst();
  const eventId = String(formData.get('eventId') ?? '');
  if (!eventId) {
    throw new Error('eventId is required');
  }

  await approveEvent(getDb(), eventId);
  revalidatePath('/workspace');
  revalidatePath(`/workspace/events/${eventId}`);
  revalidatePath('/events');
  revalidatePath(`/events/${eventId}`);
  revalidatePath('/articles');
  redirect(`/workspace/events/${eventId}?approved=1`);
}

export async function unpublishEventAction(formData: FormData) {
  await gateAnalyst();
  const eventId = String(formData.get('eventId') ?? '');
  if (!eventId) {
    throw new Error('eventId is required');
  }

  await unpublishEvent(getDb(), eventId);
  revalidatePath('/workspace');
  revalidatePath(`/workspace/events/${eventId}`);
  revalidatePath('/events');
  revalidatePath(`/events/${eventId}`);
  revalidatePath('/articles');
  redirect(`/workspace/events/${eventId}?unpublished=1`);
}
