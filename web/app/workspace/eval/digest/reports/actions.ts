'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  runDigestAgreementFromWorkspace,
  runDigestEvalFromWorkspace,
} from '../../../../../../src/workspace/workspace-digest-eval-reports';
import type { DigestAgreementReport } from '../../../../../../src/evaluation/digest/digest-agreement';
import { getDb } from '../../../../../lib/db';
import { requireAnalyst } from '../../../../../lib/require-analyst';

const REPORTS_PATH = '/workspace/eval/digest/reports';

async function gateAnalyst() {
  const gate = await requireAnalyst();
  if (!gate.ok) {
    redirect(
      gate.reason === 'unauthenticated'
        ? `/login?callbackUrl=${encodeURIComponent(REPORTS_PATH)}`
        : '/auth/denied'
    );
  }
}

function redirectReports(params: Record<string, string>) {
  const search = new URLSearchParams(params);
  redirect(`${REPORTS_PATH}?${search.toString()}`);
}

export async function runDigestBaselineAction() {
  await gateAnalyst();
  try {
    const { runId } = await runDigestEvalFromWorkspace(getDb(), 'baseline');
    revalidatePath(REPORTS_PATH);
    redirectReports({ run: runId, ran: 'baseline' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Baseline run failed.';
    redirectReports({ error: encodeError(message) });
  }
}

export async function runDigestRegenAction() {
  await gateAnalyst();
  try {
    const { runId } = await runDigestEvalFromWorkspace(getDb(), 'regen');
    revalidatePath(REPORTS_PATH);
    redirectReports({ run: runId, ran: 'regen' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Regen run failed.';
    redirectReports({ error: encodeError(message) });
  }
}

export type DigestAgreementActionResult =
  | { report: DigestAgreementReport }
  | { error: string };

export async function runDigestAgreementAction(
  runId: string
): Promise<DigestAgreementActionResult> {
  await gateAnalyst();
  if (!runId.trim()) {
    return { error: 'Select a digest eval run first.' };
  }
  try {
    const report = await runDigestAgreementFromWorkspace(getDb(), runId.trim());
    return { report };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Agreement report failed.',
    };
  }
}

function encodeError(message: string): string {
  // Keep query param short and URL-safe; page maps known codes / shows generic.
  if (message.includes('No digest gold labels')) return 'no_gold';
  if (message.includes('MINIMAX_API_KEY')) return 'missing_api_key';
  return 'run_failed';
}
