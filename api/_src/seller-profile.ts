import { chat } from './llm.js';
import { extractJson } from './research.js';
import type { SellerProfile } from './types.js';

function clean(value: string): string {
  return value
    .replace(/\s*\[\d+(?:\s*,\s*\d+)*\]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function strings(value: unknown, limit = 12): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map(clean)
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
        ? clean(value.companyName).slice(0, 160)
        : '',
    domain:
      typeof value.domain === 'string'
        ? value.domain.trim().toLowerCase().slice(0, 255)
        : fallbackDomain,
    summary:
      typeof value.summary === 'string'
        ? clean(value.summary).slice(0, 1200)
        : '',
    products: strings(value.products),
    targetCustomers: strings(value.targetCustomers),
    useCases: strings(value.useCases),
    proofPoints: strings(value.proofPoints),
    competitors: strings(value.competitors),
    positioning:
      typeof value.positioning === 'string'
        ? clean(value.positioning).slice(0, 1200)
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
  const messages = [
    {
      role: 'system' as const,
      content:
        'You research B2B companies. Return strict JSON only. Use current public evidence and never invent customers, metrics, or proof points.',
    },
    {
      role: 'user' as const,
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
  ];
  const deadlineMs = Date.now() + 48_000;
  try {
    const result = await chat(messages, {
      webSearch: true,
      json: true,
      maxTokens: 3000,
      deadlineMs: Math.min(deadlineMs, Date.now() + 30_000),
    });
    return sanitizeSellerProfile(extractJson(result.content), domain);
  } catch (error) {
    console.warn(
      `grounded seller research failed for ${domain}, retrying: ${
        error instanceof Error ? error.message.slice(0, 200) : 'unknown error'
      }`
    );
    const result = await chat(messages, {
      json: true,
      maxTokens: 3000,
      deadlineMs,
    });
    return sanitizeSellerProfile(extractJson(result.content), domain);
  }
}
