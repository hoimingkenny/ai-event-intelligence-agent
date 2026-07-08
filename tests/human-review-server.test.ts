import { describe, expect, it } from 'vitest';
import { renderReviewApp } from '../src/review/human-review-server.js';
import { renderEvalReviewApp } from '../src/review/eval/eval-page.js';

describe('human review server UI', () => {
  it('renders the interactive dashboard shell with review endpoints', () => {
    const html = renderReviewApp();

    expect(html).toContain('Vendor Threat Watch Review');
    expect(html).toContain('/api/review-cases');
    expect(html).toContain('/api/reviews');
    expect(html).toContain('Cheap-filter eval');
    // Both top-level panes live in one DOM (no iframe, no postMessage):
    expect(html).toContain('id="review-pane"');
    expect(html).toContain('id="eval-pane"');
    expect(html).toContain('id="tab-human"');
    expect(html).toContain('id="tab-eval"');
    // No iframe or postMessage bridging should remain:
    expect(html).not.toContain('<iframe');
    expect(html).not.toContain('postMessage');
    expect(html).not.toContain('vendor-threat-watch:selected-article');
    // Sub-tab IDs were renamed to avoid clashing with the parent shell:
    expect(html).toContain('id="eval-tab-llm"');
    expect(html).toContain('id="eval-refresh"');
    expect(html).not.toContain('id="tab-llm"');
    expect(html).toContain('Save verdict');
    expect(html).toContain('Is the vendor/product impact correct?');
    // The eval script must be inside a <script> tag (not dumped as page text)
    // and defined before the shell calls initEvalPane(), otherwise the call
    // throws ReferenceError and both panes hang on their loading spinners.
    expect(html).toMatch(/<script>\s*function initEvalPane/);
    expect(html.indexOf('function initEvalPane')).toBeLessThan(html.indexOf('initEvalPane(state'));
  });

  it('renders LLM evaluation inside the cheap-filter eval workspace', () => {
    const html = renderEvalReviewApp({ apiPrefix: '/api/eval' });

    expect(html).toContain('id="eval-tab-llm"');
    expect(html).toContain('id="llm-view"');
    expect(html).toContain('/api/llm-evaluations');
  });
});
