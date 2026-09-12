export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export type Provider = 'openrouter' | 'perplexity' | 'gemini' | 'fixture';

interface ProviderSpec {
  name: Provider;
  envKey: string;
  url: string;
  model: string;
  /** has real-time web search */
  webSearch: boolean;
}

const PROVIDERS: ProviderSpec[] = [
  {
    name: 'gemini',
    envKey: 'GEMINI_API_KEY',
    url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    model: 'gemini-2.5-flash',
    webSearch: false,
  },
  {
    name: 'openrouter',
    envKey: 'OPENROUTER_API_KEY',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    model: '', // resolved below from OPENROUTER_MODEL
    webSearch: true,
  },
  {
    name: 'perplexity',
    envKey: 'PERPLEXITY_API_KEY',
    url: 'https://api.perplexity.ai/chat/completions',
    model: 'sonar',
    webSearch: true,
  },
];

function availableProviders(): ProviderSpec[] {
  const configured = PROVIDERS.filter((p) => !!process.env[p.envKey]).map((p) =>
    p.name === 'openrouter'
      ? { ...p, model: process.env.OPENROUTER_MODEL || 'perplexity/sonar' }
      : p
  );
  const priority = (process.env.LLM_PROVIDER_PRIORITY ?? '')
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
  if (priority.length === 0) return configured;
  const rank = new Map(priority.map((name, index) => [name, index]));
  return configured.sort(
    (a, b) =>
      (rank.get(a.name) ?? priority.length) -
      (rank.get(b.name) ?? priority.length)
  );
}

export function activeProvider(): Provider {
  return availableProviders()[0]?.name ?? 'fixture';
}

const TIMEOUT_MS = 90_000;

async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown
): Promise<unknown> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`LLM request failed ${res.status}: ${text.slice(0, 400)}`);
  }
  return res.json();
}

function extractContent(payload: unknown): string {
  const choices = (
    payload as { choices?: { message?: { content?: string } }[] }
  )?.choices;
  const content = choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('LLM returned an empty response');
  }
  return content;
}

export interface ChatResult {
  content: string;
  provider: Provider;
  model: string;
  webSearch: boolean;
}

/**
 * Try each configured provider in priority order. A failing or quota-exhausted
 * key falls through to the next so a dead credential never breaks research.
 * Throws if every provider fails.
 */
export async function chat(
  messages: ChatMessage[],
  options?: { maxTokens?: number; json?: boolean }
): Promise<ChatResult> {
  const providers = availableProviders();
  if (providers.length === 0) throw new Error('No LLM provider key configured');

  const errors: string[] = [];
  for (const p of providers) {
    try {
      const payload = await postJson(
        p.url,
        { authorization: `Bearer ${process.env[p.envKey]}` },
        {
          model: p.model,
          messages,
          max_tokens: options?.maxTokens ?? 8_000,
          ...(options?.json
            ? { response_format: { type: 'json_object' } }
            : {}),
        }
      );
      return {
        content: extractContent(payload),
        provider: p.name,
        model: p.model,
        webSearch: p.webSearch,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[llm] ${p.name} failed: ${msg.slice(0, 200)}`);
      errors.push(`${p.name}: ${msg.slice(0, 120)}`);
    }
  }
  throw new Error(`All LLM providers failed — ${errors.join(' | ')}`);
}
