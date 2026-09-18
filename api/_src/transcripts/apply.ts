import { randomUUID } from 'node:crypto';
import type {
  AccountStrategyPlan,
  MapState,
  StanceEvidence,
  TranscriptAnalysis,
} from '../types.js';

/**
 * Fold an analysis into the strategy plan. A rep's hand-set stance
 * (stanceSource 'manual') always wins; transcript-sourced stances are
 * replaced by newer transcripts. Evidence accumulates, deduped by quote.
 */
export function applyAnalysisToStrategy(
  plan: AccountStrategyPlan | undefined,
  analysis: TranscriptAnalysis,
  transcript: { id: string; title: string | null; occurredAt: string | null },
  overrides: Record<string, string | null> = {}
): { plan: AccountStrategyPlan; touchedPersonIds: string[] } {
  const next: AccountStrategyPlan = {
    stakeholders: { ...(plan?.stakeholders ?? {}) },
    tasks: [...(plan?.tasks ?? [])],
    updatedAt: new Date().toISOString(),
    ...(plan?.entryPersonId !== undefined
      ? { entryPersonId: plan.entryPersonId }
      : {}),
    ...(plan?.targetPersonId !== undefined
      ? { targetPersonId: plan.targetPersonId }
      : {}),
  };
  const touched = new Set<string>();

  for (const speaker of analysis.speakers ?? []) {
    const override = overrides[speaker.speakerLabel];
    const personId =
      override !== undefined ? override : speaker.matchedPersonId;
    if (override === null || !personId) continue;

    const existing = next.stakeholders[personId] ?? {
      stance: 'unknown' as const,
      nextStep: '',
      note: '',
    };
    const entry = { ...existing };

    // Stance: never overwrite a rep's manual call; transcript may refresh
    // itself or fill in an 'unknown'.
    if (
      speaker.stance !== 'unknown' &&
      (existing.stanceSource !== 'manual' || existing.stance === 'unknown')
    ) {
      entry.stance = speaker.stance;
      entry.stanceSource = 'transcript';
    }

    // Evidence: append surviving quotes, deduped by quote text, newest 8.
    const seen = new Set(
      (entry.evidence ?? []).map((e) => e.quote.trim().toLowerCase())
    );
    const additions: StanceEvidence[] = speaker.quotes
      .filter((q) => !seen.has(q.text.trim().toLowerCase()))
      .map((q) => ({
        quote: q.text,
        signal: q.signal,
        transcriptId: transcript.id,
        title: transcript.title,
        occurredAt: transcript.occurredAt,
      }));
    if (additions.length > 0) {
      entry.evidence = [...(entry.evidence ?? []), ...additions].slice(-8);
    }

    // First nextStep mentioning the person's first name fills an empty slot.
    if (!entry.nextStep) {
      const firstName = (speaker.matchedName ?? speaker.speakerLabel)
        .split(/\s+/)[0]
        .toLowerCase();
      const step = analysis.nextSteps.find((s) =>
        s.toLowerCase().includes(firstName)
      );
      if (step) entry.nextStep = step.slice(0, 500);
    }

    next.stakeholders[personId] = entry;
    touched.add(personId);
  }

  // Next steps become generated tasks unless already tracked.
  const taskTitles = new Set(
    next.tasks.map((task) => task.title.trim().toLowerCase())
  );
  for (const step of analysis.nextSteps.slice(0, 5)) {
    if (taskTitles.has(step.trim().toLowerCase())) continue;
    next.tasks.push({
      id: randomUUID(),
      title: step.slice(0, 500),
      done: false,
      source: 'generated',
      createdAt: new Date().toISOString(),
    });
    taskTitles.add(step.trim().toLowerCase());
  }

  return { plan: next, touchedPersonIds: [...touched] };
}

/** The call itself is a touch: attendees were met with. */
export function applyAnalysisToPeople(
  state: MapState,
  touchedPersonIds: string[],
  occurredAt: string | null
): MapState {
  const touched = new Set(touchedPersonIds);
  const people = (state.people ?? []).map((person) => {
    if (!touched.has(person.id)) return person;
    const next = { ...person, metWith: true };
    if (occurredAt) {
      const existingMs = person.lastTouchAt
        ? Date.parse(person.lastTouchAt)
        : Number.NEGATIVE_INFINITY;
      if (Date.parse(occurredAt) > existingMs) next.lastTouchAt = occurredAt;
      next.touchSource = next.touchSource ?? 'manual';
    }
    return next;
  });
  return { ...state, people };
}
