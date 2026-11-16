// Pure 2D/3D math used by the folding engine. No external dependencies.

export function add(a, b) {
  return a.map((v, i) => v + b[i]);
}
export function sub(a, b) {
  return a.map((v, i) => v - b[i]);
}
export function scale(a, s) {
  return a.map((v) => v * s);
}
export function dot(a, b) {
  return a.reduce((acc, v, i) => acc + v * b[i], 0);
}
export function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}
export function length(a) {
  return Math.sqrt(dot(a, a));
}
export function dist(a, b) {
  return length(sub(a, b));
}
export function normalize(a) {
  const l = length(a);
  if (l < 1e-12) throw new Error('cannot normalize a near-zero vector');
  return scale(a, 1 / l);
}

export function approxEqual(a, b, eps = 1e-9) {
  if (a.length !== b.length) return false;
  return a.every((v, i) => Math.abs(v - b[i]) <= eps);
}

// 2D signed area: positive for counter-clockwise vertex order.
export function polygonArea2(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    s += p[0] * q[1] - q[0] * p[1];
  }
  return s / 2;
}

// 2D polygon edge lengths in order.
export function edgeLengths2(poly) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    out.push(dist(poly[i], poly[(i + 1) % poly.length]));
  }
  return out;
}

// Column-major 4x4 matrix helpers (compatible with THREE.Matrix4 convention).
export function identity4() {
  const m = new Array(16).fill(0);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

export function multiply4(a, b) {
  // returns a * b; matrices are column-major, entry (r,c) at c*4+r.
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) {
        s += a[r + k * 4] * b[k + c * 4];
      }
      out[r + c * 4] = s;
    }
  }
  return out;
}

export function apply4(m, v) {
  const x = v[0] ?? 0;
  const y = v[1] ?? 0;
  const z = v[2] ?? 0;
  const w = v[3] ?? 1;
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12] * w,
    m[1] * x + m[5] * y + m[9] * z + m[13] * w,
    m[2] * x + m[6] * y + m[10] * z + m[14] * w,
  ];
}

// Rotation by angle (radians) around an arbitrary axis through point p.
// Rodrigues' formula, returned as a column-major 4x4 rigid transform.
// Positive angle follows the right-hand rule about the given axis direction.
export function rotationAroundAxis(axis, point, angle) {
  const u = normalize(axis);
  const [ux, uy, uz] = u;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  // Rodrigues matrix R, addressed R[row*3 + col].
  const R = [
    t * ux * ux + c,       t * ux * uy - s * uz,  t * ux * uz + s * uy,
    t * ux * uy + s * uz,  t * uy * uy + c,       t * uy * uz - s * ux,
    t * ux * uz - s * uy,  t * uy * uz + s * ux,  t * uz * uz + c,
  ];
  const rp = [
    R[0] * point[0] + R[1] * point[1] + R[2] * point[2],
    R[3] * point[0] + R[4] * point[1] + R[5] * point[2],
    R[6] * point[0] + R[7] * point[1] + R[8] * point[2],
  ];
  const tr = [point[0] - rp[0], point[1] - rp[1], point[2] - rp[2]];
  // Column-major 4x4: entries (row, col) at index col*4+row.
  return [
    R[0], R[3], R[6], 0,
    R[1], R[4], R[7], 0,
    R[2], R[5], R[8], 0,
    tr[0], tr[1], tr[2], 1,
  ];
}

// Rigid transform (rotation + translation) built from two matching point
// pairs in 2D: maps a1->b1 and a2->b2, lifting z = 0.
// Throws if the pair distances disagree (that mismatch must be caught earlier).
export function frameFromSegments(a1, a2, b1, b2) {
  const da = sub(a2, a1);
  const db = sub(b2, b1);
  const la = Math.hypot(da[0], da[1]);
  const lb = Math.hypot(db[0], db[1]);
  if (la < 1e-12 || lb < 1e-12) {
    throw new Error('degenerate segment: zero-length reference edge');
  }
  const ang = Math.atan2(db[1], db[0]) - Math.atan2(da[1], da[0]);
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  // R = [[c,-s],[s,c]]; b = R*a + t  =>  t = b1 - R*a1
  const tx = b1[0] - (c * a1[0] - s * a1[1]);
  const ty = b1[1] - (s * a1[0] + c * a1[1]);
  // Column-major 4x4 with z rotation embedded.
  return [
    c, s, 0, 0,
    -s, c, 0, 0,
    0, 0, 1, 0,
    tx, ty, 0, 1,
  ];
}

export function degToRad(d) {
  return (d * Math.PI) / 180;
}

// Inverse of a rigid 4x4 transform (orthonormal rotation, unit bottom row).
// Storage is column-major: element (row r, col c) is m[r + c*4].
// For M = [R t; 0 1], M^-1 = [R^T -R^T t; 0 1].
export function invertRigid(m) {
  const R = (r, c) => m[r + c * 4];
  // R^T elements
  const t00 = R(0, 0), t01 = R(1, 0), t02 = R(2, 0);
  const t10 = R(0, 1), t11 = R(1, 1), t12 = R(2, 1);
  const t20 = R(0, 2), t21 = R(1, 2), t22 = R(2, 2);
  const tx = m[12], ty = m[13], tz = m[14];
  const nt = [
    -(t00 * tx + t01 * ty + t02 * tz),
    -(t10 * tx + t11 * ty + t12 * tz),
    -(t20 * tx + t21 * ty + t22 * tz),
  ];
  return [
    t00, t10, t20, 0,
    t01, t11, t21, 0,
    t02, t12, t22, 0,
    nt[0], nt[1], nt[2], 1,
  ];
}
