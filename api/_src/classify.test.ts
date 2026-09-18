import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyTitle } from './classify.js';

test('classifies common roster titles', () => {
  const cases: [string, string, string][] = [
    ['CEO','executive','c_level'],['Founder','executive','c_level'],['Chief Executive Officer','executive','c_level'],
    ['CTO','executive','c_level'],['CFO','executive','c_level'],['COO','executive','c_level'],['CRO','executive','c_level'],
    ['CISO','security','c_level'],['CMO','executive','c_level'],['CPO','executive','c_level'],['CHRO','executive','c_level'],
    ['President','executive','c_level'],['Chairman','executive','c_level'],['SVP Engineering','engineering','evp_svp'],
    ['Executive Vice President Sales','sales','evp_svp'],['VP Engineering','engineering','vp'],['Vice President Marketing','marketing','vp'],
    ['Head of Product','product','vp'],['Head of Sales - EMEA','sales','director'],['Regional Head of Support','support','director'],
    ['Director of Engineering','engineering','director'],['Senior Director Product','product','director'],
    ['Managing Director','other','director'],['Account Director','sales','director'],['Engineering Manager','engineering','manager'],
    ['Customer Success Manager','customer_success','manager'],['Product Marketing Manager','marketing','manager'],
    ['IT Manager','it','manager'],['Finance Manager','finance','manager'],['Program Manager','operations','manager'],
    ['Staff Software Engineer','engineering','lead'],['Principal Engineer','engineering','lead'],['Lead Designer','design','lead'],
    ['Distinguished Scientist','data','lead'],['Senior Engineer','engineering','ic'],['Software Engineer','engineering','ic'],
    ['Product Designer','design','ic'],['Data Scientist','data','ic'],['Analytics Engineer','data','ic'],
    ['ML Engineer','data','ic'],['Security Engineer','security','ic'],['Systems Administrator','it','ic'],
    ['Help Desk Specialist','it','ic'],['Recruiter','people','ic'],['HR Business Partner','people','ic'],
    ['People Ops Specialist','people','ic'],['Talent Partner','people','ic'],['Controller','finance','ic'],
    ['Accountant','finance','ic'],['FP&A Analyst','finance','ic'],['Procurement Manager','finance','manager'],
    ['General Counsel','legal','ic'],['Paralegal','legal','ic'],['Compliance Analyst','legal','ic'],
    ['Support Engineer','support','ic'],['Technical Support Specialist','support','ic'],['Solutions Engineer','sales','ic'],
    ['Sales Engineer','sales','ic'],['Account Executive','sales','ic'],['SDR','sales','ic'],['BDR','sales','ic'],
    ['Partnerships Manager','sales','manager'],['Operations Analyst','operations','ic'],['Chief of Staff','operations','director'],
    ['Executive Assistant','operations','ic'],['Office of the CEO','operations','ic'],['Intern','other','ic'],
  ];
  for (const [title, fn, seniority] of cases) assert.deepEqual(classifyTitle(title), { function: fn, seniority }, title);
});
