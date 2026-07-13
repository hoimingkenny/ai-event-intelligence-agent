import { EventRepository, type EventRecord } from '../db/repositories/event.repository.js';
import type { Queryable } from '../db/repositories/types.js';

export type PublicationStatus = 'draft' | 'approved';

export interface EventFieldsInput {
  eventTitle: string;
  eventSummary: string | null;
  severity: string | null;
  urgency: string | null;
  affectedVendors: string[];
  affectedProducts: string[];
  cves: string[];
  attackTypes: string[];
}

export interface WorkspaceEventListItem extends EventRecord {
  sourceCount: number;
  lastSeenAt: Date | null;
}

/**
 * Analyst editorial seam for publication status and event field edits (ADR-0002).
 * Does not gate alerts.
 */
export async function approveEvent(db: Queryable, eventId: string): Promise<EventRecord> {
  return new EventRepository(db).setPublicationStatus(eventId, 'approved');
}

export async function unpublishEvent(db: Queryable, eventId: string): Promise<EventRecord> {
  return new EventRepository(db).setPublicationStatus(eventId, 'draft');
}

export async function updateEventFields(
  db: Queryable,
  eventId: string,
  fields: EventFieldsInput
): Promise<EventRecord> {
  return new EventRepository(db).updateEventFields(eventId, fields);
}

export async function listWorkspaceEvents(
  db: Queryable,
  options: { limit?: number } = {}
): Promise<WorkspaceEventListItem[]> {
  return new EventRepository(db).listForWorkspace(options.limit ?? 100);
}

export async function getWorkspaceEvent(db: Queryable, eventId: string): Promise<EventRecord | null> {
  return new EventRepository(db).findById(eventId);
}
