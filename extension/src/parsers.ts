// DOM parsers for LinkedIn pages. Pure functions over a Document so they can
// be unit-tested against saved fixtures. LinkedIn renames CSS classes
// constantly, so every parser prefers (in order): structured data (JSON-LD,
// Open Graph), stable data-*/aria attributes, then structural heuristics.
// Nothing here talks to the network.

export interface ParsedPerson {
  name: string;
  title: string | null;
  company: string | null;
  location: string | null;
  linkedinUrl: string | null;
}

export type PageKind = 'profile' | 'sales_list' | 'sales_search' | 'other';

export interface PageContext {
  kind: PageKind;
  url: string;
  person: ParsedPerson | null;
  people: ParsedPerson[];
  pagination: { hasNext: boolean; page: number | null; total: number | null };
}

const clean = (value: string | null | undefined): string | null => {
  const text = value?.replace(/\s+/g, ' ').trim() ?? '';
  return text.length ? text : null;
};

const text = (el: Element | null | undefined): string | null =>
  clean(el?.textContent);

export function classifyUrl(url: string): PageKind {
  let path: string;
  try {
    const u = new URL(url);
    if (!/(^|\.)linkedin\.com$/.test(u.hostname)) return 'other';
    path = u.pathname;
  } catch {
    return 'other';
  }
  if (/^\/in\/[^/]+\/?$/.test(path)) return 'profile';
  if (/^\/sales\/lists\/people\//.test(path)) return 'sales_list';
  if (/^\/sales\/(search\/people|lead\/|people\/)/.test(path)) {
    return 'sales_search';
  }
  return 'other';
}

/** Canonical `https://www.linkedin.com/in/<slug>` or `/sales/lead/<id>` URL. */
export function canonicalProfileUrl(
  href: string | null | undefined,
  base = 'https://www.linkedin.com'
): string | null {
  if (!href) return null;
  try {
    const u = new URL(href, base);
    if (!/(^|\.)linkedin\.com$/.test(u.hostname)) return null;
    const slug = u.pathname.match(/^\/in\/([^/?#]+)/);
    if (slug) {
      return `https://www.linkedin.com/in/${decodeURIComponent(slug[1])}`;
    }
    const lead = u.pathname.match(/^\/sales\/(lead|people)\/([^/?#,]+)/);
    if (lead) return `https://www.linkedin.com/sales/${lead[1]}/${lead[2]}`;
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- profile

interface LdPerson {
  name?: string;
  jobTitle?: string | string[];
  worksFor?: { name?: string } | { name?: string }[];
  address?: { addressLocality?: string; addressRegion?: string };
  url?: string;
}

function ldPerson(doc: Document): LdPerson | null {
  for (const script of doc.querySelectorAll(
    'script[type="application/ld+json"]'
  )) {
    try {
      const data = JSON.parse(script.textContent ?? '');
      const graph: unknown[] = Array.isArray(data?.['@graph'])
        ? data['@graph']
        : [data];
      for (const node of graph) {
        if (
          node &&
          typeof node === 'object' &&
          (node as { '@type'?: string })['@type'] === 'Person'
        ) {
          return node as LdPerson;
        }
      }
    } catch {
      // ignore malformed JSON
    }
  }
  return null;
}

function meta(doc: Document, property: string): string | null {
  return clean(
    doc
      .querySelector(`meta[property="${property}"], meta[name="${property}"]`)
      ?.getAttribute('content')
  );
}

/** "Jane Doe - VP Engineering - Acme | LinkedIn" → parts. */
export function splitOgTitle(
  title: string | null
): { name: string | null; title: string | null; company: string | null } {
  if (!title) return { name: null, title: null, company: null };
  const parts = title
    .replace(/\s*[|\u2013\u2014-]\s*LinkedIn\s*$/i, '')
    .split(/\s+[-\u2013\u2014]\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
  return {
    name: parts[0] ?? null,
    title: parts[1] ?? null,
    company: parts[2] ?? null,
  };
}

/** Strip pronouns / badges LinkedIn appends to the H1 ("Jane Doe (She/Her)"). */
function cleanName(value: string | null): string | null {
  const name = clean(value?.replace(/\s*\((?:he|she|they)\b[^)]*\)/i, ''));
  return name && name.length <= 120 ? name : null;
}

function topCard(doc: Document): Element | null {
  return (
    doc.querySelector('main section:has(h1)') ??
    doc.querySelector('[class*="top-card"]') ??
    doc.querySelector('main')
  );
}

function currentCompany(doc: Document, card: Element | null): string | null {
  const aria = doc.querySelector(
    '[aria-label^="Current company:"], [aria-label^="Current company "]'
  );
  const fromAria = clean(
    aria
      ?.getAttribute('aria-label')
      ?.replace(/^Current company:?\s*/i, '')
      .replace(/\.\s*Click to skip.*$/i, '')
  );
  if (fromAria) return fromAria;
  const link = card?.querySelector(
    'a[href*="/company/"], a[href*="/school/"], a[href*="#experience"], a[data-field="experience_company_logo"]'
  );
  const fromLink = text(link);
  if (fromLink) return fromLink;
  const exp = doc.querySelector(
    '#experience ~ * li [data-field="experience_company_logo"], #experience ~ * li a[href*="/company/"]'
  );
  return text(exp);
}

export function parseProfile(doc: Document, url: string): ParsedPerson | null {
  const ld = ldPerson(doc);
  const og = splitOgTitle(meta(doc, 'og:title') ?? meta(doc, 'twitter:title'));
  const card = topCard(doc);

  const h1 = card?.querySelector('h1') ?? doc.querySelector('main h1');
  const name =
    cleanName(ld?.name ?? null) ?? cleanName(text(h1)) ?? cleanName(og.name);
  if (!name) return null;

  const ldTitle = Array.isArray(ld?.jobTitle) ? ld?.jobTitle[0] : ld?.jobTitle;
  const headlineEl =
    card?.querySelector('[data-generated-suggestion-target*="headline"]') ??
    card?.querySelector('h1 ~ * .text-body-medium, h1 ~ .text-body-medium') ??
    card?.querySelector('[class*="headline"]');
  const title =
    clean(ldTitle) ?? text(headlineEl) ?? og.title ?? null;

  const ldWorks = Array.isArray(ld?.worksFor) ? ld?.worksFor[0] : ld?.worksFor;
  const company =
    clean(ldWorks?.name) ?? currentCompany(doc, card) ?? og.company ?? null;

  const ldLoc = ld?.address
    ? clean(
        [ld.address.addressLocality, ld.address.addressRegion]
          .filter(Boolean)
          .join(', ')
      )
    : null;
  const locEl =
    card?.querySelector('[class*="location"]') ??
    card?.querySelector('.text-body-small:not(:has(a))') ??
    card?.querySelector('h1 ~ * .text-body-small');
  const location = ldLoc ?? text(locEl);

  const canonical =
    doc.querySelector('link[rel="canonical"]')?.getAttribute('href') ??
    meta(doc, 'og:url') ??
    ld?.url ??
    url;
  const linkedinUrl = canonicalProfileUrl(canonical) ?? canonicalProfileUrl(url);

  return { name, title, company, location, linkedinUrl };
}

// --------------------------------------------------------- sales navigator

// Sales Navigator tags every PII field with data-anonymize (used by its own
// demo mode), which has stayed stable for years and is the most reliable hook.
const ROW_SELECTORS = [
  'ol li:has([data-anonymize="person-name"])',
  'tr:has([data-anonymize="person-name"])',
  '[data-x-search-result]',
  'li[class*="search-results__result-item"]',
  'li[class*="list-people"]',
];

function anon(row: Element, key: string): string | null {
  return text(row.querySelector(`[data-anonymize="${key}"]`));
}

function firstNonEmpty(...values: (string | null)[]): string | null {
  return values.find((v) => v) ?? null;
}

export function parseSalesRow(row: Element, base: string): ParsedPerson | null {
  const link = row.querySelector<HTMLAnchorElement>(
    'a[href*="/sales/lead/"], a[href*="/sales/people/"]'
  );
  const name = cleanName(
    firstNonEmpty(
      anon(row, 'person-name'),
      text(link),
      text(row.querySelector('[data-view-name*="lead-name"], h3, h2'))
    )
  );
  if (!name) return null;
  const title = firstNonEmpty(
    anon(row, 'title'),
    anon(row, 'job-title'),
    text(row.querySelector('[data-view-name*="title"], [class*="title"]'))
  );
  const company = firstNonEmpty(
    anon(row, 'company-name'),
    text(row.querySelector('a[href*="/sales/company/"], a[href*="/company/"]'))
  );
  const location = anon(row, 'location');
  return {
    name,
    title,
    company,
    location,
    linkedinUrl: canonicalProfileUrl(link?.getAttribute('href'), base),
  };
}

export function parseSalesPeople(doc: Document, url: string): ParsedPerson[] {
  const seen = new Set<Element>();
  const rows: Element[] = [];
  for (const sel of ROW_SELECTORS) {
    let matches: Element[] = [];
    try {
      matches = Array.from(doc.querySelectorAll(sel));
    } catch {
      continue;
    }
    for (const el of matches) {
      // Skip nested duplicates (a <li> inside another matched row).
      if (rows.some((r) => r.contains(el) || el.contains(r))) continue;
      if (!seen.has(el)) {
        seen.add(el);
        rows.push(el);
      }
    }
    if (rows.length) break;
  }
  const people: ParsedPerson[] = [];
  const keys = new Set<string>();
  for (const row of rows) {
    const person = parseSalesRow(row, url);
    if (!person) continue;
    const key = person.linkedinUrl ?? person.name.toLowerCase();
    if (keys.has(key)) continue;
    keys.add(key);
    people.push(person);
  }
  return people;
}

export function parsePagination(doc: Document): PageContext['pagination'] {
  const next =
    doc.querySelector<HTMLButtonElement>(
      'button[aria-label="Next"], button[class*="pagination__button--next"], a[aria-label="Next"]'
    ) ?? null;
  const hasNext =
    !!next &&
    !next.hasAttribute('disabled') &&
    next.getAttribute('aria-disabled') !== 'true';
  const current = doc.querySelector(
    '[aria-current="true"], [aria-current="page"], li[class*="pagination__indicator--active"]'
  );
  const page = Number.parseInt(text(current) ?? '', 10);
  const pageState = text(doc.querySelector('[class*="pagination__page-state"]'));
  const total = Number.parseInt(
    pageState?.match(/of\s+(\d+)/i)?.[1] ?? '',
    10
  );
  return {
    hasNext,
    page: Number.isFinite(page) ? page : null,
    total: Number.isFinite(total) ? total : null,
  };
}

export function findNextButton(doc: Document): HTMLElement | null {
  const el = doc.querySelector<HTMLElement>(
    'button[aria-label="Next"], button[class*="pagination__button--next"], a[aria-label="Next"]'
  );
  if (!el || el.hasAttribute('disabled')) return null;
  return el.getAttribute('aria-disabled') === 'true' ? null : el;
}

export function parsePage(doc: Document, url: string): PageContext {
  const kind = classifyUrl(url);
  const empty = { hasNext: false, page: null, total: null };
  if (kind === 'profile') {
    return {
      kind,
      url,
      person: parseProfile(doc, url),
      people: [],
      pagination: empty,
    };
  }
  if (kind === 'sales_list' || kind === 'sales_search') {
    return {
      kind,
      url,
      person: null,
      people: parseSalesPeople(doc, url),
      pagination: parsePagination(doc),
    };
  }
  return { kind, url, person: null, people: [], pagination: empty };
}
