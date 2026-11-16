// Headless integration smoke test for the browser-facing modules.
// A real browser (Canvas2D, WebGL) is unavailable in this environment, so the
// views are exercised against minimal stubs that honor the same contracts.
// The geometry itself is covered exhaustively in engine.test.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FlatView } from '../web/flat-view.js';
import { evaluate } from '../web/state.js';
import { openBox, withBoxFolded } from '../src/examples.js';

function makeCtxStub() {
  const calls = [];
  return new Proxy({}, {
    get(_t, prop) {
      if (prop === 'measureText') return () => ({ width: 10 });
      if (prop === 'createLinearGradient') return () => ({ addColorStop() {} });
      return (...args) => { calls.push([prop, args]); };
    },
    set() { return true; },
  });
}

function makeCanvasStub() {
  const listeners = new Map();
  return {
    clientWidth: 600,
    clientHeight: 400,
    style: {},
    getContext: () => makeCtxStub(),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 600, height: 400 }),
    addEventListener: (type, fn) => listeners.set(type, fn),
    dispatch(type, event) { listeners.get(type)?.(event); },
    width: 0,
    height: 0,
  };
}

test('FlatView renders the evaluated net and reports panel identity on click', () => {
  const canvas = makeCanvasStub();
  let selected = null;
  const view = new FlatView(canvas, { onSelect: (id) => { selected = id; } });

  const model = openBox();
  const { result } = evaluate(model);
  view.update(model, result, null);
  assert.equal(view.result, result);

  // click on the base panel center in net coordinates (2, 1.5); map through
  // the view's own transform rather than guessing screen pixels.
  const t = view.bounds;
  const screenX = t.ox + 2 * t.scale;
  const screenY = canvas.clientHeight - (t.oy + 1.5 * t.scale);
  canvas.dispatch('click', { clientX: screenX, clientY: screenY });
  assert.equal(selected, 'base');
  assert.equal(view.selectedId, 'base');

  // clicking empty space clears the selection
  canvas.dispatch('click', { clientX: 5, clientY: 5 });
  assert.equal(selected, null);
});

test('FlatView hover tracking changes cursor and updates hover id', () => {
  const canvas = makeCanvasStub();
  const view = new FlatView(canvas, { onSelect() {} });
  const { result } = evaluate(openBox());
  view.update(openBox(), result, null);
  const t = view.bounds;
  const x = t.ox + 2 * t.scale;
  const y = canvas.clientHeight - (t.oy + 1.5 * t.scale);
  canvas.dispatch('mousemove', { clientX: x, clientY: y });
  assert.equal(view.hoverId, 'base');
  assert.equal(canvas.style.cursor, 'pointer');
  canvas.dispatch('mouseleave', {});
  assert.equal(view.hoverId, null);
});

test('FlatView handles a null result (invalid model) without throwing', () => {
  const canvas = makeCanvasStub();
  const view = new FlatView(canvas, { onSelect() {} });
  assert.doesNotThrow(() => view.update(openBox(), null, null));
  canvas.dispatch('click', { clientX: 100, clientY: 100 });
});

test('folded box geometry used by both views carries stable panel ids', () => {
  const model = withBoxFolded();
  const { ok, result } = evaluate(model);
  assert.equal(ok, true);
  const ids = [...result.panels.keys()];
  for (const id of ['base', 'front', 'right', 'back', 'left']) {
    assert.ok(ids.includes(id));
    assert.equal(result.panels.get(id).worldVertices.length, 4);
  }
});
