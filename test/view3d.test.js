// Headless coverage for view3d.js using a minimal three.js API stub.
// The stub implements only the surface FoldView3D touches; it verifies that
// the view builds meshes from engine vertices, tracks panel identity on
// picking, and survives repeated updates/resize. Rendering math itself is the
// engine's responsibility (engine.test.js) and three.js is a vendor library.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FoldView3D } from '../web/view3d.js';
import { evaluate } from '../web/state.js';
import { withBoxFolded, openBox } from '../src/examples.js';
import { THREE_STUB, makeContainer } from './helpers/three-stub.js';

function createView(handlers = { onSelect() {} }) {
  const container = makeContainer();
  const view = new FoldView3D(container, handlers, THREE_STUB);
  return { container, view, canvas: container.children[0] };
}

test('FoldView3D builds one mesh per evaluated panel with stable panel ids', () => {
  const { view } = createView();
  const model = withBoxFolded();
  const { result } = evaluate(model);
  view.update(model, result, null);

  assert.equal(view.panelMeshes.size, 5);
  for (const id of ['base', 'front', 'right', 'back', 'left']) {
    const mesh = view.panelMeshes.get(id);
    assert.equal(mesh.userData.panelId, id);
    // quad panel -> two triangles -> 6 vertices
    assert.equal(mesh.geometry.values.length / 3, 6);
  }
  // hinge lines: one per connection
  assert.equal(view.hingeLines.children.length, 4);
});

test('FoldView3D clears meshes on invalid model and rebuilds on recovery', () => {
  const { view } = createView();
  view.update(openBox(), null, null);
  assert.equal(view.panelMeshes.size, 0);

  const model = openBox();
  const { result } = evaluate(model);
  view.update(model, result, 'base');
  assert.equal(view.panelMeshes.size, 5);
  assert.equal(view.selectedId, 'base');
  const selected = view.panelMeshes.get('base');
  assert.equal(selected.material.opacity, 1);
  assert.equal(selected.children.length, 1); // highlight edges
});

test('FoldView3D orbit controls mutate camera parameters on interaction', () => {
  const { view, canvas } = createView();
  const before = { ...view.orbit };
  canvas.dispatch('pointerdown', { clientX: 10, clientY: 10, pointerId: 1 });
  canvas.dispatch('pointermove', { movementX: 30, movementY: -20 });
  canvas.dispatch('pointerup', { clientX: 40, clientY: 30 });
  assert.notEqual(view.orbit.theta, before.theta);
  assert.notEqual(view.orbit.phi, before.phi);

  const r0 = view.orbit.radius;
  canvas.dispatch('wheel', { deltaY: 100, preventDefault() {} });
  assert.ok(view.orbit.radius > r0);
});

test('FoldView3D resize updates aspect ratio without throwing', () => {
  const { view } = createView();
  assert.doesNotThrow(() => view.resize());
});

test('FoldView3D click path reports raycast panel id through onSelect', () => {
  const picks = [];
  const { view, canvas } = createView({ onSelect: (id) => picks.push(id) });
  const model = openBox();
  view.update(model, evaluate(model).result, null);
  // simulate a click without drag (movement below the 5px threshold)
  canvas.dispatch('pointerdown', { clientX: 0, clientY: 0, pointerId: 1 });
  canvas.dispatch('pointerup', { clientX: 1, clientY: 1 });
  assert.ok(picks.length >= 1);
  assert.equal(typeof picks[0], 'string');
});

test('FoldView3D repeated updates dispose old geometry and stay consistent', () => {
  const { view } = createView();
  const model = openBox();
  const first = evaluate(model).result;
  view.update(model, first, null);
  const oldMesh = view.panelMeshes.get('base');
  model.edges.forEach((e, i) => { e.angle = 30 + i * 10; });
  view.update(model, evaluate(model).result, null);
  assert.equal(oldMesh.geometry.disposed, true);
  assert.equal(view.panelMeshes.size, 5);
});
