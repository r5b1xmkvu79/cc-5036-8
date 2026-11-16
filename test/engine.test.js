import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  apply4,
  approxEqual,
  cross,
  dist,
  frameFromSegments,
  identity4,
  invertRigid,
  multiply4,
  normalize,
  rotationAroundAxis,
  sub,
} from '../src/math.js';
import { validateModel } from '../src/validation.js';
import { buildFold } from '../src/engine.js';
import {
  BOX_FOLD_ANGLES,
  cyclicModel,
  mismatchedHinge,
  mixedSizeStrip,
  openBox,
  twoPanelDiagonal,
  withBoxFolded,
} from '../src/examples.js';

const EPS = 1e-9;

function vApprox(actual, expected, eps = 1e-8) {
  assert.ok(approxEqual(actual, expected, eps),
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function panelVerts(result, panelId) {
  return result.panels.get(panelId).worldVertices;
}

test('rotationAroundAxis: right-handed 90 deg around z maps +x onto +y', () => {
  const m = rotationAroundAxis([0, 0, 1], [0, 0, 0], Math.PI / 2);
  vApprox(apply4(m, [1, 0, 0]), [0, 1, 0]);
  vApprox(apply4(m, [0, 1, 0]), [-1, 0, 0]);
  // a point on the axis stays fixed
  vApprox(apply4(m, [0, 0, 5]), [0, 0, 5]);
});

test('frameFromSegments maps both reference points exactly', () => {
  const m = frameFromSegments([4, 2], [0, 2], [0, 0], [4, 0]);
  vApprox(apply4(m, [4, 2]), [0, 0, 0]);
  vApprox(apply4(m, [0, 2]), [4, 0, 0]);
  // lengths preserved (rigid, no scaling)
  const p = apply4(m, [0, 0]);
  const q = apply4(m, [4, 0]);
  assert.ok(Math.abs(dist(p, q) - 4) < EPS);
});

test('zero fold angle restores the flat net for the whole tree', () => {
  const model = openBox();
  const result = buildFold(model);
  assert.equal(result.ok, true);
  for (const panel of result.panels.values()) {
    panel.worldVertices.forEach((w, i) => {
      vApprox(w, panel.flatVertices[i]);
      assert.ok(Math.abs(w[2]) < EPS, 'flat net must lie in z=0');
    });
  }
  // base stays at its local frame
  vApprox(panelVerts(result, 'base')[0], [0, 0, 0]);
  vApprox(panelVerts(result, 'base')[2], [4, 3, 0]);
  // front wall laid below the base, no overlap
  vApprox(panelVerts(result, 'front')[0], [0, -2, 0]);
  vApprox(panelVerts(result, 'front')[1], [4, -2, 0]);
  vApprox(panelVerts(result, 'front')[2], [4, 0, 0]);
  vApprox(panelVerts(result, 'front')[3], [0, 0, 0]);
  // right wall laid to the right of the base
  const right = panelVerts(result, 'right');
  vApprox(right[0], [4, 3, 0]);
  vApprox(right[2], [6, 0, 0]);
});

test('two-panel diagonal hinge rotates around a non-axis-aligned axis', () => {
  const model = twoPanelDiagonal();
  model.edges[0].angle = 90;
  const result = buildFold(model);
  assert.equal(result.ok, true);
  const a = panelVerts(result, 'A');
  const b = panelVerts(result, 'B');
  // panel A untouched
  vApprox(a[0], [0, 0, 0]);
  vApprox(a[3], [0, 1, 0]);
  // reversed glue: B's hinge edge (v3->v0) maps to A's edge reversed
  vApprox(b[3], a[2]);
  vApprox(b[0], a[1]);
  // hinge axis runs (1,0)->(1,1); the free edge of B must leave the plane.
  // b[1] and b[2] are the free edge vertices; each sits exactly one panel
  // unit away from the hinge line (rigid motion preserves that distance).
  const hingeDir = normalize(sub(a[2], a[1]));
  vApprox(hingeDir, [0, 1, 0]);
  for (const idx of [1, 2]) {
    const rel = sub(b[idx], a[1]);
    const projLen = rel.reduce((s, x, k) => s + x * hingeDir[k], 0);
    const along = hingeDir.map((c) => c * projLen);
    const perp = sub(rel, along);
    assert.ok(Math.abs(Math.hypot(...perp) - 1) < 1e-8);
  }
  // sign convention: positive angle is valley -> free edge moves to +z
  assert.ok(b[1][2] > 0, 'valley fold should lift the child toward +z');
});

test('opposite signs give mirror-symmetric mountain/valley geometry', () => {
  const plus = twoPanelDiagonal();
  plus.edges[0].angle = 60;
  const minus = twoPanelDiagonal();
  minus.edges[0].angle = -60;
  const rp = buildFold(plus);
  const rm = buildFold(minus);
  assert.equal(rp.ok, true);
  assert.equal(rm.ok, true);
  const bp = panelVerts(rp, 'B');
  const bm = panelVerts(rm, 'B');
  bp.forEach((p, i) => {
    // xy identical, z mirrored
    vApprox(bm[i], [p[0], p[1], -p[2]]);
    assert.ok(Math.abs(bm[i][2] + bp[i][2]) < 1e-8, 'z components must be opposite');
  });
});

test('open box folds to exact 4x3x2 tray geometry', () => {
  const result = buildFold(withBoxFolded());
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));

  const base = panelVerts(result, 'base');
  vApprox(base[0], [0, 0, 0]);
  vApprox(base[2], [4, 3, 0]);

  // every wall top edge must lie at z = 2 (vertices in panel-local order)
  const expectedTop = {
    front: [[0, 0, 2], [4, 0, 2]],
    right: [[4, 0, 2], [4, 3, 2]],
    back: [[4, 3, 2], [0, 3, 2]],
    left: [[0, 3, 2], [0, 0, 2]],
  };
  for (const [id, tops] of Object.entries(expectedTop)) {
    const verts = panelVerts(result, id);
    // find the two vertices with z ~ 2 and compare as an unordered set
    const high = verts.filter((v) => Math.abs(v[2] - 2) < 1e-8);
    assert.equal(high.length, 2, `${id} should have two top vertices at z=2`);
    const matched = tops.map((t) => high.some((h) => approxEqual(h, t, 1e-8)));
    assert.ok(matched.every(Boolean), `${id} top edge mismatch: ${JSON.stringify(high)}`);
    // hinge vertices stay on the base plane
    verts.forEach((v) => assert.ok(v[2] >= -EPS));
  }
});

test('all panel edge lengths are invariant through arbitrary fold angles', () => {
  const model = openBox();
  model.edges.forEach((e) => { e.angle = (e.id.length * 37) % 150 - 75; });
  const result = buildFold(model);
  assert.equal(result.ok, true);
  for (const panel of result.panels.values()) {
    for (let i = 0; i < panel.localVertices.length; i++) {
      const j = (i + 1) % panel.localVertices.length;
      const local = dist(panel.localVertices[i], panel.localVertices[j]);
      const world = dist(panel.worldVertices[i], panel.worldVertices[j]);
      assert.ok(Math.abs(local - world) < 1e-9);
    }
  }
});

test('hinge endpoints of every connection coincide after folding', () => {
  const model = withBoxFolded();
  const result = buildFold(model);
  for (const edge of model.edges) {
    const pa = result.panels.get(edge.a);
    const pb = result.panels.get(edge.b);
    const ea = [edge.aEdge, (edge.aEdge + 1) % pa.localVertices.length];
    const eb = [edge.bEdge, (edge.bEdge + 1) % pb.localVertices.length];
    // reversed hinge pairing in the flat assembly
    vApprox(pa.worldVertices[ea[0]], pb.worldVertices[eb[1]]);
    vApprox(pa.worldVertices[ea[1]], pb.worldVertices[eb[0]]);
  }
});

test('mixed panel sizes: transforms propagate down the chain without scaling', () => {
  const flat = buildFold(mixedSizeStrip());
  assert.equal(flat.ok, true);
  // flat layout: P0 y[0,3], P1 y[3,4.5], P2 y[4.5,8.5]
  const p0 = panelVerts(flat, 'P0');
  const p1 = panelVerts(flat, 'P1');
  const p2 = panelVerts(flat, 'P2');
  vApprox(p0[2], [2, 3, 0]);
  vApprox(p1[2], [2, 4.5, 0]);
  vApprox(p2[2], [2, 8.5, 0]);

  const folded = buildFold((() => {
    const m = mixedSizeStrip();
    m.edges[0].angle = 90;
    m.edges[1].angle = -45;
    return m;
  })());
  assert.equal(folded.ok, true);
  // P1 width (2) and P1 depth (1.5) and P2 depth (4) preserved
  const f1 = panelVerts(folded, 'P1');
  const f2 = panelVerts(folded, 'P2');
  assert.ok(Math.abs(dist(f1[0], f1[1]) - 2) < 1e-9);
  assert.ok(Math.abs(dist(f1[1], f1[2]) - 1.5) < 1e-9);
  assert.ok(Math.abs(dist(f2[1], f2[2]) - 4) < 1e-9);
  // grandchild hinge (P1 top edge) shared exactly
  vApprox(f1[2], panelVerts(folded, 'P2')[1]);
  vApprox(f1[3], panelVerts(folded, 'P2')[0]);
});

test('edge length mismatch is rejected, never rescaled', () => {
  const { ok, diagnostics } = validateModel(mismatchedHinge());
  assert.equal(ok, false);
  assert.ok(diagnostics.some((d) => d.code === 'EDGE_LENGTH_MISMATCH'));
  const built = buildFold(mismatchedHinge());
  assert.equal(built.ok, false);
});

test('cyclic / extra connection is diagnosed as unsupported', () => {
  const { ok, diagnostics } = validateModel(cyclicModel());
  assert.equal(ok, false);
  assert.ok(diagnostics.some((d) => d.code === 'TOPOLOGY'));
});

test('duplicate connection between the same panel pair is rejected', () => {
  const model = twoPanelDiagonal();
  model.edges.push({ id: 'dup', a: 'A', b: 'B', aEdge: 0, bEdge: 0, angle: 0 });
  const { ok, diagnostics } = validateModel(model);
  assert.equal(ok, false);
  assert.ok(diagnostics.some((d) => d.code === 'DUPLICATE_CONNECTION'));
});

test('disconnected panels are reported', () => {
  const model = twoPanelDiagonal();
  model.panels.push({ id: 'lonely', vertices: [[0, 0], [1, 0], [1, 1]] });
  const { ok, diagnostics } = validateModel(model);
  assert.equal(ok, false);
  assert.ok(diagnostics.some((d) => d.code === 'DISCONNECTED'));
});

test('folded geometry recomputes when an angle parameter changes', () => {
  const model = openBox();
  const r0 = buildFold(model);
  assert.ok(panelVerts(r0, 'front').every((v) => Math.abs(v[2]) < EPS));
  model.edges.find((e) => e.id === 'front-hinge').angle = 45;
  const r1 = buildFold(model);
  const front = panelVerts(r1, 'front');
  // top of front wall: y = -2 cos45, z = 2 sin45
  const top = front.find((v) => Math.abs(v[2]) > EPS);
  assert.ok(Math.abs(top[2] - 2 * Math.sin(Math.PI / 4)) < 1e-8);
  assert.ok(Math.abs(top[1] + 2 * Math.cos(Math.PI / 4)) < 1e-8);
});

test('engine output exposes stable panel identity for selection', () => {
  const result = buildFold(withBoxFolded());
  assert.deepEqual([...result.panels.keys()].sort(),
    ['back', 'base', 'front', 'left', 'right'].sort());
  const base = result.panels.get('base');
  assert.equal(base.id, 'base');
  assert.equal(base.parent, null);
  assert.equal(result.panels.get('front').parent, 'base');
});

test('matrix multiply and rigid inverse round-trip', () => {
  const r = rotationAroundAxis([1, 2, 3], [4, -1, 2], 0.7);
  const inv = invertRigid(r);
  const id = multiply4(r, inv);
  for (let i = 0; i < 16; i++) {
    assert.ok(Math.abs(id[i] - identity4()[i]) < 1e-10);
  }
  const p = [3.2, -1.7, 0.9];
  vApprox(apply4(inv, apply4(r, p)), p, 1e-10);
});

test('cross product sanity for right-handed coordinate frame', () => {
  vApprox(cross([1, 0, 0], [0, 1, 0]), [0, 0, 1]);
});

test('fold angle metadata round-trips through hinges', () => {
  const result = buildFold(withBoxFolded());
  assert.equal(result.hinges.length, 4);
  for (const hinge of result.hinges) {
    const edge = openBox().edges[hinge.edgeIndex];
    assert.equal(hinge.flatLength > 0, true);
    assert.ok(BOX_FOLD_ANGLES[edge.id] !== undefined);
  }
});

test('self-intersecting panel polygon and out-of-range angles are rejected', () => {
  const bowtie = {
    panels: [{ id: 'A', vertices: [[0, 0], [2, 2], [2, 0], [0, 2]] }],
    edges: [],
  };
  const v1 = validateModel(bowtie);
  assert.equal(v1.ok, false);
  assert.ok(v1.diagnostics.some((d) => d.code === 'SELF_INTERSECTING'));

  const badAngle = {
    panels: [
      { id: 'A', vertices: [[0, 0], [1, 0], [1, 1], [0, 1]] },
      { id: 'B', vertices: [[0, 0], [1, 0], [1, 1], [0, 1]] },
    ],
    edges: [{ a: 'A', b: 'B', aEdge: 1, bEdge: 3, angle: 270 }],
  };
  const v2 = validateModel(badAngle);
  assert.ok(v2.diagnostics.some((d) => d.code === 'ANGLE_RANGE'));
});

test('triangular panels fold rigidly at the +/-180 degree limits', () => {
  const model = {
    panels: [
      { id: 'A', vertices: [[0, 0], [2, 0], [1, 1.5]] },
      { id: 'B', vertices: [[0, 0], [2, 0], [1, 1.5]] },
    ],
    edges: [{ id: 'e', a: 'A', b: 'B', aEdge: 0, bEdge: 0, angle: 180 }],
  };
  for (const angle of [180, -180]) {
    model.edges[0].angle = angle;
    const r = buildFold(model);
    assert.equal(r.ok, true, JSON.stringify(r.diagnostics));
    const panel = r.panels.get('B');
    panel.localEdgeLengths.forEach((len, i) => {
      const a = panel.worldVertices[i];
      const b = panel.worldVertices[(i + 1) % 3];
      const world = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      assert.ok(Math.abs(world - len) < 1e-9);
    });
  }
});
