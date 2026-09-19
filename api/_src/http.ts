import type { Context } from 'hono';
import type { Hono } from 'hono';
import type { UserRow } from './types.js';

export type Vars = { user: UserRow };
export type App = Hono<{ Variables: Vars }>;

export const ALLOWED_ORIGINS = (
  process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173'
)
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

export function allowedWebOrigin(o: string): string | null {
  return ALLOWED_ORIGINS.includes(o) || /https:\/\/[^/]+\.vercel\.app$/.test(o)
    ? o
    : null;
}

export function bad(c: Context, message: string, status = 400) {
  return c.json({ error: message }, status as 400);
}

export function param(c: Context, key: string): string {
  const v = c.req.param(key);
  if (!v) throw new Error(`missing route param: ${key}`);
  return v;
}

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"]/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!
  );
}

export function appUrl(c: Context): string {
  return (
    process.env.APP_URL ||
    c.req.header('origin') ||
    'https://topdown.sh'
  );
}

export function exportFilename(name: string): string {
  return name
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/[\\/:*?"<>|]/g, '-')
    .trim();
}

export function sendWorkbook(
  c: Context,
  workbook: Buffer,
  filename: string
) {
  const asciiSafe = exportFilename(filename);
  const body = new Uint8Array(workbook) as unknown as Uint8Array<ArrayBuffer>;
  return c.body(body, 200, {
    'content-type':
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'content-disposition': `attachment; filename="${asciiSafe}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
  });
}
