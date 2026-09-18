/**
 * Canonical function / seniority taxonomy shared by personas, coverage and
 * the title classifier. Mirrored verbatim in web/src/lib/taxonomy.ts — keep
 * the two files identical.
 */

export type Fn =
  | 'executive'
  | 'engineering'
  | 'product'
  | 'design'
  | 'data'
  | 'security'
  | 'it'
  | 'sales'
  | 'marketing'
  | 'customer_success'
  | 'support'
  | 'finance'
  | 'legal'
  | 'people'
  | 'operations'
  | 'other';

export type Seniority =
  | 'c_level'
  | 'evp_svp'
  | 'vp'
  | 'director'
  | 'manager'
  | 'lead'
  | 'ic'
  | 'unknown';

export const FUNCTIONS: Fn[] = [
  'executive',
  'engineering',
  'product',
  'design',
  'data',
  'security',
  'it',
  'sales',
  'marketing',
  'customer_success',
  'support',
  'finance',
  'legal',
  'people',
  'operations',
  'other',
];

/** Most senior first. */
export const SENIORITY_ORDER: Seniority[] = [
  'c_level',
  'evp_svp',
  'vp',
  'director',
  'manager',
  'lead',
  'ic',
  'unknown',
];

export const FN_LABELS: Record<Fn, string> = {
  executive: 'Executive',
  engineering: 'Engineering',
  product: 'Product',
  design: 'Design',
  data: 'Data',
  security: 'Security',
  it: 'IT',
  sales: 'Sales',
  marketing: 'Marketing',
  customer_success: 'Customer Success',
  support: 'Support',
  finance: 'Finance',
  legal: 'Legal',
  people: 'People',
  operations: 'Operations',
  other: 'Other',
};

export const SENIORITY_LABELS: Record<Seniority, string> = {
  c_level: 'C-level',
  evp_svp: 'EVP / SVP',
  vp: 'VP',
  director: 'Director',
  manager: 'Manager',
  lead: 'Lead',
  ic: 'IC',
  unknown: 'Unknown',
};

export function isFn(value: unknown): value is Fn {
  return typeof value === 'string' && (FUNCTIONS as string[]).includes(value);
}

export function isSeniority(value: unknown): value is Seniority {
  return (
    typeof value === 'string' && (SENIORITY_ORDER as string[]).includes(value)
  );
}

/** 0 = most senior. */
export function seniorityRank(seniority: Seniority): number {
  return SENIORITY_ORDER.indexOf(seniority);
}

/** True when `actual` is at least as senior as `min`. */
export function atLeast(actual: Seniority, min: Seniority): boolean {
  return seniorityRank(actual) <= seniorityRank(min);
}

const DEPARTMENT_TO_FN: [RegExp, Fn][] = [
  [/customer|success|\bcs\b|account management/i, 'customer_success'],
  [/support|service desk|help ?desk/i, 'support'],
  [/security|trust|safety|grc/i, 'security'],
  [/\bdata\b|analytics|machine learning|\bml\b|\bai\b/i, 'data'],
  [/information technology|\bit\b|infrastructure|systems/i, 'it'],
  [/engineer|technology|r&d|research|develop|software|platform/i, 'engineering'],
  [/product/i, 'product'],
  [/design|\bux\b|creative/i, 'design'],
  [/sales|revenue|business development|partnership|\bgtm\b/i, 'sales'],
  [/marketing|brand|communications|growth/i, 'marketing'],
  [/financ|accounting|procurement|treasury|billing/i, 'finance'],
  [/legal|compliance|counsel|governance|privacy/i, 'legal'],
  [/people|human resources|\bhr\b|talent|recruit/i, 'people'],
  [/operation|\bops\b|admin|program|strategy|facilit/i, 'operations'],
  [/executive|leadership|founder|office of the ceo/i, 'executive'],
];

// Title-specific overrides run before department: a CFO filed under
// "Executive" is still a finance buyer, and a security lead filed under
// "Engineering" is still a security buyer.
const TITLE_TO_FN: [RegExp, Fn][] = [
  [/\b(cfo|chief financial|controller|treasurer|chief accounting|financ(e|ial)|accounting|fp&a|treasury|payroll|billing)\b/i, 'finance'],
  [/\b(ciso|chief (information )?security|security|infosec|appsec|trust & safety|trust and safety)\b/i, 'security'],
  [/\b(cio|chief information officer|information technology|\bit\b|it ops|helpdesk|help desk|sysadmin|systems administrator|endpoint)\b/i, 'it'],
  [/\b(customer success|customer experience|\bcsm\b|account manager|client success|customer (health|outcomes))\b/i, 'customer_success'],
  [/\b(support|customer care|service desk|technical account)\b/i, 'support'],
  [/\b(cdo|chief data|data (engineer|scientist|analyst|platform|science)|analytics|machine learning|\bml\b|\bai\b engineer)\b/i, 'data'],
  [/\b(cto|chief technology|chief technical|engineering|engineer|developer|software|devops|\bsre\b|architect|platform)\b/i, 'engineering'],
  [/\b(cpo|chief product|product)\b/i, 'product'],
  [/\b(cdo|chief design|design(er)?|\bux\b|\bui\b|user experience)\b/i, 'design'],
  [/\b(cro|chief revenue|sales|account executive|business development|\bsdr\b|\bbdr\b|partnerships?|alliances)\b/i, 'sales'],
  [/\b(cmo|chief marketing|marketing|demand gen(eration)?|brand|communications|content|growth)\b/i, 'marketing'],
  [/\b(general counsel|legal|counsel|attorney|compliance|privacy|paralegal|contracts?)\b/i, 'legal'],
  [/\b(chro|chief people|people|human resources|\bhr\b|talent|recruit(er|ing)|learning and development|l&d)\b/i, 'people'],
  [/\b(coo|chief operating|operations|\bops\b|program manager|project manager|procurement|facilities|administrat|chief of staff|strategy)\b/i, 'operations'],
  [/\b(ceo|chief executive|founder|co-founder|cofounder|(?<!vice )president|owner|chairman|chairwoman|chair|managing director|managing partner|general manager)\b/i, 'executive'],
];

/**
 * Map a Person's department (already bucketed by research) plus title to a
 * canonical function. Title wins for C-suite / specialist roles, otherwise
 * the department lane decides; falls back to title keywords, then 'other'.
 */
export function personDepartmentToFn(
  department: string | null,
  title: string
): Fn {
  const t = (title ?? '').trim();
  if (/(executive|administrative|personal) assistant|assistant to\b/i.test(t)) {
    return 'operations';
  }
  const cSuite = /\bchief\b|\bc[a-z]{1,3}o\b|(?<!vice )president|founder/i.test(t);
  if (cSuite) {
    for (const [re, fn] of TITLE_TO_FN) if (re.test(t)) return fn;
  }
  const specialist = /security|infosec|\bciso\b|\bit\b|information technology|data|analytics|machine learning|support|customer success|compliance|privacy/i;
  if (specialist.test(t)) {
    for (const [re, fn] of TITLE_TO_FN) if (re.test(t)) return fn;
  }
  const d = (department ?? '').trim();
  if (d) {
    for (const [re, fn] of DEPARTMENT_TO_FN) if (re.test(d)) return fn;
  }
  for (const [re, fn] of TITLE_TO_FN) if (re.test(t)) return fn;
  return 'other';
}

const JOB_LEVEL_TO_SENIORITY: [RegExp, Seniority][] = [
  [/^(cxo|c-level|c_level|chief|founder|owner)$/i, 'c_level'],
  [/^(evp|svp|evp_svp|executive vice president|senior vice president)$/i, 'evp_svp'],
  [/^(vp|vice president|head)$/i, 'vp'],
  [/^director$/i, 'director'],
  [/^manager$/i, 'manager'],
  [/^(lead|principal|staff)$/i, 'lead'],
  [/^(senior|entry|ic|individual contributor|intern|junior|associate)$/i, 'ic'],
];

/**
 * Seniority from an enrichment job level when present, otherwise from title
 * heuristics. "Vice President" beats "President"; "Head of" reads as VP-ish;
 * "Senior Engineer" is still an IC.
 */
export function personSeniority(
  jobLevel: string | null | undefined,
  title: string
): Seniority {
  const level = (jobLevel ?? '').trim();
  if (level) {
    for (const [re, s] of JOB_LEVEL_TO_SENIORITY) if (re.test(level)) return s;
  }
  const t = (title ?? '').trim();
  if (!t) return 'unknown';
  if (/\b(assistant|coordinator|associate) to\b|executive assistant|chief of staff/i.test(t)) {
    return /chief of staff/i.test(t) ? 'director' : 'ic';
  }
  if (/\b(evp|svp)\b|executive vice president|senior vice president|group vice president|\bgvp\b/i.test(t)) {
    return 'evp_svp';
  }
  if (/\bvice president\b|\b(a|s|r)?vp\b/i.test(t)) return 'vp';
  if (/\bchief\b|\bc[a-z]{1,3}o\b|\bfounder\b|\bco-?founder\b|\bpresident\b|\bowner\b|\bchair(man|woman|person)?\b|managing partner|managing director|general counsel/i.test(t)) {
    return 'c_level';
  }
  if (/\bhead of\b|\bhead\b,|\bgeneral manager\b|\bgm\b/i.test(t)) return 'vp';
  if (/\bdirector\b|\bdir\.?\b/i.test(t)) return 'director';
  if (/\bmanager\b|\bmgr\b|\bsupervisor\b/i.test(t)) return 'manager';
  if (/\blead\b|\bprincipal\b|\bstaff\b|\bdistinguished\b|\bfellow\b|\barchitect\b/i.test(t)) {
    return 'lead';
  }
  return 'ic';
}
