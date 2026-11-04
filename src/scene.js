// Three.js scene: a generic 6-axis arm built from primitives, a work cell with a table and
// parts, a two-finger gripper, and the TCP path trace. World units are millimetres, Z up.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ROBOT } from './kinematics.js';
import { DEG } from './math.js';

const GRIPPER_LEN = 120; // flange -> finger tips; matches TOOL_DATA[1]

export class RobotScene {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, 10, 40000);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(2300, -1700, 1500);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(350, 0, 450);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.update();

    this.buildLights();
    this.buildFloor();
    this.buildRobot();
    this.buildCell();
    this.paths = new THREE.Group();
    this.scene.add(this.paths);
    this.gripClosed = false;
    this.fingerOpen = 1;
    this.held = null;

    this.setTheme(false);
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(container);
    this.resize();
  }

  setTheme(dark) {
    this.dark = dark;
    const bg = dark ? 0x14181d : 0xe9ecef;
    this.scene.background = new THREE.Color(bg);
    this.scene.fog = new THREE.Fog(bg, 6000, 14000);
    this.grid.material.color = new THREE.Color(dark ? 0x2b3138 : 0xc8cdd3);
    this.floor.material.color = new THREE.Color(dark ? 0x1a1f25 : 0xf3f5f7);
  }

  buildLights() {
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 0.9));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(1500, -1200, 3000);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const c = sun.shadow.camera;
    c.left = -1500; c.right = 1500; c.top = 1500; c.bottom = -1500; c.near = 100; c.far = 8000;
    this.scene.add(sun);
  }

  buildFloor() {
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(12000, 12000), new THREE.MeshStandardMaterial({ color: 0xf3f5f7, roughness: 1 }));
    floor.receiveShadow = true;
    floor.position.z = -1;
    this.floor = floor;
    this.scene.add(floor);
    const grid = new THREE.GridHelper(6000, 60, 0xc8cdd3, 0xc8cdd3);
    grid.rotation.x = Math.PI / 2;
    grid.material.transparent = true;
    grid.material.opacity = 0.7;
    this.grid = grid;
    this.scene.add(grid);
    const axes = makeAxes(300, 6);
    axes.position.z = 1;
    this.scene.add(axes);
  }

  buildRobot() {
    const R = ROBOT;
    const body = new THREE.MeshStandardMaterial({ color: 0xd9dde2, roughness: 0.45, metalness: 0.15 });
    const accent = new THREE.MeshStandardMaterial({ color: 0x2f6f9f, roughness: 0.5, metalness: 0.2 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a2e33, roughness: 0.6, metalness: 0.3 });
    this.materials = { body, accent, dark };
    const mesh = (geo, mat) => { const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true; return m; };
    const cylZ = (r, h, mat, seg = 40) => { const m = mesh(new THREE.CylinderGeometry(r, r, h, seg), mat); m.rotation.x = Math.PI / 2; return m; };
    const cylY = (r, h, mat, seg = 40) => mesh(new THREE.CylinderGeometry(r, r, h, seg), mat);
    const cylX = (r, h, mat, seg = 40) => { const m = mesh(new THREE.CylinderGeometry(r, r, h, seg), mat); m.rotation.z = Math.PI / 2; return m; };
    const box = (x, y, z, mat) => mesh(new THREE.BoxGeometry(x, y, z), mat);

    this.root = new THREE.Group();
    this.scene.add(this.root);
    // Fixed base
    const base = cylZ(150, 120, dark); base.position.z = 60; this.root.add(base);
    const base2 = cylZ(125, 60, body); base2.position.z = 150; this.root.add(base2);

    // A1: turret
    this.j = [];
    const l1 = new THREE.Group(); this.root.add(l1); this.j.push(l1);
    const turret = cylZ(115, 140, body); turret.position.z = 250; l1.add(turret);
    const shoulder = box(170, 150, 210, body); shoulder.position.set(R.a1 * 0.6, -55, R.d1 - 40); l1.add(shoulder);
    const motor1 = cylZ(45, 90, dark); motor1.position.set(-110, 60, 260); l1.add(motor1);

    // A2: upper arm
    const l2 = new THREE.Group(); l2.position.set(R.a1, 0, R.d1); l1.add(l2); this.j.push(l2);
    const hub2 = cylY(88, 70, accent); hub2.position.y = -150; l2.add(hub2);
    const ua = box(R.a2 + 40, 78, 120, body); ua.position.set(R.a2 / 2, -150, 0); l2.add(ua);
    const motor2 = cylY(48, 90, dark); motor2.position.set(0, -235, 0); l2.add(motor2);

    // A3: elbow
    const l3 = new THREE.Group(); l3.position.set(R.a2, 0, 0); l2.add(l3); this.j.push(l3);
    const hub3 = cylY(78, 70, accent); hub3.position.y = -150; l3.add(hub3);
    const elbow = box(160, 220, 150, body); elbow.position.set(-10, -60, R.a3); l3.add(elbow);
    const motor3 = cylX(42, 120, dark); motor3.position.set(-130, -40, R.a3 + 20); l3.add(motor3);

    // A4: forearm roll
    const l4 = new THREE.Group(); l4.position.set(0, 0, R.a3); l3.add(l4); this.j.push(l4);
    const fa = cylX(52, R.d4 - 110, body); fa.position.x = (R.d4 - 110) / 2 + 60; l4.add(fa);
    const ring = cylX(56, 18, accent); ring.position.x = 90; l4.add(ring);
    const fork = box(70, 120, 90, body); fork.position.set(R.d4 - 40, 0, 0); l4.add(fork);

    // A5: wrist pitch
    const l5 = new THREE.Group(); l5.position.set(R.d4, 0, 0); l4.add(l5); this.j.push(l5);
    const hub5 = cylY(42, 112, accent); l5.add(hub5);
    const wrist = cylX(36, R.d6 - 20, body); wrist.position.x = (R.d6 - 20) / 2 + 10; l5.add(wrist);

    // A6: flange
    const l6 = new THREE.Group(); l5.add(l6); this.j.push(l6);
    const flange = cylX(32, 12, dark); flange.position.x = R.d6 - 6; l6.add(flange);
    this.flange = new THREE.Group(); this.flange.position.x = R.d6; l6.add(this.flange);

    // Gripper (tool direction = +X of flange, KUKA style)
    const g = new THREE.Group();
    const gbody = box(50, 90, 50, dark); gbody.position.x = 25; g.add(gbody);
    const fmat = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.4, metalness: 0.5 });
    this.fingers = [box(GRIPPER_LEN - 40, 12, 30, fmat), box(GRIPPER_LEN - 40, 12, 30, fmat)];
    for (const f of this.fingers) { f.position.x = 50 + (GRIPPER_LEN - 50) / 2; g.add(f); }
    this.gripper = g;
    this.flange.add(g);
    this.updateFingers();

    this.tcpMarker = makeAxes(70, 3);
    this.scene.add(this.tcpMarker);
  }

  buildCell() {
    this.cell = new THREE.Group();
    this.scene.add(this.cell);
    const top = new THREE.MeshStandardMaterial({ color: 0x7c8794, roughness: 0.8 });
    const leg = new THREE.MeshStandardMaterial({ color: 0x3a4148, roughness: 0.7 });
    // Table: x 450..850, y -450..450, top at z = 300
    this.table = { x0: 450, x1: 850, y0: -450, y1: 450, z: 300 };
    const t = this.table;
    const slab = new THREE.Mesh(new THREE.BoxGeometry(t.x1 - t.x0, t.y1 - t.y0, 30), top);
    slab.position.set((t.x0 + t.x1) / 2, 0, t.z - 15); slab.castShadow = slab.receiveShadow = true;
    this.cell.add(slab);
    for (const [x, y] of [[t.x0 + 30, t.y0 + 30], [t.x1 - 30, t.y0 + 30], [t.x0 + 30, t.y1 - 30], [t.x1 - 30, t.y1 - 30]]) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(40, 40, t.z - 30), leg);
      l.position.set(x, y, (t.z - 30) / 2); l.castShadow = true;
      this.cell.add(l);
    }
    // Place marks
    const markMat = new THREE.MeshBasicMaterial({ color: 0xe0b100 });
    for (const y of [-200, 0, 200]) {
      const ringM = new THREE.Mesh(new THREE.RingGeometry(34, 40, 4, 1), markMat);
      ringM.rotation.z = Math.PI / 4;
      ringM.position.set(750, y, t.z + 0.5);
      this.cell.add(ringM);
    }
    this.parts = [];
    this.resetParts();
  }

  resetParts() {
    for (const p of this.parts) p.mesh.parent.remove(p.mesh);
    this.parts = [];
    const colors = [0xd9534f, 0x3c8dbc, 0x5cb85c];
    [-200, 0, 200].forEach((y, i) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(50, 50, 50), new THREE.MeshStandardMaterial({ color: colors[i], roughness: 0.5 }));
      m.castShadow = m.receiveShadow = true;
      m.position.set(600, y, this.table.z + 25);
      this.scene.add(m);
      this.parts.push({ mesh: m, fallV: 0 });
    });
    this.held = null;
  }

  updateFingers() {
    const gap = this.gripClosed ? 26 : 44;
    this.fingers[0].position.y = gap;
    this.fingers[1].position.y = -gap;
  }

  setJoints(q) {
    const [q1, q2, q3, q4, q5, q6] = q.map((v) => v * DEG);
    this.j[0].rotation.set(0, 0, -q1);
    this.j[1].rotation.set(0, q2, 0);
    this.j[2].rotation.set(0, q3, 0);
    this.j[3].rotation.set(-q4, 0, 0);
    this.j[4].rotation.set(0, q5, 0);
    this.j[5].rotation.set(-q6, 0, 0);
    this.root.updateMatrixWorld(true);
  }

  setTcpMarker(frame) {
    const m = new THREE.Matrix4();
    const R = frame.R;
    m.set(R[0][0], R[0][1], R[0][2], frame.p[0], R[1][0], R[1][1], R[1][2], frame.p[1], R[2][0], R[2][1], R[2][2], frame.p[2], 0, 0, 0, 1);
    this.tcpMarker.matrixAutoUpdate = false;
    this.tcpMarker.matrix.copy(m);
  }

  // Gripper output changed. Grab a part near the finger tips or release the held one.
  setGripper(closed) {
    this.gripClosed = closed;
    this.updateFingers();
    this.root.updateMatrixWorld(true);
    const tip = new THREE.Vector3(GRIPPER_LEN - 25, 0, 0).applyMatrix4(this.flange.matrixWorld);
    if (closed && !this.held) {
      let best = null, bd = 45;
      for (const p of this.parts) {
        const d = p.mesh.position.distanceTo(tip);
        if (d < bd) { bd = d; best = p; }
      }
      if (best) {
        this.held = best;
        this.flange.attach(best.mesh);
        return 'grab';
      }
      return 'miss';
    }
    if (!closed && this.held) {
      const p = this.held;
      this.scene.attach(p.mesh);
      p.fallV = 0;
      this.held = null;
      return 'release';
    }
    return null;
  }

  // Simple gravity for released parts, so a drop in mid-air is visible to students.
  stepPhysics(dt) {
    for (const p of this.parts) {
      if (p === this.held) continue;
      const pos = p.mesh.position;
      const t = this.table;
      const onTable = pos.x > t.x0 && pos.x < t.x1 && pos.y > t.y0 && pos.y < t.y1 && pos.z >= t.z + 24;
      let support = onTable ? t.z + 25 : 25;
      for (const o of this.parts) {
        if (o === p || o === this.held) continue;
        const q = o.mesh.position;
        if (Math.abs(q.x - pos.x) < 48 && Math.abs(q.y - pos.y) < 48 && q.z < pos.z - 1) support = Math.max(support, q.z + 50);
      }
      if (pos.z > support + 0.01) {
        p.fallV += 9810 * dt;
        pos.z = Math.max(support, pos.z - p.fallV * dt);
        if (pos.z === support) {
          p.fallV = 0;
          // settle upright
          p.mesh.rotation.x = 0; p.mesh.rotation.y = 0;
        }
      }
    }
  }

  clearPaths() {
    for (const c of [...this.paths.children]) { c.geometry.dispose(); this.paths.remove(c); }
  }

  addPath(points, kind) {
    const colors = { PTP: 0x8a96a3, LIN: 0xe0a800, CIRC: 0x2fa37a };
    const geo = new THREE.BufferGeometry().setFromPoints(points.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
    const mat = kind === 'PTP'
      ? new THREE.LineDashedMaterial({ color: colors.PTP, dashSize: 18, gapSize: 12 })
      : new THREE.LineBasicMaterial({ color: colors[kind] || 0xffffff });
    const line = new THREE.Line(geo, mat);
    if (kind === 'PTP') line.computeLineDistances();
    this.paths.add(line);
    while (this.paths.children.length > 300) { const c = this.paths.children[0]; c.geometry.dispose(); this.paths.remove(c); }
  }

  // Flange position from the scene graph (used by tests to check the model matches the kinematics)
  flangeWorld() {
    this.root.updateMatrixWorld(true);
    const v = new THREE.Vector3().setFromMatrixPosition(this.flange.matrixWorld);
    return [v.x, v.y, v.z];
  }

  view(name) {
    const t = this.controls.target;
    t.set(350, 0, 450);
    const views = { iso: [2300, -1700, 1500], front: [2800, 0, 600], top: [351, 0, 3400], side: [350, -2900, 600] };
    this.camera.position.set(...(views[name] || views.iso));
    this.controls.update();
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render() {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}

function makeAxes(len, r) {
  const g = new THREE.Group();
  const mk = (color, rot) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 8), new THREE.MeshBasicMaterial({ color }));
    const holder = new THREE.Group();
    m.position.y = len / 2;
    holder.add(m);
    holder.rotation.set(...rot);
    g.add(holder);
  };
  mk(0xe5484d, [0, 0, -Math.PI / 2]); // X red
  mk(0x30a46c, [0, 0, 0]);            // Y green
  mk(0x3e63dd, [Math.PI / 2, 0, 0]);  // Z blue
  return g;
}
