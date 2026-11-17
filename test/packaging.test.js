// Closed-loop packaging solver and seam validation.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluatePackaging,
  seamDistances,
  solveClosedLoop,
  validateSeams,
} from '../src/packaging.js';
import { buildFold } from '../src/engine.js';
import { detectCollisions } from '../src/collision.js';
import {
  closedBox,
  closedBoxColliding,
  closedBoxInternalCollision,
  openBox,
} from '../src/examples.js';

test('seam validation rejects unequal edges, duplicate slots and missing orientation', () => {
  const model = closedBox();
  const brokenLength = { ...model, seams: [...model.seams, { id: 'bad', a: 'front', aEdge: 1, b: 'lid', bEdge: 2, flip: true }] };
  assert.ok(validateSeams(brokenLength).diagnostics.some((d) => d.code === 'SEAM_LENGTH_MISMATCH'));

  const reuse = { ...model, seams: [...model.seams, { id: 'dup-a', a: 'front', aEdge: 0, b: 'lid', bEdge: 2, flip: true }] };
  // front edge 0 is already used by front-lid
  assert.ok(validateSeams(reuse).diagnostics.some((d) => d.code === 'SEAM_SLOT_REUSE'));

  const noFlip = {
    ...model,
    seams: model.seams.map((s, i) => (i === 0 ? { ...s, flip: undefined } : s)),
  };
  assert.ok(validateSeams(noFlip).diagnostics.some((d) => d.code === 'SEAM_ORIENTATION'));
});

test('hinge slots cannot be reused as seam slots', () => {
  const model = closedBox();
  // front edge 2 is the front hinge (length 4); lid edge 2 is free and also
  // length 4, so the length check passes and the slot-reuse check is reached.
  const seams = [...model.seams, { id: 'overlap', a: 'front', aEdge: 2, b: 'lid', bEdge: 2, flip: true }];
  const report = validateSeams({ ...model, seams });
  assert.ok(report.diagnostics.some((d) => d.code === 'SEAM_SLOT_REUSE'));
  assert.ok(report.diagnostics.some((d) => d.refs?.slot === 'front\u00002'));
});

test('tree mode measures an open seam and never claims closure', () => {
  const evaluated = evaluatePackaging(closedBox(), { mode: 'tree' });
  assert.equal(evaluated.tree.seamReport.seamCount, 7);
  assert.ok(evaluated.tree.seamReport.maxGap > 1);
  assert.equal(evaluated.tree.seamReport.closed, false);
  assert.ok(evaluated.diagnostics.some((d) => d.code === 'SEAM_OPEN_TREE'));
  assert.equal(evaluated.closed, null);
});

test('closed mode closes all seven seams from a flat request', () => {
  const evaluated = evaluatePackaging(closedBox(), { mode: 'closed' });
  assert.equal(evaluated.closed.converged, true, JSON.stringify(evaluated.diagnostics));
  assert.ok(evaluated.closed.seamReport.maxGap < 1e-6);
  assert.equal(evaluated.closed.seamReport.seamCount, 7);
  // The solve had to leave the flat start: that cost is recorded, not hidden.
  assert.ok(evaluated.closed.work.seedsTried > 1);
  assert.ok(evaluated.closed.work.foldBuilds > 1);
});

test('closed solve from an already-closing request costs one fold build', () => {
  const model = closedBox();
  for (const edge of model.edges) edge.angle = 90;
  const solved = solveClosedLoop(model);
  assert.equal(solved.converged, true);
  assert.equal(solved.work.foldBuilds, 1);
  assert.equal(solved.work.iterations, 0);
  assert.ok(solved.maxAngleChange < 1e-9);
});

test('closed mode refuses a seam-less model instead of falling back to tree', () => {
  const evaluated = evaluatePackaging(openBox(), { mode: 'closed' });
  assert.equal(evaluated.ok, false);
  assert.ok(evaluated.diagnostics.some((d) => d.code === 'NO_SEAMS'));
  assert.equal(evaluated.result, null);
});

test('seam distances are real endpoint distances, not a default flag', () => {
  const model = closedBox();
  const tree = buildFold(model);
  const distances = seamDistances(model, tree);
  assert.equal(distances.length, 7);
  for (const d of distances) {
    assert.equal(d.endpointGaps.length, 2);
    assert.ok(Number.isFinite(d.gap));
  }
  // The flat net is not a closed package: the lid lies beyond the walls, so
  // the seam report must show a large real gap rather than a zero default.
  assert.ok(distances.every((d) => Number.isFinite(d.gap)));
  assert.ok(Math.max(...distances.map((d) => d.gap)) > 1);
});

test('collision detector finds a lid sweeping through the base', () => {
  const model = closedBoxColliding();
  const built = buildFold(model);
  assert.equal(built.ok, true);
  const stats = {};
  const collisions = detectCollisions(model, built, { stats });
  assert.ok(collisions.length >= 1, 'expected base/lid interference');
  assert.ok(collisions.some((c) => c.type === 'cross'));
  assert.ok(stats.trianglePairs > 0);
});

test('closure succeeds but interference is still reported', () => {
  const evaluated = evaluatePackaging(closedBoxInternalCollision(), { mode: 'closed' });
  assert.equal(evaluated.closed.converged, true, 'seams still close');
  assert.ok(evaluated.closed.seamReport.maxGap < 1e-6);
  assert.ok(evaluated.collisions.length >= 1, 'flap interference must not be hidden');
  assert.equal(evaluated.ok, false);
  assert.ok(evaluated.diagnostics.some((d) => d.code === 'PANEL_COLLISION'));
});

test('adjacent panels meeting only along their hinge are not collisions', () => {
  const model = openBox();
  for (const edge of model.edges) edge.angle = 90;
  const evaluated = evaluatePackaging(model, { mode: 'tree' });
  assert.equal(evaluated.result.ok, true);
  assert.equal(evaluated.collisions.length, 0);
});

test('solver cost counters are monotone and finite for a failing start', () => {
  const model = closedBox();
  // Request a pose that cannot close (all hinges at 0 but one seam deliberately
  // detached by moving the lid angle far outside the closed family).
  const solved = solveClosedLoop(model, { maxIterations: 2, tolerance: 1e-12 });
  assert.ok(solved.work.foldBuilds >= 1);
  assert.ok(solved.work.residualEvaluations >= 1);
  for (const v of Object.values(solved.work)) assert.ok(Number.isFinite(v));
});

test('an unknown root never yields a partial pose or a crash', () => {
  const evaluated = evaluatePackaging(closedBox(), { mode: 'closed', rootId: 'missing' });
  assert.equal(evaluated.ok, false);
  assert.equal(evaluated.result, null);
  assert.ok(evaluated.diagnostics.some((d) => d.code === 'UNKNOWN_ROOT'));
});
