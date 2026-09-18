const TIMESTAMP =
  /^\s*\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}\s*-->\s*\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}.*$/;
const SRT_INDEX = /^\s*\d+\s*$/;
const VOICE_TAG = /<v\s+([^>]+)>/g;

function looksLikeSrt(lines: string[]): boolean {
  // cue index on its own line immediately followed by a timestamp line
  for (let i = 0; i < lines.length - 1; i += 1) {
    if (SRT_INDEX.test(lines[i]) && TIMESTAMP.test(lines[i + 1])) return true;
  }
  return false;
}

function isTimed(lines: string[], filename?: string): boolean {
  const ext = (filename ?? '').toLowerCase();
  if (ext.endsWith('.vtt')) return true;
  const head = lines.slice(0, 12).join('\n');
  if (head.includes('WEBVTT')) return true;
  if (ext.endsWith('.srt')) return looksLikeSrt(lines);
  return lines.some((line) => TIMESTAMP.test(line));
}

/**
 * Normalize .vtt / .srt / plain-text transcripts into "Speaker: text" lines.
 * Voice tags (`<v Jane>…`) become the speaker name; cue indices and
 * timestamp rows are dropped. Plain text passes through trimmed.
 */
export function normalizeTranscript(raw: string, filename?: string): string {
  const lines = raw.replace(/\r\n?/g, '\n').split('\n');
  if (!isTimed(lines, filename)) {
    return raw.trim();
  }
  const out: string[] = [];
  let speaker: string | null = null;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (
      line === '' ||
      line === 'WEBVTT' ||
      TIMESTAMP.test(line) ||
      SRT_INDEX.test(line) ||
      /^NOTE\b/.test(line)
    ) {
      continue;
    }
    // <v Name>text — the tag carries the speaker label.
    let text = line;
    const voice = /<v\s+([^>]+)>/.exec(text);
    if (voice) {
      speaker = voice[1].trim();
      text = text.replace(VOICE_TAG, '').replace(/<\/v>/g, '').trim();
    }
    text = text.replace(/<[^>]+>/g, '').trim();
    if (!text) continue;
    if (speaker) {
      out.push(`${speaker}: ${text}`);
      speaker = null;
    } else {
      out.push(text);
    }
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
