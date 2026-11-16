// Example packaging nets. All polygons are counter-clockwise in panel-local
// coordinates; edge i is vertices[i] -> vertices[(i+1) % n].

// Two unit squares glued along an edge. The shared edge is a diagonal hinge
// once the net is assembled (axis (-1,-1,0)), exercising non-axis-aligned
// rotation.
export function twoPanelDiagonal() {
  return {
    name: 'two-panel diagonal hinge',
    panels: [
      { id: 'A', vertices: [[0, 0], [1, 0], [1, 1], [0, 1]] },
      { id: 'B', vertices: [[0, 0], [1, 0], [1, 1], [0, 1]] },
    ],
    edges: [
      { id: 'e1', a: 'A', b: 'B', aEdge: 1, bEdge: 3, angle: 0 },
    ],
  };
}

// Rectangular tray: 4 x 3 base, walls of height 2 (front/back) and 2
// (left/right). Flat angles = 0; folding every wall to +/-90 degrees yields
// a 4 x 3 x 2 open box.
export function openBox() {
  return {
    name: 'open box 4x3x2',
    panels: [
      // base
      { id: 'base', vertices: [[0, 0], [4, 0], [4, 3], [0, 3]] },
      // front wall (hinge: base edge 0)
      { id: 'front', vertices: [[0, 0], [4, 0], [4, 2], [0, 2]] },
      // back wall (hinge: base edge 2)
      { id: 'back', vertices: [[0, 0], [4, 0], [4, 2], [0, 2]] },
      // left wall: hinge edge is 3 long (matches base edge 3), height 2
      { id: 'left', vertices: [[0, 0], [3, 0], [3, 2], [0, 2]] },
      // right wall: hinge edge is 3 long (matches base edge 1), height 2
      { id: 'right', vertices: [[0, 0], [3, 0], [3, 2], [0, 2]] },
    ],
    edges: [
      { id: 'front-hinge', a: 'base', b: 'front', aEdge: 0, bEdge: 2, angle: 0 },
      { id: 'right-hinge', a: 'base', b: 'right', aEdge: 1, bEdge: 0, angle: 0 },
      { id: 'back-hinge', a: 'base', b: 'back', aEdge: 2, bEdge: 0, angle: 0 },
      { id: 'left-hinge', a: 'base', b: 'left', aEdge: 3, bEdge: 0, angle: 0 },
    ],
  };
}

// The angles that fold openBox() into an upward tray (all walls rise to z=2).
// The sign follows the engine convention: a positive angle rotates the child
// toward +z (valley from the flat front view), negative toward -z (mountain).
// Back/left walls need the opposite sign because their hinge edge direction
// in the flat net is reversed.
export const BOX_FOLD_ANGLES = {
  'front-hinge': 90,
  'right-hinge': 90,
  'back-hinge': 90,
  'left-hinge': 90,
};

// Panels with deliberately different sizes connected in a chain; the hinge
// lengths still match at every glue edge but panel widths differ, so no
// scaling is possible or needed.
export function mixedSizeStrip() {
  return {
    name: 'mixed-size strip',
    panels: [
      { id: 'P0', vertices: [[0, 0], [2, 0], [2, 3], [0, 3]] },
      { id: 'P1', vertices: [[0, 0], [2, 0], [2, 1.5], [0, 1.5]] },
      { id: 'P2', vertices: [[0, 0], [2, 0], [2, 4], [0, 4]] },
    ],
    edges: [
      { id: 'h1', a: 'P0', b: 'P1', aEdge: 2, bEdge: 0, angle: 0 },
      { id: 'h2', a: 'P1', b: 'P2', aEdge: 2, bEdge: 0, angle: 0 },
    ],
  };
}

// Same box but with one hinge shortened on one side -> must be rejected with
// EDGE_LENGTH_MISMATCH instead of being silently rescaled.
export function mismatchedHinge() {
  const model = openBox();
  model.edges = model.edges.map((e) => ({ ...e }));
  model.panels = model.panels.map((p) => ({ ...p, vertices: p.vertices.map((v) => [...v]) }));
  // shorten the top edge of the front wall (its edge 3): 4 -> 3
  model.panels.find((p) => p.id === 'front').vertices[2][0] = 3;
  return model;
}

// Adds a connection between two wall panels along previously unused slots,
// closing a loop in the connection graph -> unsupported topology.
export function cyclicModel() {
  const model = openBox();
  model.edges = [
    ...model.edges.map((e) => ({ ...e })),
    { id: 'extra', a: 'front', b: 'left', aEdge: 1, bEdge: 3, angle: 0 },
  ];
  return model;
}

export function withBoxFolded(model = openBox()) {
  model.edges.forEach((e) => {
    if (BOX_FOLD_ANGLES[e.id] !== undefined) e.angle = BOX_FOLD_ANGLES[e.id];
  });
  return model;
}
