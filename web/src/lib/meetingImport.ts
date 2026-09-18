import type { Person } from '../types';

export interface MeetingEntry {
  /** Name as written in the meeting notes. */
  name: string;
  /** Title captured alongside the name, when the notes recorded one. */
  title: string | null;
}

export type MatchConfidence = 'exact' | 'strong' | 'guess' | 'none';

export interface MeetingMatch {
  entry: MeetingEntry;
  person: Person | null;
  confidence: MatchConfidence;
  /** Other plausible people when the match isn't clean. */
  alternates: Person[];
}

const NOT_NAME_WORDS = new Set([
  'title', 'titles', 'not', 'recorded', 'notes', 'note', 'explicitly',
  'captured', 'capture', 'met', 'with', 'meeting', 'meetings', 'everyone',
  'everybody', 'people', 'person', 'who', 'whom', 'the', 'and', 'or', 'of',
  'in', 'on', 'at', 'for', 'from', 'list', 'lists', 'below', 'above',
  'attendees', 'participant', 'participants', 'names', 'name', 'mapped',
  'unmatched', 'no', 'unknown', 'n/a', 'none', 'here',
]);

function tokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function looksLikeName(value: string): boolean {
  const parts = tokens(value);
  if (parts.length === 0 || parts.length > 5) return false;
  if (parts.some((part) => NOT_NAME_WORDS.has(part))) return false;
  // A plausible name has at least one alphabetic token.
  return parts.some((part) => /[a-z]/.test(part));
}

function splitSegments(raw: string): string[] {
  return raw
    .split(/[\n\r;]+/)
    .map((segment) => segment.replace(/^\s*[-*•✓✔✅‣·>]+\s*/, '').trim())
    .filter(Boolean);
}

/**
 * Parse a pasted Granola-style "everyone I've met" dump into name/title
 * entries. Accepts `Name — Title`, `Name - Title`, bullet lists, and
 * semicolon-separated runs; section headers and prose are skipped.
 */
export function parseMeetingText(raw: string): MeetingEntry[] {
  const entries: MeetingEntry[] = [];
  const seen = new Set<string>();
  for (const segment of splitSegments(raw)) {
    const titled = segment.match(/^(.+?)\s+[—–-]\s+(.+)$/);
    let name = segment;
    let title: string | null = null;
    if (titled && looksLikeName(titled[1]) && !NOT_NAME_WORDS.has(tokens(titled[2])[0] ?? '')) {
      name = titled[1].trim();
      title = titled[2].trim() || null;
    }
    if (!looksLikeName(name)) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({ name, title });
  }
  return entries;
}

function canonical(value: string): string {
  return tokens(value).join(' ');
}

function compact(value: string): string {
  return canonical(value).replace(/\s+/g, '');
}

function nameTokens(value: string): Set<string> {
  return new Set(tokens(value));
}

/**
 * Match parsed meeting entries to people already on the map.
 * exact: full-name equality. strong: token containment (either direction).
 * guess: single-token or concatenated-name equality that's unique.
 * Ambiguous guesses surface alternates for manual confirmation instead of
 * silently marking the wrong person.
 */
export function matchMeetingPeople(
  entries: MeetingEntry[],
  people: Person[]
): MeetingMatch[] {
  return entries.map((entry) => {
    const want = canonical(entry.name);
    const wantTokens = nameTokens(entry.name);
    const wantCompact = compact(entry.name);

    const exact = people.filter(
      (person) => canonical(person.name) === want
    );
    if (exact.length > 0) {
      return {
        entry,
        person: exact[0],
        confidence: 'exact',
        alternates: exact.slice(1),
      };
    }

    const strong = people.filter((person) => {
      const have = nameTokens(person.name);
      const wantInHave = [...wantTokens].every((token) => have.has(token));
      const haveInWant = [...have].every((token) => wantTokens.has(token));
      return wantInHave || haveInWant;
    });
    if (strong.length > 0) {
      return {
        entry,
        person: strong[0],
        confidence: 'strong',
        alternates: strong.slice(1),
      };
    }

    // Single or collapsed forms: "Dhruv", "Averybrandes" — match only when
    // exactly one person fits, otherwise surface candidates.
    const guesses = people.filter((person) => {
      const personTokens = tokens(person.name);
      if (personTokens.includes(wantCompact) && wantTokens.size === 1) {
        return true;
      }
      return (
        compact(person.name) === wantCompact ||
        compact(personTokens.reverse().join(' ')) === wantCompact
      );
    });
    if (guesses.length === 1) {
      return { entry, person: guesses[0], confidence: 'guess', alternates: [] };
    }
    return {
      entry,
      person: guesses[0] ?? null,
      confidence: guesses.length > 0 ? 'guess' : 'none',
      alternates: guesses.slice(1),
    };
  });
}
