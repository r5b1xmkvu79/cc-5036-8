import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addEdge,
  addPanel,
  deepClone,
  evaluate,
  parseJSONFile,
  removeEdge,
  removePanel,
  setAngle,
  toJSONFile,
} from '../web/state.js';
import { openBox, twoPanelDiagonal, withBoxFolded } from '../src/examples.js';

test('evaluate returns diagnostics for invalid models and result for valid ones', () => {
  const malformed = evaluate({ panels: 'nope', edges: [] });
  assert.equal(malformed.ok, false);
  assert.ok(malformed.diagnostics.length > 0);
  assert.equal(malformed.result, null);

  const good = evaluate(openBox());
  assert.equal(good.ok, true);
  assert.ok(good.result.panels.has('base'));
});

test('angle edits re-evaluate actual geometry, not a stored pose', () => {
  const model = openBox();
  const flat = evaluate(model);
  const frontFlat = flat.result.panels.get('front').worldVertices;
  assert.ok(frontFlat.every((v) => Math.abs(v[2]) < 1e-9));

  const idx = model.edges.findIndex((e) => e.id === 'front-hinge');
  setAngle(model, idx, 90);
  const folded = evaluate(model);
  const frontFolded = folded.result.panels.get('front').worldVertices;
  assert.ok(frontFolded.some((v) => Math.abs(v[2] - 2) < 1e-9));
});

test('add/remove panel and edge keep the model coherent', () => {
  const model = twoPanelDiagonal();
  addPanel(model, { id: 'C', vertices: [[0, 0], [1, 0], [1, 1]] });
  addEdge(model, { id: 'e2', a: 'B', b: 'C', aEdge: 0, bEdge: 1, angle: 30 });
  const ok = evaluate(model);
  assert.equal(ok.ok, true, JSON.stringify(ok.diagnostics));

  removePanel(model, 'C');
  assert.equal(model.panels.some((p) => p.id === 'C'), false);
  assert.equal(model.edges.some((e) => e.a === 'C' || e.b === 'C'), false);
  assert.equal(evaluate(model).ok, true);

  removeEdge(model, 0);
  assert.equal(model.edges.length, 0);
});

test('setAngle rejects non-finite values', () => {
  const model = openBox();
  assert.throws(() => setAngle(model, 0, NaN));
  assert.throws(() => setAngle(model, 0, Infinity));
});

test('JSON export round-trips through parse and evaluates identically', () => {
  const original = withBoxFolded();
  const text = toJSONFile(original);
  const restored = parseJSONFile(text);
  assert.deepEqual(restored, original);
  const before = evaluate(original);
  const after = evaluate(restored);
  assert.equal(after.ok, before.ok);
  for (const [id, panel] of before.result.panels) {
    panel.worldVertices.forEach((v, i) => {
      assert.deepEqual(after.result.panels.get(id).worldVertices[i], v);
    });
  }
});

test('parseJSONFile rejects malformed payloads with useful errors', () => {
  assert.throws(() => parseJSONFile('{not json'), /invalid JSON/);
  assert.throws(() => parseJSONFile('{}'), /panels\[\] and edges\[\]/);
  assert.throws(() => parseJSONFile(JSON.stringify({ panels: [{ id: 1 }], edges: [] })), /vertices/);
  assert.throws(() =>
    parseJSONFile(JSON.stringify({ panels: [{ id: 'a', vertices: [[0,0],[1,0],[1,1]] }], edges: [{ a: 'a' }] })),
  /integer aEdge/);
});

test('parseJSONFile defaults missing angles to zero', () => {
  const model = parseJSONFile(JSON.stringify({
    panels: [
      { id: 'A', vertices: [[0, 0], [1, 0], [1, 1], [0, 1]] },
      { id: 'B', vertices: [[0, 0], [1, 0], [1, 1], [0, 1]] },
    ],
    edges: [{ a: 'A', b: 'B', aEdge: 1, bEdge: 3 }],
  }));
  assert.equal(model.edges[0].angle, 0);
  assert.equal(evaluate(model).ok, true);
});

test('deepClone produces an independent copy', () => {
  const model = openBox();
  const clone = deepClone(model);
  clone.edges[0].angle = 123;
  clone.panels[0].vertices[0][0] = 99;
  assert.notEqual(model.edges[0].angle, 123);
  assert.notEqual(model.panels[0].vertices[0][0], 99);
});

test('pre-folding example yields the expected tray height across live edits', () => {
  const model = withBoxFolded();
  const result = evaluate(model).result;
  for (const id of ['front', 'back', 'left', 'right']) {
    const zs = result.panels.get(id).worldVertices.map((v) => v[2]);
    assert.ok(zs.some((z) => Math.abs(z - 2) < 1e-9), `${id} should reach z=2`);
  }
});
