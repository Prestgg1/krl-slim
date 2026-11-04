import { Interpreter } from '../src/krl/interpreter.js';
import assert from 'node:assert';
function run(src) {
  const logs = [], outs = {}, motions = [];
  const env = { getAxisAct: () => [0,-90,90,0,0,0], getPosAct: () => ({X:525,Y:0,Z:890,A:0,B:0,C:0}), getIn: (n) => n===1, setOut: (n,v)=>{outs[n]=v}, log: (m)=>logs.push(m), now: ()=>0 };
  const it = new Interpreter(src, env);
  for (const ev of it.run()) { if (ev.type==='motion') motions.push(ev); }
  return { it, logs, outs, motions };
}
let r = run(`
DEF main()
  DECL INT i, sum
  DECL REAL r
  DECL E6POS p1
  DECL BOOL ok
  sum = 0
  FOR i = 1 TO 10
    sum = sum + i
  ENDFOR
  r = 7 / 2
  p1 = {X 500, Y 0, Z 600, A 0, B 90, C 0}
  p1.Z = p1.Z + 100
  PTP HOME
  LIN p1 C_DIS
  CIRC {X 500, Y 100, Z 700}, {X 500, Y 200, Z 600}
  ok = (sum > 50) AND (r == 3)
  IF ok THEN
    $OUT[2] = TRUE
  ELSE
    $OUT[3] = TRUE
  ENDIF
  SWITCH i
  CASE 11
    MsgNotify("i on bir")
  DEFAULT
    MsgNotify("default")
  ENDSWITCH
  i = 0
  LOOP
    i = i + 1
    IF i >= 3 THEN
      EXIT
    ENDIF
  ENDLOOP
  WHILE $IN[1] AND (i < 5)
    i = i + 1
  ENDWHILE
  MsgNotify("kv", sq(4.0))
  inc(i)
  MsgNotify("i", i)
END
DEFFCT REAL sq(x:IN)
  RETURN x*x
ENDFCT
DEF inc(v:OUT)
  v = v + 100
END
`);
console.log(r.logs, r.outs, r.motions.map(m=>[m.kind, m.target, m.approx]));
assert.deepEqual(r.outs, {2:true});
assert.deepEqual(r.logs, ['i on bir', 'kv 16', 'i 105']);
// errors
for (const [src, re] of [
 ['DEF m()\n DECL INT i\n i = j\nEND', /elan olunmayıb/],
 ['DEF m()\n DECL INT i\n IF i > 1 AND i < 3 THEN\n ENDIF\nEND', /işə salınmayıb/],
 ['DEF m()\n DECL INT i\n i=2\n IF i > 1 AND i < 3 THEN\n ENDIF\nEND', /AND yalnız BOOL/],
 ['DEF m()\n FOR i = 1 TO 3\n ENDFOR\nEND', /elan olunmayıb/],
 ['DEF m()\n LIN HOME\nEND', /Kartezian/],
 ['DEF m()\n PTP {X 1\nEND', /\}/],
]) {
  try { run(src); assert.fail('no error for '+src); } catch (e) { if (e.code==='ERR_ASSERTION') throw e; console.log('ok err:', e.line, e.message); assert.match(e.message, re); }
}
console.log('interp ok');
