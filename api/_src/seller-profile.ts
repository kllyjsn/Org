import { chat } from './llm.js';
import { extractJson } from './research.js';
import type { SellerProfile } from './types.js';

function strings(value: unknown, limit = 12): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, limit);
}

export function sanitizeSellerProfile(
  input: unknown,
  fallbackDomain = ''
): SellerProfile {
  const value =
    input && typeof input === 'object'
      ? (input as Record<string, unknown>)
      : {};
  return {
    companyName:
      typeof value.companyName === 'string'
        ? value.companyName.trim().slice(0, 160)
        : '',
    domain:
      typeof value.domain === 'string'
        ? value.domain.trim().toLowerCase().slice(0, 255)
        : fallbackDomain,
    summary:
      typeof value.summary === 'string'
        ? value.summary.trim().slice(0, 1200)
        : '',
    products: strings(value.products),
    targetCustomers: strings(value.targetCustomers),
    useCases: strings(value.useCases),
    proofPoints: strings(value.proofPoints),
    competitors: strings(value.competitors),
    positioning:
      typeof value.positioning === 'string'
        ? value.positioning.trim().slice(0, 1200)
        : '',
    researchedAt:
      typeof value.researchedAt === 'string'
        ? value.researchedAt
        : new Date().toISOString(),
  };
}

export async function researchSellerProfile(
  domain: string
): Promise<SellerProfile> {
  const result = await chat(
    [
      {
        role: 'system',
        content:
          'You research B2B companies. Return strict JSON only. Use current public evidence and never invent customers, metrics, or proof points.',
      },
      {
        role: 'user',
        content: `Research the company at "${domain}" so its sales team can use
the result as reusable context when planning target accounts.

Return ONLY:
{
  "companyName": "string",
  "domain": "${domain}",
  "summary": "one precise paragraph",
  "products": ["specific products or product families"],
  "targetCustomers": ["buyer/company segments the evidence supports"],
  "useCases": ["problems the products solve"],
  "proofPoints": ["named customer, outcome, or credible company claim — omit anything unverified"],
  "competitors": ["direct alternatives supported by public evidence"],
  "positioning": "concise explanation of why buyers choose this company"
}

Prefer the company's website, product pages, customer stories, documentation,
and current reputable reporting. Keep each list concise and editable.`,
      },
    ],
    {
      webSearch: true,
      json: true,
      maxTokens: 3000,
      deadlineMs: Date.now() + 48_000,
    }
  );
  const parsed = extractJson(result.content);
  return sanitizeSellerProfile(parsed, domain);
}
