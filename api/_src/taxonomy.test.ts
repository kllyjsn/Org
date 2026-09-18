import assert from 'node:assert/strict';
import test from 'node:test';
import {
  atLeast,
  personDepartmentToFn,
  personSeniority,
  SENIORITY_ORDER,
  type Fn,
  type Seniority,
} from './taxonomy.js';

const CASES: [
  department: string | null,
  title: string,
  fn: Fn,
  seniority: Seniority,
][] = [
  ['Executive', 'Chief Executive Officer', 'executive', 'c_level'],
  ['Sales', 'Chief Revenue Officer', 'sales', 'c_level'],
  ['Engineering', 'Chief Technology Officer', 'engineering', 'c_level'],
  ['Finance', 'Chief Financial Officer', 'finance', 'c_level'],
  ['Executive', 'CFO', 'finance', 'c_level'],
  ['Executive', 'CISO', 'security', 'c_level'],
  ['Executive', 'Chief Operating Officer', 'operations', 'c_level'],
  ['Executive', 'Chief People Officer', 'people', 'c_level'],
  ['Executive', 'Chief Marketing Officer', 'marketing', 'c_level'],
  ['Executive', 'Chief Product Officer', 'product', 'c_level'],
  ['Executive', 'Founder & CEO', 'executive', 'c_level'],
  ['Executive', 'President', 'executive', 'c_level'],
  ['Sales', 'VP Sales, Americas', 'sales', 'vp'],
  ['Engineering', 'VP Engineering', 'engineering', 'vp'],
  ['Engineering', 'Head of Security', 'security', 'vp'],
  ['Marketing', 'VP Marketing', 'marketing', 'vp'],
  ['Finance', 'Senior Vice President, Finance', 'finance', 'evp_svp'],
  ['Sales', 'EVP Global Sales', 'sales', 'evp_svp'],
  ['Engineering', 'SVP Engineering', 'engineering', 'evp_svp'],
  ['Engineering', 'Vice President of Platform', 'engineering', 'vp'],
  ['Engineering', 'Director of Engineering', 'engineering', 'director'],
  ['Finance', 'Director, FP&A', 'finance', 'director'],
  ['Legal', 'General Counsel', 'legal', 'c_level'],
  ['Legal', 'Senior Director, Procurement', 'legal', 'director'],
  ['Operations', 'Procurement Manager', 'operations', 'manager'],
  ['Engineering', 'Engineering Manager', 'engineering', 'manager'],
  ['Engineering', 'Staff Software Engineer', 'engineering', 'lead'],
  ['Engineering', 'Senior Software Engineer', 'engineering', 'ic'],
  ['Engineering', 'Data Engineer', 'data', 'ic'],
  ['Engineering', 'Head of IT', 'it', 'vp'],
  ['Engineering', 'IT Manager', 'it', 'manager'],
  ['Customer Success', 'Customer Success Manager', 'customer_success', 'manager'],
  ['Customer Success', 'Support Engineer', 'support', 'ic'],
  ['People', 'Head of Talent', 'people', 'vp'],
  ['People', 'HR Business Partner', 'people', 'ic'],
  ['Design', 'Lead Product Designer', 'design', 'lead'],
  ['Product', 'Group Product Manager', 'product', 'manager'],
  ['Sales', 'Account Executive', 'sales', 'ic'],
  ['Operations', 'Chief of Staff', 'operations', 'director'],
  ['Operations', 'Executive Assistant to the CEO', 'operations', 'ic'],
  ['Other', 'Program Manager', 'operations', 'manager'],
  [null, 'Security Architect', 'security', 'lead'],
  [null, 'Marketing Coordinator', 'marketing', 'ic'],
  [null, 'Director of Sales Development', 'sales', 'director'],
  [null, 'General Manager, EMEA', 'executive', 'vp'],
  [null, '', 'other', 'unknown'],
];

test('title heuristics classify function and seniority', () => {
  for (const [department, title, fn, seniority] of CASES) {
    assert.equal(
      personDepartmentToFn(department, title),
      fn,
      `fn for "${title}" (${department})`
    );
    assert.equal(
      personSeniority(null, title),
      seniority,
      `seniority for "${title}"`
    );
  }
  assert.ok(CASES.length >= 30);
});

test('enrichment job level overrides title heuristics', () => {
  assert.equal(personSeniority('CXO', 'Product Lead'), 'c_level');
  assert.equal(personSeniority('VP', 'Product Lead'), 'vp');
  assert.equal(personSeniority('Director', 'Engineer'), 'director');
  assert.equal(personSeniority('Senior', 'Engineer'), 'ic');
  assert.equal(personSeniority('Something odd', 'VP Sales'), 'vp');
});

test('seniority order is most-senior-first and atLeast is inclusive', () => {
  assert.equal(SENIORITY_ORDER[0], 'c_level');
  assert.equal(SENIORITY_ORDER.at(-1), 'unknown');
  assert.ok(atLeast('vp', 'vp'));
  assert.ok(atLeast('c_level', 'director'));
  assert.ok(!atLeast('manager', 'director'));
  assert.ok(!atLeast('unknown', 'ic'));
});
