import { canonicalPersonName } from './researchQuality';

/**
 * Stable identity keys for matching the same person across snapshots,
 * research passes, and imports — names alone are too fuzzy (renames,
 * nicknames), so LinkedIn and email keys outrank the canonical name.
 * Mirrors api/_src/identity.ts.
 */

export function normalizeLinkedin(
  url: string | null | undefined
): string | null {
  if (!url) return null;
  const cleaned = url
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    // www. and country subdomains (uk.linkedin.com) are the same profile.
    .replace(/^(www|[a-z]{2})\.linkedin\.com/, 'linkedin.com');
  const match = cleaned.match(/^linkedin\.com\/in\/([^/?#]+)/);
  const slug = match?.[1]?.replace(/\/+$/, '') ?? '';
  return slug ? `linkedin.com/in/${slug}` : null;
}

export function normalizeEmail(
  email: string | null | undefined
): string | null {
  const normalized = email?.trim().toLowerCase() ?? '';
  return normalized || null;
}

export type IdentityKeys = {
  linkedin: string | null;
  email: string | null;
  name: string;
};

export function personIdentity(person: {
  name: string;
  email?: string | null;
  linkedin?: string | null;
}): IdentityKeys {
  return {
    linkedin: normalizeLinkedin(person.linkedin),
    email: normalizeEmail(person.email),
    name: canonicalPersonName(person.name ?? ''),
  };
}

type Identifiable = {
  name: string;
  email?: string | null;
  linkedin?: string | null;
};

/** Precedence order: LinkedIn is strongest, then email, then canonical name. */
const KEY_ORDER: (keyof IdentityKeys)[] = ['linkedin', 'email', 'name'];

/**
 * Two identities match on `key` when the key is equal AND no stronger key
 * actively contradicts it — a shared name doesn't merge two different
 * LinkedIn profiles.
 */
function keysMatch(candidate: IdentityKeys, person: IdentityKeys, key: keyof IdentityKeys): boolean {
  if (!candidate[key] || candidate[key] !== person[key]) return false;
  for (const stronger of KEY_ORDER.slice(0, KEY_ORDER.indexOf(key))) {
    if (
      candidate[stronger] &&
      person[stronger] &&
      candidate[stronger] !== person[stronger]
    ) {
      return false;
    }
  }
  return true;
}

export function matchPerson<T extends Identifiable>(
  candidate: Identifiable,
  people: T[]
): T | null {
  const keys = personIdentity(candidate);
  for (const key of KEY_ORDER) {
    if (!keys[key]) continue;
    const hit = people.find((person) =>
      keysMatch(keys, personIdentity(person), key)
    );
    if (hit) return hit;
  }
  return null;
}

/**
 * Greedily pair previous/current people on the matchPerson precedence; each
 * person is consumed at most once so one rename can't claim two slots.
 */
export function pairPeople<A extends Identifiable, B extends Identifiable>(
  previous: A[],
  current: B[]
): { pairs: [A, B][]; removed: A[]; added: B[] } {
  const remainingPrev = [...previous];
  const remainingCurr = [...current];
  const pairs: [A, B][] = [];

  for (const key of KEY_ORDER) {
    for (let i = 0; i < remainingPrev.length; i++) {
      const prev = remainingPrev[i];
      const prevKeys = personIdentity(prev);
      if (!prevKeys[key]) continue;
      const j = remainingCurr.findIndex((person) =>
        keysMatch(prevKeys, personIdentity(person), key)
      );
      if (j === -1) continue;
      pairs.push([prev, remainingCurr[j]]);
      remainingPrev.splice(i, 1);
      remainingCurr.splice(j, 1);
      i -= 1;
    }
  }

  return { pairs, removed: remainingPrev, added: remainingCurr };
}
