import test from 'node:test';
import assert from 'node:assert/strict';
import * as gates from '../gates.mjs';
test('npm scan requires a complete clean installed-graph result', () => {
  const raw = { auditReportVersion: 2, vulnerabilities: {}, metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 }, dependencies: { total: 240 } } };
  assert.equal(gates.npmAuditMeasurement(raw).status, 'pass');
  raw.metadata.vulnerabilities.moderate = 1; raw.metadata.vulnerabilities.total = 1;
  assert.equal(gates.npmAuditMeasurement(raw).status, 'fail');
  for (const invalid of [{}, { error: 'service unavailable' }, { ...raw, auditReportVersion: 1 }]) assert.throws(() => gates.npmAuditMeasurement(invalid));
});
test('cargo-deny scanner completion and duplicate advisory are distinct', () => {
  const clean = [{ type: 'summary', fields: { advisories: { errors: 0, warnings: 0, notes: 0 }, licenses: { errors: 0, warnings: 0, notes: 0 }, bans: { errors: 0, warnings: 2, notes: 0 }, sources: { errors: 0, warnings: 0, notes: 0 } } }];
  assert.equal(gates.denyMeasurement(clean).status, 'pass');
  clean[0].fields.licenses.errors = 1;
  assert.equal(gates.denyMeasurement(clean).status, 'fail');
  assert.throws(() => gates.denyMeasurement([{ type: 'diagnostic', fields: { message: 'network failed' } }]));
});
