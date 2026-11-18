import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const allowedAdvisoryIds = new Set(['GHSA-FC5Q-39XC-VJPF']);

export function classifyAuditReport(report) {
  const vulnerabilities = report?.vulnerabilities;
  if (!vulnerabilities || typeof vulnerabilities !== 'object') {
    return { allowed: false, advisoryIds: [], errors: ['npm audit returned no vulnerability map.'] };
  }

  const advisoryIds = new Set();
  const errors = [];

  function inspectPackage(packageName, ancestry = new Set()) {
    if (ancestry.has(packageName)) {
      errors.push(`Circular advisory dependency chain at ${packageName}.`);
      return;
    }

    const vulnerability = vulnerabilities[packageName];
    if (!vulnerability || !Array.isArray(vulnerability.via) || vulnerability.via.length === 0) {
      errors.push(`Unable to resolve the advisory chain for ${packageName}.`);
      return;
    }

    const nextAncestry = new Set(ancestry);
    nextAncestry.add(packageName);

    for (const item of vulnerability.via) {
      if (typeof item === 'string') {
        inspectPackage(item, nextAncestry);
        continue;
      }

      if (!item || typeof item !== 'object') {
        errors.push(`Unrecognised advisory entry for ${packageName}.`);
        continue;
      }

      const searchable = [item.url, item.source, item.title].filter(Boolean).join(' ');
      const match = searchable.match(/GHSA-[A-Z0-9-]+/i);
      const advisoryId = match?.[0]?.toUpperCase();

      if (!advisoryId || !allowedAdvisoryIds.has(advisoryId)) {
        errors.push(
          `Unapproved advisory for ${packageName}: ${advisoryId ?? item.title ?? item.url ?? 'unknown advisory'}.`
        );
        continue;
      }

      advisoryIds.add(advisoryId);
    }
  }

  for (const packageName of Object.keys(vulnerabilities)) {
    inspectPackage(packageName);
  }

  return {
    allowed: errors.length === 0,
    advisoryIds: [...advisoryIds],
    errors,
  };
}

function runAudit(cwd, label) {
  const result = spawnSync('npm', ['audit', '--json'], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });

  if (result.error) {
    console.error(`[${label}] Unable to run npm audit:`, result.error.message);
    return false;
  }

  const output = result.stdout ?? '';
  const jsonStart = output.indexOf('{');
  const jsonEnd = output.lastIndexOf('}');
  if (jsonStart < 0 || jsonEnd <= jsonStart) {
    console.error(`[${label}] npm audit did not return a parseable JSON report.`);
    if (result.stderr) console.error(result.stderr);
    return false;
  }

  let report;
  try {
    report = JSON.parse(output.slice(jsonStart, jsonEnd + 1));
  } catch (error) {
    console.error(`[${label}] Unable to parse npm audit output:`, error);
    return false;
  }

  const classification = classifyAuditReport(report);
  const total = report.metadata?.vulnerabilities?.total ?? 0;

  if (classification.allowed) {
    if (classification.advisoryIds.length > 0) {
      console.warn(
        `::warning::[${label}] ${total} transitive findings are covered only by the documented, no-fix ${classification.advisoryIds.join(', ')} exception.`
      );
    } else if (total > 0) {
      console.error(`[${label}] npm audit reported vulnerabilities but no approved exception matched.`);
      return false;
    } else if (result.status !== 0) {
      console.error(`[${label}] npm audit failed without reporting an approved vulnerability.`);
      if (result.stderr) console.error(result.stderr);
      return false;
    }
    return true;
  }

  console.error(`::error::[${label}] Unapproved dependency vulnerabilities remain.`);
  for (const error of classification.errors) console.error(`- ${error}`);
  if (result.stderr) console.error(result.stderr);
  return false;
}

function main() {
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const electron = process.argv.includes('--electron');
  const cwd = electron ? path.join(repositoryRoot, 'electron') : repositoryRoot;
  const label = electron ? 'Electron dependency tree' : 'Root dependency tree';

  if (!runAudit(cwd, label)) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
