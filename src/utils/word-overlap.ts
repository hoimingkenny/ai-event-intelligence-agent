/**
 * Word-level overlap metrics between two texts.
 *
 * Main use: extraction quality ground truth. An article's RSS summary is
 * (almost always) drawn from the article body, so
 * `wordRecall(rssSummary, cleanText)` measures whether extraction captured
 * the real article. A healthy source scores ~0.9+; a broken selector or a
 * site redesign drops it sharply — which is the drift signal.
 */

export function wordRecall(reference: string, candidate: string): number {
  return overlapRatio(toWordCounts(reference), toWordCounts(candidate));
}

export function wordOverlap(
  reference: string,
  candidate: string
): { recall: number; precision: number } {
  const referenceWords = toWordCounts(reference);
  const candidateWords = toWordCounts(candidate);
  return {
    recall: overlapRatio(referenceWords, candidateWords),
    precision: overlapRatio(candidateWords, referenceWords),
  };
}

function toWordCounts(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const word of text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}.-]*/gu) ?? []) {
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return counts;
}

function overlapRatio(from: Map<string, number>, against: Map<string, number>): number {
  let total = 0;
  let matched = 0;
  for (const [word, count] of from) {
    total += count;
    matched += Math.min(count, against.get(word) ?? 0);
  }
  return total === 0 ? 0 : matched / total;
}
