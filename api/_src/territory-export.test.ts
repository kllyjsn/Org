import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import type { AccountBriefing } from './briefing.js';
import type { StrategyInsights } from './strategy.js';
import {
  accountSheetName,
  buildTerritoryWorkbook,
  type ExportAccount,
} from './territory-export.js';
import type { MapState, Person, ResearchSource } from './types.js';

const source: ResearchSource = {
  url: 'https://example.com/filing',
  title: 'Annual report',
  publisher: 'Example',
  publishedAt: null,
  retrievedAt: new Date().toISOString(),
  sourceType: 'filing',
};

function person(overrides: Partial<Person>): Person {
  return {
    id: 'person-1',
    name: 'Alex Champion',
    title: 'VP Engineering',
    department: 'Engineering',
    role: 'champion',
    confidence: 'high',
    sources: [source.url],
    sourceDetails: [source],
    notes: 'Helpful contact',
    metWith: false,
    email: 'alex@example.com',
    linkedin: 'https://linkedin.com/in/alex',
    x: 0,
    y: 0,
    ...overrides,
  };
}

function state(people: Person[]): MapState {
  return {
    people,
    edges: [],
    meta: {
      domain: 'example.com',
      companyName: 'Example, Inc.',
      researchedAt: null,
      tier: 'T0',
      provider: null,
      initiatives: [
        {
          name: 'AI modernization',
          summary: 'Modernize delivery workflows',
          category: 'technology',
          evidence: [source.url],
          evidenceDetails: [source],
          relevantPeople: [],
          relevantTeams: ['Engineering'],
          salesAngles: [],
        },
      ],
      strategy: {
        stakeholders: {
          'person-1': {
            stance: 'advocate',
            nextStep: 'Schedule workshop',
            note: 'Strong fit',
          },
        },
        tasks: [
          {
            id: 'task-1',
            title: 'Confirm pilot scope',
            done: false,
            source: 'manual',
            createdAt: new Date().toISOString(),
          },
        ],
        updatedAt: new Date().toISOString(),
      },
    },
  };
}

const strategy: StrategyInsights = {
  generatedAt: new Date().toISOString(),
  provider: 'test',
  researchDepth: 'map_only',
  executiveSummary: 'A focused hypothesis',
  winThemes: [
    { statement: 'Expand from engineering', provenance: 'hypothesis', evidence: [] },
  ],
  landingPlays: [
    {
      title: 'Run a pilot',
      rationale: 'Show measurable impact',
      personIds: ['person-1'],
      provenance: 'hypothesis',
      evidence: [],
    },
  ],
  stakeholderQuestions: [],
  competitiveWatch: [],
  mutualActionPlan: [
    { milestone: 'Pilot review', owner: 'joint', timing: 'This quarter' },
  ],
  researchGaps: [],
};

const briefing: AccountBriefing = {
  generatedAt: new Date().toISOString(),
  baselineAt: null,
  headline: 'Example account',
  summary: 'A useful account summary',
  changes: [],
  actions: [],
  valueCase: null,
};

function account(
  overrides: Partial<ExportAccount> = {}
): ExportAccount {
  const people = [
    person({ id: 'person-1' }),
    person({
      id: 'person-2',
      name: 'Taylor Unmet',
      title: 'Developer',
      department: null,
      role: 'none',
      notes: '=SUM(A1:A2)',
      email: null,
      linkedin: null,
      sourceDetails: [],
      sources: [],
    }),
  ];
  return {
    id: 'account-1',
    name: 'Example',
    domain: 'example.com',
    companyName: 'Example, Inc.',
    isLiveOpportunity: true,
    state: state(people),
    strategy,
    briefing,
    mapUrl: 'https://topdown.sh/maps/account-1',
    ...overrides,
  };
}

test('builds the territory and account plan workbook layout', async () => {
  const first = account();
  const second = account({
    id: 'account-2',
    name: 'Second Account',
    domain: 'second.example.com',
    companyName: null,
    state: {
      people: [
        person({
          id: 'person-3',
          name: 'No Role',
          department: null,
          role: 'none',
          sourceDetails: [],
          sources: [],
          notes: 'No notes',
        }),
      ],
      edges: [],
      meta: {
        domain: 'second.example.com',
        companyName: null,
        researchedAt: null,
        tier: 'T0',
        provider: null,
      },
    },
    strategy: null,
    briefing: null,
  });
  const buffer = await buildTerritoryWorkbook([first, second], {
    includeTerritorySheet: true,
  });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]
  );

  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), [
    'Territory',
    'Example, Inc.',
    'Second Account',
  ]);
  const territory = workbook.getWorksheet('Territory')!;
  assert.equal(territory.getCell('A1').value, 'Accounts');
  const view = territory.views[0] as { xSplit?: number; ySplit?: number };
  assert.equal(view.xSplit, 1);
  assert.equal(view.ySplit, 1);
  assert.deepEqual(territory.getCell('J2').value, { formula: 'I2*425' });

  const accountSheet = workbook.getWorksheet('Example, Inc.')!;
  assert.deepEqual(
    Array.from({ length: 11 }, (_, index) => accountSheet.getCell(index + 1, 1).value),
    [
      'Account',
      'Revenue',
      'Address',
      'Website',
      'LinkedIn',
      'Org Chart Link',
      'Company Mission',
      'Fiscal Year End',
      'Number of developers',
      'Deployment Footprint ',
      'Latest 10K Report',
    ]
  );
  assert.equal(accountSheet.getCell('A12').value, 'Overall Hypothesis for Codeium');
  assert.equal(
    (accountSheet.getCell('A12').fill as { fgColor?: { argb?: string } }).fgColor
      ?.argb,
    'FFA4C2F4'
  );
  assert.ok(accountSheet.model.merges.includes('B1:H1'));
  assert.ok(accountSheet.model.merges.includes('A12:I12'));
  assert.ok(accountSheet.model.merges.includes('A13:H13'));

  assert.equal(accountSheet.getCell('E28').value, 'Engagment Status');
  const championRow = [30, 31].find(
    (row) => accountSheet.getCell(row, 1).value === 'Alex Champion'
  )!;
  const unmetRow = [30, 31].find(
    (row) => accountSheet.getCell(row, 1).value === 'Taylor Unmet'
  )!;
  assert.equal(accountSheet.getCell(championRow, 5).value, 'Champ');
  assert.equal(accountSheet.getCell(unmetRow, 5).value, 'Not Met');
  assert.equal(accountSheet.getCell(unmetRow, 9).value, "'=SUM(A1:A2)");
  assert.equal(typeof accountSheet.getCell(unmetRow, 9).value, 'string');
});

test('accountSheetName strips invalid characters, truncates, and deduplicates', () => {
  const taken = new Set<string>();
  const first = accountSheetName('A'.repeat(40) + '[]:*?/\\', taken);
  const second = accountSheetName('A'.repeat(40) + '[]:*?/\\', taken);
  assert.equal(first.length, 31);
  assert.equal(second.length, 31);
  assert.notEqual(first, second);
  assert.equal(second.endsWith(' (2)'), true);
});
