import type { ResearchSource } from '../types';

// Public suffixes where the meaningful publisher boundary sits one level up.
const MULTI_PART_SUFFIXES = new Set([
  'ac.uk',
  'co.uk',
  'gov.uk',
  'org.uk',
  'com.au',
  'net.au',
  'org.au',
  'co.jp',
  'or.jp',
  'ne.jp',
  'ac.jp',
  'com.br',
  'com.cn',
  'com.hk',
  'com.mx',
  'com.sg',
  'com.tw',
  'co.kr',
  'co.nz',
  'co.in',
]);

/**
 * Registrable domain of a source URL — subdomains of one publisher (e.g.
 * ir.hubspot.com vs hubspot.com) count as a single corroborating source.
 * Mirrors the server's sourceDomain in api/_src/research.ts.
 */
export function sourceRegistrableDomain(url: string): string {
  try {
    const hostname = new URL(url).hostname
      .replace(/^www\./, '')
      .toLowerCase();
    const labels = hostname.split('.').filter(Boolean);
    if (labels.length <= 2) return hostname;
    const lastTwo = labels.slice(-2).join('.');
    if (MULTI_PART_SUFFIXES.has(lastTwo)) {
      return labels.slice(-3).join('.');
    }
    return lastTwo;
  } catch {
    return '';
  }
}

/**
 * Independent corroboration = distinct publisher domains, not raw link count.
 */
export function corroborationCount(sources: ResearchSource[]): number {
  return new Set(
    sources.map((s) => sourceRegistrableDomain(s.url)).filter(Boolean)
  ).size;
}

/**
 * Evidence freshness from the newest usable publication date, matching the
 * server thresholds: <=180d fresh, <=540d aging, older stale, undated unknown.
 */
export function evidenceFreshness(
  sources: ResearchSource[],
  nowMs = Date.now()
): 'fresh' | 'aging' | 'stale' | 'unknown' {
  const datedAges = sources.flatMap((source) => {
    if (!source.publishedAt) return [];
    const publishedMs = Date.parse(source.publishedAt);
    return Number.isFinite(publishedMs)
      ? [(nowMs - publishedMs) / 86_400_000]
      : [];
  });
  if (datedAges.length === 0) return 'unknown';
  const newestAge = Math.min(...datedAges);
  if (newestAge <= 180) return 'fresh';
  if (newestAge <= 540) return 'aging';
  return 'stale';
}
