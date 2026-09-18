import {
  sumbleAllPeople,
  sumbleRelatedPeople,
  sumbleResolveOrg,
} from './sumble.js';

export interface RosterCandidate {
  name: string;
  title: string | null;
  location: string | null;
  linkedin: string | null;
  email: string | null;
  managerName: string | null;
  managerLinkedin: string | null;
  jobLevel: string | null;
  functionHint: string | null;
  sourceUrl: string | null;
  raw: unknown;
}

export interface RosterProvider {
  id: 'sumble' | 'crustdata';
  label: string;
  available(): boolean;
  fetch(
    domain: string,
    opts: {
      max: number;
      deadlineMs: number;
      onProgress: (n: number) => void;
    }
  ): Promise<RosterCandidate[]>;
}

function attr(row: Record<string, unknown>): Record<string, unknown> {
  return (
    row.attributes && typeof row.attributes === 'object'
      ? row.attributes
      : row
  ) as Record<string, unknown>;
}

function text(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

const sumbleProvider: RosterProvider = {
  id: 'sumble',
  label: 'Sumble',
  available: () => !!process.env.SUMBLE_API_KEY,
  async fetch(domain, opts) {
    const key = process.env.SUMBLE_API_KEY;
    if (!key) return [];
    const org = await sumbleResolveOrg(domain, key, opts.deadlineMs);
    if (!org) return [];
    const [peopleResult, related] = await Promise.all([
      sumbleAllPeople(org.id, key, opts),
      sumbleRelatedPeople(org.id, key, opts.deadlineMs),
    ]);
    return peopleResult.people.flatMap((row) => {
      const a = attr(row);
      const name = text(a.name);
      if (!name) return [];
      const linkedin = text(a.linkedin_url);
      const managerName = related.get(name.toLowerCase()) ?? null;
      return [{
        name,
        title: text(a.job_title ?? a.title),
        location: text(a.location),
        linkedin,
        email: text(a.email),
        managerName,
        managerLinkedin: null,
        jobLevel: text(a.job_level),
        functionHint: text(a.job_function),
        sourceUrl: text(a.sumble_url),
        raw: row,
      }];
    });
  },
};

function crustText(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    return text(o.name ?? o.full_location ?? o.raw ?? o.value ?? o.matched_title);
  }
  return null;
}

function crustNested(row: Record<string, unknown>, path: string[]): unknown {
  let current: unknown = row;
  for (const part of path) {
    if (!current || typeof current !== 'object') return null;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}
const crustdataProvider: RosterProvider = {
  id: 'crustdata',
  label: 'Crustdata',
  available: () => !!process.env.CRUSTDATA_API_KEY,
  async fetch(domain, opts) {
    const key = process.env.CRUSTDATA_API_KEY;
    if (!key) return [];
    const out: RosterCandidate[] = [];
    let cursor: string | null = null;
    while (out.length < opts.max && Date.now() < opts.deadlineMs - 1000) {
      const response = await fetch('https://api.crustdata.com/person/search', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'content-type': 'application/json',
          'x-api-version': '2025-11-01',
        },
        body: JSON.stringify({
          filters: { field: 'experience.employment_details.current.company_website_domain', type: '=', value: domain },
          limit: Math.min(1000, opts.max - out.length),
          ...(cursor ? { cursor } : {}),
          fields: ['basic_profile', 'experience.employment_details.current', 'professional_network'],
        }),
        signal: AbortSignal.timeout(Math.max(1000, Math.min(10000, opts.deadlineMs - Date.now()))),
      });
      if (!response.ok) throw new Error(`Crustdata request failed (${response.status})`);
      const payload = await response.json() as Record<string, unknown>;
      const profiles = Array.isArray(payload.profiles) ? payload.profiles as Record<string, unknown>[] : [];
      for (const row of profiles) {
        const basic = (row.basic_profile ?? {}) as Record<string, unknown>;
        const current = (
          crustNested(row, [
            'experience',
            'employment_details',
            'current',
          ]) ?? {}
        ) as Record<string, unknown>;
        const name = crustText(
          basic.name ??
            [basic.first_name, basic.last_name].filter(Boolean).join(' ')
        );
        if (!name) continue;
        const linkedin = crustText(
          row.linkedin_url ??
            crustNested(row, ['professional_network', 'linkedin_url']) ??
            crustNested(row, ['professional_network', 'profile_url'])
        );
        out.push({
          name,
          title: crustText(current.title ?? basic.headline),
          location: crustText(basic.location),
          linkedin,
          email: crustText(row.email),
          managerName: null,
          managerLinkedin: null,
          jobLevel: crustText(
            current.seniority_level ?? basic.seniority_level
          ),
          functionHint: crustText(
            basic.normalized_title &&
              typeof basic.normalized_title === 'object'
              ? (basic.normalized_title as Record<string, unknown>).department
              : null
          ),
          sourceUrl: linkedin,
          raw: row,
        });
      }
      opts.onProgress(out.length);
      cursor = typeof payload.next_cursor === 'string' ? payload.next_cursor : null;
      if (!cursor || profiles.length === 0) break;
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
    return out.slice(0, opts.max);
  },
};

export function rosterProviders(): RosterProvider[] {
  return [sumbleProvider, crustdataProvider];
}

export function configuredRosterProviders(): string[] {
  return rosterProviders()
    .filter((provider) => provider.available())
    .map((provider) => provider.id);
}
