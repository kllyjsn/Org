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

const C_LEVEL_TITLE_RE = new RegExp([
  '\\bchief\\b.*\\bofficer\\b',
  '\\bceo\\b',
  '\\bcto\\b',
  '\\bcfo\\b',
  '\\bcoo\\b',
  '\\bcro\\b',
  '\\bciso\\b',
  '\\bcmo\\b',
  '\\bcpo\\b',
  '\\bcio\\b',
  '\\bchro\\b',
  '(?<!vice )\\bpresident\\b',
  '\\bfounder\\b',
  '\\bco-founder\\b',
  '\\bowner\\b',
  '\\bchairman\\b',
].join('|'));
const OPERATIONS_TITLE_RE = new RegExp([
  'chief of staff',
  'executive assistant',
  'office of the ceo',
  'program manager',
  'project manager',
  'operations',
  '\\bops\\b',
  'office manager',
  'administrat',
].join('|'));

export function seniorityFromLevel(
  level: string | null | undefined
): Seniority | null {
  const value = level?.trim().toLowerCase();
  if (!value || /unknown|uncategorized|n\/a|none/.test(value)) return null;
  if (/c[- ]?level|cxo|chief|founder|president|owner/.test(value)) {
    return 'c_level';
  }
  if (/evp|svp|executive vice|senior vice/.test(value)) return 'evp_svp';
  if (/\bvp\b|vice president|head/.test(value)) return 'vp';
  if (/director|managing director/.test(value)) return 'director';
  if (/manager/.test(value)) return 'manager';
  if (/lead|principal|staff|architect|distinguished|senior/.test(value)) {
    return 'lead';
  }
  if (/entry|intern|associate|junior|ic|individual contributor/.test(value)) {
    return 'ic';
  }
  return null;
}

function titleSeniority(value: string): Seniority {
  if (!value) return 'unknown';
  if (/office of the ceo|assistant to\b/.test(value)) return 'ic';
  if (/chief of staff/.test(value)) return 'director';
  if (C_LEVEL_TITLE_RE.test(value)) {
    return 'c_level';
  }
  if (
    /\b(ev[p]?|svp)\b|senior vice president|executive vice president/.test(
      value
    )
  ) {
    return 'evp_svp';
  }
  if (/\bregional head\b|head of .*(,|-)\s*[a-z]{2,}/.test(value)) {
    return 'director';
  }
  if (/\bvp\b|vice president|head of\b/.test(value)) return 'vp';
  if (
    /\bsr\.?\s*director\b|\bsenior director\b|\bmanaging director\b|\bdirector\b/.test(
      value
    )
  ) {
    return 'director';
  }
  if (/\bmanager\b/.test(value)) return 'manager';
  if (
    /\blead\b|\bprincipal\b|\bstaff\b|\barchitect\b|\bdistinguished\b/.test(
      value
    )
  ) {
    return 'lead';
  }
  return 'ic';
}

export function functionToDepartment(fn: Fn): string | null {
  const departments: Partial<Record<Fn, string>> = {
    executive: 'Executive',
    engineering: 'Engineering',
    product: 'Product',
    design: 'Design',
    marketing: 'Marketing',
    sales: 'Sales',
    finance: 'Finance',
    people: 'People',
    legal: 'Legal',
    security: 'Security',
    customer_success: 'Customer Success',
    operations: 'Operations',
    other: 'Other',
  };
  if (fn === 'data' || fn === 'it') return 'Engineering';
  if (fn === 'support') return 'Customer Success';
  return departments[fn] ?? null;
}

export function seniorityToJobLevel(s: Seniority): string | null {
  return ({
    c_level: 'CXO',
    evp_svp: 'SVP',
    vp: 'VP',
    director: 'Director',
    manager: 'Manager',
    lead: 'Lead',
    ic: 'IC',
    unknown: null,
  } as Record<Seniority, string | null>)[s];
}

export function classifyTitle(title: string | null | undefined): {
  function: Fn;
  seniority: Seniority;
} {
  const value =
    title?.trim().toLowerCase().replace(/[’']/g, "'") ?? '';
  const seniority = titleSeniority(value);
  if (!value) return { function: 'other', seniority: 'unknown' };
  let fn: Fn = 'other';
  if (seniority === 'c_level' && !/\bciso\b/.test(value)) fn = 'executive';
  else if (
    /\bciso\b|security|cyber|information security|trust & safety/.test(value)
  ) fn = 'security';
  else if (
    /product marketing|growth marketing|marketing|brand|communications|content|demand gen/.test(
      value
    )
  ) fn = 'marketing';
  else if (/customer success/.test(value)) fn = 'customer_success';
  else if (
    /it manager|information technology|systems administrator|system administrator|help desk|\bit\b/.test(
      value
    )
  ) fn = 'it';
  else if (
    /technical support|customer support|support engineer|support/.test(value)
  ) fn = 'support';
  else if (
    /sales|account executive|sales engineer|solutions engineer|sdr|bdr|partnerships|revenue/.test(
      value
    )
  ) fn = 'sales';
  else if (
    /finance|accountant|controller|fp&a|procurement|treasury|payroll/.test(
      value
    )
  ) fn = 'finance';
  else if (
    /general counsel|paralegal|compliance|legal|attorney/.test(value)
  ) fn = 'legal';
  else if (
    /recruiter|human resources|\bhr\b|people ops|talent|people partner/.test(
      value
    )
  ) fn = 'people';
  else if (OPERATIONS_TITLE_RE.test(value)) fn = 'operations';
  else if (
    /data scientist|data engineer|analytics|machine learning|\bml\b|scientist/.test(
      value
    )
  ) fn = 'data';
  else if (/designer|design|ux|ui|creative/.test(value)) fn = 'design';
  else if (
    /engineering|engineer|developer|software|devops|sre|platform|infrastructure|technician/.test(
      value
    )
  ) fn = 'engineering';
  else if (/product/.test(value)) fn = 'product';
  else if (/account director/.test(value)) fn = 'sales';
  if (fn === 'other' && seniority === 'c_level') fn = 'executive';
  return { function: fn, seniority };
}
