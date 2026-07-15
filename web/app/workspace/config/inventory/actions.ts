'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  InventoryWriteFailedError,
  createProduct,
  setProductActive,
  updateProduct,
  type InventoryWriteError,
} from '../../../../../src/workspace/workspace-inventory-writes';
import type { Criticality } from '../../../../../src/db/repositories/vendor.repository';
import { getDb } from '../../../../lib/db';
import { requireAnalyst } from '../../../../lib/require-analyst';

const CRITICALITIES = ['critical', 'high', 'medium', 'low'] as const;
const NEWS_VOLUMES = ['quiet', 'noisy'] as const;

async function gateAnalyst() {
  const gate = await requireAnalyst();
  if (!gate.ok) {
    redirect(gate.reason === 'unauthenticated' ? '/login?callbackUrl=/workspace/config/inventory' : '/auth/denied');
  }
}

function parseCriticality(value: FormDataEntryValue | null): Criticality {
  const candidate = typeof value === 'string' ? value.trim() : '';
  if ((CRITICALITIES as readonly string[]).includes(candidate)) {
    return candidate as Criticality;
  }
  throw new InventoryWriteFailedError('invalid_criticality');
}

function parseNewsVolume(value: FormDataEntryValue | null): 'quiet' | 'noisy' {
  const candidate = typeof value === 'string' ? value.trim() : '';
  if ((NEWS_VOLUMES as readonly string[]).includes(candidate)) {
    return candidate as 'quiet' | 'noisy';
  }
  throw new InventoryWriteFailedError('invalid_news_volume');
}

function parseAliases(value: FormDataEntryValue | null): string[] {
  if (typeof value !== 'string' || !value.trim()) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseBoolean(value: FormDataEntryValue | null, fallback: boolean): boolean {
  if (typeof value !== 'string') return fallback;
  return value === 'true' || value === 'on' || value === '1';
}

function redirectWithStatus(status: 'saved' | 'created' | 'deactivated' | 'reactivated', error?: InventoryWriteError) {
  const params = new URLSearchParams();
  params.set('status', status);
  if (error) params.set('error', error);
  redirect(`/workspace/config/inventory?${params.toString()}`);
}

export async function createProductAction(formData: FormData) {
  await gateAnalyst();
  try {
    await createProduct(
      {
        vendor: String(formData.get('vendor') ?? ''),
        product: String(formData.get('product') ?? ''),
        aliases: parseAliases(formData.get('aliases')),
        criticality: parseCriticality(formData.get('criticality')),
        newsVolume: parseNewsVolume(formData.get('newsVolume')),
        isActive: parseBoolean(formData.get('isActive'), true),
      },
      getDb()
    );
  } catch (error) {
    if (error instanceof InventoryWriteFailedError) {
      redirectWithStatus('created', error.code);
    }
    throw error;
  }
  revalidatePath('/workspace/config');
  revalidatePath('/workspace/config/inventory');
  redirectWithStatus('created');
}

export async function updateProductAction(formData: FormData) {
  await gateAnalyst();
  const productId = String(formData.get('productId') ?? '').trim();
  if (!productId) {
    throw new Error('productId is required');
  }
  try {
    await updateProduct(
      {
        productId,
        productName: String(formData.get('product') ?? ''),
        aliases: parseAliases(formData.get('aliases')),
        criticality: parseCriticality(formData.get('criticality')),
        newsVolume: parseNewsVolume(formData.get('newsVolume')),
      },
      getDb()
    );
  } catch (error) {
    if (error instanceof InventoryWriteFailedError) {
      redirectWithStatus('saved', error.code);
    }
    throw error;
  }
  revalidatePath('/workspace/config');
  revalidatePath('/workspace/config/inventory');
  redirectWithStatus('saved');
}

export async function setProductActiveAction(formData: FormData) {
  await gateAnalyst();
  const productId = String(formData.get('productId') ?? '').trim();
  const intent = String(formData.get('intent') ?? '').trim();
  if (!productId || (intent !== 'activate' && intent !== 'deactivate')) {
    throw new Error('productId and intent are required');
  }
  const isActive = intent === 'activate';
  try {
    await setProductActive(productId, isActive, getDb());
  } catch (error) {
    if (error instanceof InventoryWriteFailedError) {
      redirectWithStatus(isActive ? 'reactivated' : 'deactivated', error.code);
    }
    throw error;
  }
  revalidatePath('/workspace/config');
  revalidatePath('/workspace/config/inventory');
  redirectWithStatus(isActive ? 'reactivated' : 'deactivated');
}