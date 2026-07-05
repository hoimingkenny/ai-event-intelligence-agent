import { describe, expect, it } from 'vitest';
import { renderReviewApp } from '../src/review/human-review-server.js';

describe('human review server UI', () => {
  it('renders the interactive dashboard shell with review endpoints', () => {
    const html = renderReviewApp();

    expect(html).toContain('Vendor Threat Watch Review');
    expect(html).toContain('/api/review-cases');
    expect(html).toContain('/api/reviews');
    expect(html).toContain('Save verdict');
    expect(html).toContain('Is the vendor/product impact correct?');
  });
});
