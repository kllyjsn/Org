import { randomUUID } from 'node:crypto';
import { now, query } from './db.js';
import { chat } from './llm.js';
import { extractJson } from './research.js';
import {
  isFn,
  isSeniority,
  type Fn,
  type Seniority,
} from './taxonomy.js';
import type { SellerProfile } from './types.js';

export type PersonaBuyingRole =
  | 'economic_buyer'
  | 'champion'
  | 'decision_maker'
  | 'technical_buyer'
  | 'influencer'
  | 'blocker';

export const PERSONA_BUYING_ROLES: PersonaBuyingRole[] = [
  'economic_buyer',
  'champion',
  'decision_maker',
  'technical_buyer',
  'influencer',
  'blocker',
];

export interface Persona {
  id: string;
  name: string;
  /** Empty means any function. */
  functions: Fn[];
  /** Inclusive floor: 'vp' means VP and above. */
  minSeniority: Seniority;
  titleKeywords: string[];
  buyingRole: PersonaBuyingRole | null;
  required: boolean;
  sortOrder: number;
}

export type PersonaInput = Omit<Persona, 'id' | 'sortOrder'> & {
  id?: string;
};

interface PersonaRow {
  id: string;
  workspace_id: string;
  name: string;
  functions: string[];
  min_seniority: string;
  title_keywords: string[];
  buying_role: string | null;
  required: boolean;
  sort_order: number;
}

export const MAX_PERSONAS = 24;

function isBuyingRole(value: unknown): value is PersonaBuyingRole {
  return (
    typeof value === 'string' &&
    (PERSONA_BUYING_ROLES as string[]).includes(value)
  );
}

function keywords(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const k = item.trim().toLowerCase().slice(0, 60);
    if (k) seen.add(k);
  }
  return [...seen].slice(0, 20);
}

/** Validate one persona; returns null when it cannot be repaired. */
export function sanitizePersona(input: unknown): PersonaInput | null {
  if (!input || typeof input !== 'object') return null;
  const v = input as Record<string, unknown>;
  const name =
    typeof v.name === 'string' ? v.name.trim().slice(0, 80) : '';
  if (!name) return null;
  const functions = Array.isArray(v.functions)
    ? [...new Set(v.functions.filter(isFn))]
    : [];
  const minSeniority = isSeniority(v.minSeniority)
    ? v.minSeniority
    : isSeniority(v.min_seniority)
      ? v.min_seniority
      : null;
  if (!minSeniority) return null;
  const rawRole = v.buyingRole ?? v.buying_role;
  return {
    ...(typeof v.id === 'string' && v.id.trim() ? { id: v.id.trim() } : {}),
    name,
    functions,
    minSeniority,
    titleKeywords: keywords(v.titleKeywords ?? v.title_keywords),
    buyingRole: isBuyingRole(rawRole) ? rawRole : null,
    required: v.required !== false,
  };
}

export function sanitizePersonas(input: unknown): PersonaInput[] {
  if (!Array.isArray(input)) return [];
  return input
    .map(sanitizePersona)
    .filter((p): p is PersonaInput => p !== null)
    .slice(0, MAX_PERSONAS);
}

const TARGET_FN_HINTS: [RegExp, Fn][] = [
  [/security|soc\b|threat|vulnerab|identity|zero trust|compliance/i, 'security'],
  [/developer|engineer|devops|platform|infrastructure|api|observab|cloud/i, 'engineering'],
  [/data (team|platform|engineer)|analytics|warehouse|\bbi\b|machine learning/i, 'data'],
  [/\bit\b|help ?desk|endpoint|device management|service desk/i, 'it'],
  [/sales|revenue|\bgtm\b|pipeline|quota|\bsdr\b|deal/i, 'sales'],
  [/marketing|demand|campaign|brand|content|\bseo\b/i, 'marketing'],
  [/customer success|retention|churn|onboarding|account management/i, 'customer_success'],
  [/support|ticket|contact center|help center/i, 'support'],
  [/financ|accounting|spend|expense|procurement|payments|billing|treasury|\bfp&a\b/i, 'finance'],
  [/legal|contract|counsel|privacy/i, 'legal'],
  [/\bhr\b|people|recruit|talent|payroll|benefits|workforce/i, 'people'],
  [/product (team|manager)|roadmap|user research/i, 'product'],
  [/design|ux|prototype/i, 'design'],
  [/operations|\bops\b|supply chain|logistics|workflow/i, 'operations'],
];

/** Which functions the seller most plausibly sells into, from profile text. */
export function inferTargetFunctions(profile: SellerProfile | null): Fn[] {
  if (!profile) return ['operations'];
  const text = [
    ...profile.targetCustomers,
    ...profile.useCases,
    ...profile.products,
    profile.summary,
    profile.positioning,
  ].join(' \n ');
  const scores = new Map<Fn, number>();
  for (const [re, fn] of TARGET_FN_HINTS) {
    const hits = text.match(new RegExp(re.source, 'gi'))?.length ?? 0;
    if (hits > 0) scores.set(fn, (scores.get(fn) ?? 0) + hits);
  }
  const ranked = [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([fn]) => fn)
    .slice(0, 2);
  return ranked.length > 0 ? ranked : ['operations'];
}

/**
 * Deterministic default committee. Works with no LLM and no seller profile;
 * a profile only sharpens the Champion's function.
 */
export function defaultPersonas(
  profile: SellerProfile | null = null
): PersonaInput[] {
  const target = inferTargetFunctions(profile);
  return [
    {
      name: 'Economic buyer – Finance',
      functions: ['finance'],
      minSeniority: 'vp',
      titleKeywords: [],
      buyingRole: 'economic_buyer',
      required: true,
    },
    {
      name: 'Champion – Target function',
      functions: target,
      minSeniority: 'director',
      titleKeywords: [],
      buyingRole: 'champion',
      required: true,
    },
    {
      name: 'Technical buyer – Engineering & Security',
      functions: ['engineering', 'security', 'it'],
      minSeniority: 'director',
      titleKeywords: [],
      buyingRole: 'technical_buyer',
      required: true,
    },
    {
      name: 'Decision maker – C-level',
      functions: [],
      minSeniority: 'c_level',
      titleKeywords: [],
      buyingRole: 'decision_maker',
      required: true,
    },
    {
      name: 'Procurement & Legal',
      functions: ['legal'],
      minSeniority: 'manager',
      titleKeywords: ['procurement', 'vendor', 'sourcing', 'contracts'],
      buyingRole: 'blocker',
      required: false,
    },
    {
      name: 'Influencer – Operations',
      functions: ['operations'],
      minSeniority: 'manager',
      titleKeywords: [],
      buyingRole: 'influencer',
      required: false,
    },
  ];
}

/** LLM-suggested personas from the seller profile; falls back to defaults. */
export async function suggestPersonas(
  profile: SellerProfile | null
): Promise<{ personas: PersonaInput[]; source: 'llm' | 'fallback' }> {
  const fallback = defaultPersonas(profile);
  if (!profile || !profile.companyName) {
    return { personas: fallback, source: 'fallback' };
  }
  try {
    const result = await chat(
      [
        {
          role: 'system',
          content:
            'You design B2B buying-committee targeting. Return strict JSON only.',
        },
        {
          role: 'user',
          content: `Seller: ${profile.companyName} (${profile.domain})
Summary: ${profile.summary}
Products: ${profile.products.join('; ')}
Target customers: ${profile.targetCustomers.join('; ')}
Use cases: ${profile.useCases.join('; ')}
Positioning: ${profile.positioning}

Propose 5–8 buyer personas this seller should cover in every target account.
Use ONLY these function values: executive, engineering, product, design, data,
security, it, sales, marketing, customer_success, support, finance, legal,
people, operations, other. Use ONLY these seniority values (the floor; "vp"
means VP and above): c_level, evp_svp, vp, director, manager, lead, ic.
Buying role must be one of economic_buyer, champion, decision_maker,
technical_buyer, influencer, blocker.

Return ONLY:
{"personas":[{"name":"Economic buyer – Finance","functions":["finance"],"minSeniority":"vp","titleKeywords":[],"buyingRole":"economic_buyer","required":true}]}`,
        },
      ],
      { json: true, maxTokens: 1500, deadlineMs: Date.now() + 25_000 }
    );
    const parsed = extractJson(result.content) as {
      personas?: unknown;
    } | null;
    const personas = sanitizePersonas(parsed?.personas);
    if (personas.length >= 3) return { personas, source: 'llm' };
  } catch (error) {
    console.warn(
      `persona suggestion failed: ${
        error instanceof Error ? error.message.slice(0, 200) : 'unknown error'
      }`
    );
  }
  return { personas: fallback, source: 'fallback' };
}

function rowToPersona(row: PersonaRow): Persona {
  return {
    id: row.id,
    name: row.name,
    functions: row.functions.filter(isFn),
    minSeniority: isSeniority(row.min_seniority) ? row.min_seniority : 'ic',
    titleKeywords: row.title_keywords ?? [],
    buyingRole: isBuyingRole(row.buying_role) ? row.buying_role : null,
    required: row.required,
    sortOrder: row.sort_order,
  };
}

export async function listPersonas(workspaceId: string): Promise<Persona[]> {
  const rows = await query<PersonaRow>(
    'SELECT * FROM personas WHERE workspace_id = $1 ORDER BY sort_order, created_at',
    [workspaceId]
  );
  return rows.map(rowToPersona);
}

/** Replace-all: rows not in `personas` are deleted, ids are kept when given. */
export async function replacePersonas(
  workspaceId: string,
  personas: PersonaInput[]
): Promise<Persona[]> {
  const ts = now();
  const ids = personas.map((p) => p.id ?? randomUUID());
  await query(
    'DELETE FROM personas WHERE workspace_id = $1 AND NOT (id = ANY($2::text[]))',
    [workspaceId, ids]
  );
  for (const [index, persona] of personas.entries()) {
    await query(
      `INSERT INTO personas
        (id, workspace_id, name, functions, min_seniority, title_keywords,
         buying_role, required, sort_order, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         functions = EXCLUDED.functions,
         min_seniority = EXCLUDED.min_seniority,
         title_keywords = EXCLUDED.title_keywords,
         buying_role = EXCLUDED.buying_role,
         required = EXCLUDED.required,
         sort_order = EXCLUDED.sort_order,
         updated_at = EXCLUDED.updated_at
       WHERE personas.workspace_id = EXCLUDED.workspace_id`,
      [
        ids[index],
        workspaceId,
        persona.name,
        persona.functions,
        persona.minSeniority,
        persona.titleKeywords,
        persona.buyingRole,
        persona.required,
        index,
        ts,
      ]
    );
  }
  return listPersonas(workspaceId);
}

/** Seed the default committee for a workspace that has no personas yet. */
export async function ensureDefaultPersonas(
  workspaceId: string,
  profile: SellerProfile | null = null
): Promise<Persona[]> {
  const existing = await listPersonas(workspaceId);
  if (existing.length > 0) return existing;
  return replacePersonas(workspaceId, defaultPersonas(profile));
}
