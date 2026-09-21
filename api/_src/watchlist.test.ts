import assert from 'node:assert/strict';
import test from 'node:test';
import { parseTrace } from './watchlist.js';

test('parseTrace reads a move', () => {
  const trace = parseTrace(
    JSON.stringify({
      status: 'moved',
      currentCompany: 'Globex, Inc.',
      currentTitle: 'VP Sales',
      currentDomain: 'https://globex.com/about',
      evidence: ['https://linkedin.com/in/jane', 'not a url'],
    })
  );
  assert.equal(trace.status, 'moved');
  assert.equal(trace.currentCompany, 'Globex, Inc.');
  assert.equal(trace.currentTitle, 'VP Sales');
  assert.equal(trace.currentDomain, 'globex.com');
  assert.deepEqual(trace.evidence, ['https://linkedin.com/in/jane']);
});

test('parseTrace defaults to unknown for bad status', () => {
  const trace = parseTrace('{"status":"promoted","currentCompany":"Acme"}');
  assert.equal(trace.status, 'unknown');
});

test('parseTrace handles same_company and departed', () => {
  assert.equal(
    parseTrace('{"status":"same_company","currentTitle":"CRO"}').status,
    'same_company'
  );
  const departed = parseTrace('{"status":"departed","evidence":[]}');
  assert.equal(departed.status, 'departed');
  assert.equal(departed.currentCompany, null);
});

test('parseTrace tolerates prose around the json', () => {
  const trace = parseTrace(
    'Based on my search:\n{"status":"moved","currentCompany":"Initech"}\nDone.'
  );
  assert.equal(trace.status, 'moved');
  assert.equal(trace.currentCompany, 'Initech');
});
