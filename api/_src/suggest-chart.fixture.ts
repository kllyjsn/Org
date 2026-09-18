import type { RosterPersonRow } from './roster.js';

const functions = [
  'sales',
  'marketing',
  'engineering',
  'product',
  'customer_success',
  'finance',
  'people',
] as const;
const locations = ['United States', 'United Kingdom', 'Germany', 'Singapore', 'Australia', 'Brazil'];
const levels = ['vp', 'director', 'manager', 'lead', 'ic'] as const;

function row(
  index: number,
  name: string,
  title: string,
  fn: string,
  seniority: string,
  managerKey: string | null,
  location: string,
  source: RosterPersonRow['source'] = 'sumble',
  domain = 'acme.com'
): RosterPersonRow {
  return {
    id: `roster-${index}`,
    workspace_id: 'workspace-fixture',
    domain,
    person_key: `person-${index}`,
    name,
    title,
    function: fn,
    seniority,
    location,
    linkedin: `https://linkedin.com/in/person-${index}`,
    email: `${index}@${domain}`,
    manager_key: managerKey,
    source,
    source_url: source === 'sumble' ? `https://sumble.example/${index}` : null,
    confidence: source === 'sumble' ? 'high' : 'medium',
    status: 'suggested',
    map_person_id: null,
    raw: null,
    first_seen_at: '2025-01-01T00:00:00Z',
    last_seen_at: '2025-01-01T00:00:00Z',
  };
}

export function makeRosterFixture(
  n = 300,
  opts: { domain?: string } = {}
): RosterPersonRow[] {
  const count = Math.max(1, Math.trunc(n));
  const domain = opts.domain ?? 'acme.com';
  const rows: RosterPersonRow[] = [
    row(0, 'Alex Chief', 'Chief Executive Officer', 'executive', 'c_level', null, 'United States', 'sumble', domain),
  ];
  const chiefs: Array<[string, string, string]> = [
    ['Casey Revenue', 'Chief Revenue Officer', 'sales'],
    ['Morgan Marketing', 'Chief Marketing Officer', 'marketing'],
    ['Taylor Technology', 'Chief Technology Officer', 'engineering'],
    ['Jordan Product', 'Chief Product Officer', 'product'],
    ['Riley Success', 'Chief Customer Officer', 'customer_success'],
    ['Jamie Finance', 'Chief Financial Officer', 'finance'],
  ];
  for (const [name, title, fn] of chiefs) {
    if (rows.length >= count) return rows;
    rows.push(row(rows.length, name, title, fn, 'c_level', 'person-0', locations[rows.length % locations.length], 'sumble', domain));
  }
  for (let index = rows.length; index < count; index += 1) {
    const fn = functions[(index - 7) % functions.length];
    const seniority = levels[Math.min(levels.length - 1, Math.floor((index - 7) / 7) % levels.length)];
    const managerIndex = index > 7 && index % 10 < 6
      ? (index - (index % 7 || 7))
      : null;
    const managerKey = managerIndex !== null && managerIndex < index
      ? `person-${managerIndex}`
      : null;
    const titlePrefix = seniority === 'vp' ? 'VP' :
      seniority[0].toUpperCase() + seniority.slice(1);
    rows.push(row(
      index,
      `Person ${index}`,
      `${titlePrefix}, ${fn.replace('_', ' ')} `,
      fn,
      seniority,
      managerKey,
      locations[index % locations.length],
      index % 5 === 0 ? 'csv' : 'sumble',
      domain
    ));
  }
  return rows;
}

function csvEscape(value: string | null): string {
  const text = value ?? '';
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function rosterFixtureCsv(rows: RosterPersonRow[]): string {
  const headers = ['name', 'title', 'linkedin', 'email', 'location', 'company', 'manager'];
  const lines = rows.map((item) =>
    [
      item.name,
      item.title,
      item.linkedin,
      item.email,
      item.location,
      item.domain,
      item.manager_key,
    ].map(csvEscape).join(',')
  );
  return [headers.join(','), ...lines].join('\n');
}
