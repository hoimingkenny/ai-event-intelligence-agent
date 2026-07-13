import { describe, expect, it, vi } from 'vitest';
import {
  AssistInputError,
  MAX_ASSIST_ARTICLES,
  MIN_ASSIST_ARTICLES,
  mergeAssistDraft,
  pickBriefsForArticles,
  proposeGoldIncidentAssist,
  validateAssistArticles,
  type AssistArticleInput,
} from '../eval/grouping/gold-incident-assist.js';

const ARTICLE_A: AssistArticleInput = {
  articleId: 'a-1',
  url: 'https://example.test/a',
  title: 'SharePoint zero-day exploited in the wild',
  sourceName: 'SecurityWeek',
  cleanText: 'Microsoft warns of an actively exploited SharePoint zero-day…',
};

const ARTICLE_B: AssistArticleInput = {
  articleId: 'b-1',
  url: 'https://example.test/b',
  title: 'SharePoint RCE: emergency patch issued',
  sourceName: 'Bleeping Computer',
  cleanText: 'An emergency patch addresses the same SharePoint RCE flaw…',
};

const ARTICLE_C: AssistArticleInput = {
  articleId: 'c-1',
  url: 'https://example.test/c',
  title: 'Linux kernel privilege escalation disclosed',
  sourceName: 'The Hacker News',
  cleanText: 'A separate disclosure affects Linux kernels…',
};

function buildLlmDraft(recommendation: 'same_event' | 'mixed' | 'different_event', articles: AssistArticleInput[]) {
  return {
    recommendation,
    confidence: 0.8,
    rationale: 'Aligned vendor/product/CVE context.',
    suggestedName: 'SharePoint 202505',
    briefs: articles.map((a) => ({
      articleId: a.articleId,
      brief: [`Outlet ${a.sourceName} reports relevant detail.`],
    })),
  };
}

describe('validateAssistArticles', () => {
  it('accepts a 2–5 article set with non-empty cleanText', () => {
    expect(() => validateAssistArticles([ARTICLE_A, ARTICLE_B])).not.toThrow();
    expect(() => validateAssistArticles([ARTICLE_A, ARTICLE_B, ARTICLE_C])).not.toThrow();
  });

  it(`refuses fewer than ${MIN_ASSIST_ARTICLES} articles`, () => {
    expect(() => validateAssistArticles([ARTICLE_A])).toThrowError(AssistInputError);
    expect(() => validateAssistArticles([ARTICLE_A])).toThrowError(/2.*5/);
  });

  it(`refuses more than ${MAX_ASSIST_ARTICLES} articles`, () => {
    const many = [ARTICLE_A, ARTICLE_B, ARTICLE_C, ARTICLE_A, ARTICLE_B, ARTICLE_C];
    try {
      validateAssistArticles(many);
      throw new Error('expected to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(AssistInputError);
      expect((err as AssistInputError).code).toBe('ARTICLE_COUNT');
    }
  });

  it('refuses when any article lacks cleanText', () => {
    try {
      validateAssistArticles([ARTICLE_A, { ...ARTICLE_B, cleanText: '   ' }]);
      throw new Error('expected to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(AssistInputError);
      expect((err as AssistInputError).code).toBe('MISSING_CLEAN_TEXT');
    }
  });
});

describe('proposeGoldIncidentAssist', () => {
  it('returns the draft and passes schema validation', async () => {
    const call = vi.fn().mockResolvedValue(buildLlmDraft('same_event', [ARTICLE_A, ARTICLE_B]));
    const draft = await proposeGoldIncidentAssist([ARTICLE_A, ARTICLE_B], { call });

    expect(call).toHaveBeenCalledTimes(1);
    expect(draft.recommendation).toBe('same_event');
    expect(draft.briefs).toHaveLength(2);
    expect(draft.briefs.map((b) => b.articleId).sort()).toEqual([ARTICLE_A.articleId, ARTICLE_B.articleId]);
    expect(draft.briefs[0].url).toBe(ARTICLE_A.url);
  });

  it('uses DB URLs even when the LLM schema only returns articleId + brief', () => {
    const draft = mergeAssistDraft([ARTICLE_A, ARTICLE_B], buildLlmDraft('same_event', [ARTICLE_A, ARTICLE_B]));
    expect(draft.briefs[0].url).toBe(ARTICLE_A.url);
    expect(draft.briefs[1].url).toBe(ARTICLE_B.url);
  });

  it('coerces a string brief from the LLM into bullet array', async () => {
    const call = vi.fn().mockResolvedValue({
      ...buildLlmDraft('same_event', [ARTICLE_A, ARTICLE_B]),
      briefs: [
        { articleId: ARTICLE_A.articleId, brief: '- First point\n- Second point' },
        { articleId: ARTICLE_B.articleId, brief: ['Already an array'] },
      ],
    });
    const draft = await proposeGoldIncidentAssist([ARTICLE_A, ARTICLE_B], { call });
    expect(draft.briefs[0].brief).toEqual(['First point', 'Second point']);
  });

  it('ignores extra LLM brief rows beyond the selected articles', async () => {
    const extra = {
      articleId: '999',
      brief: ['Should be ignored'],
    };
    const call = vi.fn().mockResolvedValue({
      ...buildLlmDraft('same_event', [ARTICLE_A, ARTICLE_B]),
      briefs: [...buildLlmDraft('same_event', [ARTICLE_A, ARTICLE_B]).briefs, extra, extra, extra, extra, extra],
    });
    const draft = await proposeGoldIncidentAssist([ARTICLE_A, ARTICLE_B], { call });
    expect(draft.briefs).toHaveLength(2);
  });

  it('tolerates null LLM string fields and null brief bullets', async () => {
    const call = vi.fn().mockResolvedValue({
      recommendation: null,
      confidence: '0.7',
      rationale: null,
      suggestedName: null,
      briefs: [
        { articleId: ARTICLE_A.articleId, brief: [null, 'Real point', null] },
        { articleId: ARTICLE_B.articleId, brief: null },
      ],
    });
    const draft = await proposeGoldIncidentAssist([ARTICLE_A, ARTICLE_B], { call });
    expect(draft.recommendation).toBe('mixed');
    expect(draft.rationale).toContain('did not provide');
    expect(draft.suggestedName).toBeTruthy();
    expect(draft.briefs[0].brief).toEqual(['Real point']);
    expect(draft.briefs[1].brief[0]).toMatch(/Summary unavailable/i);
  });

  it('truncates cleanText before sending to the model', async () => {
    const huge = 'x'.repeat(20_000);
    const call = vi.fn().mockResolvedValue(buildLlmDraft('same_event', [ARTICLE_A, { ...ARTICLE_B, cleanText: huge }]));
    await proposeGoldIncidentAssist([ARTICLE_A, { ...ARTICLE_B, cleanText: huge }], { call });

    const userArg = call.mock.calls[0][1];
    const parsed = JSON.parse(userArg) as { articles: Array<{ cleanText: string }> };
    for (const article of parsed.articles) {
      expect(article.cleanText.length).toBeLessThanOrEqual(8000);
    }
  });

  it('refuses when caller returns briefs that do not match input ids', async () => {
    const call = vi.fn().mockResolvedValue({
      ...buildLlmDraft('same_event', [ARTICLE_A, ARTICLE_B]),
      briefs: [buildLlmDraft('same_event', [ARTICLE_A, ARTICLE_B]).briefs[0]],
    });
    await expect(
      proposeGoldIncidentAssist([ARTICLE_A, ARTICLE_B], { call })
    ).rejects.toThrow(/briefs do not match|Too small|missing articleId/i);
  });

  it('refuses when caller returns briefs with unknown articleId', async () => {
    const bad = buildLlmDraft('same_event', [ARTICLE_A, ARTICLE_B]);
    bad.briefs[0].articleId = 'someone-else';
    const call = vi.fn().mockResolvedValue(bad);
    await expect(
      proposeGoldIncidentAssist([ARTICLE_A, ARTICLE_B], { call })
    ).rejects.toThrowError(/missing articleId/i);
  });

  it('propagates caller errors so the UI can show a clear failure', async () => {
    const call = vi.fn().mockRejectedValue(new Error('LLM timeout'));
    await expect(proposeGoldIncidentAssist([ARTICLE_A, ARTICLE_B], { call })).rejects.toThrow('LLM timeout');
  });
});