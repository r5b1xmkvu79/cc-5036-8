import { FlatView } from './flat-view.js';
import { FoldView3D } from './view3d.js';
import {
  addEdge,
  addPanel,
  clearLocal,
  deepClone,
  emptyModel,
  evaluate,
  loadLocal,
  parseJSONFile,
  removeEdge,
  removePanel,
  saveLocal,
  setAngle,
  toJSONFile,
} from './state.js';
import {
  cyclicModel,
  mismatchedHinge,
  mixedSizeStrip,
  openBox,
  twoPanelDiagonal,
  withBoxFolded,
} from '../src/examples.js';

const $ = (sel) => document.querySelector(sel);

const app = {
  model: emptyModel(),
  result: null,
  diagnostics: [],
  selectedPanel: null,
  selectedEdge: null,
  flat: null,
  view3d: null,
};

function refresh() {
  const { ok, diagnostics, result } = evaluate(app.model);
  app.result = ok ? result : null;
  app.diagnostics = diagnostics;
  if (app.selectedPanel && !app.model.panels.some((p) => p.id === app.selectedPanel)) {
    app.selectedPanel = null;
  }
  renderDiagnostics();
  renderPanels();
  renderEdges();
  app.flat.update(app.model, app.result, app.selectedPanel);
  app.view3d.update(app.model, app.result, app.selectedPanel);
  renderVertexInspector();
}

function renderDiagnostics() {
  const el = $('#diagnostics');
  if (!app.diagnostics.length) {
    el.innerHTML = '<div class="ok">Model valid: tree topology, all hinge lengths consistent.</div>';
    return;
  }
  el.innerHTML = app.diagnostics.map((d) => {
    const detail = d.refs && d.refs.slot ? ` (${d.refs.slot})` : '';
    return `<div class="diag ${d.level}"><strong>${d.code}</strong>${detail}: ${d.message}</div>`;
  }).join('');
}

function renderPanels() {
  const el = '#panel-list';
  $(el).innerHTML = app.model.panels.map((p) => {
    const sel = p.id === app.selectedPanel ? 'selected' : '';
    const dims = p.vertices.map((v) => `(${v[0]},${v[1]})`).join(' ');
    return `<div class="row ${sel}" data-panel="${p.id}">
      <span class="pid">${p.id}</span>
      <span class="verts" title="${dims}">${p.vertices.length} verts</span>
      <button data-action="delete-panel" data-id="${p.id}">delete</button>
    </div>`;
  }).join('') || '<div class="muted">No panels yet.</div>';
}

function renderEdges() {
  $('#edge-list').innerHTML = app.model.edges.map((e, i) => {
    const sel = i === app.selectedEdge ? 'selected' : '';
    const kind = e.angle > 0 ? 'valley' : e.angle < 0 ? 'mountain' : 'flat';
    return `<div class="edge-row ${sel}" data-edge="${i}">
      <div class="edge-head">
        <span><strong>#${i}</strong> ${e.a}·e${e.aEdge} ↔ ${e.b}·e${e.bEdge}</span>
        <button data-action="delete-edge" data-index="${i}">delete</button>
      </div>
      <div class="angle-control">
        <input type="range" min="-180" max="180" step="1" value="${e.angle}"
          data-action="angle" data-index="${i}" aria-label="fold angle">
        <input type="number" min="-180" max="180" step="1" value="${e.angle}"
          data-action="angle-num" data-index="${i}">
        <span class="fold-kind ${kind}">${kind}</span>
      </div>
    </div>`;
  }).join('') || '<div class="muted">No connections yet.</div>';
}

function renderVertexInspector() {
  const el = '#vertex-inspector';
  if (!app.selectedPanel || !app.result) {
    el.innerHTML = '<div class="muted">Select a panel in either view to inspect evaluated vertices.</div>';
    return;
  }
  const panel = app.result.panels.get(app.selectedPanel);
  el.innerHTML = `<div class="insp-title">${panel.id} — local → flat (z=0) → folded world</div>` +
    panel.localVertices.map((lv, i) => {
      const fv = panel.flatVertices[i];
      const wv = panel.worldVertices[i];
      const fmt = (v) => v.map((n) => (Math.abs(n) < 1e-9 ? 0 : +n.toFixed(4))).join(', ');
      return `<div class="vrow">
        <span class="vtag">v${i}</span>
        <span>(${fmt(lv)})</span><span>→</span>
        <span>(${fmt(fv)})</span><span>→</span>
        <span class="world">(${fmt(wv)})</span>
      </div>`;
    }).join('');
}

function selectPanel(id) {
  app.selectedPanel = id;
  if (id) {
    const edgeIdx = app.model.edges.findIndex((e) => e.a === id || e.b === id);
    app.selectedEdge = edgeIdx >= 0 ? edgeIdx : null;
  }
  refresh();
}

function loadExample(builder, preFold = false) {
  app.model = preFold ? withBoxFolded(openBox()) : deepClone(builder());
  app.selectedPanel = null;
  app.selectedEdge = null;
  refresh();
}

async function bindUI() {
  app.flat = new FlatView($('#flat-canvas'), { onSelect: selectPanel });
  app.view3d = await FoldView3D.create($('#view3d'), { onSelect: selectPanel });

  document.addEventListener('input', (e) => {
    const action = e.target.dataset.action;
    const idx = Number(e.target.dataset.index);
    if (action === 'angle' || action === 'angle-num') {
      const value = Number(e.target.value);
      if (Number.isFinite(value)) {
        setAngle(app.model, idx, value);
        // keep slider and number input in sync without rebuilding focus
        const pair = document.querySelector(
          `[data-action="${action === 'angle' ? 'angle-num' : 'angle'}"][data-index="${idx}"]`);
        if (pair) pair.value = value;
        refresh();
      }
    }
  });

  document.addEventListener('click', (e) => {
    const action = e.target.dataset.action;
    if (!action) {
      const panelRow = e.target.closest('[data-panel]');
      const edgeRow = e.target.closest('[data-edge]');
      if (panelRow) selectPanel(panelRow.dataset.panel);
      if (edgeRow) { app.selectedEdge = Number(edgeRow.dataset.edge); renderEdges(); }
      return;
    }
    if (action === 'delete-panel') {
      removePanel(app.model, e.target.dataset.id);
      refresh();
    } else if (action === 'delete-edge') {
      removeEdge(app.model, Number(e.target.dataset.index));
      refresh();
    } else if (action === 'add-panel') {
      try {
        const id = $('#new-panel-id').value.trim() || `P${app.model.panels.length}`;
        const w = Number($('#new-panel-w').value) || 1;
        const h = Number($('#new-panel-h').value) || 1;
        addPanel(app.model, {
          id,
          vertices: [[0, 0], [w, 0], [w, h], [0, h]],
        });
        refresh();
      } catch (err) {
        alert(err.message);
      }
    } else if (action === 'add-edge') {
      try {
        addEdge(app.model, {
          id: $('#new-edge-id').value.trim() || `e${app.model.edges.length}`,
          a: $('#edge-a').value.trim(),
          b: $('#edge-b').value.trim(),
          aEdge: Number($('#edge-a-slot').value),
          bEdge: Number($('#edge-b-slot').value),
          angle: Number($('#edge-angle').value) || 0,
        });
        refresh();
      } catch (err) {
        alert(err.message);
      }
    } else if (action === 'save') {
      saveLocal(app.model);
      flash('#save-status', 'Saved to browser storage.');
    } else if (action === 'load') {
      const m = loadLocal();
      if (m) { app.model = m; refresh(); flash('#save-status', 'Loaded from browser storage.'); }
      else flash('#save-status', 'No saved model found.');
    } else if (action === 'clear-save') {
      clearLocal();
      flash('#save-status', 'Cleared browser storage.');
    } else if (action === 'export') {
      const blob = new Blob([toJSONFile(app.model)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${app.model.name.replace(/\s+/g, '-') || 'net'}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } else if (action === 'import') {
      $('#import-file').click();
    } else if (action === 'reset-flat') {
      app.model.edges.forEach((_, i) => setAngle(app.model, i, 0));
      refresh();
    }
  });

  $('#import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      app.model = parseJSONFile(text);
      app.selectedPanel = null;
      refresh();
      flash('#save-status', `Imported ${file.name}.`);
    } catch (err) {
      alert(err.message);
    }
    e.target.value = '';
  });

  document.querySelectorAll('[data-example]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const which = btn.dataset.example;
      if (which === 'box') loadExample(openBox);
      else if (which === 'box-folded') loadExample(openBox, true);
      else if (which === 'diagonal') loadExample(twoPanelDiagonal);
      else if (which === 'strip') loadExample(mixedSizeStrip);
      else if (which === 'mismatch') loadExample(mismatchedHinge);
      else if (which === 'cycle') loadExample(cyclicModel);
    });
  });

  window.addEventListener('resize', () => app.view3d.resize());
}

function flash(sel, text) {
  const el = $(sel);
  el.textContent = text;
  setTimeout(() => { el.textContent = ''; }, 2500);
}

async function boot() {
  await bindUI();
  const saved = loadLocal();
  app.model = saved ?? deepClone(openBox());
  refresh();
}

boot();
