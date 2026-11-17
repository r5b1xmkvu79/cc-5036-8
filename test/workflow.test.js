// End-to-end workflow coverage at the engine+state boundary: the same code
// path the UI takes when a user drags an angle slider or loads an example.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, parseJSONFile, setAngle, toJSONFile } from '../web/state.js';
import {
  closedBox,
  closedBoxColliding,
  closedBoxInternalCollision,
  cyclicModel,
  mismatchedHinge,
  mixedSizeStrip,
  openBox,
  twoPanelDiagonal,
} from '../src/examples.js';

test('workflow: flat -> drag every hinge to 90 -> exact tray, then back to flat', () => {
  const model = openBox();

  const flat = evaluate(model);
  assert.equal(flat.ok, true);
  for (const panel of flat.result.panels.values()) {
    for (const v of panel.worldVertices) assert.ok(Math.abs(v[2]) < 1e-9);
  }

  model.edges.forEach((_, i) => setAngle(model, i, 90));
  const folded = evaluate(model);
  assert.equal(folded.ok, true);
  for (const id of ['front', 'right', 'back', 'left']) {
    const verts = folded.result.panels.get(id).worldVertices;
    assert.ok(verts.some((v) => Math.abs(v[2] - 2) < 1e-9), `${id} reaches z=2`);
  }

  model.edges.forEach((_, i) => setAngle(model, i, 0));
  const back = evaluate(model);
  for (const panel of back.result.panels.values()) {
    panel.worldVertices.forEach((v, i) => {
      assert.deepEqual(v, flat.result.panels.get(panel.id).worldVertices[i]);
    });
  }
});

test('workflow: editing one angle only moves that subtree, root and siblings stay fixed', () => {
  const model = openBox();
  const before = evaluate(model).result;
  const idx = model.edges.findIndex((e) => e.id === 'front-hinge');
  setAngle(model, idx, 55);
  const after = evaluate(model).result;

  // root panel unchanged
  before.panels.get('base').worldVertices.forEach((v, i) => {
    assert.deepEqual(after.panels.get('base').worldVertices[i], v);
  });
  // an unrelated sibling (back) unchanged
  before.panels.get('back').worldVertices.forEach((v, i) => {
    assert.deepEqual(after.panels.get('back').worldVertices[i], v);
  });
  // the folded panel actually moved out of the plane
  assert.ok(after.panels.get('front').worldVertices.some((v) => Math.abs(v[2]) > 1e-9));
});

test('workflow: every diagnostic example is surfaced and blocks 3D evaluation', () => {
  for (const bad of [mismatchedHinge(), cyclicModel()]) {
    const r = evaluate(bad);
    assert.equal(r.ok, false);
    assert.equal(r.result, null);
    assert.ok(r.diagnostics.some((d) => d.level === 'error'));
  }
});

test('workflow: diagonal hinge and mixed-size strip fold without any scaling', () => {
  for (const model of [twoPanelDiagonal(), mixedSizeStrip()]) {
    model.edges.forEach((e, i) => setAngle(model, i, 45 + i * 20));
    const r = evaluate(model);
    assert.equal(r.ok, true, JSON.stringify(r.diagnostics));
    for (const panel of r.result.panels.values()) {
      panel.localEdgeLengths.forEach((localLen, i) => {
        const a = panel.worldVertices[i];
        const b = panel.worldVertices[(i + 1) % panel.worldVertices.length];
        const worldLen = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
        assert.ok(Math.abs(localLen - worldLen) < 1e-9);
      });
    }
  }
});

test('workflow: save -> edit -> reimport restores the exact evaluated structure', () => {
  const model = openBox();
  model.edges.forEach((e, i) => setAngle(model, i, (i % 2 === 0 ? 70 : -70)));
  const expected = evaluate(model).result;

  const restored = parseJSONFile(toJSONFile(model));
  const actual = evaluate(restored).result;
  for (const [id, panel] of expected.panels) {
    panel.worldVertices.forEach((v, i) => {
      assert.deepEqual(actual.panels.get(id).worldVertices[i], v);
    });
  }
});

test('workflow: valley (+) and mountain (-) on identical panels are z-mirrors', () => {
  const plus = twoPanelDiagonal();
  setAngle(plus, 0, 75);
  const minus = twoPanelDiagonal();
  setAngle(minus, 0, -75);
  const a = evaluate(plus).result.panels.get('B').worldVertices;
  const b = evaluate(minus).result.panels.get('B').worldVertices;
  a.forEach((v, i) => {
    assert.ok(Math.abs(b[i][0] - v[0]) < 1e-9);
    assert.ok(Math.abs(b[i][1] - v[1]) < 1e-9);
    assert.ok(Math.abs(b[i][2] + v[2]) < 1e-9);
  });
});

test('workflow: the UI evaluation path uses the packaging kernel for closed mode', () => {
  const tree = evaluate(closedBox());
  assert.equal(tree.mode, 'tree');
  assert.ok(tree.tree.seamReport.maxGap > 1);

  const closed = evaluate(closedBox(), { mode: 'closed' });
  assert.equal(closed.mode, 'closed');
  assert.equal(closed.closed.converged, true);
  assert.ok(closed.comparison.closedWork.foldBuilds >= 1);
  assert.ok(closed.closed.seamReport.maxGap < 1e-6);
});

test('workflow: drag-to-angle edits feed the same solver and keep failures visible', () => {
  const model = closedBoxInternalCollision();
  // Simulate the 3D handle drag callback: setAngle -> evaluate -> view update.
  const lidIdx = model.edges.findIndex((e) => e.id === 'insert-hinge');
  setAngle(model, lidIdx, -90); // flap folds up instead of into the wall
  const fixed = evaluate(model, { mode: 'closed' });
  assert.equal(fixed.closed.converged, true);
  assert.equal(fixed.collisions.length, 0);
  assert.equal(fixed.ok, true);

  setAngle(model, lidIdx, 90); // back into the wall
  const broken = evaluate(model, { mode: 'closed' });
  assert.equal(broken.closed.converged, true, 'seams still close');
  assert.ok(broken.collisions.length >= 1, 'interference is still reported');
  assert.equal(broken.ok, false);
  assert.ok(broken.diagnostics.some((d) => d.code === 'PANEL_COLLISION'));
});

test('workflow: a closed-mode failure produces no fabricated pose', () => {
  const model = closedBox();
  // Max iterations 1 is not enough to leave the flat stationary point from 0
  // when only the requested start is allowed; the result must stay honest.
  const evaluated = evaluate(model, { mode: 'closed', tolerance: 1e-9 });
  // The real multi-start does converge; verify the failure path separately by
  // evaluating a model whose seam slot set is invalid.
  const invalid = { ...closedBox() };
  invalid.seams = invalid.seams.map((s, i) => (i === 0 ? { ...s, bEdge: 0 } : s));
  const failed = evaluate(invalid, { mode: 'closed' });
  assert.equal(failed.ok, false);
  assert.equal(failed.result, null);
  assert.ok(failed.diagnostics.length > 0);
  // Sanity: the untouched model did converge, so the failure above is real.
  assert.equal(evaluated.closed.converged, true);
});

test('workflow: legacy tree examples run to completion alongside packaging', () => {
  for (const model of [openBox(), twoPanelDiagonal(), mixedSizeStrip(), closedBoxColliding()]) {
    const r = evaluate(model);
    assert.ok(r.result, `${model.name} should produce a pose in tree mode`);
    assert.ok(r.result.ok, `${model.name} pose must be rigid`);
  }
});
