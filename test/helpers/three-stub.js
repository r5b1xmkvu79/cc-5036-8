// Minimal three.js surface stub for headless testing of view3d.js.
// Implements only the API surface FoldView3D touches; injected directly via
// the view constructor so no module-loader hooks are needed.

class Vector2 {
  constructor(x = 0, y = 0) { this.x = x; this.y = y; }
}

class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  clone() { return new Vector3(this.x, this.y, this.z); }
}
class Box3 {
  constructor() { this.min = null; this.max = null; }
  expandByPoint(v) {
    if (!this.min) { this.min = v.clone(); this.max = v.clone(); return this; }
    this.min.x = Math.min(this.min.x, v.x);
    this.min.y = Math.min(this.min.y, v.y);
    this.min.z = Math.min(this.min.z, v.z);
    this.max.x = Math.max(this.max.x, v.x);
    this.max.y = Math.max(this.max.y, v.y);
    this.max.z = Math.max(this.max.z, v.z);
    return this;
  }
  isEmpty() { return this.min === null; }
  getCenter(out) {
    if (!this.min) return out.set(0, 0, 0);
    return out.set(
      (this.min.x + this.max.x) / 2,
      (this.min.y + this.max.y) / 2,
      (this.min.z + this.max.z) / 2,
    );
  }
}

class Float32BufferAttribute {
  constructor(array) { this.array = new Float32Array(array); this.itemSize = 3; }
}

class BufferGeometry {
  constructor() { this.attributes = {}; this.values = []; }
  setAttribute(name, attr) {
    this.attributes[name] = attr;
    if (name === 'position') this.values = attr.array;
  }
  setFromPoints(points) {
    this.values = new Float32Array(points.flatMap((p) => [p.x, p.y, p.z]));
    this.attributes.position = { array: this.values, itemSize: 3 };
    return this;
  }
  computeVertexNormals() {
    this.attributes.normal = new Float32BufferAttribute(new Float32Array(this.values.length));
  }
  dispose() { this.disposed = true; }
}
class EdgesGeometry extends BufferGeometry {}

class Material {
  constructor(opts = {}) { Object.assign(this, opts); }
}
class MeshStandardMaterial extends Material {}
class LineBasicMaterial extends Material {}

class Object3D {
  constructor() {
    this.children = [];
    this.userData = {};
    this.position = new Vector3();
    this.rotation = { x: 0, y: 0, z: 0 };
  }
  add(child) { this.children.push(child); }
  remove(child) {
    const i = this.children.indexOf(child);
    if (i >= 0) this.children.splice(i, 1);
  }
}
class Group extends Object3D {
  clear() { this.children.length = 0; }
}
class Mesh extends Object3D {
  constructor(geometry, material) { super(); this.geometry = geometry; this.material = material; }
}
class Line extends Object3D {
  constructor(geometry, material) { super(); this.geometry = geometry; this.material = material; }
}
class LineSegments extends Line {}
class GridHelper extends Line {}

class Color { constructor(v) { this.value = v; } }
class Light extends Object3D {
  constructor() { super(); }
}
class AmbientLight extends Light {
  constructor() { super(); }
}
class DirectionalLight extends Light {
  constructor() { super(); }
}
class Scene extends Object3D {
  constructor() { super(); this.background = null; }
}
class PerspectiveCamera extends Object3D {
  constructor(fov, aspect, near, far) {
    super();
    this.fov = fov; this.aspect = aspect; this.near = near; this.far = far;
  }
  lookAt() {}
  updateProjectionMatrix() {}
}
class Raycaster {
  setFromCamera() {}
  intersectObjects(objects) {
    return objects.length ? [{ object: objects[0] }] : [];
  }
}

const domListeners = Symbol('listeners');
function makeDomElement() {
  return {
    [domListeners]: new Map(),
    style: {},
    addEventListener(type, fn) { this[domListeners].set(type, fn); },
    setPointerCapture() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: 640, height: 480 }; },
    dispatch(type, event) { this[domListeners].get(type)?.(event); },
  };
}
class WebGLRenderer {
  constructor() { this.domElement = makeDomElement(); this.renderCount = 0; }
  setPixelRatio() {}
  setSize(w, h) { this.width = w; this.height = h; }
  render() { this.renderCount += 1; }
}

export const THREE_STUB = {
  Vector2, Vector3, Box3, Float32BufferAttribute, BufferGeometry,
  EdgesGeometry, MeshStandardMaterial, LineBasicMaterial,
  Group, Mesh, Line, LineSegments, GridHelper, Color,
  AmbientLight, DirectionalLight, Scene, PerspectiveCamera,
  Raycaster, WebGLRenderer,
  MathUtils: { clamp: (v, lo, hi) => Math.min(hi, Math.max(lo, v)) },
};

export function makeContainer() {
  const listeners = new Map();
  return {
    clientWidth: 640,
    clientHeight: 480,
    children: [],
    appendChild(el) { this.children.push(el); },
    addEventListener(type, fn) { listeners.set(type, fn); },
    dispatch(type, event) { listeners.get(type)?.(event); },
  };
}
