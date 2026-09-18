import { randomUUID } from 'node:crypto';
import { matchPerson } from '../identity.js';
import type { BuyingRole, MapState, Person } from '../types.js';
import type { CrmContact, CrmPushContact } from './crm-types.js';

type Provider = 'hubspot' | 'salesforce';

/** CRM role text (TopDown fields, OCR roles, HubSpot enum) → BuyingRole. */
export function buyingRoleFromCrm(role: string | null): BuyingRole | null {
  if (!role) return null;
  const normalized = role.trim().toLowerCase().replace(/[\s-]+/g, '_');
  const direct: Record<string, BuyingRole> = {
    champion: 'champion',
    economic_buyer: 'economic_buyer',
    decision_maker: 'decision_maker',
    technical_buyer: 'technical_buyer',
    influencer: 'influencer',
    blocker: 'blocker',
    none: 'none',
  };
  if (direct[normalized]) return direct[normalized];
  const salesforce: Record<string, BuyingRole> = {
    economic_decision_maker: 'economic_buyer',
    executive_sponsor: 'champion',
    evaluator: 'influencer',
    gatekeeper: 'blocker',
  };
  return salesforce[normalized] ?? null;
}

export interface MergeResult {
  state: MapState;
  matched: number;
  created: number;
  updated: number;
}

/**
 * Fold CRM contacts into the map. Matching honors the crm identity key
 * (strongest — a renamed contact still lands on its person), then the
 * usual linkedin/email/name keys. Existing people get `crm` plus empty
 * fields filled; unmatched contacts optionally become new people in a
 * grid below the current map.
 */
export function mergeCrmContacts(
  state: MapState,
  contacts: CrmContact[],
  provider: Provider,
  opts: { createUnmatched: boolean }
): MergeResult {
  const people = (state.people ?? []).map((p) => ({ ...p }));
  let matched = 0;
  let created = 0;
  let updated = 0;

  const claimedIds = new Set<string>();
  const unclaimed = () => people.filter((p) => !claimedIds.has(p.id));
  const maxY =
    people.length > 0 ? Math.max(...people.map((p) => p.y ?? 0)) + 240 : 0;
  const minX = people.length > 0 ? Math.min(...people.map((p) => p.x ?? 0)) : 0;
  let placed = 0;

  for (const contact of contacts) {
    const crmRef = { provider, contactId: contact.id };
    const match = matchPerson(
      {
        name: contact.name,
        email: contact.email,
        linkedin: contact.linkedin,
        crm: crmRef,
      },
      unclaimed()
    );
    const contactRole = buyingRoleFromCrm(contact.role);

    if (match) {
      claimedIds.add(match.id);
      const index = people.findIndex((p) => p.id === match.id);
      const person = people[index];
      const next = { ...person };
      let dirty = false;
      if (
        next.crm?.provider !== provider ||
        next.crm?.contactId !== contact.id
      ) {
        next.crm = { provider, contactId: contact.id, url: contact.url };
        dirty = true;
      }
      if (!next.email && contact.email) {
        next.email = contact.email;
        dirty = true;
      }
      if (!next.linkedin && contact.linkedin) {
        next.linkedin = contact.linkedin;
        dirty = true;
      }
      if (!(next.title ?? '').trim() && contact.title) {
        next.title = contact.title;
        dirty = true;
      }
      if (next.role === 'none' && contactRole) {
        next.role = contactRole;
        dirty = true;
      }
      if (dirty) {
        people[index] = next;
        updated += 1;
      }
      matched += 1;
      continue;
    }

    if (!opts.createUnmatched) continue;
    const person: Person = {
      id: randomUUID(),
      name: contact.name,
      title: contact.title ?? '',
      department: null,
      role: contactRole ?? 'none',
      confidence: 'medium',
      sources: [],
      sourceDetails: [],
      notes: `Imported from ${provider}`,
      crm: { provider, contactId: contact.id, url: contact.url },
      email: contact.email ?? null,
      linkedin: contact.linkedin ?? null,
      x: minX + (placed % 4) * 300,
      y: maxY + Math.floor(placed / 4) * 260,
    };
    placed += 1;
    people.push(person);
    claimedIds.add(person.id);
    created += 1;
  }

  return { state: { ...state, people }, matched, created, updated };
}

export interface PushRow extends CrmPushContact {
  personId: string;
}

/**
 * People worth pushing: anyone with a real buying role or a non-unknown
 * strategy stance.
 */
export function contactsToPush(state: MapState): PushRow[] {
  const stakeholders = state.meta?.strategy?.stakeholders ?? {};
  return (state.people ?? [])
    .filter((person) => {
      const stance = stakeholders[person.id]?.stance;
      return (
        (person.role ?? 'none') !== 'none' ||
        (stance && stance !== 'unknown')
      );
    })
    .map((person) => ({
      personId: person.id,
      crmId: person.crm?.contactId ?? null,
      name: person.name,
      email: person.email,
      title: person.title,
      role: person.role,
      stance: stakeholders[person.id]?.stance ?? null,
      linkedin: person.linkedin,
    }));
}

/** Stamp the CRM ids/urls the push created back onto people. */
export function applyPushResults(
  state: MapState,
  results: { personId: string; crmId: string; url: string | null }[],
  provider: Provider
): MapState {
  const byPerson = new Map(results.map((r) => [r.personId, r]));
  const people = (state.people ?? []).map((person) => {
    const result = byPerson.get(person.id);
    if (!result) return person;
    if (
      person.crm?.provider === provider &&
      person.crm?.contactId === result.crmId &&
      (person.crm?.url ?? null) === result.url
    ) {
      return person;
    }
    return {
      ...person,
      crm: { provider, contactId: result.crmId, url: result.url },
    };
  });
  return { ...state, people };
}
