import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyAuditReport } from '../scripts/audit-dependencies.mjs';

const allowedAdvisory = {
  source: 1,
  name: 'picomatch',
  title: 'picomatch vulnerable to ReDoS through single-branch repeated extglobs',
  url: 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf',
  severity: 'high',
};

test('allows only the explicitly documented transitive picomatch advisory', () => {
  const result = classifyAuditReport({
    vulnerabilities: {
      picomatch: { via: [allowedAdvisory] },
      micromatch: { via: ['picomatch'] },
      'workbox-build': { via: ['micromatch'] },
    },
  });

  assert.equal(result.allowed, true);
  assert.deepEqual(result.advisoryIds, ['GHSA-FC5Q-39XC-VJPF']);
  assert.deepEqual(result.errors, []);
});

test('fails when any package has a different advisory', () => {
  const result = classifyAuditReport({
    vulnerabilities: {
      picomatch: { via: [allowedAdvisory] },
      minimatch: {
        via: [{
          source: 2,
          name: 'minimatch',
          title: 'A different high severity vulnerability',
          url: 'https://github.com/advisories/GHSA-AAAA-BBBB-CCCC',
        }],
      },
    },
  });

  assert.equal(result.allowed, false);
  assert.ok(result.errors.some((error) => error.includes('GHSA-AAAA-BBBB-CCCC')));
});

test('allows cyclic transitive dependency paths when they terminate in the approved advisory', () => {
  const result = classifyAuditReport({
    vulnerabilities: {
      picomatch: { via: [allowedAdvisory] },
      'app-builder-lib': { via: ['dmg-builder', 'picomatch'] },
      'dmg-builder': { via: ['app-builder-lib', 'picomatch'] },
    },
  });

  assert.equal(result.allowed, true);
  assert.deepEqual(result.advisoryIds, ['GHSA-FC5Q-39XC-VJPF']);
  assert.deepEqual(result.errors, []);
});

test('fails when a transitive advisory chain cannot be resolved', () => {
  const result = classifyAuditReport({
    vulnerabilities: {
      workbox: { via: ['unknown-transitive-package'] },
    },
  });

  assert.equal(result.allowed, false);
  assert.ok(result.errors.some((error) => error.includes('unknown-transitive-package')));
});

test('fails when npm audit does not return a vulnerability map', () => {
  const result = classifyAuditReport({ metadata: { vulnerabilities: { total: 0 } } });

  assert.equal(result.allowed, false);
  assert.ok(result.errors.length > 0);
});
