// The interface's evaluation entry point, tested without a browser. This is
// the same code path the unfold slider, mode select and 3D handle drag use.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { app, refresh, computeUnfold, captureTargetAngles } from '../web/app.js';
import { applyUnfold, interpolateAngles } from '../web/unfold.js';
import {
  closedBox,
  closedBoxColliding,
  closedBoxInternalCollision,
} from '../src/examples.js';

function load(model, mode = 'closed') {
  app.model = model;
  app.mode = mode;
  captureTargetAngles();
  refresh();
  return app.evaluation;
}

test('UI unfold control re-evaluates flat and refolded poses in the kernel', () => {
  const model = closedBox();
  model.edges.forEach((e) => { e.angle = 90; });
  load(model);

  computeUnfold(1);
  refresh();
  assert.ok(app.evaluation.closed.converged);
  assert.ok(app.evaluation.closed.seamReport.maxGap < 1e-6);

  computeUnfold(0);
  refresh();
  for (const edge of model.edges) assert.equal(edge.angle, 0);
  // the flat pose is a valid rigid fold; the seam report is recomputed there
  assert.ok(app.evaluation.result?.ok);
  assert.ok(Number.isFinite(
    app.evaluation.closed?.seamReport?.maxGap ?? app.evaluation.tree?.seamReport?.maxGap,
  ));
});

test('UI at 50% shows a real intermediate pose, not a cached endpoint', () => {
  const model = closedBox();
  model.edges.forEach((e) => { e.angle = 90; });
  load(model);
  computeUnfold(0.5);
  refresh();
  for (const edge of model.edges) assert.equal(edge.angle, 45);
  const seam = app.evaluation.closed?.seamReport ?? app.evaluation.tree?.seamReport;
  assert.ok(seam.seamCount === 7);
});

test('UI surfaces the closed-but-colliding sample as not ok', () => {
  const evaluation = load(closedBoxInternalCollision());
  assert.equal(evaluation.closed.converged, true);
  assert.ok(evaluation.collisions.length >= 1);
  assert.equal(evaluation.ok, false);
  assert.ok(evaluation.diagnostics.some((d) => d.code === 'PANEL_COLLISION'));
});

test('UI tree mode reports an open seam instead of pretending it is closed', () => {
  const evaluation = load(closedBoxColliding(), 'tree');
  assert.ok(evaluation.tree.seamReport.maxGap > 0);
  assert.equal(evaluation.closed, null);
  assert.ok(evaluation.collisions.length >= 1);
  assert.equal(evaluation.ok, false);
});

test('unfold interpolation keeps sign and bounds, rejecting bad input', () => {
  const same = (a, b) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-12));
  same(interpolateAngles([90, -90], 0), [0, 0]);
  same(interpolateAngles([90, -90], 1), [90, -90]);
  same(interpolateAngles([90, -90], 0.5), [45, -45]);
  // fractions are clamped to [0, 1], not extrapolated or defaulted
  same(interpolateAngles([90], 1.5), [90]);
  same(interpolateAngles([90], -0.5), [0]);
  assert.throws(() => interpolateAngles([90], NaN), /finite/);
  assert.throws(() => interpolateAngles([NaN], 1), /finite/);
  const model = closedBox();
  assert.throws(() => applyUnfold(model, [1, 2], 1), /does not match/);
});
