import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';

/**
 * Readability-based article extraction with three quality layers:
 * 1. Per-source CSS selectors for curated feeds (deterministic, cleanest).
 * 2. DOM pruning of known-noise nodes before running Readability.
 * 3. Post-filtering of residual boilerplate lines (subscribe/related/share/etc.).
 */

/** Per-domain article body selectors for curated feeds. Highest-priority extraction path. */
export const SOURCE_SELECTORS: Record<string, string> = {
  'bleepingcomputer.com': 'div.articleBody',
  'krebsonsecurity.com': 'div.entry-content',
  'thehackernews.com': 'div#articlebody',
  'securityweek.com': 'div.zox-post-body',
  'cisa.gov': 'div.l-page-section__content, div.usa-prose, main article',
};

/** Nodes that are never article content — removed before Readability runs. */
const NOISE_SELECTORS = [
  'script',
  'style',
  'noscript',
  'template',
  'aside',
  'nav',
  'footer',
  'header',
  'form',
  'iframe',
  'figcaption',
  '[class*="related"]',
  '[class*="newsletter"]',
  '[class*="share"]',
  '[class*="social"]',
  '[class*="promo"]',
  '[class*="sidebar"]',
  '[class*="comment"]',
  '[id*="cookie"]',
  '[class*="cookie"]',
  '[class*="ad-"]',
  '[class*="advert"]',
  '[id*="advert"]',
  '[role="complementary"]',
  '[role="banner"]',
  '[role="contentinfo"]',
  '[role="navigation"]',
].join(',');

/** Residual boilerplate line patterns dropped from the final text. */
const JUNK_LINE_PATTERN =
  /^(subscribe( to)?|sign up|get the latest|related (articles?|posts?|news)|read (more|next)|share (this|on)|follow us|advertisement|sponsored|©|copyright|all rights reserved|tags?\s*:|categories\s*:|comments?( \(\d+\))?$|leave a (comment|reply)|previous (article|post)|next (article|post)|you might also like|recommended for you|trending now|popular (articles|posts|stories))/i;

const MIN_LINE_LENGTH = 25;
/** Blocks whose text is mostly link text are boilerplate (related-article lists, tag clouds). */
const MAX_LINK_DENSITY = 0.5;

export interface ReadableContentResult {
  cleanText: string | null;
  method: 'source_selector' | 'readability' | 'none';
}

export function extractReadableContent(html: string, url?: string | null): ReadableContentResult {
  const { document } = parseHTML(html);

  // Layer 1: per-source selector.
  const selector = url ? sourceSelectorForUrl(url) : null;
  if (selector) {
    const node = document.querySelector(selector);
    if (node) {
      const text = cleanElementText(node as unknown as Element, url);
      if (text.length >= 200) {
        return { cleanText: text, method: 'source_selector' };
      }
    }
  }

  // Layer 2: prune noise, then Readability.
  document.querySelectorAll(NOISE_SELECTORS).forEach((node) => node.remove());
  const article = new Readability(document as unknown as Document, {
    keepClasses: false,
    // Default is 500; short vendor advisories are still worth extracting.
    charThreshold: 250,
  }).parse();

  if (article?.content) {
    // linkedom needs a full document; a bare <body> fragment loses its content.
    const { document: articleDoc } = parseHTML(
      `<html><head><title>.</title></head><body>${article.content}</body></html>`
    );
    const text = cleanElementText(articleDoc.body as unknown as Element, url);
    // Reject short Readability hits (e.g. SecurityWeek search chrome) so callers
    // can fall back to htmlToText / another path instead of treating junk as content.
    if (text.length >= 200) {
      return { cleanText: text, method: 'readability' };
    }
  }

  return { cleanText: null, method: 'none' };
}

export function sourceSelectorForUrl(url: string): string | null {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    for (const [domain, selector] of Object.entries(SOURCE_SELECTORS)) {
      if (hostname === domain || hostname.endsWith(`.${domain}`)) return selector;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Element → text: removes noise nodes, native-ad clusters, and
 * high-link-density blocks, preserves paragraph boundaries, then drops
 * residual boilerplate lines.
 */
function cleanElementText(root: Element, articleUrl?: string | null): string {
  root.querySelectorAll(NOISE_SELECTORS).forEach((node) => node.remove());
  removeNativeAdClusters(root, articleUrl);
  removeOffsiteImageBanners(root, articleUrl);

  for (const block of Array.from(root.querySelectorAll('p, ul, ol, div, table'))) {
    if (linkDensity(block) > MAX_LINK_DENSITY) block.remove();
  }

  const blocks = Array.from(root.querySelectorAll('p, li, h1, h2, h3, h4, pre, blockquote, td'))
    .map((node) => normalizeWhitespace(node.textContent ?? ''))
    .filter(Boolean);
  const lines = blocks.length > 0 ? blocks : [normalizeWhitespace(root.textContent ?? '')];

  return filterBoilerplateLines(lines).join('\n');
}

export function filterBoilerplateLines(lines: string[]): string[] {
  return lines.filter((line) => {
    const trimmed = line.trim();
    if (trimmed.length === 0) return false;
    if (JUNK_LINE_PATTERN.test(trimmed)) return false;
    // Keep headings even if short, drop other stub lines.
    if (trimmed.length < MIN_LINE_LENGTH && !/[.!?:]$/.test(trimmed) && trimmed.split(/\s+/).length < 4) {
      return false;
    }
    return true;
  });
}

const CTA_TEXT_PATTERN =
  /^(get|download|read|learn|register|sign ?up|request|try|start|claim|watch|book|schedule|join)\b.{0,60}$|whitepaper|webinar|free trial|demo\b/i;

const MAX_AD_CLUSTER_BLOCKS = 8;
const MAX_AD_CLUSTER_CHARS = 800;

/**
 * Native in-article ads (e.g. BleepingComputer sponsor blocks) repeat one
 * external URL across a small cluster: linked banner image + linked headline +
 * "Get the whitepaper" CTA, with 1-2 pitch paragraphs between. Detect the
 * repeated offsite href and remove the whole sibling span it covers.
 */
function removeNativeAdClusters(root: Element, articleUrl?: string | null): void {
  const articleHost = hostOf(articleUrl);
  const anchorsByTarget = new Map<string, Element[]>();

  for (const anchor of Array.from(root.querySelectorAll('a[href]'))) {
    const target = normalizeLinkTarget(anchor.getAttribute('href'));
    if (!target) continue;
    const host = hostOf(target);
    if (!host || isSameSite(host, articleHost)) continue;
    const list = anchorsByTarget.get(target) ?? [];
    list.push(anchor);
    anchorsByTarget.set(target, list);
  }

  for (const anchors of anchorsByTarget.values()) {
    if (anchors.length < 2) continue;
    const looksLikeAd = anchors.some(
      (anchor) =>
        CTA_TEXT_PATTERN.test(normalizeWhitespace(anchor.textContent ?? '')) ||
        isLinkedHeading(anchor) ||
        isImageOnlyLink(anchor)
    );
    if (!looksLikeAd) continue;

    // Resolve the sibling span relative to the anchors' lowest common
    // ancestor, NOT the root: Readability wraps its output in nested divs, so
    // root-relative blocks would resolve everything to one wrapper and the
    // span would swallow the whole article.
    const ancestor = anchors.reduce<Element | null>(
      (acc, anchor) => (acc ? lowestCommonAncestor(acc, anchor) : anchor),
      anchors[0]
    );
    if (!ancestor || ancestor === root.parentElement) continue;

    const children = Array.from(ancestor.children);
    const indices = anchors
      .map((anchor) => children.indexOf(childOfAncestor(ancestor, anchor) as never))
      .filter((index) => index >= 0);
    if (indices.length === 0) continue;

    const start = Math.min(...indices);
    const end = Math.max(...indices);
    if (end - start + 1 > MAX_AD_CLUSTER_BLOCKS) continue;

    const span = children.slice(start, end + 1);
    const spanText = normalizeWhitespace(span.map((el) => el.textContent ?? '').join(' '));
    // Too much text means we may be looking at real content citing a source twice.
    if (spanText.length > MAX_AD_CLUSTER_CHARS) continue;

    span.forEach((el) => el.remove());
  }
}

/** Standalone offsite banner: a block that is only a linked image, no text. */
function removeOffsiteImageBanners(root: Element, articleUrl?: string | null): void {
  const articleHost = hostOf(articleUrl);
  for (const anchor of Array.from(root.querySelectorAll('a[href]'))) {
    if (!isImageOnlyLink(anchor)) continue;
    const host = hostOf(normalizeLinkTarget(anchor.getAttribute('href')) ?? '');
    if (!host || isSameSite(host, articleHost)) continue;
    // Climb only through text-empty wrappers (e.g. the <p> holding the banner)
    // so a content-bearing container is never removed.
    let block: Element = anchor;
    while (
      block.parentElement &&
      block.parentElement !== root &&
      normalizeWhitespace(block.parentElement.textContent ?? '') === ''
    ) {
      block = block.parentElement;
    }
    block.remove();
  }
}

function isImageOnlyLink(anchor: Element): boolean {
  return anchor.querySelector('img') !== null && normalizeWhitespace(anchor.textContent ?? '') === '';
}

function isLinkedHeading(anchor: Element): boolean {
  const parent = anchor.parentElement;
  return parent !== null && /^H[1-6]$/i.test(parent.tagName) && linkDensity(parent) >= 0.9;
}

function lowestCommonAncestor(a: Element, b: Element): Element | null {
  const chain = new Set<Element>();
  for (let cur: Element | null = a; cur; cur = cur.parentElement) chain.add(cur);
  for (let cur: Element | null = b; cur; cur = cur.parentElement) {
    if (chain.has(cur)) return cur;
  }
  return null;
}

/** The child of `ancestor` on the path down to `node`. */
function childOfAncestor(ancestor: Element, node: Element): Element | null {
  let current: Element | null = node;
  while (current && current.parentElement !== ancestor) {
    current = current.parentElement;
  }
  return current;
}

/** Group links by origin+path so utm/query variants of one campaign URL match. */
function normalizeLinkTarget(href: string | null): string | null {
  if (!href || !/^https?:\/\//i.test(href)) return null;
  try {
    const parsed = new URL(href);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return null;
  }
}

function hostOf(url?: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function isSameSite(host: string, articleHost: string | null): boolean {
  if (!articleHost) return false;
  return host === articleHost || host.endsWith(`.${articleHost}`) || articleHost.endsWith(`.${host}`);
}

function linkDensity(block: Element): number {
  const text = normalizeWhitespace(block.textContent ?? '');
  if (text.length === 0) return 0;
  const linkText = Array.from(block.querySelectorAll('a'))
    .map((anchor) => normalizeWhitespace(anchor.textContent ?? ''))
    .join(' ');
  return linkText.length / text.length;
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
