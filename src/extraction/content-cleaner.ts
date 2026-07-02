export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

const BOILERPLATE_HINTS =
  /(subscribe|sign up|newsletter|related articles|read more|share this|follow us|advertisement|sponsored|all rights reserved|cookie)/gi;

/**
 * Content quality in [0, 1]: length factor scaled down by boilerplate density.
 * A page full of ads/footers no longer scores 1.0 on length alone.
 */
export function contentQualityScore(cleanText: string | null): number {
  if (!cleanText) return 0;
  const text = cleanText.trim();
  if (text.length === 0) return 0;

  const lengthScore = Math.min(1, text.length / 1000);
  const boilerplateMatches = text.match(BOILERPLATE_HINTS)?.length ?? 0;
  // Penalize by boilerplate hits per 1000 chars; clean articles have ~0.
  const boilerplateDensity = boilerplateMatches / Math.max(1, text.length / 1000);
  const signalScore = Math.max(0, 1 - boilerplateDensity / 5);

  return lengthScore * signalScore;
}
