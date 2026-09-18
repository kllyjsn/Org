import assert from 'node:assert/strict';
import test from 'node:test';
import { rowsFromCsv, rowsFromLinkedinUrls } from './csv.js';

test('imports Sales Navigator CSV', () => {
  const rows = rowsFromCsv('First Name,Last Name,Title,Company,LinkedIn Profile URL,Location\nJane,Doe,VP Sales,Acme,https://www.linkedin.com/in/jane-doe,New York\nJohn,Smith,Engineer,Acme,https://www.linkedin.com/in/john-smith,Remote');
  assert.deepEqual(rows[0], { name: 'Jane Doe', title: 'VP Sales', linkedin: 'https://www.linkedin.com/in/jane-doe', email: null, location: 'New York', company: 'Acme' });
});
test('imports HubSpot CSV', () => {
  const rows = rowsFromCsv('First Name,Last Name,Job Title,Email,Company Name,Mailing City\nAda,Lovelace,CTO,ada@example.com,Example,London');
  assert.deepEqual(rows[0], { name: 'Ada Lovelace', title: 'CTO', linkedin: null, email: 'ada@example.com', location: 'London', company: 'Example' });
});
test('imports Apollo CSV', () => {
  const rows = rowsFromCsv('First Name,Last Name,Title,Company,Person Linkedin Url,Email,City,State,Country\nGrace,Hopper,Engineer,Nav,https://linkedin.com/in/grace-hopper,grace@example.com,Arlington,VA,USA');
  assert.equal(rows[0].name, 'Grace Hopper');
  assert.equal(rows[0].linkedin, 'https://linkedin.com/in/grace-hopper');
  assert.equal(rows[0].email, 'grace@example.com');
});
test('normalizes and deduplicates LinkedIn URLs', () => {
  assert.deepEqual(rowsFromLinkedinUrls(['https://www.linkedin.com/in/jane-doe-123ab', 'linkedin.com/in/jane-doe-123ab', 'https://www.linkedin.com/in/john-smith']), [
    { name: 'Jane Doe', title: null, linkedin: 'https://www.linkedin.com/in/jane-doe-123ab', email: null, location: null, company: null },
    { name: 'John Smith', title: null, linkedin: 'https://www.linkedin.com/in/john-smith', email: null, location: null, company: null },
  ]);
});
