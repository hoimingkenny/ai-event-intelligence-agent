/**
 * Reset the app database to a clean migrated+seeded state for local testing.
 *
 * Requires --yes (destructive).
 *
 *   npm run db:reset -- --yes
 *   npm run db:reset -- --yes --manual          # + import manual-articles.jsonl
 *   npm run db:reset -- --yes --manual --pipeline  # + run pipeline (skip ingest)
 */
import { spawn } from 'node:child_process';
import { getDatabasePool } from '../src/db/pool.js';

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

async function runNpm(script: string, args: string[] = []): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('npm', ['run', script, ...args], {
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: process.env,
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`npm run ${script} exited with code ${code ?? 'null'}`));
    });
  });
}

async function wipeAppSchema(): Promise<void> {
  const pool = getDatabasePool();
  const client = await pool.connect();
  try {
    // App tables live in `app`; public keeps extensions (pgvector).
    await client.query('DROP SCHEMA IF EXISTS app CASCADE');
    await client.query('CREATE SCHEMA app AUTHORIZATION CURRENT_USER');
    await client.query('CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public');
    console.log('Dropped and recreated schema `app`.');
  } finally {
    client.release();
    await pool.end();
  }
}

async function main(): Promise<void> {
  if (!hasFlag('--yes')) {
    console.error(
      [
        'Refusing to reset without --yes (this drops schema `app` and all pipeline data).',
        '',
        'Examples:',
        '  npm run db:reset -- --yes',
        '  npm run db:reset -- --yes --manual',
        '  npm run db:reset -- --yes --manual --pipeline',
      ].join('\n')
    );
    process.exit(1);
  }

  const withManual = hasFlag('--manual');
  const withPipeline = hasFlag('--pipeline');

  console.log('=== db:reset ===');
  await wipeAppSchema();
  await runNpm('db:migrate');

  if (withManual) {
    // Manual-article path only needs vendors; feeds optional.
    await runNpm('seed:vendors');
    await runNpm('articles:manual');
  } else {
    await runNpm('db:seed');
  }

  if (withPipeline) {
    await runNpm('pipeline:run', ['--', '--skip-ingest', '--include-llm', '--limit=50']);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        manual: withManual,
        pipeline: withPipeline,
        next: withManual
          ? withPipeline
            ? 'Inspect portal/events or re-run diagnose-same-event-grouping.ts'
            : 'npm run pipeline:run -- --skip-ingest --include-llm --limit=50'
          : 'npm run pipeline:run',
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
