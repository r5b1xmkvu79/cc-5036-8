// Triangle-level interference detection for folded panel polygons.
//
// The detector reports only interior crossings / coplanar area overlap. Panels
// that merely share a hinge or a packaging seam are excluded by the caller;
// boundary-only contact (shared corner, touching edge) is not a collision.
// Everything is zero-thickness: material thickness and crease radius are not
// modelled, so a "no collision" result is a geometric statement only.

import { cross, dist, dot, sub } from './math.js';

const EPS = 1e-9;
const AREA_EPS = 1e-10;

function newellNormal(poly) {
  const n = [0, 0, 0];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    n[0] += (p[1] - q[1]) * (p[2] + q[2]);
    n[1] += (p[2] - q[2]) * (p[0] + q[0]);
    n[2] += (p[0] - q[0]) * (p[1] + q[1]);
  }
  return n;
}

function dominantDrop(n) {
  const ax = Math.abs(n[0]);
  const ay = Math.abs(n[1]);
  const az = Math.abs(n[2]);
  if (ax >= ay && ax >= az) return [1, 2];
  if (ay >= az) return [2, 0];
  return [0, 1];
}

function signedArea2(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    s += p[0] * q[1] - q[0] * p[1];
  }
  return s / 2;
}

function pointInTriangle2(p, a, b, c) {
  const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  if (Math.abs(area) < EPS) return false;
  const s = ((b[0] - p[0]) * (c[1] - p[1]) - (b[1] - p[1]) * (c[0] - p[0])) / area;
  const t = ((c[0] - p[0]) * (a[1] - p[1]) - (c[1] - p[1]) * (a[0] - p[0])) / area;
  return s > EPS && t > EPS && s + t < 1 - EPS;
}

// Ear clipping in the panel's dominant plane. Returns index triples into the
// original 3D vertex array. Panels are validated as simple polygons upstream.
export function triangulatePolygon(points) {
  if (points.length < 3) return [];
  if (points.length === 3) return [[0, 1, 2]];
  const normal = newellNormal(points);
  const [i0, i1] = dominantDrop(normal);
  let poly2 = points.map((p) => [p[i0], p[i1]]);
  let indices = points.map((_, i) => i);
  if (signedArea2(poly2) < 0) {
    poly2 = poly2.slice().reverse();
    indices = indices.slice().reverse();
  }
  const triangles = [];
  let guard = 0;
  while (indices.length > 3 && guard++ < indices.length * indices.length) {
    let clipped = false;
    for (let i = 0; i < indices.length; i++) {
      const prev = (i + indices.length - 1) % indices.length;
      const next = (i + 1) % indices.length;
      const a = poly2[prev];
      const b = poly2[i];
      const c = poly2[next];
      const crossZ = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      if (crossZ <= EPS) continue;
      let contains = false;
      for (let j = 0; j < indices.length; j++) {
        if (j === prev || j === i || j === next) continue;
        if (pointInTriangle2(poly2[j], a, b, c)) { contains = true; break; }
      }
      if (contains) continue;
      triangles.push([indices[prev], indices[i], indices[next]]);
      indices.splice(i, 1);
      poly2.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (indices.length === 3) {
    triangles.push([indices[0], indices[1], indices[2]]);
  }
  return triangles;
}

function aabbOf(points) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const p of points) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], p[k]);
      max[k] = Math.max(max[k], p[k]);
    }
  }
  return { min, max };
}

function aabbOverlap(a, b, eps = 1e-9) {
  return a.min[0] <= b.max[0] + eps && a.max[0] >= b.min[0] - eps &&
    a.min[1] <= b.max[1] + eps && a.max[1] >= b.min[1] - eps &&
    a.min[2] <= b.max[2] + eps && a.max[2] >= b.min[2] - eps;
}

// Segment-triangle intersection with strict barycentric interior test, so
// shared edges and vertices do not count as collisions.
function segmentTriangleInterior(p, q, tri) {
  const d = sub(q, p);
  const e1 = sub(tri[1], tri[0]);
  const e2 = sub(tri[2], tri[0]);
  const h = cross(d, e2);
  const denom = dot(e1, h);
  if (Math.abs(denom) < 1e-12) return null;
  const f = 1 / denom;
  const s = sub(p, tri[0]);
  const u = f * dot(s, h);
  if (u <= 1e-7 || u >= 1 - 1e-7) return null;
  const qv = cross(s, e1);
  const v = f * dot(d, qv);
  if (v <= 1e-7 || u + v >= 1 - 1e-7) return null;
  const t = f * dot(e2, qv);
  if (t <= 1e-7 || t >= 1 - 1e-7) return null;
  return [p[0] + d[0] * t, p[1] + d[1] * t, p[2] + d[2] * t];
}

function clipPolygon2(subject, clip) {
  let output = subject;
  for (let i = 0; i < clip.length; i++) {
    const a = clip[i];
    const b = clip[(i + 1) % clip.length];
    const input = output;
    output = [];
    if (!input.length) break;
    const inside = (p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= -EPS;
    const intersect = (p, q) => {
      const dx = q[0] - p[0];
      const dy = q[1] - p[1];
      const ex = b[0] - a[0];
      const ey = b[1] - a[1];
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-14) return [p[0], p[1]];
      const t = ((a[0] - p[0]) * ey - (a[1] - p[1]) * ex) / den;
      return [p[0] + t * dx, p[1] + t * dy];
    };
    for (let j = 0; j < input.length; j++) {
      const cur = input[j];
      const prev = input[(j + input.length - 1) % input.length];
      const curIn = inside(cur);
      const prevIn = inside(prev);
      if (curIn) {
        if (!prevIn) output.push(intersect(prev, cur));
        output.push(cur);
      } else if (prevIn) {
        output.push(intersect(prev, cur));
      }
    }
  }
  return output;
}

function coplanarOverlap(triA, triB) {
  const n = newellNormal(triA);
  const [i0, i1] = dominantDrop(n);
  const a2 = triA.map((p) => [p[i0], p[i1]]);
  const b2 = triB.map((p) => [p[i0], p[i1]]);
  const clipped = clipPolygon2(b2, a2);
  if (clipped.length < 3) return null;
  const area = Math.abs(signedArea2(clipped));
  if (area <= AREA_EPS) return null;
  const c = clipped.reduce((acc, p) => [acc[0] + p[0] / clipped.length, acc[1] + p[1] / clipped.length], [0, 0]);
  const point = [0, 0, 0];
  point[i0] = c[0];
  point[i1] = c[1];
  point[3 - i0 - i1] = triA[0][3 - i0 - i1];
  return { type: 'coplanar', area, point };
}

export function triangleTriangleIntersect(triA, triB) {
  const nA = newellNormal(triA);
  const nB = newellNormal(triB);
  const lenA = Math.hypot(...nA);
  const lenB = Math.hypot(...nB);
  if (lenA < EPS || lenB < EPS) return null;
  const nAu = nA.map((v) => v / lenA);
  const nBu = nB.map((v) => v / lenB);
  const parallel = Math.abs(dot(nAu, nBu)) > 1 - 1e-9;
  if (parallel) {
    const planeDist = Math.abs(dot(nAu, sub(triB[0], triA[0])));
    if (planeDist > 1e-7) return null;
    return coplanarOverlap(triA, triB);
  }

  const edgesA = [[triA[0], triA[1]], [triA[1], triA[2]], [triA[2], triA[0]]];
  const edgesB = [[triB[0], triB[1]], [triB[1], triB[2]], [triB[2], triB[0]]];
  for (const [p, q] of edgesA) {
    const hit = segmentTriangleInterior(p, q, triB);
    if (hit) return { type: 'cross', point: hit };
  }
  for (const [p, q] of edgesB) {
    const hit = segmentTriangleInterior(p, q, triA);
    if (hit) return { type: 'cross', point: hit };
  }
  return null;
}

// Detects interior interference between every pair of panels, including
// hinge- and seam-connected neighbours. Neighbours normally touch only along
// their shared boundary, which the strict-interior tests ignore; if they
// overlap in area or cross, that is reported like any other collision.
// Returns at most one record per panel pair; `stats` is filled in place.
export function detectCollisions(model, result, options = {}) {
  const stats = options.stats ?? {};
  stats.panelPairs = 0;
  stats.aabbPairs = 0;
  stats.trianglePairs = 0;
  stats.collidingPairs = 0;

  const ids = [...result.panels.keys()];
  const tris = new Map();
  const bounds = new Map();
  for (const id of ids) {
    const verts = result.panels.get(id).worldVertices;
    tris.set(id, triangulatePolygon(verts));
    bounds.set(id, aabbOf(verts));
  }

  const collisions = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i];
      const b = ids[j];
      stats.panelPairs += 1;
      if (!aabbOverlap(bounds.get(a), bounds.get(b))) continue;
      stats.aabbPairs += 1;
      let found = null;
      const ta = tris.get(a);
      const tb = tris.get(b);
      outer:
      for (let ia = 0; ia < ta.length; ia++) {
        const A = ta[ia].map((k) => result.panels.get(a).worldVertices[k]);
        for (let ib = 0; ib < tb.length; ib++) {
          const B = tb[ib].map((k) => result.panels.get(b).worldVertices[k]);
          stats.trianglePairs += 1;
          const hit = triangleTriangleIntersect(A, B);
          if (hit) {
            found = {
              a,
              b,
              triangleA: ta[ia],
              triangleB: tb[ib],
              type: hit.type,
              point: hit.point,
              penetrationArea: hit.area ?? null,
            };
            break outer;
          }
        }
      }
      if (found) {
        stats.collidingPairs += 1;
        collisions.push(found);
      }
    }
  }
  return collisions;
}

export function collisionDiagnostics(collisions) {
  return collisions.map((c) => ({
    level: 'error',
    code: 'PANEL_COLLISION',
    message: `panels "${c.a}" and "${c.b}" interfere (${c.type}); folded pose is not physically valid`,
    refs: { panels: [c.a, c.b], triangleA: c.triangleA, triangleB: c.triangleB, point: c.point },
  }));
}

export { dist };
