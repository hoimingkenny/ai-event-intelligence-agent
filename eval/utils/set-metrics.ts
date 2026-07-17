export function canonicalSet(values: string[]): Set<string> {
  return new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean));
}

export function setsEqual(a: string[], b: string[]): boolean {
  const left = canonicalSet(a);
  const right = canonicalSet(b);
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
}

export function setF1(gold: string[], pred: string[]): number {
  const g = canonicalSet(gold);
  const p = canonicalSet(pred);
  let intersection = 0;
  for (const value of g) {
    if (p.has(value)) intersection += 1;
  }
  if (g.size === 0 && p.size === 0) return 1;
  const denominator = 2 * intersection + (p.size - intersection) + (g.size - intersection);
  return denominator === 0 ? 0 : (2 * intersection) / denominator;
}

export function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
