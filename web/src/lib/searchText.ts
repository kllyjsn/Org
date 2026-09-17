/**
 * Loose token matching for command palette search and commands. Every query token
 * must appear in the text, with a singular fallback so "engineers" still
 * matches "Software Engineer" and "directors" matches "Director".
 */
export function tokenMatch(text: string, token: string): boolean {
  if (text.includes(token)) return true;
  if (token.length > 3 && token.endsWith('s')) {
    return text.includes(token.slice(0, -1));
  }
  return false;
}

export function matchesAllTokens(text: string, query: string): boolean {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return tokens.length > 0 && tokens.every((token) => tokenMatch(text, token));
}
