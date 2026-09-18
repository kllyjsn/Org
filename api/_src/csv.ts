export interface ImportedRow {
  name: string;
  title: string | null;
  linkedin: string | null;
  email: string | null;
  location: string | null;
  company: string | null;
}

function parseCsv(text: string): Record<string, string>[] {
  const source = text.replace(/^\uFEFF/, '');
  const headerLine = source.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = [',', ';', '\t'].sort(
    (a, b) => headerLine.split(b).length - headerLine.split(a).length
  )[0];
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];
    if (char === '"' && quoted && next === '"') { field += '"'; i += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === delimiter && !quoted) { row.push(field.trim()); field = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(field.trim());
      if (row.some(Boolean)) rows.push(row);
      row = []; field = '';
    } else field += char;
  }
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  if (rows.length < 2) return [];
  const headers = rows[0].map((h) => h.toLowerCase().replace(/[^a-z0-9]+/g, ''));
  return rows.slice(1, 2001).map((values) =>
    Object.fromEntries(headers.map((h, i) => [h, values[i] ?? '']))
  );
}

function value(row: Record<string, string>, names: string[]): string | null {
  for (const name of names) if (row[name]?.trim()) return row[name].trim();
  return null;
}

export function rowsFromCsv(csv: string): ImportedRow[] {
  return parseCsv(csv).map((row) => {
    const full = value(row, ['fullname', 'name', 'personname']);
    const first = value(row, ['firstname', 'first']);
    const last = value(row, ['lastname', 'last']);
    return {
      name: full ?? [first, last].filter(Boolean).join(' '),
      title: value(row, ['title', 'jobtitle', 'position']),
      linkedin: value(row, ['linkedinprofileurl', 'profileurl', 'personlinkedinurl', 'linkedinurl']),
      email: value(row, ['email', 'emailaddress']),
      location: value(row, ['location', 'geography', 'city', 'mailingcity']),
      company: value(row, ['company', 'companyname', 'accountname']),
    };
  }).filter((row) => !!row.name).slice(0, 2000);
}

export function linkedinSlug(url: string | null | undefined): string | null {
  if (!url?.trim()) return null;
  try {
    const parsed = new URL(url.trim().startsWith('http') ? url.trim() : `https://${url.trim()}`);
    const match = parsed.pathname.match(/^\/in\/([^/]+)/i);
    return match?.[1]?.toLowerCase() ?? null;
  } catch { return null; }
}

function nameFromSlug(slug: string): string {
  const words = slug.replace(/[-_]+/g, ' ').replace(/\b\d+[a-z0-9]*$/i, '').trim().split(/\s+/);
  return words.filter(Boolean).map((word) => word[0]?.toUpperCase() + word.slice(1)).join(' ');
}

export function rowsFromLinkedinUrls(urls: string[]): ImportedRow[] {
  const seen = new Set<string>();
  return urls.flatMap((url) => {
    const slug = linkedinSlug(url);
    if (!slug || seen.has(slug)) return [];
    seen.add(slug);
    return [{
      name: nameFromSlug(slug),
      title: null, linkedin: `https://www.linkedin.com/in/${slug}`,
      email: null, location: null, company: null,
    }];
  }).slice(0, 2000);
}
