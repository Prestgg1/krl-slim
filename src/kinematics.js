// Generic 6-axis industrial arm with a spherical wrist.
// The axis directions follow the usual KUKA convention (A1 about -Z, A2/A3 about Y,
// A4/A6 about -X, A5 about Y) so that HOME {A1 0, A2 -90, A3 90, A4 0, A5 0, A6 0}
// gives the familiar "upper arm up, forearm forward" pose. Dimensions are generic.
import {
  DEG, RAD, rotX, rotY, rotZ, matMul, compose, transpose, identity,
} from './math.js';

export const ROBOT = {
  name: 'Generic 6-axis (6 kg)',
  d1: 400,   // base to shoulder height
  a1: 25,    // shoulder forward offset
  a2: 455,   // upper arm
  a3: 35,    // elbow offset
  d4: 420,   // forearm (elbow to wrist centre)
  d6: 80,    // wrist centre to flange
  limits: [[-170, 170], [-190, 45], [-120, 156], [-185, 185], [-120, 120], [-350, 350]],
  maxSpeed: [360, 300, 360, 380, 390, 615], // deg/s at 100 %
  maxCartSpeed: 2000, // mm/s
};

export const HOME = [0, -90, 90, 0, 0, 0];

// Frames of every joint (for drawing) plus the flange frame.
export function forwardAll(q, robot = ROBOT) {
  const [q1, q2, q3, q4, q5, q6] = q.map((v) => v * DEG);
  const frames = [];
  let F = identity();
  F = { R: rotZ(-q1), p: [0, 0, 0] };
  frames.push(F); // after A1
  F = compose(F, { R: rotY(q2), p: [robot.a1, 0, robot.d1] });
  frames.push(F); // after A2
  F = compose(F, { R: rotY(q3), p: [robot.a2, 0, 0] });
  frames.push(F); // after A3
  F = compose(F, { R: rotX(-q4), p: [0, 0, robot.a3] });
  frames.push(F); // after A4
  F = compose(F, { R: rotY(q5), p: [robot.d4, 0, 0] });
  frames.push(F); // after A5 (wrist centre)
  F = compose(F, { R: rotX(-q6), p: [0, 0, 0] });
  frames.push(F); // after A6
  const flange = compose(F, { R: identity().R, p: [robot.d6, 0, 0] });
  return { frames, flange };
}

export function forward(q, robot = ROBOT) {
  return forwardAll(q, robot).flange;
}

export function withinLimits(q, robot = ROBOT, tol = 1e-6) {
  return q.every((v, i) => v >= robot.limits[i][0] - tol && v <= robot.limits[i][1] + tol);
}

export function limitViolation(q, robot = ROBOT) {
  for (let i = 0; i < 6; i++) {
    if (q[i] < robot.limits[i][0] - 1e-6 || q[i] > robot.limits[i][1] + 1e-6) return i;
  }
  return -1;
}

// Shift angle by multiples of 360 to be closest to ref, staying within limits if possible.
function nearestWrap(v, ref, lim) {
  let best = null;
  for (let k = -2; k <= 2; k++) {
    const c = v + 360 * k;
    if (c < lim[0] - 1e-6 || c > lim[1] + 1e-6) continue;
    if (best === null || Math.abs(c - ref) < Math.abs(best - ref)) best = c;
  }
  return best;
}

const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Analytic inverse kinematics for a flange frame (base coordinates).
 * Returns the in-limit solution closest to `seed`, or null if unreachable.
 */
export function inverse(flange, seed = HOME, robot = ROBOT) {
  const sols = inverseAll(flange, seed, robot);
  if (!sols.length) return null;
  const w = [1.5, 1.5, 1.2, 0.6, 0.8, 0.4];
  let best = null, bestD = Infinity;
  for (const s of sols) {
    let d = 0;
    for (let i = 0; i < 6; i++) d += w[i] * Math.abs(s[i] - seed[i]);
    if (d < bestD) { bestD = d; best = s; }
  }
  return best;
}

export function inverseAll(flange, seed = HOME, robot = ROBOT) {
  const { R, p } = flange;
  const { a1, d1, a2, a3, d4, d6 } = robot;
  const pw = [p[0] - d6 * R[0][0], p[1] - d6 * R[1][0], p[2] - d6 * R[2][0]];
  const out = [];
  const rxy = Math.hypot(pw[0], pw[1]);
  const phi = rxy < 1e-6 ? -seed[1 - 1] * DEG : Math.atan2(pw[1], pw[0]);
  const L3 = Math.hypot(d4, a3);
  const delta = Math.atan2(a3, d4);

  // Front (r = rxy) and overhead (r = -rxy, A1 turned by 180) shoulder solutions.
  for (const shoulder of [1, -1]) {
    const q1r = shoulder === 1 ? -phi : -phi + Math.PI;
    const r = shoulder * rxy - a1;
    const z = pw[2] - d1;
    const D2 = r * r + z * z;
    const c = (D2 - a2 * a2 - L3 * L3) / (2 * a2 * L3);
    if (c > 1 + 1e-9 || c < -1 - 1e-9) continue;
    const acs = Math.acos(Math.max(-1, Math.min(1, c)));
    for (const elbow of [-1, 1]) {
      const rel = elbow * acs;
      const e2 = Math.atan2(z, r) - Math.atan2(L3 * Math.sin(rel), a2 + L3 * Math.cos(rel));
      const q2r = -e2;
      const q3r = delta - rel;
      // Wrist
      const R03 = matMul(rotZ(-q1r), rotY(q2r + q3r));
      const M = matMul(transpose(R03), R);
      const cb = Math.max(-1, Math.min(1, M[0][0]));
      const beta = Math.acos(cb);
      const wristSols = [];
      if (Math.abs(Math.sin(beta)) < 1e-6) {
        // Singular: only alpha + gamma (or alpha - gamma) is defined. Keep A4 at the seed.
        const sum = Math.atan2(M[2][1], M[1][1]);
        const alpha = -seed[3] * DEG;
        const b = cb > 0 ? 0 : Math.PI;
        const gamma = cb > 0 ? sum - alpha : alpha - sum;
        wristSols.push([alpha, b, gamma]);
      } else {
        const alpha = Math.atan2(M[1][0], -M[2][0]);
        const gamma = Math.atan2(M[0][1], M[0][2]);
        wristSols.push([alpha, beta, gamma]);
        wristSols.push([alpha + Math.PI, -beta, gamma + Math.PI]);
      }
      for (const [al, be, ga] of wristSols) {
        const raw = [q1r, q2r, q3r, -al, be, -ga].map((v) => wrapPi(v) * RAD);
        const q = [];
        let ok = true;
        for (let i = 0; i < 6; i++) {
          const v = nearestWrap(raw[i], seed[i], robot.limits[i]);
          if (v === null) { ok = false; break; }
          q.push(v);
        }
        if (ok) out.push(q);
      }
    }
  }
  return out;
}
