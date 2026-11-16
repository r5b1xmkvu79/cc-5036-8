// 2D flat-net view on a canvas. Panels are drawn from the engine's evaluated
// flatVertices, so what is shown is the assembled net rather than raw local
// coordinates. Selection works by panel id and is shared with the 3D view.

import { dist } from '../src/math.js';

const COLORS = [
  '#7dd3fc', '#fda4af', '#86efac', '#fcd34d', '#c4b5fd',
  '#fdba74', '#67e8f9', '#f9a8d4', '#a3e635', '#f0abfc',
];

export class FlatView {
  constructor(canvas, callbacks) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.callbacks = callbacks;
    this.result = null;
    this.model = null;
    this.selectedId = null;
    this.hoverId = null;
    this.dpr = globalThis.devicePixelRatio || 1;
    this.bounds = null;
    this.canvas.addEventListener('click', (e) => this.onClick(e));
    this.canvas.addEventListener('mousemove', (e) => this.onMove(e));
    this.canvas.addEventListener('mouseleave', () => {
      this.hoverId = null;
      this.draw();
    });
  }

  update(model, result, selectedId) {
    this.model = model;
    this.result = result;
    this.selectedId = selectedId;
    this.draw();
  }

  colorFor(id) {
    if (!this.model) return '#cbd5e1';
    const idx = this.model.panels.findIndex((p) => p.id === id);
    return COLORS[((idx % COLORS.length) + COLORS.length) % COLORS.length];
  }

  computeTransform() {
    const all = [...this.result.panels.values()].flatMap((p) => p.flatVertices);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const v of all) {
      minX = Math.min(minX, v[0]); maxX = Math.max(maxX, v[0]);
      minY = Math.min(minY, v[1]); maxY = Math.max(maxY, v[1]);
    }
    const pad = 40;
    const w = this.canvas.clientWidth - pad * 2;
    const h = this.canvas.clientHeight - pad * 2;
    const sx = w / Math.max(maxX - minX, 1e-6);
    const sy = h / Math.max(maxY - minY, 1e-6);
    const scale = Math.min(sx, sy);
    const ox = pad + (w - (maxX - minX) * scale) / 2 - minX * scale;
    const oy = pad + (h - (maxY - minY) * scale) / 2 - minY * scale;
    this.bounds = { minX, minY, maxX, maxY, scale, ox, oy };
    return { scale, ox, oy };
  }

  toScreen(p, t) {
    // flip y so net +y points up on screen
    return [t.ox + p[0] * t.scale, this.canvas.clientHeight - (t.oy + p[1] * t.scale)];
  }

  draw() {
    const ctx = this.ctx;
    const { width, height } = this.canvas.getBoundingClientRect();
    this.canvas.width = width * this.dpr;
    this.canvas.height = height * this.dpr;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    if (!this.result || !this.model) {
      ctx.fillStyle = '#64748b';
      ctx.font = '14px sans-serif';
      ctx.fillText('No valid model — fix diagnostics or load an example.', 16, 32);
      return;
    }
    const t = this.computeTransform();

    // panels
    for (const panel of this.result.panels.values()) {
      const pts = panel.flatVertices.map((v) => this.toScreen(v, t));
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.closePath();
      const isSel = panel.id === this.selectedId;
      const isHover = panel.id === this.hoverId;
      ctx.fillStyle = isSel ? this.colorFor(panel.id) : `${this.colorFor(panel.id)}55`;
      ctx.fill();
      ctx.lineWidth = isSel ? 3 : isHover ? 2 : 1;
      ctx.strokeStyle = isSel ? '#0f172a' : '#334155';
      ctx.stroke();

      const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
      const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(panel.id, cx, cy);
    }

    // hinge labels with the live angle
    ctx.textAlign = 'left';
    for (const edge of this.model.edges) {
      const pa = this.result.panels.get(edge.a);
      const va = pa.flatVertices[edge.aEdge];
      const vb = pa.flatVertices[(edge.aEdge + 1) % pa.flatVertices.length];
      const s1 = this.toScreen(va, t);
      const s2 = this.toScreen(vb, t);
      const mx = (s1[0] + s2[0]) / 2;
      const my = (s1[1] + s2[1]) / 2;
      const label = `${edge.angle.toFixed(0)}°${edge.angle > 0 ? ' V' : edge.angle < 0 ? ' M' : ''}`;
      ctx.font = '11px monospace';
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = 'rgba(15,23,42,0.85)';
      ctx.fillRect(mx - tw / 2 - 3, my - 18, tw + 6, 15);
      ctx.fillStyle = '#f8fafc';
      ctx.fillText(label, mx - tw / 2, my - 7);
    }
  }

  pick(screenX, screenY) {
    if (!this.result) return null;
    const t = this.bounds;
    // invert screen -> net coordinates
    const nx = (screenX - t.ox) / t.scale;
    const ny = ((this.canvas.clientHeight - screenY) - t.oy) / t.scale;
    let best = null;
    let bestD = Infinity;
    for (const panel of this.result.panels.values()) {
      if (pointInPolygon([nx, ny], panel.flatVertices)) {
        const c = centroid(panel.flatVertices);
        const d = dist([nx, ny], c);
        if (d < bestD) { bestD = d; best = panel.id; }
      }
    }
    return best;
  }

  onClick(e) {
    const rect = this.canvas.getBoundingClientRect();
    const id = this.pick(e.clientX - rect.left, e.clientY - rect.top);
    this.selectedId = id;
    this.callbacks.onSelect?.(id);
    this.draw();
  }

  onMove(e) {
    const rect = this.canvas.getBoundingClientRect();
    const id = this.pick(e.clientX - rect.left, e.clientY - rect.top);
    if (id !== this.hoverId) {
      this.hoverId = id;
      this.canvas.style.cursor = id ? 'pointer' : 'default';
      this.draw();
    }
  }
}

function centroid(poly) {
  const c = [0, 0];
  for (const v of poly) { c[0] += v[0]; c[1] += v[1]; }
  return [c[0] / poly.length, c[1] / poly.length];
}

function pointInPolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1];
    const xj = poly[j][0], yj = poly[j][1];
    const intersect = ((yi > p[1]) !== (yj > p[1])) &&
      (p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}
