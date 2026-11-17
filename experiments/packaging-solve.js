#!/usr/bin/env node
// Packaging closure experiment: hierarchy vs closed-loop constraints on one
// planar net. Writes a machine-readable record of every measured number so the
// interface and the tests can re-run exactly the same computation.
//
//   node experiments/packaging-solve.js            # table + deliverables/packaging-report.json
//   node experiments/packaging-solve.js --json     # JSON only
//
// Nothing here substitutes a default for a failure: skipped seams, refused
// solves and collisions are printed with the reason they occurred.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluatePackaging, validateSeams } from '../src/packaging.js';
import { validateModel } from '../src/validation.js';
import {
  LEGACY_EXAMPLE_NAMES,
  closedBox,
  closedBoxColliding,
  closedBoxInternalCollision,
  mixedSizeStrip,
  openBox,
  twoPanelDiagonal,
} from '../src/examples.js';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'deliverables');

function nowSeconds() {
  return Number(process.hrtime.bigint()) / 1e9;
}

function runCase(name, builder, mode) {
  const model = builder();
  const t0 = nowSeconds();
  const evaluated = evaluatePackaging(model, { mode });
  const elapsedMs = (nowSeconds() - t0) * 1000;
  return {
    name,
    mode,
    ok: evaluated.ok,
    validPose: Boolean(evaluated.result?.ok),
    // Wall-clock is machine-dependent and therefore kept out of the canonical
    // JSON. It is printed in the table; the reproducible cost evidence is the
    // deterministic fold/residual/iteration counter block below.
    elapsedMs,
    seam: evaluated.closed?.seamReport ?? evaluated.tree?.seamReport ?? null,
    comparison: evaluated.comparison ?? null,
    work: evaluated.closed?.work ?? evaluated.tree?.work ?? null,
    collisions: evaluated.collisions.map((c) => ({
      a: c.a,
      b: c.b,
      type: c.type,
      point: c.point,
    })),
    collisionStats: evaluated.collisionStats,
    diagnostics: evaluated.diagnostics.map((d) => ({
      level: d.level,
      code: d.code,
      message: d.message,
    })),
  };
}

function canonical(record) {
  const { elapsedMs, ...rest } = record;
  return rest;
}

const cases = [
  { key: 'closed-box-flat-request', make: closedBox },
  { key: 'closed-box-lid-150', make: closedBoxColliding },
  { key: 'closed-box-internal-flap', make: closedBoxInternalCollision },
];

const legacy = [openBox, twoPanelDiagonal, mixedSizeStrip].map((builder) => {
  const model = builder();
  const tree = evaluatePackaging(model, { mode: 'tree' });
  return {
    name: model.name,
    legacyName: LEGACY_EXAMPLE_NAMES.includes(model.name),
    ok: tree.ok,
    seamCount: tree.tree.seamReport.seamCount,
    collisionCount: tree.collisions.length,
    diagnostics: tree.diagnostics.map((d) => d.code),
  };
});

const records = [];
for (const c of cases) {
  for (const mode of ['tree', 'closed']) {
    records.push(runCase(c.key, c.make, mode));
  }
}

const assumptions = [
  'Rigid, zero-thickness panels: no material thickness, crease radius or ply build-up.',
  'Seams join free panel edges of exactly equal length; unequal lengths are rejected, never rescaled.',
  'Every seam declares flip (endpoint pairing) explicitly; orientation is never inferred.',
  'Hinges must form a single tree (legacy validation); seams add closure, not extra kinematic loops.',
  'Seed sequence is deterministic (requested, then 90/-90/45/-45/135/-135 degrees); solve is local and may fail.',
  'A flat net is an exact seam-residual stationary point, so 0-degree requests require a restart.',
  'Closure is geometric only: it is not a sealability, stiffness or manufacturability claim.',
  'Collisions are strict-interior triangle tests; shared hinge/seam boundaries do not count.',
  'Timing is wall-clock on this machine; fold-build and residual counters are the portable cost evidence.',
];

const report = {
  generatedBy: 'experiments/packaging-solve.js',
  node: process.version,
  cases: records.map(canonical),
  legacy,
  assumptions,
  notes: [
    'tree = hierarchical articulation with seams only measured.',
    'closed = same hinge tree plus seam equality constraints solved by LM multi-start.',
    'A closed case with collisions is still reported as ok:false; closure never hides interference.',
    'elapsedMs is printed to stdout only; it is wall-clock and not part of the reproducible report.',
  ],
};

if (process.argv.includes('--json')) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, 'packaging-report.json'), `${JSON.stringify(report, null, 2)}\n`);

  const pad = (s, n) => String(s).padEnd(n);
  const num = (v, digits = 6) => (v === null || v === undefined ? '—' : Number(v).toFixed(digits));
  console.log('Packaging closure experiment (same planar net)');
  console.log('case'.padEnd(30), pad('mode', 8), pad('seam max gap', 14), pad('seams', 6), pad('closed', 7), pad('collisions', 11), pad('fold builds', 12), 'elapsed ms');
  for (const r of records) {
    const gap = r.seam?.maxGap;
    console.log(
      pad(r.name, 30),
      pad(r.mode, 8),
      pad(num(gap), 14),
      pad(r.seam?.seamCount ?? '—', 6),
      pad(r.seam?.closed === null || r.seam?.closed === undefined ? '—' : String(r.seam.closed), 7),
      pad(r.collisions.length, 11),
      pad(r.work?.foldBuilds ?? '—', 12),
      r.elapsedMs.toFixed(2),
    );
  }
  console.log('\nLegacy examples still run:');
  for (const l of legacy) console.log(`  ${l.ok ? 'ok  ' : 'FAIL'} ${l.name} (seams ${l.seamCount}, collisions ${l.collisionCount})`);
  console.log(`\nReport written to ${join(outDir, 'packaging-report.json')}`);
}

// A failed legacy example or a malformed seam set is a hard experiment failure.
const badLegacy = legacy.filter((l) => !l.ok);
if (badLegacy.length) {
  console.error(`legacy examples failed: ${badLegacy.map((l) => l.name).join(', ')}`);
  process.exitCode = 1;
}
for (const c of cases) {
  const model = c.make();
  const modelOk = validateModel(model).ok;
  const seams = validateSeams(model);
  if (!modelOk || !seams.ok) {
    console.error(`case ${c.key} is structurally invalid: ${seams.diagnostics.map((d) => d.code).join(', ') || 'model'}`);
    process.exitCode = 1;
  }
}
