import { Runner } from '../src/runner.js';
import { LESSONS } from '../src/lessons.js';
let bad = 0;
for (const L of LESSONS) {
  let err = null; const logs = [];
  const r = new Runner({ onError: (e, l) => { err = `line ${l}: ${e.message}`; }, onLog: (m) => logs.push(m) });
  r.ins.set(1, true);
  const ms = r.runHeadless(L.code);
  const T = ms.reduce((a, x) => a + x.m.duration, 0);
  console.log(L.id.padEnd(10), err ? 'ERR ' + err : 'ok', ms.length, 'motions', T.toFixed(1) + 's', logs.filter(Boolean).join(' | '));
  if (err) bad++;
}
process.exit(bad ? 1 : 0);
