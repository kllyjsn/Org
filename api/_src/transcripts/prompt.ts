import type { Person } from '../types.js';

export interface TranscriptPromptInput {
  companyName: string;
  domain: string;
  title: string | null;
  occurredAt: string | null;
  people: Pick<Person, 'id' | 'name' | 'title' | 'role'>[];
  sellerSummary: string | null;
  transcript: string;
}

export const TRANSCRIPT_MAX_CHARS = 60_000;

/**
 * Prompt for stance inference from a sales-call transcript. The model must
 * only attribute stance to what a speaker actually said and must return
 * verbatim quotes as evidence; anything it cannot ground is 'unknown'.
 */
export function transcriptPrompt(input: TranscriptPromptInput): string {
  const roster = input.people
    .map((p) => `- ${p.name} — ${p.title || 'title unknown'} (mapped role: ${p.role})`)
    .join('\n');
  const transcript =
    input.transcript.length > TRANSCRIPT_MAX_CHARS
      ? input.transcript.slice(0, TRANSCRIPT_MAX_CHARS) + '\n[transcript truncated]'
      : input.transcript;

  return `You analyze a B2B sales call transcript and infer each buyer-side speaker's stance toward the seller's proposal.

Account: ${input.companyName} (${input.domain})
Call: ${input.title ?? 'untitled'}${input.occurredAt ? ` on ${input.occurredAt}` : ''}
${input.sellerSummary ? `Seller: ${input.sellerSummary}\n` : ''}
Known stakeholders on the account map (match speakers to these by name when clearly the same person; otherwise leave matchedName null):
${roster || '- (none mapped yet)'}

Rules:
1. Only include speakers who appear to work for the buyer (${input.domain}). Skip the seller's own team.
2. stance is one of: "advocate" (actively pushes for the deal or the seller), "neutral" (engaged but non-committal), "skeptic" (raises objections, defends status quo or a competitor), "unknown" (too little said to judge).
3. Every stance other than "unknown" MUST be backed by 1-4 verbatim quotes copied exactly from the transcript. Never paraphrase inside "text". Tag each quote's signal as one of: "support", "objection", "question", "budget", "timeline", "authority", "competitor".
4. confidence is "high" only when multiple quotes point the same way, "medium" for one clear quote, "low" otherwise.
5. summary: one sentence, what this person cares about, in plain language.
6. nextSteps: concrete follow-ups the buyer or seller committed to, as stated. risks: explicit blockers or concerns raised. Keep both to at most 5 items each; empty arrays are fine.
7. Output ONLY the JSON object below. No markdown, no commentary.

{
  "speakers": [
    {
      "speakerLabel": "name or label as it appears in the transcript",
      "matchedName": "exact name from the stakeholder list, or null",
      "inferredTitle": "title if stated in the call, else null",
      "stance": "advocate" | "neutral" | "skeptic" | "unknown",
      "confidence": "high" | "medium" | "low",
      "quotes": [{ "text": "verbatim quote", "signal": "support" }],
      "summary": "one sentence"
    }
  ],
  "nextSteps": ["..."],
  "risks": ["..."]
}

Transcript:
"""
${transcript}
"""`;
}
