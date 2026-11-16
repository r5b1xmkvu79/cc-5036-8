// Folding engine.
//
// Coordinate conventions
// ----------------------
// 1. Every panel owns a 2D local frame; its polygon vertices are expressed in
//    that frame. Panel edge i is the segment vertices[i] -> vertices[i+1].
// 2. At fold angle 0 the engine first builds the flat net: each child panel
//    is placed by a rigid 2D transform that glues its hinge edge to the
//    parent's hinge edge with opposite segment directions (no scaling, ever).
// 3. The folded 3D position of every vertex is obtained by propagating rigid
//    transforms down the connection tree. Each fold is a rotation around the
//    shared hinge axis by the edge's signed angle:
//      - angle 0   -> exactly the flat net
//      - angle > 0 -> valley fold: the child turns toward +z (its front face
//                     stays visible from above)
//      - angle < 0 -> mountain fold: the child turns toward -z
//    The axis is oriented opposite to the parent's directed hinge edge
//    (right-hand rule), which makes the sign convention identical for every
//    child regardless of where it sits on the net.

import {
  apply4,
  degToRad,
  dist,
  edgeLengths2,
  frameFromSegments,
  identity4,
  invertRigid,
  multiply4,
  rotationAroundAxis,
  sub,
} from './math.js';
import { validateModel } from './validation.js';

function edgeEndpoints(panel, edgeIndex) {
  const a = panel.vertices[edgeIndex];
  const b = panel.vertices[(edgeIndex + 1) % panel.vertices.length];
  return [a, b];
}

export function buildFold(model, options = {}) {
  const rootId = options.rootId ?? model.panels?.[0]?.id;
  const { ok, diagnostics } = validateModel(model);
  if (!ok) {
    return { ok: false, diagnostics, panels: new Map(), edges: [] };
  }

  const panelById = new Map(model.panels.map((p) => [p.id, p]));

  // ---- adjacency + rooted tree ------------------------------------------
  const adj = new Map(model.panels.map((p) => [p.id, []]));
  for (const [idx, edge] of model.edges.entries()) {
    adj.get(edge.a).push({ other: edge.b, edge, edgeIndex: idx, selfSlot: edge.aEdge, otherSlot: edge.bEdge });
    adj.get(edge.b).push({ other: edge.a, edge, edgeIndex: idx, selfSlot: edge.bEdge, otherSlot: edge.aEdge });
  }
  if (!panelById.has(rootId)) {
    return {
      ok: false,
      diagnostics: [{ level: 'error', code: 'UNKNOWN_ROOT', message: `root panel "${rootId}" not found` }],
      panels: new Map(),
      edges: [],
    };
  }

  const parentOf = new Map(); // childId -> { parentId, edgeIndex }
  const order = [];
  const visited = new Set([rootId]);
  const queue = [rootId];
  parentOf.set(rootId, null);
  while (queue.length) {
    const id = queue.shift();
    order.push(id);
    for (const link of adj.get(id)) {
      if (visited.has(link.other)) continue;
      visited.add(link.other);
      parentOf.set(link.other, { parentId: id, edgeIndex: link.edgeIndex });
      queue.push(link.other);
    }
  }

  // ---- stage 1: flat net placement (angle = 0) --------------------------
  // flatFrame maps panel-local 2D coordinates -> shared net coordinates (z=0).
  const flatFrame = new Map();
  flatFrame.set(rootId, identity4());
  for (const id of order.slice(1)) {
    const link = parentOf.get(id);
    const parentPanel = panelById.get(link.parentId);
    const childPanel = panelById.get(id);
    const edge = model.edges[link.edgeIndex];
    const parentSlot = edge.a === link.parentId ? edge.aEdge : edge.bEdge;
    const childSlot = edge.a === id ? edge.aEdge : edge.bEdge;

    const [p1, p2] = edgeEndpoints(parentPanel, parentSlot);
    const [c1, c2] = edgeEndpoints(childPanel, childSlot);
    const parentFrame = flatFrame.get(link.parentId);
    const wp1 = apply4(parentFrame, p1);
    const wp2 = apply4(parentFrame, p2);

    // Glue c1->wp2 and c2->wp1 with reversed directions. Both polygons are
    // CCW, so reversing the hinge direction places the child interior on the
    // opposite side of the hinge from the parent interior: the non-overlapping
    // flat net layout, with no scaling or reflection.
    const childFlat = frameFromSegments(c1, c2, [wp2[0], wp2[1]], [wp1[0], wp1[1]]);
    flatFrame.set(id, childFlat);
  }

  // ---- stage 2: fold transforms along the tree --------------------------
  // foldFrame maps panel-local coordinates -> final 3D world coordinates.
  const foldFrame = new Map();
  foldFrame.set(rootId, identity4());
  const hingeData = [];

  for (const id of order.slice(1)) {
    const { parentId, edgeIndex } = parentOf.get(id);
    const edge = model.edges[edgeIndex];
    const parentPanel = panelById.get(parentId);
    const parentSlot = edge.a === parentId ? edge.aEdge : edge.bEdge;

    const [hp1, hp2] = edgeEndpoints(parentPanel, parentSlot);
    const parentFold = foldFrame.get(parentId);
    const worldP1 = apply4(parentFold, hp1);
    const worldP2 = apply4(parentFold, hp2);

    // Axis opposite to the parent's directed hinge edge so that positive
    // angles always mean valley (+z) for the child.
    const axis = sub(worldP1, worldP2);
    const angleRad = degToRad(edge.angle);
    const hingeRot = rotationAroundAxis(axis, worldP1, angleRad);

    // Flat child frame expressed relative to the parent's folded frame:
    // foldChild = hingeRot * parentFold * (parentFlat^-1 * childFlat)
    // Frame composition can be done directly because at the hinge both
    // flat frames share world endpoints; equivalently:
    //   foldChild = hingeRot * parentFold * parentFlat^-1 * childFlat
    const parentFlat = flatFrame.get(parentId);
    const childFlat = flatFrame.get(id);
    const relToParentFlat = multiply4(invertRigid(parentFlat), childFlat);
    const folded = multiply4(
      hingeRot,
      multiply4(parentFold, relToParentFlat),
    );
    foldFrame.set(id, folded);

    hingeData.push({
      edgeIndex,
      panelA: edge.a,
      panelB: edge.b,
      axisPoint: worldP1,
      axisDir: axis,
      flatLength: dist(worldP1, worldP2),
    });
  }

  // ---- per-panel evaluated geometry -------------------------------------
  const resultPanels = new Map();
  for (const panel of model.panels) {
    const flat = flatFrame.get(panel.id);
    const foldedM = foldFrame.get(panel.id);
    resultPanels.set(panel.id, {
      id: panel.id,
      localVertices: panel.vertices,
      flatVertices: panel.vertices.map((v) => apply4(flat, v)),
      worldVertices: panel.vertices.map((v) => apply4(foldedM, v)),
      flatFrame: flat,
      worldFrame: foldedM,
      parent: parentOf.get(panel.id)?.parentId ?? null,
      localEdgeLengths: edgeLengths2(panel.vertices),
    });
  }

  // Rigidity check: no evaluated edge may change length during folding.
  const rigidityErrors = [];
  for (const panel of model.panels) {
    const r = resultPanels.get(panel.id);
    const worldLengths = edgeLengths2(r.worldVertices);
    r.localEdgeLengths.forEach((l, i) => {
      if (Math.abs(l - worldLengths[i]) > 1e-9) {
        rigidityErrors.push({
          level: 'error',
          code: 'RIGIDITY_BROKEN',
          message: `panel "${panel.id}" edge ${i} changed length during folding`,
          refs: { panelId: panel.id, edgeIndex: i, before: l, after: worldLengths[i] },
        });
      }
    });
  }

  // Shared-hinge check: connected vertices must coincide after folding.
  for (const [idx, edge] of model.edges.entries()) {
    const pa = panelById.get(edge.a);
    const pb = panelById.get(edge.b);
    const ra = resultPanels.get(edge.a);
    const rb = resultPanels.get(edge.b);
    const aPts = edgeEndpoints(pa, edge.aEdge).map((v) => ra.worldVertices[pa.vertices.indexOf(v)]);
    const bPts = edgeEndpoints(pb, edge.bEdge).map((v) => rb.worldVertices[pb.vertices.indexOf(v)]);
    // Flat assembly reverses the child hinge direction, so the glued pairs
    // are a[0]-b[1] and a[1]-b[0].
    const pairs = [[aPts[0], bPts[1]], [aPts[1], bPts[0]]];
    for (const [paPt, pbPt] of pairs) {
      if (dist(paPt, pbPt) > 1e-9) {
        rigidityErrors.push({
          level: 'error',
          code: 'HINGE_OPEN',
          message: `edge #${idx}: hinge endpoints do not coincide after folding`,
          refs: { edgeIndex: idx },
        });
      }
    }
  }

  return {
    ok: rigidityErrors.length === 0,
    diagnostics: [...diagnostics, ...rigidityErrors],
    rootId,
    panels: resultPanels,
    hinges: hingeData,
    order,
  };
}
