import { apolloOrgPeople } from './apollo.js';
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
  id: string;
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

const apolloProvider: RosterProvider = {
  id: 'apollo',
  label: 'Apollo',
  available: () => !!process.env.APOLLO_API_KEY,
  async fetch(domain, opts) {
    const org = await apolloOrgPeople(domain, opts);
    if (!org) return [];
    return org.people.map((person) => ({
      name: person.name,
      title: person.title,
      location: person.location,
      linkedin: person.linkedin,
      email: person.email,
      managerName: null,
      managerLinkedin: null,
      jobLevel: person.jobLevel,
      functionHint: person.functionHint,
      sourceUrl: person.sourceUrl,
      raw: person.raw,
    }));
  },
};

export function rosterProviders(): RosterProvider[] {
  return [sumbleProvider, apolloProvider];
}

export function configuredRosterProviders(): string[] {
  return rosterProviders()
    .filter((provider) => provider.available())
    .map((provider) => provider.id);
}
