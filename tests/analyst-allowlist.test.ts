import { describe, expect, it } from 'vitest';
import {
  isAnalystAllowed,
  parseAnalystAllowlist,
} from '../src/auth/analyst-allowlist.js';

describe('parseAnalystAllowlist', () => {
  it('returns an empty set when unset or blank (fail closed)', () => {
    expect(parseAnalystAllowlist(undefined).size).toBe(0);
    expect(parseAnalystAllowlist(null).size).toBe(0);
    expect(parseAnalystAllowlist('').size).toBe(0);
    expect(parseAnalystAllowlist('  ,  ').size).toBe(0);
  });

  it('parses comma or whitespace separated GitHub usernames case-insensitively', () => {
    expect([...parseAnalystAllowlist('Alice, bob Carol')].sort()).toEqual(['alice', 'bob', 'carol']);
  });
});

describe('isAnalystAllowed', () => {
  it('denies when the allowlist is empty', () => {
    expect(isAnalystAllowed('alice', '')).toBe(false);
    expect(isAnalystAllowed('alice', new Set())).toBe(false);
  });

  it('denies missing usernames', () => {
    expect(isAnalystAllowed(null, 'alice')).toBe(false);
    expect(isAnalystAllowed(undefined, 'alice')).toBe(false);
    expect(isAnalystAllowed('', 'alice')).toBe(false);
  });

  it('allows only allowlisted usernames (case-insensitive)', () => {
    expect(isAnalystAllowed('Alice', 'alice,bob')).toBe(true);
    expect(isAnalystAllowed('bob', 'alice,bob')).toBe(true);
    expect(isAnalystAllowed('eve', 'alice,bob')).toBe(false);
  });
});
