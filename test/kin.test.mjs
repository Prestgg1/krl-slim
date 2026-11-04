import { forward, inverse, HOME, ROBOT } from '../src/kinematics.js';
import { frameToPose, poseToFrame, rotError, norm, sub } from '../src/math.js';
import assert from 'node:assert';
const f = forward(HOME);
console.log('home', frameToPose(f));
let maxErr = 0, fails = 0;
for (let n = 0; n < 3000; n++) {
  const q = ROBOT.limits.map(([a,b]) => a + Math.random()*(b-a));
  const F = forward(q);
  const s = inverse(F, q);
  if (!s) { fails++; continue; }
  const G = forward(s);
  const e = norm(sub(F.p,G.p)) + norm(rotError(F.R,G.R))*100;
  maxErr = Math.max(maxErr, e);
}
console.log('fails', fails, 'maxErr', maxErr);
assert(maxErr < 1e-6);
// round trip pose
const P = {X:600,Y:100,Z:500,A:30,B:80,C:10};
const s = inverse(poseToFrame(P), HOME);
console.log(s, frameToPose(forward(s)));
