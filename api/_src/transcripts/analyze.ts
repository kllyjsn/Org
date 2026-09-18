import { chat, activeProvider } from '../llm.js';
import { extractJson } from '../research.js';
import { matchPerson } from '../identity.js';
import { transcriptPrompt, type TranscriptPromptInput } from './prompt.js';
import type {
  Confidence,
  Person,
  Stance,
  StanceSignal,
  TranscriptAnalysis,
  TranscriptQuote,
  TranscriptSpeaker,
} from '../types.js';

const STANCES: Stance[] = ['advocate', 'neutral', 'skeptic', 'unknown'];
const SIGNALS: StanceSignal[] = [
  'support',
  'objection',
  'question',
  'budget',
  'timeline',
  'authority',
  'competitor',
];
const CONFIDENCES: Confidence[] = ['high', 'medium', 'low'];

function compact(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function appearsInTranscript(quote: string, transcriptCompact: string): boolean {
  return transcriptCompact.includes(compact(quote));
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Coerce raw LLM output into a trustworthy analysis: enums clamped to
 * allowed values, non-verbatim quotes dropped (the whole feature rests on
 * quotes being copyable evidence), ungrounded stances demoted, and speaker
 * → person resolution via identity name matching.
 */
export function sanitizeAnalysis(
  raw: unknown,
  people: Pick<Person, 'id' | 'name' | 'email' | 'linkedin'>[],
  transcript: string,
  meta: { provider: string | null; analyzedAt: string }
): TranscriptAnalysis {
  const value = (raw ?? {}) as Record<string, unknown>;
  const transcriptCompact = compact(transcript);

  const speakers: TranscriptSpeaker[] = (Array.isArray(value.speakers)
    ? value.speakers
    : []
  )
    .slice(0, 25)
    .map((item) => {
      const row = (item ?? {}) as Record<string, unknown>;
      const speakerLabel =
        stringOrNull(row.speakerLabel) ?? 'Unknown speaker';
      const matchedName = stringOrNull(row.matchedName);
      const match = matchPerson(
        { name: matchedName ?? speakerLabel },
        people
      );
      const stance = STANCES.includes(row.stance as Stance)
        ? (row.stance as Stance)
        : 'unknown';
      const confidence = CONFIDENCES.includes(row.confidence as Confidence)
        ? (row.confidence as Confidence)
        : 'low';
      const quotes: TranscriptQuote[] = (Array.isArray(row.quotes)
        ? row.quotes
        : []
      )
        .map((quote) => {
          const q = (quote ?? {}) as Record<string, unknown>;
          const text = stringOrNull(q.text);
          if (!text || !appearsInTranscript(text, transcriptCompact)) {
            return null;
          }
          return {
            text,
            signal: SIGNALS.includes(q.signal as StanceSignal)
              ? (q.signal as StanceSignal)
              : 'question',
          };
        })
        .filter((q): q is TranscriptQuote => q !== null)
        .slice(0, 4);
      return {
        speakerLabel,
        matchedName: match?.name ?? matchedName,
        matchedPersonId: match?.id ?? null,
        inferredTitle: stringOrNull(row.inferredTitle),
        // A stance without surviving evidence is not a stance.
        stance: stance !== 'unknown' && quotes.length === 0 ? 'unknown' : stance,
        confidence,
        quotes,
        summary: stringOrNull(row.summary) ?? '',
      };
    })
    .filter((speaker) => speaker.speakerLabel !== '');

  const stringList = (key: string) =>
    (Array.isArray(value[key]) ? value[key] : [])
      .map((item) => stringOrNull(item))
      .filter((item): item is string => item !== null)
      .slice(0, 5);

  return {
    speakers,
    nextSteps: stringList('nextSteps'),
    risks: stringList('risks'),
    provider: meta.provider,
    analyzedAt: meta.analyzedAt,
  };
}

export async function analyzeTranscript(
  input: TranscriptPromptInput,
  people: Pick<Person, 'id' | 'name' | 'email' | 'linkedin'>[],
  options?: { demoFixture?: boolean }
): Promise<TranscriptAnalysis> {
  const provider = activeProvider();
  if (provider === 'fixture') {
    if (options?.demoFixture) {
      return {
        speakers: [],
        nextSteps: [],
        risks: [],
        provider: 'fixture',
        analyzedAt: new Date().toISOString(),
      };
    }
    throw new Error('No LLM provider configured — set an LLM API key');
  }
  const result = await chat(
    [
      {
        role: 'system',
        content:
          'You analyze sales-call transcripts. Output only the JSON requested.',
      },
      { role: 'user', content: transcriptPrompt(input) },
    ],
    {
      maxTokens: 6_000,
      json: true,
      deadlineMs: Date.now() + 45_000,
    }
  );
  const parsed = extractJson(result.content);
  return sanitizeAnalysis(parsed, people, input.transcript, {
    provider: result.provider,
    analyzedAt: new Date().toISOString(),
  });
}
