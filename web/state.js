// Application state: the working model, live re-evaluation, persistence and
// import/export. Every render is produced by re-running the folding engine on
// the current parameter values — there is no baked animation or cached pose.

import { buildFold } from '../src/engine.js';
import { validateModel } from '../src/validation.js';
import { evaluatePackaging } from '../src/packaging.js';

const STORAGE_KEY = 'fold-preview-model-v1';

export function emptyModel() {
  return { name: 'untitled net', panels: [], edges: [] };
}

export function deepClone(model) {
  return JSON.parse(JSON.stringify(model));
}

// Packaging-aware evaluation. `mode` is 'tree' (legacy articulation, seams
// measured) or 'closed' (seam-constrained solve). Tree is the default so old
// hinge-only models keep their exact previous behaviour; closed mode is opt-in
// and refuses models without seams instead of silently falling back.
export function evaluate(model, options = {}) {
  const mode = options.mode === 'closed' ? 'closed' : 'tree';
  const validation = validateModel(model);
  if (!validation.ok) {
    return { ok: false, diagnostics: validation.diagnostics, result: null, mode };
  }
  const packaged = evaluatePackaging(model, {
    mode,
    rootId: options.rootId,
    tolerance: options.tolerance,
  });
  return packaged;
}

// Legacy tree-only evaluation retained for callers that only know hinges.
export function evaluateTree(model, rootId) {
  const validation = validateModel(model);
  if (!validation.ok) {
    return { ok: false, diagnostics: validation.diagnostics, result: null };
  }
  const result = buildFold(model, rootId ? { rootId } : undefined);
  return { ok: result.ok, diagnostics: result.diagnostics, result };
}

export function saveLocal(model) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(model));
}

export function loadLocal() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.panels) || !Array.isArray(parsed.edges)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearLocal() {
  localStorage.removeItem(STORAGE_KEY);
}

export function toJSONFile(model) {
  return JSON.stringify({ version: 1, ...model }, null, 2);
}

export function parseJSONFile(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`invalid JSON: ${err.message}`);
  }
  if (!Array.isArray(parsed.panels) || !Array.isArray(parsed.edges)) {
    throw new Error('file must contain panels[] and edges[]');
  }
  for (const panel of parsed.panels) {
    if (typeof panel.id !== 'string' || !Array.isArray(panel.vertices)) {
      throw new Error('each panel needs a string id and a vertices array');
    }
  }
  for (const edge of parsed.edges) {
    if (typeof edge.a !== 'string' || typeof edge.b !== 'string' ||
        !Number.isInteger(edge.aEdge) || !Number.isInteger(edge.bEdge)) {
      throw new Error('each edge needs a/b panel ids and integer aEdge/bEdge slots');
    }
    if (!Number.isFinite(edge.angle)) edge.angle = 0;
  }
  const seams = parsed.seams ?? [];
  if (!Array.isArray(seams)) throw new Error('seams must be an array when present');
  for (const seam of seams) {
    if (typeof seam.id !== 'string' || typeof seam.a !== 'string' || typeof seam.b !== 'string') {
      throw new Error('each seam needs a string id and a/b panel ids');
    }
    if (!Number.isInteger(seam.aEdge) || !Number.isInteger(seam.bEdge)) {
      throw new Error('each seam needs integer aEdge/bEdge slots');
    }
    if (typeof seam.flip !== 'boolean') {
      throw new Error(`seam "${seam.id}" must declare flip (true/false)`);
    }
  }
  return {
    name: parsed.name ?? 'imported net',
    panels: parsed.panels,
    edges: parsed.edges,
    ...(seams.length ? { seams } : {}),
  };
}

// ---- model editing helpers (structural edits, not visual shortcuts) ------
export function addPanel(model, panel) {
  if (model.panels.some((p) => p.id === panel.id)) {
    throw new Error(`panel id "${panel.id}" already exists`);
  }
  model.panels.push(panel);
}

export function removePanel(model, panelId) {
  model.panels = model.panels.filter((p) => p.id !== panelId);
  model.edges = model.edges.filter((e) => e.a !== panelId && e.b !== panelId);
  if (model.seams) {
    model.seams = model.seams.filter((s) => s.a !== panelId && s.b !== panelId);
  }
}

export function addEdge(model, edge) {
  model.edges.push({ ...edge, angle: edge.angle ?? 0 });
}

export function addSeam(model, seam) {
  if (!model.seams) model.seams = [];
  model.seams.push({ ...seam, flip: seam.flip ?? true });
}

export function removeSeam(model, seamId) {
  if (!model.seams) return;
  model.seams = model.seams.filter((s) => s.id !== seamId);
}

export function removeEdge(model, edgeIndex) {
  model.edges.splice(edgeIndex, 1);
}

export function setAngle(model, edgeIndex, degrees) {
  if (!Number.isFinite(degrees)) throw new Error('angle must be a finite number');
  model.edges[edgeIndex].angle = degrees;
}
