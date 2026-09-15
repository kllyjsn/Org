interface ExaResult {
  title?: string;
  url?: string;
  text?: string;
}

export async function exaPeopleContext(
  domain: string,
  focus?: string
): Promise<string> {
  const key = process.env.EXA_API_KEY;
  if (!key) return '';
  const response = await fetch('https://api.exa.ai/search', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
    },
    body: JSON.stringify({
      query:
        `People, leadership, teams, and employee profiles at ${domain}. ` +
        (focus ? `Focus on ${focus}.` : 'Cover functions beyond executives.'),
      type: 'auto',
      numResults: 15,
      contents: { text: { maxCharacters: 900 } },
    }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return '';
  }
  const payload = (await response.json()) as { results?: ExaResult[] };
  const results = (payload.results ?? []).flatMap((result) => {
    if (!result.url) return [];
    return [
      `- ${result.title ?? 'Profile result'}\n  URL: ${result.url}\n  ` +
        `Excerpt: ${(result.text ?? '').replace(/\s+/g, ' ').slice(0, 900)}`,
    ];
  });
  return results.length > 0
    ? `\n\nAdditional Exa discovery leads. Treat these only as candidates: verify the
person and current title against the linked page before citing them.\n${results.join('\n')}`
    : '';
}
