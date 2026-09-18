import ExcelJS from 'exceljs';
import type { AccountBriefing } from './briefing.js';
import type { StrategyInsights } from './strategy.js';
import type {
  MapState,
  Person,
  ResearchSource,
  StakeholderPlanEntry,
  StrategicInitiative,
} from './types.js';

export interface ExportAccount {
  id: string;
  name: string;
  domain: string;
  companyName: string | null;
  isLiveOpportunity: boolean;
  state: MapState;
  strategy: StrategyInsights | null;
  briefing: AccountBriefing | null;
  mapUrl: string;
}

const territoryHeaders = [
  'Accounts',
  'Tier',
  'Domain',
  'Status',
  'ACV Base',
  'Closed Won',
  'FY Remaining Goal',
  '# Eng',
  '# Eng Override',
  'ARR Potential',
  '',
  'Employee Count',
  'Location',
  'Notes',
  'Comments',
  'Annual Revenue',
  'Industry',
  'FY End (Month)',
  'Linkedin Profile',
  'Description',
  'Code Assistant Job Postings',
  '10-K URL',
  'Generative AI Initiative Search (3 Credits per row)',
  'Productivity Initiative Search (3 Credits per Row)',
  'AI Code Assistant Case-Study Search (3 Credits per row)',
];

const accountLabels = [
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
];

const buHeaders = [
  'BU Name',
  'Developer Count',
  'Critical Applications',
  'Programming Languages',
  'SCMs and IDEs',
  'Current Coding Assistant ',
  'Why Do Anything?',
  'Why Now?',
  'Strategy to win',
];

const contactHeaders = [
  'Name',
  'Role',
  'Responsibility',
  'Business Unit',
  'Engagment Status',
  'LinkedIn',
  'Email',
  'Cell Number',
  'Notes',
];

const peopleHeaders = [
  'Account',
  'Name',
  'Title',
  'Function (Department)',
  'Business Unit / Team',
  'Product Line',
  'Level',
  'Buying Role',
  'Engagement',
  'Confidence',
  'LinkedIn',
  'Email',
  'Notes',
];

const headingFill = 'FFA4C2F4';
const contactsFill = 'FFC9DAF8';

function safeText(value: string): string {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

function optionalText(value: string | null | undefined): string | null {
  return value ? safeText(value) : null;
}

function normalized(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function accountDisplayName(account: ExportAccount): string {
  const profile = account.state.meta?.companyProfile ?? null;
  return account.companyName ?? profile?.companyName ?? account.name;
}

function engagementLabel(
  person: Person,
  stakeholder?: StakeholderPlanEntry
): string {
  return person.role === 'champion'
    ? 'Champ'
    : person.role === 'economic_buyer'
      ? 'EB'
      : person.role === 'blocker'
        ? 'Blocker'
        : stakeholder?.stance === 'advocate'
          ? 'Coach'
          : person.metWith
            ? 'Met & Unknown'
            : 'Not Met';
}

function humanizeBuyingRole(role: Person['role']): string {
  return role
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function sortedPeople(account: ExportAccount): Person[] {
  return [...(account.state.people ?? [])].sort(
    (a, b) =>
      normalized(a.department).localeCompare(normalized(b.department)) ||
      a.name.localeCompare(b.name)
  );
}

function sourceDetailsFor(
  people: Person[],
  initiatives: StrategicInitiative[]
): ResearchSource[] {
  return [
    ...people.flatMap((person) => person.sourceDetails ?? []),
    ...initiatives.flatMap((initiative) => initiative.evidenceDetails ?? []),
  ];
}

function filingUrl(account: ExportAccount): string {
  const source = sourceDetailsFor(
    account.state.people ?? [],
    account.state.meta?.initiatives ?? []
  ).find((item) => item.sourceType === 'filing' && item.url);
  return source?.url ?? '';
}

function setHyperlink(
  cell: ExcelJS.Cell,
  text: string,
  url: string
): void {
  cell.value = { text, hyperlink: url };
  cell.font = { color: { argb: 'FF0563C1' }, underline: true };
}

function styleHeading(row: ExcelJS.Row, fill = headingFill): void {
  row.font = { bold: true };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
}

function styleBody(cell: ExcelJS.Cell, height?: number): void {
  cell.alignment = { wrapText: true, vertical: 'top' };
  if (height !== undefined) {
    cell.worksheet.getRow(cell.fullAddress.row).height = height;
  }
}

export function accountSheetName(name: string, taken: Set<string>): string {
  const base = name
    .replace(/\u005b|\u005d|:|\*|\?|\/|\u005c/g, '')
    .trim() || 'Account';
  let candidate = base.slice(0, 31);
  let suffix = 2;
  while (taken.has(candidate)) {
    const ending = ` (${suffix++})`;
    candidate = `${base.slice(0, 31 - ending.length)}${ending}`;
  }
  taken.add(candidate);
  return candidate;
}

function addTerritorySheet(
  workbook: ExcelJS.Workbook,
  accounts: ExportAccount[]
): void {
  const sheet = workbook.addWorksheet('Territory');
  sheet.views = [{ state: 'frozen', xSplit: 1, ySplit: 1 }];
  sheet.addRow(territoryHeaders);
  sheet.getRow(1).font = { bold: true };
  sheet.getColumn(1).width = 19;
  sheet.getColumn(3).width = 16.75;
  sheet.getColumn(4).width = 18.25;
  sheet.getColumn(5).width = 15.13;
  sheet.getColumn(7).width = 16.25;
  sheet.getColumn(16).width = 14.38;
  sheet.getColumn(21).width = 12.63;
  sheet.getColumn(23).width = 12.63;
  for (const column of [5, 6, 7, 10, 16]) {
    sheet.getColumn(column).numFmt = '"$"#,##0';
  }

  accounts.forEach((account, index) => {
    const rowNumber = index + 2;
    const initiatives = account.state.meta?.initiatives ?? [];
    const people = account.state.people ?? [];
    const profile = account.state.meta?.companyProfile ?? null;
    const annualReport = (profile?.annualReportUrl ?? filingUrl(account)) || null;
    const description = profile?.description ?? account.briefing?.summary ?? '';
    const row = sheet.addRow([
      safeText(accountDisplayName(account)),
      '',
      safeText(account.domain),
      account.isLiveOpportunity ? 'Live Opportunity' : 'Prospect',
      '',
      '',
      '',
      profile?.engineerCount ?? null,
      '',
      { formula: `I${rowNumber}*425` },
      '',
      profile?.employeeCount ?? null,
      profile?.headquarters ? safeText(profile.headquarters) : null,
      safeText(
        `${people.length} stakeholders mapped · ${initiatives.length} initiatives`
      ),
      profile?.funding ? safeText(profile.funding) : null,
      profile?.annualRevenueUsd ??
        (profile?.annualRevenue ? safeText(profile.annualRevenue) : null),
      profile?.industry ? safeText(profile.industry) : null,
      profile?.fiscalYearEndMonth ?? null,
      null,
      description ? safeText(description) : null,
      '',
      annualReport ? safeText(annualReport) : null,
      '',
      '',
      '',
    ]);
    if (profile?.linkedinUrl) {
      setHyperlink(row.getCell(19), 'Link', profile.linkedinUrl);
    }
    row.getCell(10).numFmt = '"$"#,##0';
  });
}

function addAccountSheet(
  workbook: ExcelJS.Workbook,
  account: ExportAccount,
  taken: Set<string>
): void {
  const profile = account.state.meta?.companyProfile ?? null;
  const sheet = workbook.addWorksheet(
    accountSheetName(accountDisplayName(account), taken)
  );
  const widths = [19.25, 26.63, 23.75, 23.38, 21.5, 29.88, 20, 13.25];
  for (const [index, width] of widths.entries()) {
    sheet.getColumn(index < 7 ? index + 1 : 9).width = width;
  }

  for (let rowNumber = 1; rowNumber <= accountLabels.length; rowNumber++) {
    sheet.getCell(rowNumber, 1).value = accountLabels[rowNumber - 1];
    sheet.getCell(rowNumber, 1).font = { bold: true };
    sheet.mergeCells(`B${rowNumber}:H${rowNumber}`);
  }
  sheet.getCell(1, 2).value = safeText(
    account.companyName ?? profile?.companyName ?? account.name
  );
  if (profile?.annualRevenue) {
    sheet.getCell(2, 2).value = safeText(profile.annualRevenue);
  }
  if (profile?.headquarters) {
    sheet.getCell(3, 2).value = safeText(profile.headquarters);
  }
  sheet.getCell(4, 2).value = safeText(account.domain);
  if (profile?.linkedinUrl) {
    setHyperlink(sheet.getCell(5, 2), 'Link', profile.linkedinUrl);
  }
  setHyperlink(sheet.getCell(6, 2), 'Link', account.mapUrl);
  if (profile?.mission) {
    sheet.getCell(7, 2).value = safeText(profile.mission);
  }
  if (profile?.fiscalYearEndMonth !== null && profile?.fiscalYearEndMonth !== undefined) {
    sheet.getCell(8, 2).value = profile.fiscalYearEndMonth;
  }
  if (profile?.engineerCount !== null && profile?.engineerCount !== undefined) {
    sheet.getCell(9, 2).value = profile.engineerCount;
  }
  const filing = filingUrl(account);
  const annualReport = profile?.annualReportUrl ?? filing;
  if (annualReport) setHyperlink(sheet.getCell(11, 2), 'Link', annualReport);

  const headingRows = [12, 14, 16, 18, 20];
  for (const rowNumber of headingRows) {
    sheet.mergeCells(`A${rowNumber}:I${rowNumber}`);
    styleHeading(sheet.getRow(rowNumber));
  }
  sheet.getCell(12, 1).value = 'Overall Hypothesis for Codeium';
  sheet.getCell(14, 1).value = 'Strategy To Win The Account';
  sheet.getCell(16, 1).value = 'Partner Strategy';
  sheet.getCell(18, 1).value = 'Our Current Quarter Priorities';
  sheet.getCell(20, 1).value = 'Business Units ';

  sheet.mergeCells('A13:H13');
  sheet.getCell(13, 1).value = safeText(
    account.strategy?.executiveSummary ||
      account.briefing?.summary ||
      account.briefing?.headline ||
      ''
  );
  styleBody(sheet.getCell(13, 1), 66.75);

  sheet.mergeCells('A15:H15');
  const strategyText = account.strategy
    ? [
        ...account.strategy.winThemes.map((theme) => `• ${theme.statement}`),
        ...(account.strategy.landingPlays.length
          ? [
              '',
              'Landing plays:',
              ...account.strategy.landingPlays.map(
                (play) => `• ${play.title} — ${play.rationale}`
              ),
            ]
          : []),
      ].join('\n')
    : '';
  sheet.getCell(15, 1).value = safeText(strategyText);
  styleBody(sheet.getCell(15, 1), 61.5);

  sheet.mergeCells('A17:H17');
  sheet.getCell(17, 1).value = '';
  styleBody(sheet.getCell(17, 1), 61.5);

  sheet.mergeCells('A19:H19');
  const openTasks = (account.state.meta?.strategy?.tasks ?? [])
    .filter((task) => !task.done)
    .map((task) => `• ${task.title}`);
  const milestones = (account.strategy?.mutualActionPlan ?? []).map(
    (item) => `• ${item.milestone} (${item.owner}, ${item.timing})`
  );
  sheet.getCell(19, 1).value = safeText([...openTasks, ...milestones].join('\n'));
  styleBody(sheet.getCell(19, 1), 27);
  sheet.getCell(19, 1).alignment = { wrapText: true, vertical: 'middle' };

  const people = account.state.people ?? [];
  const initiatives = account.state.meta?.initiatives ?? [];
  const departmentCounts = new Map<string, number>();
  for (const person of people) {
    if (person.department) {
      departmentCounts.set(
        person.department,
        (departmentCounts.get(person.department) ?? 0) + 1
      );
    }
  }
  const departments = [...departmentCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([department]) => department);
  if (departments.length === 0) departments.push('Unassigned');
  while (departments.length < 5) departments.push('');

  sheet.addRow(buHeaders);
  const buHeaderRow = sheet.getRow(21);
  buHeaderRow.font = { bold: true };
  buHeaderRow.height = 17.25;
  departments.forEach((department) => {
    const relevant = initiatives
      .filter((initiative) =>
        initiative.relevantTeams.some(
          (team) => normalized(team) === normalized(department)
        )
      )
      .map((initiative) => initiative.name)
      .join('; ');
    const row = sheet.addRow([
      department ? safeText(department) : '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      safeText(relevant),
    ]);
    row.getCell(1).font = { bold: true };
  });

  const contactsHeading = 22 + departments.length;
  sheet.mergeCells(`A${contactsHeading}:I${contactsHeading}`);
  sheet.getCell(contactsHeading, 1).value = 'Contacts';
  styleHeading(sheet.getRow(contactsHeading), contactsFill);
  const contactsHeaderRow = contactsHeading + 1;
  sheet.getRow(contactsHeaderRow).values = contactHeaders;
  sheet.getRow(contactsHeaderRow).font = { bold: true };
  sheet.getRow(contactsHeaderRow).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: contactsFill },
  };
  const legendRow = contactsHeaderRow + 1;
  sheet.getCell(legendRow, 5).value =
    'Mole, Coach, Champ, EB, Blocker, Not Met, Met & Unknown';

  const accountPeople = sortedPeople(account);
  accountPeople.forEach((person) => {
    const stakeholder = account.state.meta?.strategy?.stakeholders?.[person.id];
    const engagement = engagementLabel(person, stakeholder);
    const notes = [
      person.notes,
      stakeholder?.nextStep && `Next: ${stakeholder.nextStep}`,
      stakeholder?.note,
    ]
      .filter(Boolean)
      .join(' · ');
    const row = sheet.addRow([
      safeText(person.name),
      safeText(person.title),
      safeText(person.team ?? person.productLine ?? ''),
      safeText(person.department ?? ''),
      engagement,
      '',
      safeText(person.email ?? ''),
      '',
      safeText(notes),
    ]);
    if (person.linkedin) setHyperlink(row.getCell(6), 'Link', person.linkedin);
  });

  const otherHeading = contactsHeaderRow + 2 + accountPeople.length;
  sheet.mergeCells(`A${otherHeading}:I${otherHeading}`);
  sheet.getCell(otherHeading, 1).value = 'OTHER INFORMATION';
  styleHeading(sheet.getRow(otherHeading));
  const otherBody = otherHeading + 1;
  sheet.mergeCells(`A${otherBody}:I${otherBody + 2}`);
  sheet.getCell(otherBody, 1).value = safeText(
    initiatives
      .map((initiative) => `${initiative.name} (${initiative.category}): ${initiative.summary}`)
      .join('\n')
  );
  sheet.getCell(otherBody, 1).alignment = {
    wrapText: true,
    vertical: 'middle',
  };
}

function addPeopleSheet(
  workbook: ExcelJS.Workbook,
  accounts: ExportAccount[]
): void {
  const sheet = workbook.addWorksheet('People');
  sheet.views = [{ state: 'frozen', xSplit: 1, ySplit: 1 }];
  sheet.addRow(peopleHeaders);
  sheet.getRow(1).font = { bold: true };
  sheet.autoFilter = { from: 'A1', to: 'M1' };
  [
    22, 24, 28, 22, 24, 20, 14, 18, 18, 14, 36, 28, 42,
  ].forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });

  const rows = accounts.flatMap((account) => {
    const accountName = accountDisplayName(account);
    return (account.state.people ?? []).map((person) => ({
      accountName,
      person,
      stakeholder: account.state.meta?.strategy?.stakeholders?.[person.id],
    }));
  });
  rows.sort(
    (a, b) =>
      a.accountName.localeCompare(b.accountName) ||
      normalized(a.person.department).localeCompare(normalized(b.person.department)) ||
      a.person.name.localeCompare(b.person.name)
  );

  for (const { accountName, person, stakeholder } of rows) {
    const row = sheet.addRow([
      safeText(accountName),
      safeText(person.name),
      safeText(person.title),
      optionalText(person.department),
      optionalText(person.team),
      optionalText(person.productLine),
      optionalText(person.jobLevel),
      safeText(humanizeBuyingRole(person.role)),
      safeText(engagementLabel(person, stakeholder)),
      safeText(person.confidence),
      null,
      optionalText(person.email),
      optionalText(person.notes),
    ]);
    if (person.linkedin) setHyperlink(row.getCell(11), 'Link', person.linkedin);
  }
}

export async function buildTerritoryWorkbook(
  accounts: ExportAccount[],
  opts: { includeTerritorySheet: boolean }
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'TopDown';
  workbook.created = new Date();
  if (opts.includeTerritorySheet) addTerritorySheet(workbook, accounts);
  addPeopleSheet(workbook, accounts);
  const taken = new Set<string>();
  for (const account of accounts) addAccountSheet(workbook, account, taken);
  return Buffer.from(await workbook.xlsx.writeBuffer()) as unknown as Buffer;
}
