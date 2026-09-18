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
function sourceRegistrableDomain(url: string): string {
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

const FIRST_NAME_ALIASES: Record<string, string> = {
  bob: 'robert', rob: 'robert', bobby: 'robert', robbie: 'robert',
  bill: 'william', billy: 'william', will: 'william', liam: 'william',
  mike: 'michael', mikey: 'michael',
  dave: 'david', davey: 'david',
  jim: 'james', jimmy: 'james', jamie: 'james',
  rich: 'richard', rick: 'richard', ricky: 'richard', dick: 'richard',
  tom: 'thomas', tommy: 'thomas',
  chris: 'christopher', topher: 'christopher',
  matt: 'matthew', matty: 'matthew',
  joe: 'joseph', joey: 'joseph',
  dan: 'daniel', danny: 'daniel',
  ben: 'benjamin', benny: 'benjamin',
  tony: 'anthony',
  ed: 'edward', ted: 'edward', eddie: 'edward', teddy: 'edward',
  charlie: 'charles', chuck: 'charles', chas: 'charles',
  jack: 'john', johnny: 'john',
  andy: 'andrew', drew: 'andrew',
  josh: 'joshua',
  nick: 'nicholas', nicky: 'nicholas',
  steve: 'steven', stevie: 'steven',
  greg: 'gregory',
  jeff: 'jeffrey',
  phil: 'philip',
  larry: 'lawrence',
  liz: 'elizabeth', beth: 'elizabeth', lizzy: 'elizabeth', betty: 'elizabeth',
  kate: 'katherine', katie: 'katherine', katy: 'katherine', cathy: 'katherine',
  meg: 'margaret', peggy: 'margaret', maggie: 'margaret',
  sue: 'susan', suzy: 'susan', susie: 'susan',
  jenny: 'jennifer', jen: 'jennifer',
  vicky: 'victoria', vicki: 'victoria', tori: 'victoria',
  becky: 'rebecca',
  cindy: 'cynthia',
  debbie: 'deborah', deb: 'deborah',
  jerry: 'gerald',
  ron: 'ronald', ronnie: 'ronald',
  don: 'donald', donnie: 'donald',
  ray: 'raymond',
  fred: 'frederick', freddy: 'frederick',
  kenny: 'kenneth', ken: 'kenneth',
  tim: 'timothy', timmy: 'timothy',
  zach: 'zachary', zack: 'zachary',
  pete: 'peter',
};

/**
 * Person match key shared with the server: lowercase name with the first
 * name canonicalized, so "Bob Komin" merges into an existing "Robert Komin".
 */
export function canonicalPersonName(name: string): string {
  const normalized = name.trim().toLowerCase().replace(/\s+/g, ' ');
  const parts = normalized.split(' ');
  const first = FIRST_NAME_ALIASES[parts[0] ?? ''];
  if (first) parts[0] = first;
  return parts.join(' ');
}
