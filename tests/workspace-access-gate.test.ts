import { describe, expect, it } from 'vitest';
import { isAnalystAllowed } from '../src/auth/analyst-allowlist.js';

/**
 * Mirrors the workspace API gate used by requireAnalyst / middleware:
 * unauthenticated and non-allowlisted callers must not mutate.
 */
function canAccessWorkspace(input: {
  authenticated: boolean;
  githubLogin?: string | null;
  allowlistEnv?: string;
}): boolean {
  if (!input.authenticated) return false;
  return isAnalystAllowed(input.githubLogin, input.allowlistEnv);
}

describe('workspace access gate', () => {
  it('sends unauthenticated callers away from workspace', () => {
    expect(canAccessWorkspace({ authenticated: false, allowlistEnv: 'alice' })).toBe(false);
  });

  it('blocks authenticated users missing from the allowlist', () => {
    expect(
      canAccessWorkspace({ authenticated: true, githubLogin: 'eve', allowlistEnv: 'alice,bob' })
    ).toBe(false);
  });

  it('allows authenticated allowlisted analysts', () => {
    expect(
      canAccessWorkspace({ authenticated: true, githubLogin: 'alice', allowlistEnv: 'alice,bob' })
    ).toBe(true);
  });

  it('fails closed when ANALYST_GITHUB_USERS is empty', () => {
    expect(
      canAccessWorkspace({ authenticated: true, githubLogin: 'alice', allowlistEnv: '' })
    ).toBe(false);
  });
});
