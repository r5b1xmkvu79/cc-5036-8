// Application state: the working model, live re-evaluation, persistence and
// import/export. Every render is produced by re-running the folding engine on
// the current parameter values — there is no baked animation or cached pose.

import { buildFold } from '../src/engine.js';
import { validateModel } from '../src/validation.js';

const STORAGE_KEY = 'fold-preview-model-v1';

export function emptyModel() {
  return { name: 'untitled net', panels: [], edges: [] };
}

export function deepClone(model) {
  return JSON.parse(JSON.stringify(model));
}

export function evaluate(model, rootId) {
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
  return { name: parsed.name ?? 'imported net', panels: parsed.panels, edges: parsed.edges };
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
}

export function addEdge(model, edge) {
  model.edges.push({ ...edge, angle: edge.angle ?? 0 });
}

export function removeEdge(model, edgeIndex) {
  model.edges.splice(edgeIndex, 1);
}

export function setAngle(model, edgeIndex, degrees) {
  if (!Number.isFinite(degrees)) throw new Error('angle must be a finite number');
  model.edges[edgeIndex].angle = degrees;
}
