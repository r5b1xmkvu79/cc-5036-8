// Boots web/app.js against a minimal DOM so the real bindUI() path (not a
// reimplementation) is exercised: element wiring, mode select, examples and
// unfold buttons. Canvas2D and WebGL are stubbed; the geometry comes from the
// production kernel.

import { test } from 'node:test';
import assert from 'node:assert/strict';

class El {
  constructor(tag = 'div', id = '') {
    this.tagName = tag.toUpperCase();
    this.id = id;
    this.dataset = {};
    this._children = [];
    this.style = {};
    this.listeners = new Map();
    this.value = '';
    this.innerHTML = '';
    this.textContent = '';
    this.hidden = false;
    this.clientWidth = 640;
    this.clientHeight = 480;
  }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }
  get children() { return this._children; }
  set children(v) {
    // The three.js stub appends its renderer canvas to the mount container.
    // Keep only DOM-like nodes in the traversal graph.
    for (const child of Array.isArray(v) ? v : []) {
      if (child instanceof El) this._children.push(child);
    }
  }
  dispatch(type, event = {}) {
    for (const fn of this.listeners.get(type) ?? []) fn({ target: this, ...event });
  }
  appendChild(child) {
    if (child instanceof El) this._children.push(child);
  }
  querySelector(sel) { return findIn(this, sel); }
  querySelectorAll(sel) { return findAllIn(this, sel); }
  closest(sel) { return matches(this, sel) ? this : null; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 640, height: 480 }; }
  setPointerCapture() {}
  click() { this.dispatch('click'); }
  matchSel(sel) { return matches(this, sel); }
}

function matches(el, sel) {
  if (!el) return false;
  if (sel.startsWith('#')) return el.id === sel.slice(1);
  if (sel.startsWith('.')) return (el.className ?? '').split(/\s+/).includes(sel.slice(1));
  if (sel.startsWith('[data-')) {
    const m = sel.match(/^\[data-([\w-]+)(?:="([^"]*)")?\]$/);
    if (!m) return false;
    const key = m[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    return m[2] === undefined ? el.dataset[key] !== undefined : String(el.dataset[key]) === m[2];
  }
  return el.tagName === sel.toUpperCase();
}

function walk(el) {
  const out = [];
  const visit = (node) => {
    out.push(node);
    for (const c of node.children ?? []) visit(c);
  };
  visit(el);
  return out;
}
function findIn(root, sel) {
  return walk(root).find((el) => el !== root && matches(el, sel)) ?? null;
}
function findAllIn(root, sel) {
  return walk(root).filter((el) => el !== root && matches(el, sel));
}

function makeCanvasCtx() {
  return new Proxy({}, {
    get(_t, prop) {
      if (prop === 'measureText') return () => ({ width: 10 });
      if (prop === 'createLinearGradient') return () => ({ addColorStop() {} });
      return (...args) => { void args; };
    },
    set() { return true; },
  });
}

function buildDocument() {
  const root = new El('body');
  const ids = [
    'diagnostics', 'packaging', 'flat-canvas', 'view3d', 'edge-list', 'seam-list',
    'panel-list', 'vertex-inspector', 'mode-select', 'unfold-slider', 'unfold-value',
    'save-status', 'import-file', 'new-panel-id', 'new-panel-w', 'new-panel-h',
    'new-edge-id', 'edge-a', 'edge-a-slot', 'edge-b', 'edge-b-slot', 'edge-angle',
    'new-seam-id', 'seam-a', 'seam-a-slot', 'seam-b', 'seam-b-slot', 'seam-flip',
  ];
  const byId = new Map();
  for (const id of ids) {
    const el = new El(id === 'flat-canvas' ? 'canvas' : id === 'mode-select' || id === 'seam-flip' ? 'select' : 'div', id);
    if (id === 'flat-canvas') el.getContext = () => makeCanvasCtx();
    if (id === 'mode-select') { el.value = 'tree'; el.tagName = 'SELECT'; }
    if (id === 'unfold-slider') { el.value = '1'; el.tagName = 'INPUT'; }
    byId.set(id, el);
    root.appendChild(el);
  }

  // Example buttons and static action buttons.
  const exampleKeys = [
    'box', 'box-folded', 'diagonal', 'strip', 'mismatch', 'cycle',
    'closed-box', 'closed-lid', 'closed-insert',
  ];
  for (const key of exampleKeys) {
    const btn = new El('button');
    btn.dataset.example = key;
    root.appendChild(btn);
  }
  for (const action of ['reset-flat', 'unfold-flat', 'refold', 'save', 'load',
    'clear-save', 'export', 'import', 'add-panel', 'add-edge', 'add-seam']) {
    const btn = new El('button');
    btn.dataset.action = action;
    root.appendChild(btn);
  }
  return { document: root, byId };
}

function installDom() {
  const fake = buildDocument();
  const listeners = new Map();
  const doc = {
    body: fake.document,
    querySelector: (sel) => fake.document.querySelector(sel),
    querySelectorAll: (sel) => fake.document.querySelectorAll(sel),
    addEventListener: (type, fn) => {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    createElement: (tag) => new El(tag),
  };
  const prev = globalThis.document;
  globalThis.document = doc;
  globalThis.window = {
    listeners: new Map(),
    addEventListener(type, fn) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(fn);
    },
  };
  globalThis.localStorage = {
    store: new Map(),
    getItem(k) { return this.store.has(k) ? this.store.get(k) : null; },
    setItem(k, v) { this.store.set(k, String(v)); },
    removeItem(k) { this.store.delete(k); },
  };
  globalThis.devicePixelRatio = 1;
  return {
    fake,
    doc,
    dispatch(type, event) {
      for (const fn of listeners.get(type) ?? []) fn(event);
    },
    restore() {
      globalThis.document = prev;
      delete globalThis.window;
      delete globalThis.localStorage;
      delete globalThis.devicePixelRatio;
    },
  };
}

// three.js is loaded lazily from node_modules inside the browser entry point.
// In Node we preload the module and inject a stub-compatible object by
// importing the real package; WebGLRenderer is the only browser-only piece.
async function installThreeStub() {
  const mod = await import('./helpers/three-stub.js');
  return mod.THREE_STUB;
}

test('the real app boots, wires controls, and switches packaging mode', async () => {
  const THREE_STUB = await installThreeStub();
  const env = installDom();
  try {
    // Import the fold view module and inject the test three.js implementation
    // through the documented static hook, so boot() takes its real path.
    const view3dMod = await import('../web/view3d.js');
    view3dMod.FoldView3D.threeModule = THREE_STUB;

    const appMod = await import('../web/app.js?boot=1');
    // boot() runs on import; give the async chain a tick to settle.
    await new Promise((r) => setTimeout(r, 0));
    const { app } = appMod;
    assert.ok(app.flat, 'FlatView must be constructed by boot()');
    assert.ok(app.view3d, 'FoldView3D must be constructed by boot()');
    assert.ok(app.model.edges.length > 0, 'boot loads a default net');
    assert.ok(app.evaluation, 'boot must evaluate the initial model');

    // Static example button selects the closed box and closed mode.
    const closedBtn = env.fake.document.querySelectorAll('button')
      .find((b) => b.dataset.example === 'closed-box');
    closedBtn.click();
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(app.mode, 'closed');
    assert.ok(app.model.seams.length === 7);
    assert.ok(app.evaluation.closed?.converged);

    // Unfold to flat through the actual document-level click handler.
    const unfoldBtn = env.fake.document.querySelectorAll('button')
      .find((b) => b.dataset.action === 'unfold-flat');
    env.dispatch('click', { target: unfoldBtn });
    await new Promise((r) => setTimeout(r, 0));
    assert.ok(app.model.edges.every((e) => e.angle === 0));

    const refoldBtn = env.fake.document.querySelectorAll('button')
      .find((b) => b.dataset.action === 'refold');
    env.dispatch('click', { target: refoldBtn });
    await new Promise((r) => setTimeout(r, 0));
    assert.ok(app.model.edges.some((e) => e.angle !== 0));
    assert.ok(app.evaluation.ok);

    // Mode switch through the real change handler.
    const modeSelect = env.fake.byId.get('mode-select');
    modeSelect.value = 'closed';
    env.dispatch('change', { target: modeSelect });
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(app.mode, 'closed');
    assert.ok(app.evaluation.closed, 'closed mode must populate the solve report');

    modeSelect.value = 'tree';
    env.dispatch('change', { target: modeSelect });
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(app.mode, 'tree');
    assert.equal(app.evaluation.closed, null);

    view3dMod.FoldView3D.threeModule = null;
  } finally {
    env.restore();
  }
});
