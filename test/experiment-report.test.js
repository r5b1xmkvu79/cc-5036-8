// The packaging experiment report is generated evidence, not prose. These
// tests re-run the same solver calls and assert that every seam-gap and cost
// number in deliverables/packaging-report.json matches the code exactly.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluatePackaging } from '../src/packaging.js';
import {
  closedBox,
  closedBoxColliding,
  closedBoxInternalCollision,
  mixedSizeStrip,
  openBox,
  twoPanelDiagonal,
} from '../src/examples.js';

const here = dirname(fileURLToPath(import.meta.url));
const reportPath = join(here, '..', 'deliverables', 'packaging-report.json');

const builders = {
  'closed-box-flat-request': closedBox,
  'closed-box-lid-150': closedBoxColliding,
  'closed-box-internal-flap': closedBoxInternalCollision,
};

function closeTo(actual, expected, label) {
  assert.ok(Math.abs(actual - expected) <= 1e-9 * Math.max(1, Math.abs(expected)),
    `${label}: ${actual} != ${expected}`);
}

test('report exists and covers every packaging case in both assumptions', async () => {
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  assert.equal(report.generatedBy, 'experiments/packaging-solve.js');
  const keys = report.cases.map((c) => `${c.name}/${c.mode}`).sort();
  const expected = Object.keys(builders).flatMap((k) => [`${k}/tree`, `${k}/closed`]).sort();
  assert.deepEqual(keys, expected);
});

test('every seam gap and cost counter in the report recomputes from code', async () => {
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  for (const record of report.cases) {
    const model = builders[record.name]();
    const fresh = evaluatePackaging(model, { mode: record.mode });
    const seam = fresh.closed?.seamReport ?? fresh.tree?.seamReport;
    assert.equal(record.seam.seamCount, seam.seamCount, `${record.name}/${record.mode} seam count`);
    if (seam.maxGap === null) {
      assert.equal(record.seam.maxGap, null);
    } else {
      closeTo(record.seam.maxGap, seam.maxGap, `${record.name}/${record.mode} max gap`);
    }
    assert.equal(record.seam.closed, seam.closed, `${record.name}/${record.mode} closed flag`);
    const work = fresh.closed?.work ?? fresh.tree?.work;
    assert.equal(record.work.foldBuilds, work.foldBuilds, `${record.name}/${record.mode} fold builds`);
    assert.equal(record.work.iterations, work.iterations, `${record.name}/${record.mode} iterations`);
    assert.equal(record.work.seedsTried, work.seedsTried, `${record.name}/${record.mode} seeds`);
    assert.equal(record.collisions.length, fresh.collisions.length,
      `${record.name}/${record.mode} collision count`);
    assert.equal(record.ok, fresh.ok, `${record.name}/${record.mode} ok flag`);
  }
});

test('per-seam distances in the report match a fresh solve', async () => {
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  for (const record of report.cases.filter((r) => r.seam?.seams?.length)) {
    const model = builders[record.name]();
    const fresh = evaluatePackaging(model, { mode: record.mode });
    const seam = fresh.closed?.seamReport ?? fresh.tree?.seamReport;
    for (const saved of record.seam.seams) {
      const now = seam.seams.find((s) => s.id === saved.id);
      assert.ok(now, `seam ${saved.id} missing on recompute`);
      closeTo(saved.gap, now.gap, `${record.name}/${record.mode}/${saved.id}`);
      closeTo(saved.endpointGaps[0], now.endpointGaps[0], `${saved.id} endpoint 0`);
      closeTo(saved.endpointGaps[1], now.endpointGaps[1], `${saved.id} endpoint 1`);
    }
  }
});

test('legacy examples still run and stay seam-free', async () => {
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  const legacyNames = report.legacy.map((l) => l.name).sort();
  assert.deepEqual(legacyNames, [openBox().name, twoPanelDiagonal().name, mixedSizeStrip().name].sort());
  for (const entry of report.legacy) {
    assert.equal(entry.ok, true, `${entry.name} must evaluate`);
    assert.equal(entry.seamCount, 0);
    assert.equal(entry.collisionCount, 0);
  }
});

test('the closed box with 150 degree lid is an actual tree-mode collision', () => {
  const model = closedBoxColliding();
  const evaluated = evaluatePackaging(model, { mode: 'tree' });
  assert.ok(evaluated.collisions.length >= 1);
  assert.equal(evaluated.ok, false);
});

test('numbers cited in the conclusion match the generated report', async () => {
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  const doc = await readFile(
    join(here, '..', 'deliverables', 'packaging-solve.md'), 'utf8',
  );
  const pick = (name, mode) => report.cases.find((c) => c.name === name && c.mode === mode);

  const flatTree = pick('closed-box-flat-request', 'tree');
  assert.equal(flatTree.seam.maxGap, 10);
  assert.equal(flatTree.work.foldBuilds, 1);
  const flatClosed = pick('closed-box-flat-request', 'closed');
  assert.equal(flatClosed.work.foldBuilds, 20);
  assert.equal(flatClosed.work.iterations, 1);
  assert.equal(flatClosed.comparison.maxAngleChange, 90);

  const lidTree = pick('closed-box-lid-150', 'tree');
  assert.equal(lidTree.seam.maxGap, 3);
  assert.equal(lidTree.collisions[0].a, 'base');
  assert.equal(lidTree.collisions[0].b, 'lid');
  const lidClosed = pick('closed-box-lid-150', 'closed');
  assert.equal(lidClosed.work.foldBuilds, 45);
  // The lid was requested at 150° and solves back to ≈90°: 60° of correction,
  // accurate to the solver's angle residual rather than exactly 60.
  assert.ok(Math.abs(lidClosed.comparison.maxAngleChange - 60) < 1e-4);

  const flapTree = pick('closed-box-internal-flap', 'tree');
  const flapClosed = pick('closed-box-internal-flap', 'closed');
  assert.equal(flapTree.seam.closed, true);
  assert.equal(flapClosed.seam.closed, true);
  assert.equal(flapClosed.ok, false);
  assert.equal(flapClosed.collisions[0].a, 'front');
  assert.equal(flapClosed.collisions[0].b, 'insert');

  // The document must state the same numbers, not looser prose.
  for (const needle of ['10.0', '4.61e−16', '20', '45', '1.08e−7', '3.65e−16']) {
    assert.ok(doc.includes(needle), `conclusion should cite ${needle}`);
  }
});
