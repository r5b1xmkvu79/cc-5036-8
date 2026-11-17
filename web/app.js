import { FlatView } from './flat-view.js';
import { FoldView3D } from './view3d.js';
import {
  addEdge,
  addPanel,
  addSeam,
  clearLocal,
  deepClone,
  emptyModel,
  evaluate,
  loadLocal,
  parseJSONFile,
  removeEdge,
  removePanel,
  removeSeam,
  saveLocal,
  setAngle,
  toJSONFile,
} from './state.js';
import {
  closedBox,
  closedBoxColliding,
  closedBoxFolded,
  closedBoxInternalCollision,
  cyclicModel,
  mismatchedHinge,
  mixedSizeStrip,
  openBox,
  twoPanelDiagonal,
  withBoxFolded,
} from '../src/examples.js';
import { applyUnfold } from './unfold.js';

const $ = (sel) => document.querySelector(sel);

const app = {
  model: emptyModel(),
  mode: 'tree',
  evaluation: null,
  result: null,
  diagnostics: [],
  selectedPanel: null,
  selectedEdge: null,
  flat: null,
  view3d: null,
  // Angles that the unfold slider returns to when you refold; captured when
  // the user loads an example or releases an angle edit.
  targetAngles: [],
};

function refresh() {
  const evaluation = evaluate(app.model, { mode: app.mode });
  app.evaluation = evaluation;
  app.result = evaluation.result;
  app.diagnostics = evaluation.diagnostics;
  if (app.selectedPanel && !app.model.panels.some((p) => p.id === app.selectedPanel)) {
    app.selectedPanel = null;
  }
  if (typeof document === 'undefined') return;
  renderDiagnostics();
  renderPackaging();
  renderPanels();
  renderEdges();
  renderSeams();
  app.flat.update(app.model, app.result, app.selectedPanel);
  app.view3d.update(app.model, app.result, app.selectedPanel, evaluation);
  renderVertexInspector();
}

function captureTargetAngles() {
  app.targetAngles = app.model.edges.map((e) => e.angle);
}

function renderDiagnostics() {
  const el = $('#diagnostics');
  if (!app.diagnostics.length) {
    el.innerHTML = `<div class="ok">${app.mode === 'closed'
      ? 'Closed-loop packaging: every seam is within tolerance and no panel interference was found.'
      : 'Tree model valid: all hinge lengths consistent.'}</div>`;
    return;
  }
  el.innerHTML = app.diagnostics.map((d) => {
    const detail = d.refs && d.refs.slot ? ` (${d.refs.slot})` : '';
    return `<div class="diag ${d.level}"><strong>${d.code}</strong>${detail}: ${d.message}</div>`;
  }).join('');
}

function fmtGap(v) {
  if (v === null || v === undefined) return '—';
  if (Math.abs(v) < 1e-12) return '0';
  if (Math.abs(v) < 1e-4) return v.toExponential(2);
  return v.toFixed(4);
}

function renderPackaging() {
  const el = $('#packaging');
  const ev = app.evaluation;
  if (!el) return;
  if (!ev) { el.innerHTML = ''; return; }
  const treeSeam = ev.tree?.seamReport;
  const closedSeam = ev.closed?.seamReport;
  const work = ev.closed?.work ?? ev.tree?.work;
  const rows = [];
  rows.push(`<div class="pack-row"><span>mode</span><strong>${ev.mode}</strong></div>`);
  if (treeSeam?.seamCount) {
    rows.push(`<div class="pack-row"><span>tree seam max gap</span><strong>${fmtGap(treeSeam.maxGap)}</strong></div>`);
  }
  if (closedSeam?.seamCount) {
    rows.push(`<div class="pack-row"><span>solved seam max gap</span><strong>${fmtGap(closedSeam.maxGap)}</strong></div>`);
    rows.push(`<div class="pack-row"><span>closed</span><strong>${closedSeam.closed ? 'yes' : 'NO'}</strong></div>`);
  }
  if (ev.comparison) {
    rows.push(`<div class="pack-row"><span>largest angle change</span><strong>${ev.comparison.maxAngleChange.toFixed(2)}°</strong></div>`);
  }
  if (work) {
    rows.push(`<div class="pack-row"><span>solve cost</span><strong>${work.foldBuilds} folds · ${work.iterations} iters · ${work.seedsTried ?? 0} seeds</strong></div>`);
  }
  if (ev.closed?.solvedFrom) {
    rows.push(`<div class="pack-row"><span>converged from</span><strong>${ev.closed.solvedFrom}</strong></div>`);
  }
  const collisions = ev.collisions ?? [];
  rows.push(`<div class="pack-row"><span>interference</span><strong class="${collisions.length ? 'bad' : ''}">${
    collisions.length ? `${collisions.length} pair(s)` : 'none'}</strong></div>`);
  if (collisions.length) {
    rows.push(`<ul class="collision-list">${collisions.map((c) =>
      `<li>${c.a} × ${c.b} — ${c.type} at (${c.point.map((n) => n.toFixed(2)).join(', ')})</li>`).join('')}</ul>`);
  }
  if (app.mode === 'closed' && !ev.result) {
    rows.push('<div class="muted">No pose was produced; the diagnostics above explain why.</div>');
  }
  el.innerHTML = rows.join('');
}

function renderPanels() {
  $('#panel-list').innerHTML = app.model.panels.map((p) => {
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

function renderSeams() {
  const seams = app.model.seams ?? [];
  const gaps = new Map();
  for (const report of app.evaluation?.closed?.seamReport?.seams
    ?? app.evaluation?.tree?.seamReport?.seams ?? []) {
    gaps.set(report.id, report.gap);
  }
  $('#seam-list').innerHTML = seams.map((s) => {
    const gap = gaps.get(s.id);
    const cls = gap === undefined ? '' : gap <= 1e-6 ? 'seam-closed' : 'seam-open';
    return `<div class="row ${cls}" data-seam="${s.id}">
      <span class="pid">${s.id}</span>
      <span class="verts">${s.a}·e${s.aEdge} ↔ ${s.b}·e${s.bEdge}</span>
      <span class="gap">${gap === undefined ? '—' : fmtGap(gap)}</span>
      <button data-action="delete-seam" data-id="${s.id}">delete</button>
    </div>`;
  }).join('') || '<div class="muted">No seams declared.</div>';
}

function renderVertexInspector() {
  const el = $('#vertex-inspector');
  if (!el) return;
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
  captureTargetAngles();
  refresh();
}

// Re-applies the unfold fraction to the captured folded target. Used by the
// unfold slider and the "unfold flat / refold" buttons; the kernel re-evaluates
// every step, so seam gaps and collisions at that fraction are real.
function setUnfold(t) {
  const angles = computeUnfold(t);
  if (typeof document === 'undefined') return angles;
  const label = $('#unfold-value');
  if (label) label.textContent = `${Math.round(t * 100)}%`;
  const slider = $('#unfold-slider');
  if (slider && Math.abs(Number(slider.value) - t) > 1e-9) {
    slider.value = String(t);
  }
  refresh();
  return angles;
}

// Pure state transition behind the unfold control: no DOM access, so the exact
// path the UI takes is covered by headless tests.
function computeUnfold(t) {
  if (!app.targetAngles.length || app.targetAngles.length !== app.model.edges.length) {
    captureTargetAngles();
  }
  return applyUnfold(app.model, app.targetAngles, t);
}

async function bindUI() {
  app.flat = new FlatView($('#flat-canvas'), { onSelect: selectPanel });
  app.view3d = await FoldView3D.create($('#view3d'), {
    onSelect: selectPanel,
    onAngleChange: (edgeIndex, degrees) => {
      setAngle(app.model, edgeIndex, degrees);
      refresh();
    },
  });

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
        // A manual angle edit becomes the new folded target and pins the
        // unfold fraction at 100%.
        captureTargetAngles();
        const slider = $('#unfold-slider');
        if (slider) slider.value = '1';
        const label = $('#unfold-value');
        if (label) label.textContent = '100%';
        refresh();
      }
    } else if (action === 'unfold') {
      setUnfold(Number(e.target.value));
    }
  });

  document.addEventListener('change', (e) => {
    if (e.target.id === 'mode-select') {
      app.mode = e.target.value === 'closed' ? 'closed' : 'tree';
      refresh();
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
    } else if (action === 'delete-seam') {
      removeSeam(app.model, e.target.dataset.id);
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
    } else if (action === 'add-seam') {
      try {
        const flipValue = $('#seam-flip').value;
        if (flipValue !== 'true' && flipValue !== 'false') {
          throw new Error('seam orientation (flip) must be chosen explicitly');
        }
        addSeam(app.model, {
          id: $('#new-seam-id').value.trim() || `s${(app.model.seams ?? []).length}`,
          a: $('#seam-a').value.trim(),
          aEdge: Number($('#seam-a-slot').value),
          b: $('#seam-b').value.trim(),
          bEdge: Number($('#seam-b-slot').value),
          flip: flipValue === 'true',
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
      captureTargetAngles();
      refresh();
    } else if (action === 'unfold-flat') {
      setUnfold(0);
    } else if (action === 'refold') {
      setUnfold(1);
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
      else if (which === 'closed-box') { app.mode = 'closed'; syncModeSelect(); loadExample(closedBoxFolded); }
      else if (which === 'closed-lid') { app.mode = 'closed'; syncModeSelect(); loadExample(closedBoxColliding); }
      else if (which === 'closed-insert') { app.mode = 'closed'; syncModeSelect(); loadExample(closedBoxInternalCollision); }
    });
  });

  window.addEventListener('resize', () => app.view3d.resize());
}

function syncModeSelect() {
  const select = $('#mode-select');
  if (select) select.value = app.mode;
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
  captureTargetAngles();
  refresh();
}

// The browser entry point starts automatically; importing this module in a
// headless test (no document) only exposes the pure helpers and app state.
if (typeof document !== 'undefined') boot();

export { app, refresh, setUnfold, computeUnfold, captureTargetAngles };
