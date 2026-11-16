// Interactive 3D folded view built with three.js. Geometry is regenerated
// from the engine's evaluated worldVertices on every parameter change; the
// meshes are never animated from a precomputed pose. Picking reports the same
// panel id used everywhere else in the app.
//
// The three.js module is resolved lazily so non-browser environments can
// inject a compatible implementation through the constructor's third arg.

let THREE = null;
async function loadDefaultThree() {
  if (!THREE) {
    THREE = await import('/node_modules/three/build/three.module.js');
  }
  return THREE;
}

const PALETTE = [
  0x7dd3fc, 0xfda4af, 0x86efac, 0xfcd34d, 0xc4b5fd,
  0xfdba74, 0x67e8f9, 0xf9a8d4, 0xa3e635, 0xf0abfc,
];

export class FoldView3D {
  static async create(container, callbacks) {
    const mod = await loadDefaultThree();
    return new FoldView3D(container, callbacks, mod);
  }

  constructor(container, callbacks, mod = THREE) {
    THREE = mod;
    this.container = container;
    this.callbacks = callbacks;
    this.selectedId = null;
    this.panelMeshes = new Map();
    this.hingeLines = new THREE.Group();

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
      this.dragging = true;
      this.pointerDown = { x: e.clientX, y: e.clientY };
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.orbit.theta -= e.movementX * 0.01;
      this.orbit.phi = THREE.MathUtils.clamp(this.orbit.phi - e.movementY * 0.01, 0.08, Math.PI - 0.08);
    });
    el.addEventListener('pointerup', (e) => {
      this.dragging = false;
      const moved = this.pointerDown &&
        Math.hypot(e.clientX - this.pointerDown.x, e.clientY - this.pointerDown.y);
      if (moved < 5) this.pick(e);
      this.pointerDown = null;
    });
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.orbit.radius = THREE.MathUtils.clamp(this.orbit.radius * (1 + e.deltaY * 0.001), 2, 80);
    }, { passive: false });
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

  update(model, result, selectedId) {
    this.selectedId = selectedId;
    for (const mesh of this.panelMeshes.values()) {
      this.group.remove(mesh);
      mesh.geometry.dispose();
    }
    this.panelMeshes.clear();
    this.hingeLines.clear();

    if (!result) {
      this._render();
      return;
    }

    const indexById = new Map(model.panels.map((p, i) => [p.id, i]));
    const bounds = new THREE.Box3();

    for (const [id, panel] of result.panels) {
      // engine coordinates (x, y, z-up) -> three.js (x, z, -y)
      const points = panel.worldVertices.map(engineToThree);
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
      const material = new THREE.MeshStandardMaterial({
        color,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: id === selectedId ? 1 : 0.82,
        roughness: 0.6,
        metalness: 0.05,
      });
      const mesh = new THREE.Mesh(geom, material);
      mesh.userData.panelId = id;
      if (id === selectedId) {
        mesh.add(new THREE.LineSegments(
          new THREE.EdgesGeometry(geom),
          new THREE.LineBasicMaterial({ color: 0x0f172a }),
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
      const a = engineToThree(pa.worldVertices[i0]);
      const b = engineToThree(pa.worldVertices[i1]);
      const lineGeom = new THREE.BufferGeometry().setFromPoints([a, b]);
      const line = new THREE.Line(lineGeom, new THREE.LineBasicMaterial({ color: 0x1e293b }));
      this.hingeLines.add(line);
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

function engineToThree(v) {
  return new THREE.Vector3(v[0], v[2], -v[1]);
}
