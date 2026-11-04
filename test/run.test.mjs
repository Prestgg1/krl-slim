import { Runner } from '../src/runner.js';
import { poseInBase } from '../src/motion.js';
import assert from 'node:assert';
const logs=[]; let err=null;
const r = new Runner({ onLog:(m)=>logs.push(m), onError:(e,l)=>{err=[e.message,l, e.hint]} });
const ms = r.runHeadless(`
DEF main()
  DECL E6POS p1, p2, p3
  BAS(#INITMOV, 0)
  $VEL.CP = 0.5
  PTP HOME
  p1 = {X 600, Y -200, Z 400, A 0, B 90, C 0}
  PTP p1
  p2 = p1
  p2.Y = 200
  LIN p2
  LIN_REL {Z 150}
  CIRC {X 700, Y 0, Z 550}, {X 600, Y -200, Z 550}
  $TOOL = {X 0, Y 0, Z 150, A 0, B 0, C 0}
  LIN {X 600, Y 0, Z 300, A 0, B 90, C 0}
  PTP_REL {A1 30}
  PTP HOME
END`);
console.log(err, logs);
assert.equal(err, null);
for (const {m, ev} of ms) console.log(ev.cmd, m.duration.toFixed(2)+'s', m.samples.length, m.samples.at(-1).map(v=>v.toFixed(1)).join(' '));
// final pose check of a LIN w/ tool
const lin = ms[5];
const pz = poseInBase(lin.m.samples.at(-1), lin.ev.tool, lin.ev.base);
console.log(pz); assert(Math.abs(pz.Z-300)<1e-6 && Math.abs(pz.X-600)<1e-6);
// unreachable
err=null; r.runHeadless(`DEF m()\n PTP {X 3000, Y 0, Z 0, A 0, B 90, C 0}\nEND`); console.log(err); assert(err);
err=null; r.runHeadless(`DEF m()\n PTP {A1 0,A2 -90,A3 90,A4 0,A5 0,A6 0}\n LIN {X 525, Y 0, Z 890, A 0, B 0, C 0}\n PTP {A2 -200}\nEND`); console.log(err); assert(err);
console.log('run ok');
