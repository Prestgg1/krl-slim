// Small rigid-body math helpers. Units: mm and degrees at the API boundary.
// A frame is { R: [[...],[...],[...]], p: [x, y, z] } (rotation rows, position).

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;

export function matMul(A, B) {
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      C[i][j] = A[i][0] * B[0][j] + A[i][1] * B[1][j] + A[i][2] * B[2][j];
  return C;
}

export function matVec(A, v) {
  return [
    A[0][0] * v[0] + A[0][1] * v[1] + A[0][2] * v[2],
    A[1][0] * v[0] + A[1][1] * v[1] + A[1][2] * v[2],
    A[2][0] * v[0] + A[2][1] * v[1] + A[2][2] * v[2],
  ];
}

export function transpose(A) {
  return [[A[0][0], A[1][0], A[2][0]], [A[0][1], A[1][1], A[2][1]], [A[0][2], A[1][2], A[2][2]]];
}

export const rotX = (a) => { const c = Math.cos(a), s = Math.sin(a); return [[1, 0, 0], [0, c, -s], [0, s, c]]; };
export const rotY = (a) => { const c = Math.cos(a), s = Math.sin(a); return [[c, 0, s], [0, 1, 0], [-s, 0, c]]; };
export const rotZ = (a) => { const c = Math.cos(a), s = Math.sin(a); return [[c, -s, 0], [s, c, 0], [0, 0, 1]]; };

export const identity = () => ({ R: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], p: [0, 0, 0] });

export function compose(F, G) {
  const Rp = matVec(F.R, G.p);
  return { R: matMul(F.R, G.R), p: [F.p[0] + Rp[0], F.p[1] + Rp[1], F.p[2] + Rp[2]] };
}

export function invert(F) {
  const Rt = transpose(F.R);
  const p = matVec(Rt, F.p);
  return { R: Rt, p: [-p[0], -p[1], -p[2]] };
}

// KUKA convention: A about Z, B about Y, C about X, applied as Rz(A)*Ry(B)*Rx(C).
export function eulerToMat(A, B, C) {
  return matMul(rotZ(A * DEG), matMul(rotY(B * DEG), rotX(C * DEG)));
}

export function matToEuler(R) {
  const sb = -R[2][0];
  let A, B, C;
  if (Math.abs(sb) < 0.999999) {
    B = Math.asin(sb);
    A = Math.atan2(R[1][0], R[0][0]);
    C = Math.atan2(R[2][1], R[2][2]);
  } else {
    // Gimbal lock: B = +-90. Put all rotation into A, set C = 0.
    B = sb > 0 ? Math.PI / 2 : -Math.PI / 2;
    C = 0;
    A = Math.atan2(-R[0][1], R[1][1]);
  }
  return { A: A * RAD, B: B * RAD, C: C * RAD };
}

export function poseToFrame(pose) {
  return { R: eulerToMat(pose.A || 0, pose.B || 0, pose.C || 0), p: [pose.X || 0, pose.Y || 0, pose.Z || 0] };
}

export function frameToPose(F) {
  const e = matToEuler(F.R);
  return { X: F.p[0], Y: F.p[1], Z: F.p[2], A: e.A, B: e.B, C: e.C };
}

// Rotation error as an axis-angle vector (radians) taking Ra to Rb, in base coords.
export function rotError(Ra, Rb) {
  const E = matMul(Rb, transpose(Ra));
  const tr = E[0][0] + E[1][1] + E[2][2];
  const cosT = Math.max(-1, Math.min(1, (tr - 1) / 2));
  const theta = Math.acos(cosT);
  const v = [E[2][1] - E[1][2], E[0][2] - E[2][0], E[1][0] - E[0][1]];
  if (theta < 1e-9) return [v[0] / 2, v[1] / 2, v[2] / 2];
  if (Math.PI - theta < 1e-4) {
    // Near 180 deg: extract axis from the symmetric part.
    const x = Math.sqrt(Math.max(0, (E[0][0] + 1) / 2));
    const y = Math.sqrt(Math.max(0, (E[1][1] + 1) / 2)) * (E[0][1] + E[1][0] >= 0 ? 1 : -1);
    const z = Math.sqrt(Math.max(0, (E[2][2] + 1) / 2)) * (E[0][2] + E[2][0] >= 0 ? 1 : -1);
    return [x * theta, y * theta, z * theta];
  }
  const k = theta / (2 * Math.sin(theta));
  return [v[0] * k, v[1] * k, v[2] * k];
}

// Quaternions [w, x, y, z]
export function matToQuat(R) {
  const tr = R[0][0] + R[1][1] + R[2][2];
  let w, x, y, z;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    w = s / 4; x = (R[2][1] - R[1][2]) / s; y = (R[0][2] - R[2][0]) / s; z = (R[1][0] - R[0][1]) / s;
  } else if (R[0][0] > R[1][1] && R[0][0] > R[2][2]) {
    const s = Math.sqrt(1 + R[0][0] - R[1][1] - R[2][2]) * 2;
    w = (R[2][1] - R[1][2]) / s; x = s / 4; y = (R[0][1] + R[1][0]) / s; z = (R[0][2] + R[2][0]) / s;
  } else if (R[1][1] > R[2][2]) {
    const s = Math.sqrt(1 + R[1][1] - R[0][0] - R[2][2]) * 2;
    w = (R[0][2] - R[2][0]) / s; x = (R[0][1] + R[1][0]) / s; y = s / 4; z = (R[1][2] + R[2][1]) / s;
  } else {
    const s = Math.sqrt(1 + R[2][2] - R[0][0] - R[1][1]) * 2;
    w = (R[1][0] - R[0][1]) / s; x = (R[0][2] + R[2][0]) / s; y = (R[1][2] + R[2][1]) / s; z = s / 4;
  }
  return [w, x, y, z];
}

export function quatToMat([w, x, y, z]) {
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
    [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
    [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
  ];
}

export function slerp(a, b, t) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  if (d < 0) { b = b.map((v) => -v); d = -d; }
  if (d > 0.9995) {
    const r = a.map((v, i) => v + t * (b[i] - v));
    const n = Math.hypot(...r);
    return r.map((v) => v / n);
  }
  const th = Math.acos(d), s = Math.sin(th);
  const wa = Math.sin((1 - t) * th) / s, wb = Math.sin(t * th) / s;
  return a.map((v, i) => wa * v + wb * b[i]);
}

export function quatAngle(a, b) {
  const d = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
  return 2 * Math.acos(Math.min(1, d));
}

export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm = (a) => Math.hypot(a[0], a[1], a[2]);
export const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// Solve a linear system A x = b (n x n) with Gaussian elimination and partial pivoting.
export function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    const d = M[c][c];
    if (Math.abs(d) < 1e-14) return null;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / d;
      if (f === 0) continue;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}
