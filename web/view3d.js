// Interactive 3D folded view built with three.js. Geometry is regenerated
// from the engine's evaluated worldVertices on every parameter change; the
// meshes are never animated from a precomputed pose. Picking reports the same
// panel id used everywhere else in the app.
//
// The three.js module is resolved lazily so non-browser environments can
// inject a compatible implementation through the constructor's third arg.

let defaultThree = null;
async function loadDefaultThree() {
  if (!defaultThree) {
    defaultThree = await import('/node_modules/three/build/three.module.js');
  }
  return defaultThree;
}

const PALETTE = [
  0x7dd3fc, 0xfda4af, 0x86efac, 0xfcd34d, 0xc4b5fd,
  0xfdba74, 0x67e8f9, 0xf9a8d4, 0xa3e635, 0xf0abfc,
];

export class FoldView3D {
  // Tests and embedding hosts can preload a three.js-compatible module here
  // instead of relying on the browser-only dynamic import beneath.
  static threeModule = null;

  static async create(container, callbacks) {
    const mod = FoldView3D.threeModule ?? await loadDefaultThree();
    return new FoldView3D(container, callbacks, mod);
  }

  constructor(container, callbacks, mod) {
    if (!mod) throw new Error('FoldView3D needs a three.js-compatible module');
    this.THREE = mod;
    const THREE = mod;
    this.container = container;
    this.callbacks = callbacks;
    this.selectedId = null;
    this.panelMeshes = new Map();
    this.hingeLines = new THREE.Group();
    this.seamLines = new THREE.Group();
    this.collisionMarks = new THREE.Group();
    this.handleMeshes = [];
    this.draggingHandle = null;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xf1f5f9);

    const w = container.clientWidth || 600;
    const h = container.clientHeight || 500;
    this.camera = new THREE.PerspectiveCamera(45, w / h, 0.01, 1000);
    this.camera.position.set(7, -9, 6);
    this.camera.lookAt(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(globalThis.devicePixelRatio || 1);
    this.renderer.setSize(w, h);
    container.appendChild(this.renderer.domElement);

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const key = new THREE.DirectionalLight(0xffffff, 0.9);
    key.position.set(5, -6, 8);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.35);
    fill.position.set(-4, 3, 4);
    this.scene.add(fill);

    this.grid = new THREE.GridHelper(20, 20, 0x94a3b8, 0xcbd5e1);
    this.grid.rotation.x = Math.PI / 2;
    this.scene.add(this.grid);
    this.scene.add(this.hingeLines);
    this.scene.add(this.seamLines);
    this.scene.add(this.collisionMarks);

    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();

    this.orbit = { theta: -0.9, phi: 0.75, radius: 12, target: new THREE.Vector3() };
    this.dragging = false;
    this.pointerDown = null;
    this.bindControls();
    this._render();
  }

  bindControls() {
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', (e) => {
      this.pointerDown = { x: e.clientX, y: e.clientY };
      const handle = this.pickHandle(e);
      if (handle) {
        // Dragging a fold-line handle changes that hinge's requested angle;
        // orbit is suppressed for the duration of the drag.
        this.draggingHandle = {
          edgeIndex: handle.userData.edgeIndex,
          startY: e.clientY,
          startAngle: handle.userData.angle,
        };
      } else {
        this.dragging = true;
      }
      el.setPointerCapture?.(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (this.draggingHandle) {
        const dy = e.clientY - this.draggingHandle.startY;
        const next = this.draggingHandle.startAngle - dy * 0.5;
        this.callbacks.onAngleChange?.(this.draggingHandle.edgeIndex, clampAngle(next));
        return;
      }
      if (!this.dragging) return;
      this.orbit.theta -= e.movementX * 0.01;
      this.orbit.phi = this.THREE.MathUtils.clamp(this.orbit.phi - e.movementY * 0.01, 0.08, Math.PI - 0.08);
    });
    el.addEventListener('pointerup', (e) => {
      this.dragging = false;
      this.draggingHandle = null;
      const moved = this.pointerDown &&
        Math.hypot(e.clientX - this.pointerDown.x, e.clientY - this.pointerDown.y);
      // A click (no drag) always selects the panel under the cursor, even when
      // it landed on a handle; only actual movement changes the hinge angle.
      if (moved < 5) this.pick(e);
      this.pointerDown = null;
    });
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.orbit.radius = this.THREE.MathUtils.clamp(this.orbit.radius * (1 + e.deltaY * 0.001), 2, 80);
    }, { passive: false });
  }

  pickHandle(event) {
    if (!this.handleMeshes.length) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.handleMeshes);
    return hits.length ? hits[0].object : null;
  }

  pick(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects([...this.panelMeshes.values()]);
    const id = hits.length ? hits[0].object.userData.panelId : null;
    this.callbacks.onSelect?.(id);
  }

  colorFor(index) {
    return PALETTE[((index % PALETTE.length) + PALETTE.length) % PALETTE.length];
  }

  update(model, result, selectedId, packaging = null) {
    const THREE = this.THREE;
    this.selectedId = selectedId;
    for (const mesh of this.panelMeshes.values()) {
      this.group.remove(mesh);
      mesh.geometry.dispose();
    }
    this.panelMeshes.clear();
    this.hingeLines.clear();
    this.seamLines.clear();
    this.collisionMarks.clear();
    this.handleMeshes = [];

    if (!result) {
      this._render();
      return;
    }

    const indexById = new Map(model.panels.map((p, i) => [p.id, i]));
    const bounds = new THREE.Box3();
    const colliding = new Set();
    for (const c of packaging?.collisions ?? []) {
      colliding.add(c.a);
      colliding.add(c.b);
    }

    for (const [id, panel] of result.panels) {
      // engine coordinates (x, y, z-up) -> three.js (x, z, -y)
      const points = panel.worldVertices.map((v) => engineToThree(THREE, v));
      const positions = [];
      // triangle fan around vertex 0; panels are validated simple polygons
      for (let i = 1; i < points.length - 1; i++) {
        for (const idx of [0, i, i + 1]) {
          positions.push(points[idx].x, points[idx].y, points[idx].z);
        }
      }
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geom.computeVertexNormals();

      const color = this.colorFor(indexById.get(id));
      const interfering = colliding.has(id);
      const material = new THREE.MeshStandardMaterial({
        color,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: id === selectedId ? 1 : interfering ? 0.72 : 0.82,
        roughness: 0.6,
        metalness: 0.05,
        // Interfering panels are the only ones drawn without depth write so
        // the intersection stays visible inside the folded box.
        depthWrite: !interfering,
        emissive: interfering ? 0xdc2626 : 0x000000,
        emissiveIntensity: interfering ? 0.55 : 0,
      });
      const mesh = new THREE.Mesh(geom, material);
      mesh.userData.panelId = id;
      if (interfering) mesh.renderOrder = 2;
      // Interfering panels render with depthTest disabled after the rest, so
      // the intersection is visible from any orbit angle instead of being
      // occluded by the surfaces in front of it.
      if (id === selectedId || interfering) {
        mesh.add(new THREE.LineSegments(
          new THREE.EdgesGeometry(geom),
          new THREE.LineBasicMaterial({ color: interfering ? 0xdc2626 : 0x0f172a }),
        ));
      }
      this.panelMeshes.set(id, mesh);
      this.group.add(mesh);
      points.forEach((v) => bounds.expandByPoint(v));
    }

    // hinge axes as thin dark lines on the actual shared edges
    for (const edge of model.edges) {
      const pa = result.panels.get(edge.a);
      const [i0, i1] = [edge.aEdge, (edge.aEdge + 1) % pa.worldVertices.length];
      const a = engineToThree(THREE, pa.worldVertices[i0]);
      const b = engineToThree(THREE, pa.worldVertices[i1]);
      const lineGeom = new THREE.BufferGeometry().setFromPoints([a, b]);
      const line = new THREE.Line(lineGeom, new THREE.LineBasicMaterial({ color: 0x1e293b }));
      this.hingeLines.add(line);

      // Draggable handle at the hinge midpoint (teal marker).
      const mid = new THREE.Vector3((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
      const handleGeom = new THREE.BufferGeometry();
      const s = 0.09;
      handleGeom.setAttribute('position', new THREE.Float32BufferAttribute([
        mid.x + s, mid.y, mid.z, mid.x - s, mid.y, mid.z, mid.x, mid.y + s, mid.z,
        mid.x, mid.y - s, mid.z, mid.x, mid.y, mid.z + s, mid.x, mid.y, mid.z - s,
      ], 3));
      const handle = new THREE.Mesh(
        handleGeom,
        new THREE.MeshStandardMaterial({ color: 0x0d9488, emissive: 0x0f766e, emissiveIntensity: 0.5 }),
      );
      handle.userData.edgeIndex = model.edges.indexOf(edge);
      handle.userData.angle = edge.angle;
      this.handleMeshes.push(handle);
      this.group.add(handle);
    }

    // seam edges: green when the two endpoints coincide, red with the measured
    // gap when the packaging closure is still open. The gap is taken from the
    // report for the active assumption, so tree mode cannot be coloured by a
    // closed solve that was not requested.
    const seamGaps = new Map();
    const activeReport = packaging?.mode === 'closed'
      ? packaging.closed?.seamReport
      : packaging?.tree?.seamReport;
    for (const report of activeReport?.seams ?? []) seamGaps.set(report.id, report.gap);
    const tolerance = packaging?.closed?.tolerance ?? 1e-6;
    for (const seam of model.seams ?? []) {
      const pa = result.panels.get(seam.a);
      const [i0, i1] = [seam.aEdge, (seam.aEdge + 1) % pa.worldVertices.length];
      const a = engineToThree(THREE, pa.worldVertices[i0]);
      const b = engineToThree(THREE, pa.worldVertices[i1]);
      const gap = seamGaps.get(seam.id);
      const closed = gap !== undefined && gap <= tolerance;
      const lineGeom = new THREE.BufferGeometry().setFromPoints([a, b]);
      const line = new THREE.Line(lineGeom, new THREE.LineBasicMaterial({
        color: closed ? 0x16a34a : 0xdc2626,
      }));
      this.seamLines.add(line);
    }

    for (const c of packaging?.collisions ?? []) {
      const p = engineToThree(THREE, c.point);
      // Small octahedral marker at the reported interference point; built from
      // raw positions so it works with the minimal three.js test stub too.
      const r = 0.12;
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.Float32BufferAttribute([
        p.x + r, p.y, p.z, p.x - r, p.y, p.z, p.x, p.y + r, p.z,
        p.x, p.y - r, p.z, p.x, p.y, p.z + r, p.x, p.y, p.z - r,
      ], 3));
      const mark = new THREE.Mesh(
        geom,
        new THREE.MeshStandardMaterial({ color: 0xdc2626, emissive: 0x991b1b, emissiveIntensity: 1 }),
      );
      mark.userData.collision = { a: c.a, b: c.b, type: c.type };
      this.collisionMarks.add(mark);
    }

    if (!bounds.isEmpty()) {
      const center = bounds.getCenter(new THREE.Vector3());
      this.orbit.target.copy(center);
    }
    this._render();
  }

  _render() {
    const { theta, phi, radius, target } = this.orbit;
    this.camera.position.set(
      target.x + radius * Math.sin(phi) * Math.cos(theta),
      target.y + radius * Math.cos(phi),
      target.z + radius * Math.sin(phi) * Math.sin(theta),
    );
    this.camera.lookAt(target);
    this.renderer.render(this.scene, this.camera);
  }

  resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this._render();
  }
}

function engineToThree(THREE, v) {
  return new THREE.Vector3(v[0], v[2], -v[1]);
}

function clampAngle(deg) {
  return Math.max(-180, Math.min(180, deg));
}
