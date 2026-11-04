// Trajectory planning for PTP / LIN / CIRC. Produces joint-space samples along the path
// plus a duration; the player maps time -> path parameter with a trapezoidal profile.
import { forward, inverse, ROBOT, limitViolation } from './kinematics.js';
import {
  compose, invert, poseToFrame, frameToPose, matToQuat, quatToMat, slerp, quatAngle,
  sub, add, scale, dot, cross, norm, lerp, RAD, DEG,
} from './math.js';

export class MotionError extends Error {
  constructor(msg, hint) { super(msg); this.hint = hint; }
}

const CART = ['X', 'Y', 'Z', 'A', 'B', 'C'];
const AXES = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6'];

export function tcpWorld(q, tool, robot = ROBOT) {
  return compose(forward(q, robot), poseToFrame(tool));
}

// Current TCP pose expressed in the given base with the given tool
export function poseInBase(q, tool, base, robot = ROBOT) {
  return frameToPose(compose(invert(poseToFrame(base)), tcpWorld(q, tool, robot)));
}

function flangeForTcp(tcpWorldFrame, tool) {
  return compose(tcpWorldFrame, invert(poseToFrame(tool)));
}

function profile(T, ta) {
  ta = Math.min(ta, T / 2);
  const vmax = 1 / (T - ta);
  const a = vmax / ta;
  return (t) => {
    if (t <= 0) return 0;
    if (t >= T) return 1;
    if (t < ta) return 0.5 * a * t * t;
    if (t > T - ta) { const r = T - t; return 1 - 0.5 * a * r * r; }
    return 0.5 * a * ta * ta + vmax * (t - ta);
  };
}

function axisName(i) { return `A${i + 1}`; }

function checkLimits(q, what) {
  const i = limitViolation(q);
  if (i >= 0) {
    const [lo, hi] = ROBOT.limits[i];
    throw new MotionError(`${what}: ${axisName(i)} oxu hədddən kənardır (${q[i].toFixed(1)}°, icazə: ${lo}..${hi}°)`,
      'Nöqtəni robotun iş zonasına yaxınlaşdırın və ya başqa oriyentasiya seçin');
  }
}

function resolveCartTarget(ev, q0) {
  const cur = poseInBase(q0, ev.tool, ev.base);
  const t = {};
  for (const k of CART) {
    if (ev.rel) t[k] = cur[k] + (ev.target[k] ?? 0);
    else t[k] = ev.target[k] ?? cur[k];
  }
  return t;
}

function tcpWorldFromPose(pose, base) {
  return compose(poseToFrame(base), poseToFrame(pose));
}

/**
 * Plan a motion event from the interpreter.
 * @returns {{samples:number[][], duration:number, s:(t)=>number, path:number[][], kind:string}}
 */
export function plan(ev, q0) {
  const ov = Math.max(1, Math.min(100, ev.ovPro ?? 100)) / 100;
  if (ev.kind === 'PTP') return planPTP(ev, q0, ov);
  if (ev.kind === 'LIN') return planLIN(ev, q0, ov);
  if (ev.kind === 'CIRC') return planCIRC(ev, q0, ov);
  throw new MotionError(`Naməlum hərəkət: ${ev.kind}`);
}

function planPTP(ev, q0, ov) {
  let q1;
  if (ev.targetKind === 'axis') {
    q1 = AXES.map((k, i) => (ev.rel ? q0[i] + (ev.target[k] ?? 0) : (ev.target[k] ?? q0[i])));
    checkLimits(q1, 'PTP');
  } else {
    const pose = resolveCartTarget(ev, q0);
    const flange = flangeForTcp(tcpWorldFromPose(pose, ev.base), ev.tool);
    q1 = inverse(flange, q0);
    if (!q1) {
      throw new MotionError(`PTP: nöqtə əlçatan deyil {X ${pose.X.toFixed(1)}, Y ${pose.Y.toFixed(1)}, Z ${pose.Z.toFixed(1)}}`,
        'Robotun çatma radiusu təxminən 950 mm-dir. Nöqtəni bazaya yaxınlaşdırın');
    }
  }
  let Tc = 0;
  for (let i = 0; i < 6; i++) {
    const v = ROBOT.maxSpeed[i] * Math.max(1, ev.velAxis?.[i] ?? 100) / 100 * ov;
    Tc = Math.max(Tc, Math.abs(q1[i] - q0[i]) / v);
  }
  const ta = 0.25 / Math.sqrt(ov);
  const T = Tc < 1e-6 ? 0 : Tc + ta;
  const path = [];
  for (let k = 0; k <= 40; k++) {
    const s = k / 40;
    path.push(tcpWorld(q0.map((v, i) => v + (q1[i] - v) * s), ev.tool).p);
  }
  return { kind: 'PTP', samples: [q0.slice(), q1], duration: T, s: T ? profile(T, ta) : () => 1, path };
}

function cartesianSamples(ev, q0, posFn, oriFn, N, ov, lengthMm, angleRad, label) {
  const samples = [q0.slice()];
  const path = [tcpWorld(q0, ev.tool).p];
  let q = q0;
  let tNeeded = 0;
  for (let k = 1; k <= N; k++) {
    const s = k / N;
    const tcp = { R: oriFn(s), p: posFn(s) };
    const flange = flangeForTcp(tcp, ev.tool);
    const qn = inverse(flange, q);
    if (!qn) {
      throw new MotionError(`${label}: yolun ${(s * 100).toFixed(0)}%-də nöqtə əlçatan deyil`,
        'Düz xətt robotun iş zonasından çıxır. PTP ilə keçin və ya nöqtələri dəyişin');
    }
    let seg = 0;
    for (let i = 0; i < 6; i++) {
      const dq = Math.abs(qn[i] - q[i]);
      if (dq > 25) {
        throw new MotionError(`${label}: ${axisName(i)} oxunda sinqulyarlıq (ani ${dq.toFixed(0)}° sıçrayış)`,
          'Bu yol sinqulyar nöqtədən keçir (məs. A5 ≈ 0°). LIN əvəzinə PTP istifadə edin və ya oriyentasiyanı dəyişin');
      }
      seg = Math.max(seg, dq / (ROBOT.maxSpeed[i] * ov));
    }
    tNeeded += seg;
    samples.push(qn);
    path.push(tcp.p);
    q = qn;
  }
  const vcp = Math.max(0.001, ev.velCP ?? 2) * 1000 * ov; // mm/s
  const vori = Math.max(1, ev.velOri ?? 200) * ov;          // deg/s
  const Tc = Math.max(lengthMm / Math.min(vcp, ROBOT.maxCartSpeed), angleRad * RAD / vori, tNeeded);
  const ta = 0.2 / Math.sqrt(ov);
  const T = Tc < 1e-6 ? 0 : Tc + ta;
  return { samples, path, duration: T, s: T ? profile(T, ta) : () => 1 };
}

function planLIN(ev, q0, ov) {
  const start = tcpWorld(q0, ev.tool);
  const pose = resolveCartTarget(ev, q0);
  const end = tcpWorldFromPose(pose, ev.base);
  const qa = matToQuat(start.R), qb = matToQuat(end.R);
  const L = norm(sub(end.p, start.p));
  const ang = quatAngle(qa, qb);
  const N = Math.max(2, Math.ceil(L / 3), Math.ceil(ang * RAD / 1.5));
  const r = cartesianSamples(ev, q0, (s) => lerp(start.p, end.p, s), (s) => quatToMat(slerp(qa, qb, s)), N, ov, L, ang, 'LIN');
  return { kind: 'LIN', ...r };
}

function planCIRC(ev, q0, ov) {
  const start = tcpWorld(q0, ev.tool);
  const cur = poseInBase(q0, ev.tool, ev.base);
  const fill = (t) => {
    const o = {};
    for (const k of CART) o[k] = ev.rel ? cur[k] + (t[k] ?? 0) : (t[k] ?? cur[k]);
    return o;
  };
  const auxW = tcpWorldFromPose(fill(ev.aux), ev.base);
  const endW = tcpWorldFromPose(fill(ev.target), ev.base);
  const A = start.p, B = auxW.p, C = endW.p;
  const a = sub(A, C), b = sub(B, C);
  const axb = cross(a, b);
  const den = 2 * dot(axb, axb);
  if (norm(sub(A, B)) < 1 || norm(sub(B, C)) < 1 || norm(sub(A, C)) < 1) {
    throw new MotionError('CIRC: başlanğıc, köməkçi və son nöqtə bir-birindən fərqli olmalıdır');
  }
  if (den < 1e-6 * Math.pow(norm(a) * norm(b), 2) || den < 1e-9) {
    throw new MotionError('CIRC: üç nöqtə bir düz xətt üzərindədir, dairə qurmaq olmur', 'Köməkçi nöqtəni xəttdən kənara çəkin');
  }
  const O = add(C, scale(cross(sub(scale(b, dot(a, a)), scale(a, dot(b, b))), axb), 1 / den));
  const R = norm(sub(A, O));
  const u = scale(sub(A, O), 1 / R);
  const nrm = cross(sub(B, A), sub(C, A));
  const n = scale(nrm, 1 / norm(nrm));
  const v = cross(n, u);
  const angOf = (P) => { const d = sub(P, O); let t = Math.atan2(dot(d, v), dot(d, u)); if (t < 0) t += 2 * Math.PI; return t; };
  let sweep = angOf(C);
  if (ev.ca !== null && ev.ca !== undefined) sweep = ev.ca * DEG;
  const qa = matToQuat(start.R), qb = matToQuat(endW.R);
  const posFn = (s) => {
    const t = sweep * s;
    return add(O, add(scale(u, R * Math.cos(t)), scale(v, R * Math.sin(t))));
  };
  const L = Math.abs(sweep) * R;
  const ang = quatAngle(qa, qb);
  const N = Math.max(8, Math.ceil(L / 3), Math.ceil(ang * RAD / 1.5));
  const r = cartesianSamples(ev, q0, posFn, (s) => quatToMat(slerp(qa, qb, s)), N, ov, L, ang, 'CIRC');
  return { kind: 'CIRC', ...r, circle: { O, R } };
}

// Joint vector at time t of a planned motion
export function sampleAt(m, t) {
  const s = m.s(t);
  const n = m.samples.length - 1;
  const x = s * n;
  const i = Math.min(n - 1, Math.floor(x));
  const f = x - i;
  const a = m.samples[i], b = m.samples[i + 1];
  return a.map((v, k) => v + (b[k] - v) * f);
}
