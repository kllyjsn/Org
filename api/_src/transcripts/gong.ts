import { IntegrationError } from '../integrations/types.js';
import { matchPerson } from '../identity.js';
import type { Person } from '../types.js';

const BASE = 'https://api.gong.io/v2';

function key(): string | null {
  const access = process.env.GONG_ACCESS_KEY;
  const secret = process.env.GONG_ACCESS_KEY_SECRET;
  if (!access || !secret) return null;
  return Buffer.from(`${access}:${secret}`).toString('base64');
}

export function configured(): boolean {
  return key() !== null;
}

async function gongFetch(
  path: string,
  init?: RequestInit
): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      authorization: `Basic ${key()}`,
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new IntegrationError(res.status, body.slice(0, 200));
  }
  return res.json();
}

export interface GongCall {
  id: string;
  title: string | null;
  started: string | null;
  parties: { name: string | null; emailAddress: string | null; affiliation: string | null }[];
}

interface GongParty {
  name?: string;
  emailAddress?: string;
  affiliation?: string;
}

function emailDomain(email: string | null | undefined): string | null {
  const at = email?.indexOf('@') ?? -1;
  return at > 0 ? email!.slice(at + 1).toLowerCase() : null;
}

/**
 * Calls within the window whose parties overlap the map — either an
 * attendee on the map's domain or a name matching a mapped person.
 */
export async function listCalls(
  fromIso: string,
  toIso: string,
  mapDomain: string,
  people: Pick<Person, 'id' | 'name' | 'email' | 'linkedin'>[]
): Promise<GongCall[]> {
  const calls: GongCall[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 3; page += 1) {
    const body = {
      filter: {
        fromDateTime: fromIso,
        toDateTime: toIso,
        ...(cursor ? { cursor } : {}),
      },
      contentSelector: { exposedFields: { parties: true } },
    };
    const data = (await gongFetch('/calls/extensive', {
      method: 'POST',
      body: JSON.stringify(body),
    })) as {
      calls?: {
        metaData?: { id?: string; title?: string; started?: string };
        parties?: GongParty[];
      }[];
      records?: { cursor?: string };
    };
    for (const call of data.calls ?? []) {
      const parties = (call.parties ?? []).map((p) => ({
        name: p.name ?? null,
        emailAddress: p.emailAddress ?? null,
        affiliation: p.affiliation ?? null,
      }));
      const domain = mapDomain.toLowerCase();
      const domainHit = parties.some(
        (p) => emailDomain(p.emailAddress) === domain
      );
      const nameHit = parties.some(
        (p) => p.name && matchPerson({ name: p.name }, people)
      );
      if (!domainHit && !nameHit) continue;
      calls.push({
        id: call.metaData?.id ?? '',
        title: call.metaData?.title ?? null,
        started: call.metaData?.started ?? null,
        parties,
      });
    }
    cursor = data.records?.cursor;
    if (!cursor) break;
  }
  return calls.filter((call) => call.id);
}

/**
 * Transcript sentences flattened to "Speaker: text" lines, resolving the
 * Gong speakerId to a party name when possible.
 */
export async function fetchTranscript(callId: string): Promise<string> {
  const data = (await gongFetch('/calls/transcript', {
    method: 'POST',
    body: JSON.stringify({ filter: { callIds: [callId] } }),
  })) as {
    callTranscripts?: {
      transcript?: { speakerId?: string; topic?: string; sentences?: { start?: number; text?: string }[] }[];
      parties?: { speakerId?: string; name?: string }[];
    }[];
  };
  const call = data.callTranscripts?.[0];
  if (!call) throw new IntegrationError(404, 'transcript not found');
  const names = new Map(
    (call.parties ?? [])
      .filter((p) => p.speakerId)
      .map((p) => [p.speakerId!, p.name ?? p.speakerId!])
  );
  const lines: string[] = [];
  for (const block of call.transcript ?? []) {
    const speaker = names.get(block.speakerId ?? '') ?? block.speakerId ?? 'Speaker';
    for (const sentence of block.sentences ?? []) {
      const text = (sentence.text ?? '').trim();
      if (text) lines.push(`${speaker}: ${text}`);
    }
  }
  return lines.join('\n');
}
