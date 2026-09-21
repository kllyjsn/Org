import { chat } from './llm.js';
import { extractJson } from './research.js';
import type {
  MapState,
  Person,
  SellerProfile,
  StrategicInitiative,
} from './types.js';

export interface OutreachDraft {
  generatedAt: string;
  provider: string;
  subject: string;
  emailBody: string;
  linkedinNote: string;
  talkingPoints: string[];
  /** URLs the draft is grounded in — empty for template/hypothesis content. */
  evidence: string[];
}

function cleanText(value: unknown, max = 500): string {
  return typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, max)
    : '';
}

function firstName(person: Person): string {
  return (person.name ?? '').trim().split(/\s+/)[0] || 'there';
}

function normalized(value: string | null | undefined) {
  return (value ?? '').trim().toLowerCase();
}

function relevantInitiatives(state: MapState, person: Person) {
  const initiatives = state.meta?.initiatives ?? [];
  return initiatives.filter(
    (initiative) =>
      (initiative.relevantPeople ?? []).some(
        (name) => normalized(name) === normalized(person.name)
      ) ||
      (initiative.relevantTeams ?? []).some((team) =>
        [person.team, person.department, person.productLine].some(
          (value) =>
            !!value &&
            (normalized(team).includes(normalized(value)) ||
              normalized(value).includes(normalized(team)))
        )
      )
  );
}

const ROLE_CONTEXT: Record<Person['role'], string> = {
  champion: 'an internal champion who can advocate and broker introductions',
  economic_buyer: 'the economic buyer who owns the budget decision',
  decision_maker: 'a decision maker in the buying group',
  technical_buyer: 'a technical evaluator who will probe fit and risk',
  influencer: 'an influencer whose opinion shapes the decision',
  blocker: 'a potential blocker — lead with de-risking and proof',
  none: 'a stakeholder in the account',
};

/**
 * Deterministic draft used when no LLM provider is configured or the model
 * fails — the feature still works in fixture mode, grounded only in map data.
 */
export function templateOutreachDraft(
  state: MapState,
  person: Person,
  sellerProfile: SellerProfile | null
): OutreachDraft {
  const company = state.meta?.companyName || state.meta?.domain || 'your team';
  const initiatives = relevantInitiatives(state, person);
  const sellerName = sellerProfile?.companyName || 'our team';
  const first = firstName(person);
  const angle = initiatives[0]?.salesAngles?.[0] ?? initiatives[0]?.summary;
  const hook = angle
    ? `I saw ${company} is focused on ${initiatives[0]!.name} — ${angle}`
    : `I've been mapping ${company}'s team and your role as ${ROLE_CONTEXT[person.role]} stood out`;
  const proof = sellerProfile?.proofPoints?.[0]
    ? ` ${sellerProfile.proofPoints[0]}.`
    : '';
  const subject = `${initiatives[0]?.name ?? `${company} priorities`} — quick idea`;
  const emailBody =
    `Hi ${first},\n\n${hook}.${proof}\n\n` +
    `Would a 15-minute call to compare notes be useful? ` +
    `Happy to share what we're seeing work with similar teams.\n\nBest,`;
  const linkedinNote =
    `Hi ${first} — your work on ${initiatives[0]?.name ?? `priorities at ${company}`} caught my eye. ` +
    `${sellerName} helps teams on exactly that; open to a quick chat?`;
  const talkingPoints = [
    `Role: ${ROLE_CONTEXT[person.role]} — frame the ask accordingly.`,
    ...(initiatives.slice(0, 2).map(
      (i: StrategicInitiative) => `Initiative: ${i.name} — ${i.summary}`
    )),
    ...(person.notes ? [`Notes on file: ${person.notes.slice(0, 160)}`] : []),
    `Verify current scope before outreach — evidence confidence is ${person.confidence}.`,
  ];
  return {
    generatedAt: new Date().toISOString(),
    provider: 'template',
    subject: cleanText(subject, 120),
    emailBody,
    linkedinNote: cleanText(linkedinNote, 280),
    talkingPoints: talkingPoints.slice(0, 5),
    evidence: (person.sources ?? []).filter((s) => /^https?:\/\//i.test(s)).slice(0, 4),
  };
}

export async function draftOutreach(
  state: MapState,
  person: Person,
  sellerProfile: SellerProfile | null
): Promise<OutreachDraft> {
  const fallback = templateOutreachDraft(state, person, sellerProfile);
  const company = state.meta?.companyName || state.meta?.domain || 'the account';
  const initiatives = relevantInitiatives(state, person);
  const prompt = `Write outreach drafts for a seller contacting one specific stakeholder.

ACCOUNT
${company} (${state.meta?.domain ?? ''})

STAKEHOLDER
${JSON.stringify({
  name: person.name,
  title: person.title,
  department: person.department,
  team: person.team,
  productLine: person.productLine,
  buyingRole: person.role,
  roleMeaning: ROLE_CONTEXT[person.role],
  notes: person.notes || undefined,
  sources: (person.sources ?? []).slice(0, 4),
})}

RELEVANT ACCOUNT INITIATIVES
${JSON.stringify(
  initiatives.map((i) => ({
    name: i.name,
    summary: i.summary,
    salesAngles: i.salesAngles,
    evidence: (i.evidence ?? []).slice(0, 3),
  }))
)}

SELLER
${
  sellerProfile
    ? `${sellerProfile.companyName} (${sellerProfile.domain})
Products: ${(sellerProfile.products ?? []).join('; ') || 'unknown'}
Use cases: ${(sellerProfile.useCases ?? []).join('; ') || 'unknown'}
Positioning: ${sellerProfile.positioning || sellerProfile.summary || 'unknown'}
Proof points: ${(sellerProfile.proofPoints ?? []).join('; ') || 'none supplied'}`
    : 'No seller profile configured — keep the drafts generic and credible.'
}

Rules: reference only the evidence and initiatives above; never invent facts
about the person or account. Sound like a person, not a sequence tool — short
sentences, one idea per message, no buzzwords. The email is at most 120 words.
The LinkedIn note is at most 280 characters (connection-note limit).

Return JSON only:
{
  "subject": "email subject line",
  "emailBody": "email body text",
  "linkedinNote": "linkedin connection note, <=280 chars",
  "talkingPoints": ["up to 4 short bullets for a call prep"],
  "evidence": ["urls from the input that the drafts rely on"]
}`;
  try {
    const result = await chat(
      [
        {
          role: 'system',
          content:
            'You write concise, evidence-grounded enterprise outreach. You never fabricate claims.',
        },
        { role: 'user', content: prompt },
      ],
      { maxTokens: 2_500, json: true, deadlineMs: Date.now() + 25_000 }
    );
    const parsed = extractJson(result.content) as Record<string, unknown>;
    const emailBody = typeof parsed.emailBody === 'string'
      ? parsed.emailBody.trim().slice(0, 3_000)
      : '';
    if (!emailBody) return fallback;
    return {
      generatedAt: new Date().toISOString(),
      provider: result.provider,
      subject: cleanText(parsed.subject, 140) || fallback.subject,
      emailBody,
      linkedinNote:
        cleanText(parsed.linkedinNote, 280) || fallback.linkedinNote,
      talkingPoints: Array.isArray(parsed.talkingPoints)
        ? parsed.talkingPoints
            .map((item) => cleanText(item, 240))
            .filter(Boolean)
            .slice(0, 4)
        : fallback.talkingPoints,
      evidence: Array.isArray(parsed.evidence)
        ? parsed.evidence
            .filter(
              (item): item is string =>
                typeof item === 'string' && /^https?:\/\//i.test(item)
            )
            .slice(0, 4)
        : fallback.evidence,
    };
  } catch {
    return fallback;
  }
}
