// Tree-walking KRL interpreter. Execution is a generator so the UI can animate motions,
// single-step lines and pause on WAIT without blocking the browser.
//
// Yielded events:
//   { type: 'line', line }                         before each statement
//   { type: 'motion', kind, rel, target, aux, ca, approx, tool, base, vel, line }
//   { type: 'wait', sec, line }                    WAIT SEC
//   { type: 'tick', line }                         WAIT FOR polling (one frame)
//   { type: 'halt', line }                         HALT
import { KrlError } from './errors.js';
import { parse } from './parser.js';
import { compose, poseToFrame, frameToPose, invert } from '../math.js';

export const STRUCT_FIELDS = {
  FRAME: ['X', 'Y', 'Z', 'A', 'B', 'C'],
  POS: ['X', 'Y', 'Z', 'A', 'B', 'C', 'S', 'T'],
  E6POS: ['X', 'Y', 'Z', 'A', 'B', 'C', 'S', 'T', 'E1', 'E2', 'E3', 'E4', 'E5', 'E6'],
  AXIS: ['A1', 'A2', 'A3', 'A4', 'A5', 'A6'],
  E6AXIS: ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'E1', 'E2', 'E3', 'E4', 'E5', 'E6'],
  VEL: ['CP', 'ORI1', 'ORI2'],
  APO: ['CPTP', 'CDIS', 'CORI', 'CVEL'],
};
const STRUCT_TYPES = new Set(['FRAME', 'POS', 'E6POS', 'AXIS', 'E6AXIS', 'VEL', 'APO']);
const INT_FIELDS = new Set(['S', 'T']);

const V = {
  int: (v) => ({ type: 'INT', v: Math.trunc(v) }),
  real: (v) => ({ type: 'REAL', v }),
  bool: (v) => ({ type: 'BOOL', v: !!v }),
  str: (v) => ({ type: 'CHAR', v: String(v) }),
  enm: (v) => ({ type: 'ENUM', v }),
  struct: (stype, fields) => ({ type: 'STRUCT', stype, v: fields }),
};

const isNum = (x) => x && (x.type === 'INT' || x.type === 'REAL');

export function fmtValue(x) {
  if (x === undefined || x === null) return '(not initialized)';
  switch (x.type) {
    case 'INT': return String(x.v);
    case 'REAL': return String(+x.v.toFixed(4));
    case 'BOOL': return x.v ? 'TRUE' : 'FALSE';
    case 'CHAR': return `"${x.v}"`;
    case 'ENUM': return `#${x.v}`;
    case 'STRUCT': {
      const parts = Object.entries(x.v).map(([k, v]) => `${k} ${INT_FIELDS.has(k) ? v : +(+v).toFixed(3)}`);
      return `{${x.stype ? x.stype + ': ' : ''}${parts.join(', ')}}`;
    }
    case 'ARRAY': return `[${x.v.length - 1} elements]`;
    default: return '?';
  }
}

function typeName(x) {
  if (!x) return 'uninitialized';
  return x.type === 'STRUCT' ? (x.stype || 'aggregate') : x.type;
}

function defaultFor(type) {
  if (STRUCT_TYPES.has(type)) return undefined; // KRL structs start invalid
  return undefined;
}

export class Interpreter {
  /**
   * env: { getAxisAct(): number[6], getPosAct(): {X..C}, getIn(n): bool, setOut(n, v),
   *        log(msg, kind), now(): ms }
   */
  constructor(source, env) {
    this.env = env;
    this.prog = parse(source);
    this.globals = new Map();
    this.outs = new Map();
    this.timerBase = new Map();
    this.callDepth = 0;
    this.initSystem();
    for (const d of this.prog.dat) this.execDeclSync(d, this.globals);
  }

  initSystem() {
    const g = this.globals;
    const sys = (name, type, value, opts = {}) => g.set(name, { type, value, ...opts });
    const axis = (a) => V.struct('E6AXIS', { A1: a[0], A2: a[1], A3: a[2], A4: a[3], A5: a[4], A6: a[5], E1: 0, E2: 0, E3: 0, E4: 0, E5: 0, E6: 0 });
    const nullFrame = () => V.struct('FRAME', { X: 0, Y: 0, Z: 0, A: 0, B: 0, C: 0 });
    sys('HOME', 'E6AXIS', axis([0, -90, 90, 0, 0, 0]));
    sys('XHOME', 'E6AXIS', axis([0, -90, 90, 0, 0, 0]));
    sys('$NULLFRAME', 'FRAME', nullFrame(), { isConst: true });
    sys('$TOOL', 'FRAME', nullFrame());
    sys('$BASE', 'FRAME', nullFrame());
    sys('$VEL', 'VEL', V.struct('VEL', { CP: 2.0, ORI1: 200, ORI2: 200 }));
    sys('$ACC', 'VEL', V.struct('VEL', { CP: 2.3, ORI1: 400, ORI2: 400 }));
    sys('$APO', 'APO', V.struct('APO', { CPTP: 100, CDIS: 10, CORI: 10, CVEL: 100 }));
    const arr = (type, n, fill) => ({ type: 'ARRAY', elem: type, v: [null, ...Array.from({ length: n }, fill)] });
    sys('$VEL_AXIS', 'ARRAY', arr('INT', 6, () => V.int(100)));
    sys('$ACC_AXIS', 'ARRAY', arr('INT', 6, () => V.int(100)));
    sys('$OV_PRO', 'INT', V.int(100));
    sys('$ADVANCE', 'INT', V.int(3));
    sys('$TIMER', 'ARRAY', arr('INT', 64, () => V.int(0)));
    sys('$TIMER_STOP', 'ARRAY', arr('BOOL', 64, () => V.bool(true)));
    sys('TOOL_DATA', 'ARRAY', arr('FRAME', 16, nullFrame));
    g.get('TOOL_DATA').value.v[1] = V.struct('FRAME', { X: 120, Y: 0, Z: 0, A: 0, B: 0, C: 0 }); // simulator gripper
    sys('BASE_DATA', 'ARRAY', arr('FRAME', 32, nullFrame));
    sys('$POS_ACT', 'E6POS', null, { readOnly: true });
    sys('$AXIS_ACT', 'E6AXIS', null, { readOnly: true });
    sys('$IN', 'IO', null);
    sys('$OUT', 'IO', null);
    sys('PI', 'REAL', V.real(Math.PI), { isConst: true });
  }

  // ---------- public helpers ----------
  *run(entryName) {
    const name = (entryName || this.prog.order[0]).toUpperCase();
    const r = this.prog.routines.get(name);
    if (!r) throw new KrlError(`Program '${name}' not found`, 1);
    if (r.params.length) throw new KrlError('The main program must not have parameters', r.line);
    yield* this.callRoutine(r, [], r.line);
    yield { type: 'line', line: r.endLine };
  }

  watchList() {
    // Variables shown in the UI: current routine locals + a few system variables.
    const out = [];
    const scope = this.currentScope;
    if (scope) for (const [k, rec] of scope) out.push([rec.raw || k, this.recDisplay(rec)]);
    for (const k of ['$VEL', '$OV_PRO', '$TOOL', '$BASE']) out.push([k, fmtValue(this.globals.get(k).value)]);
    for (const [k, rec] of this.globals) if (rec.user) out.push([rec.raw || k, this.recDisplay(rec)]);
    return out;
  }

  recDisplay(rec) {
    if (rec.ref) return fmtValue(rec.ref.get());
    if (rec.value && rec.value.type === 'ARRAY') {
      const items = rec.value.v.slice(1, 7).map(fmtValue);
      return `[${items.join(', ')}${rec.value.v.length > 7 ? ', ...' : ''}]`;
    }
    return fmtValue(rec.value);
  }

  // ---------- routines ----------
  *callRoutine(r, argRefs, line) {
    if (++this.callDepth > 64) throw new KrlError('Call stack too deep (endless recursion?)', line);
    const scope = new Map();
    if (argRefs.length !== r.params.length) {
      throw new KrlError(`'${r.name}' expects ${r.params.length} parameter(s), got ${argRefs.length}`, line);
    }
    r.params.forEach((p, i) => {
      const a = argRefs[i];
      if (p.out) {
        if (!a.ref) throw new KrlError(`'${p.name}' is an :OUT parameter, pass a variable`, line);
        scope.set(p.name, { ref: a.ref, raw: p.name, param: true });
      } else {
        scope.set(p.name, { type: a.value ? a.value.type === 'STRUCT' ? a.value.stype : a.value.type : 'REAL', value: clone(a.value), raw: p.name, param: true });
      }
    });
    const prevScope = this.currentScope;
    this.currentScope = scope;
    let ret;
    try {
      // KRL: declarations must come first in a routine
      let seenStmt = false;
      for (const s of r.body) {
        if (s.t === 'decl') {
          if (seenStmt) throw new KrlError('DECL must come at the top of the routine, before any other statement', s.line);
        } else seenStmt = true;
      }
      const res = yield* this.execBlock(r.body);
      if (res && res.kind === 'return') ret = res.value;
      else if (res && res.kind === 'exit') throw new KrlError('EXIT can only be used inside a loop (LOOP, FOR, WHILE, REPEAT)', res.line);
      if (r.isFct && ret === undefined) throw new KrlError(`DEFFCT '${r.name}' did not return a value with RETURN`, r.endLine);
    } finally {
      this.currentScope = prevScope;
      this.callDepth--;
    }
    if (r.isFct) return this.coerce(ret, r.retType, r.line);
    return undefined;
  }

  *execBlock(stmts) {
    for (const s of stmts) {
      const r = yield* this.exec(s);
      if (r) return r;
    }
    return undefined;
  }

  *exec(s) {
    yield { type: 'line', line: s.line };
    switch (s.t) {
      case 'decl': this.execDeclSync(s, this.currentScope); return;
      case 'assign': this.assign(s.target, this.eval(s.expr), s.line); return;
      case 'callstmt': yield* this.callStatement(s.call); return;
      case 'if': {
        const c = this.evalBool(s.cond, 'IF');
        return yield* this.execBlock(c ? s.then : s.else);
      }
      case 'while': {
        while (this.evalBool(s.cond, 'WHILE')) {
          const r = yield* this.execBlock(s.body);
          if (r) { if (r.kind === 'exit') break; return r; }
          yield { type: 'line', line: s.line };
        }
        return;
      }
      case 'repeat': {
        for (;;) {
          const r = yield* this.execBlock(s.body);
          if (r) { if (r.kind === 'exit') break; return r; }
          yield { type: 'line', line: s.untilLine };
          if (this.evalBool(s.cond, 'UNTIL')) break;
        }
        return;
      }
      case 'loop': {
        for (;;) {
          const r = yield* this.execBlock(s.body);
          if (r) { if (r.kind === 'exit') break; return r; }
          yield { type: 'line', line: s.line };
        }
        return;
      }
      case 'for': {
        const ref = this.lookup(s.var, s.line, s.varRaw);
        const rec = ref.rec;
        const vt = rec.ref ? 'INT' : rec.type;
        if (vt !== 'INT') throw new KrlError(`FOR counter '${s.var}' must be of type INT`, s.line, `Add DECL INT ${s.var}`);
        const from = this.evalInt(s.from, 'FOR'), to = this.evalInt(s.to, 'FOR');
        const step = s.step ? this.evalInt(s.step, 'STEP') : 1;
        if (step === 0) throw new KrlError('STEP cannot be 0', s.line);
        let i = from;
        for (; step > 0 ? i <= to : i >= to; i += step) {
          this.setRec(rec, V.int(i));
          const r = yield* this.execBlock(s.body);
          if (r) { if (r.kind === 'exit') return; return r; }
          yield { type: 'line', line: s.line };
        }
        this.setRec(rec, V.int(i)); // like KRL, the counter ends one STEP past TO
        return;
      }
      case 'switch': {
        const v = this.eval(s.expr);
        for (const c of s.cases) {
          for (const ve of c.values) {
            if (equalVals(v, this.eval(ve))) return yield* this.execBlock(c.body);
          }
        }
        if (s.def) return yield* this.execBlock(s.def);
        return;
      }
      case 'exit': return { kind: 'exit', line: s.line };
      case 'return': return { kind: 'return', value: s.expr ? this.eval(s.expr) : null, line: s.line };
      case 'halt': yield { type: 'halt', line: s.line }; return;
      case 'waitsec': {
        const sec = this.evalNum(s.expr, 'WAIT SEC');
        if (sec < 0) throw new KrlError('WAIT SEC cannot be negative', s.line);
        yield { type: 'wait', sec, line: s.line };
        return;
      }
      case 'waitfor': {
        while (!this.evalBool(s.cond, 'WAIT FOR')) yield { type: 'tick', line: s.line };
        return;
      }
      case 'motion': yield* this.motion(s); return;
      default: throw new KrlError(`Internal error: unknown statement ${s.t}`, s.line);
    }
  }

  *motion(s) {
    if (s.withs) for (const w of s.withs) this.assign(w.target, this.eval(w.expr), s.line);
    const vals = s.args.map((a) => this.eval(a));
    for (const v of vals) {
      if (!v || v.type !== 'STRUCT') throw new KrlError(`${s.cmd} expects a point (POS/E6POS/AXIS/FRAME), got: ${typeName(v)}`, s.line,
        v ? undefined : 'The point variable has no value yet. Assign one first, e.g. P1 = {X 500, Y 0, Z 600, A 0, B 90, C 0}');
    }
    const kindOf = (v) => {
      const keys = Object.keys(v.v);
      const axis = keys.some((k) => /^A[1-6]$/.test(k));
      const cart = keys.some((k) => ['X', 'Y', 'Z', 'A', 'B', 'C'].includes(k));
      if (axis && cart) throw new KrlError('The point mixes axis (A1..A6) and Cartesian (X..C) components', s.line);
      if (v.stype === 'AXIS' || v.stype === 'E6AXIS' || axis) return 'axis';
      return 'cart';
    };
    const tk = kindOf(vals[0]);
    if (s.kind !== 'PTP' && tk === 'axis') throw new KrlError(`${s.cmd} only accepts a Cartesian point (X, Y, Z, A, B, C). Use PTP for an axis point`, s.line);
    if (s.kind === 'CIRC' && kindOf(vals[1]) === 'axis') throw new KrlError('CIRC points must be Cartesian', s.line);
    const g = this.globals;
    const ev = {
      type: 'motion',
      kind: s.kind,
      cmd: s.cmd,
      rel: s.rel,
      targetKind: tk,
      target: { ...vals[s.kind === 'CIRC' ? 1 : 0].v },
      aux: s.kind === 'CIRC' ? { ...vals[0].v } : null,
      ca: s.ca ? this.evalNum(s.ca, 'CA') : null,
      approx: s.approx,
      tool: { ...g.get('$TOOL').value.v },
      base: { ...g.get('$BASE').value.v },
      velCP: g.get('$VEL').value.v.CP,
      velOri: g.get('$VEL').value.v.ORI1,
      velAxis: g.get('$VEL_AXIS').value.v.slice(1).map((x) => x.v),
      ovPro: g.get('$OV_PRO').value.v,
      line: s.line,
    };
    yield ev;
  }

  *callStatement(call) {
    const name = call.name;
    const r = this.prog.routines.get(name);
    if (r) {
      const args = call.args.map((a) => this.argRef(a));
      yield* this.callRoutine(r, args, call.line);
      return;
    }
    switch (name) {
      case 'BAS': return this.bas(call);
      case 'PULSE': {
        if (call.args.length < 3) throw new KrlError('PULSE(signal, value, time) needs three arguments', call.line);
        const [sig, val, dur] = call.args;
        const v = this.evalBool(val, 'PULSE');
        const t = this.evalNum(dur, 'PULSE');
        const prev = this.eval(sig);
        this.assign(sig, V.bool(v), call.line);
        yield { type: 'wait', sec: t, line: call.line, pulse: true };
        this.assign(sig, V.bool(prev ? prev.v : false), call.line);
        return;
      }
      case 'MSGNOTIFY': case 'MSGQUIT': case 'MSG': {
        const parts = call.args.map((a) => { const v = this.eval(a); return v && v.type === 'CHAR' ? v.v : fmtValue(v); });
        this.env.log(parts.join(' '), 'msg');
        return;
      }
      default:
        if (BUILTINS[name]) { this.eval(call); return; }
        throw new KrlError(`No routine or function named '${call.raw || name}'`, call.line,
          'Define the subroutine in the same file as DEF name() ... END');
    }
  }

  bas(call) {
    const g = this.globals;
    const [kindE, argE] = call.args;
    const kind = kindE && kindE.t === 'enum' ? kindE.v : null;
    const arg = argE ? this.evalNum(argE, 'BAS') : 0;
    switch (kind) {
      case 'INITMOV':
        g.get('$VEL').value.v.CP = 2.0;
        g.get('$VEL_AXIS').value.v.slice(1).forEach((x) => { x.v = 100; });
        g.get('$ACC_AXIS').value.v.slice(1).forEach((x) => { x.v = 100; });
        g.get('$TOOL').value = V.struct('FRAME', { X: 0, Y: 0, Z: 0, A: 0, B: 0, C: 0 });
        g.get('$BASE').value = V.struct('FRAME', { X: 0, Y: 0, Z: 0, A: 0, B: 0, C: 0 });
        return;
      case 'PTP_PARAMS': case 'VEL_PTP':
        g.get('$VEL_AXIS').value.v.slice(1).forEach((x) => { x.v = Math.round(arg); });
        return;
      case 'CP_PARAMS': case 'VEL_CP':
        g.get('$VEL').value.v.CP = arg;
        return;
      case 'TOOL': {
        const td = g.get('TOOL_DATA').value.v[arg];
        if (!td) throw new KrlError(`TOOL_DATA[${arg}] does not exist`, call.line);
        g.get('$TOOL').value = clone(td);
        return;
      }
      case 'BASE': {
        const bd = g.get('BASE_DATA').value.v[arg];
        if (!bd) throw new KrlError(`BASE_DATA[${arg}] does not exist`, call.line);
        g.get('$BASE').value = clone(bd);
        return;
      }
      default:
        throw new KrlError('Supported BAS calls: #INITMOV, #PTP_PARAMS, #CP_PARAMS, #TOOL, #BASE', call.line);
    }
  }

  // ---------- declarations & variables ----------
  execDeclSync(d, scope) {
    for (const v of d.vars) {
      const prev = scope.get(v.name);
      if (prev && prev.param && scope !== this.globals) {
        // DECL of a routine parameter fixes its type (KRL requires this)
        prev.param = false;
        if (!prev.ref) { prev.type = d.type; prev.value = this.coerce(prev.value, d.type, d.line); }
        continue;
      }
      if (scope.has(v.name) && scope !== this.globals) throw new KrlError(`'${v.raw}' is already declared`, d.line);
      if (scope === this.globals && this.globals.has(v.name) && !this.globals.get(v.name).user) {
        throw new KrlError(`'${v.raw}' is a system name, choose another name`, d.line);
      }
      let rec;
      if (v.dims.length) {
        const dims = v.dims.map((e) => this.evalInt(e, 'array size'));
        if (d.type === 'CHAR') rec = { type: 'CHAR', value: undefined, raw: v.raw, maxLen: dims[0] };
        else {
          if (dims.length > 3) throw new KrlError('Arrays can have at most 3 dimensions', d.line);
          rec = { type: 'ARRAY', value: makeArray(d.type, dims), raw: v.raw };
        }
      } else rec = { type: d.type, value: defaultFor(d.type), raw: v.raw };
      rec.isConst = d.isConst;
      if (scope === this.globals) rec.user = true;
      scope.set(v.name, rec);
      if (v.init) {
        rec.value = this.coerce(this.eval(v.init), rec.type, d.line, rec.value);
      } else if (d.isConst) throw new KrlError('A CONST variable needs a value', d.line);
    }
  }

  lookup(name, line, raw = name) {
    const scope = this.currentScope;
    if (scope && scope.has(name)) return { rec: scope.get(name) };
    if (this.globals.has(name)) return { rec: this.globals.get(name), global: true };
    const hint = name.startsWith('$') ? 'This system variable is not available in the simulator yet' : `Declare it first, e.g. DECL INT ${raw} or DECL E6POS ${raw}`;
    throw new KrlError(`Variable '${raw}' is not declared`, line, hint);
  }

  inScope(scope, fn) {
    const prev = this.currentScope;
    this.currentScope = scope;
    try { return fn(); } finally { this.currentScope = prev; }
  }

  setRec(rec, value) { if (rec.ref) rec.ref.set(value); else rec.value = value; }
  getRec(rec) { return rec.ref ? rec.ref.get() : rec.value; }

  // Returns { value, ref? } for routine arguments
  argRef(node) {
    const scope = this.currentScope;
    if (['var', 'index', 'member'].includes(node.t)) {
      return {
        value: this.eval(node),
        ref: {
          get: () => this.inScope(scope, () => this.eval(node)),
          set: (v) => this.inScope(scope, () => this.assign(node, v, node.line)),
        },
      };
    }
    return { value: this.eval(node) };
  }

  assign(target, value, line) {
    if (target.t === 'var') {
      const { rec } = this.lookup(target.name, line, target.raw);
      if (rec.isConst || rec.readOnly) throw new KrlError(`'${target.raw || target.name}' is read-only`, line);
      if (rec.type === 'IO') throw new KrlError(`${target.name} is an array, give an index: ${target.name}[1]`, line);
      if (rec.ref) { const cur = rec.ref.get(); rec.ref.set(this.coerce(value, cur ? typeOfVal(cur) : null, line, cur)); return; }
      if (rec.type === 'ARRAY') throw new KrlError('You cannot assign a whole array, assign its elements by index', line);
      rec.value = this.coerce(value, rec.type, line, rec.value, rec.maxLen);
      return;
    }
    if (target.t === 'index') {
      if (target.obj.t === 'var' && (target.obj.name === '$OUT' || target.obj.name === '$IN')) {
        const n = this.evalInt(target.idx[0], 'index');
        if (n < 1 || n > 4096) throw new KrlError(`${target.obj.name}[${n}] does not exist (1..4096)`, line);
        if (target.obj.name === '$IN') throw new KrlError('$IN inputs are read-only (toggle them in the I/O panel)', line);
        const b = this.coerce(value, 'BOOL', line);
        this.outs.set(n, b.v);
        this.env.setOut(n, b.v);
        return;
      }
      const arr = this.evalArrayRef(target.obj, line);
      const idx = target.idx.map((e) => this.evalInt(e, 'index'));
      const { holder, key } = arrayCell(arr, idx, line);
      if (arr.isConst) throw new KrlError('A constant array cannot be changed', line);
      if (target.obj.t === 'var' && target.obj.name === '$TIMER') {
        const v = this.coerce(value, 'INT', line);
        this.timerBase.set(idx[0], { start: this.env.now(), offset: v.v });
        holder[key] = v;
        return;
      }
      holder[key] = this.coerce(value, arr.elem, line, holder[key]);
      return;
    }
    if (target.t === 'member') {
      const obj = this.eval(target.obj, true);
      if (!obj) throw new KrlError(`Structure has no value yet: assign a full value first (e.g. P1 = {X 0, Y 0, Z 0, A 0, B 0, C 0})`, line);
      if (obj.type !== 'STRUCT') throw new KrlError(`'.${target.field}' only works on structures`, line);
      this.checkLvalueWritable(target.obj, line);
      const allowed = obj.stype ? STRUCT_FIELDS[obj.stype] : null;
      if (allowed && !allowed.includes(target.field)) throw new KrlError(`${obj.stype} has no component '${target.field}'. Components: ${allowed.join(', ')}`, line);
      const num = this.coerce(value, INT_FIELDS.has(target.field) ? 'INT' : 'REAL', line);
      obj.v[target.field] = num.v; // obj is the live stored value (eval with live=true)
      return;
    }
    throw new KrlError('Cannot assign to this expression', line);
  }

  checkLvalueWritable(node, line) {
    let n = node;
    while (n.t === 'member' || n.t === 'index') n = n.obj;
    if (n.t === 'var') {
      const { rec } = this.lookup(n.name, line);
      if (rec.isConst || rec.readOnly) throw new KrlError(`'${n.raw || n.name}' is read-only`, line);
    }
  }

  evalArrayRef(node, line) {
    if (node.t !== 'var') throw new KrlError('Array name expected', line);
    const { rec } = this.lookup(node.name, line);
    const val = this.getRec(rec);
    if (!val || val.type !== 'ARRAY') throw new KrlError(`'${node.raw || node.name}' is not an array`, line);
    return Object.assign(val, { isConst: rec.isConst });
  }

  coerce(value, type, line, existing, maxLen) {
    if (value === undefined || value === null) throw new KrlError('Value is not initialized (assign the variable first)', line);
    if (!type) return clone(value);
    switch (type) {
      case 'INT':
        if (value.type === 'INT') return value;
        if (value.type === 'REAL') return V.int(Math.round(value.v));
        break;
      case 'REAL':
        if (isNum(value)) return V.real(value.v);
        break;
      case 'BOOL':
        if (value.type === 'BOOL') return value;
        break;
      case 'CHAR':
        if (value.type === 'CHAR') {
          if (maxLen && value.v.length > maxLen) throw new KrlError(`Text is too long (max ${maxLen})`, line);
          return value;
        }
        break;
      case 'ENUM':
        if (value.type === 'ENUM') return value;
        break;
      default:
        if (STRUCT_TYPES.has(type)) {
          if (value.type !== 'STRUCT') break;
          const allowed = STRUCT_FIELDS[type];
          const base = existing && existing.type === 'STRUCT' ? { ...existing.v } : {};
          const isAxis = (t) => t === 'AXIS' || t === 'E6AXIS';
          if (value.stype && value.stype !== type && isAxis(value.stype) !== isAxis(type)) {
            throw new KrlError(`An ${value.stype} value cannot be assigned to a ${type} variable`, line);
          }
          for (const [k, v] of Object.entries(value.v)) {
            if (!allowed.includes(k)) {
              // silently drop components the target type does not have when copying between point types
              if (value.stype) continue;
              throw new KrlError(`${type} has no component '${k}'. Components: ${allowed.join(', ')}`, line);
            }
            base[k] = v;
          }
          return V.struct(type, base);
        }
    }
    throw new KrlError(`Type mismatch: cannot assign ${typeName(value)} to ${type}`, line);
  }

  // ---------- expressions ----------
  evalNum(e, ctx) {
    const v = this.eval(e);
    if (!isNum(v)) throw new KrlError(`${ctx}: number expected, got ${typeName(v)}`, e.line);
    return v.v;
  }
  evalInt(e, ctx) {
    const v = this.eval(e);
    if (!isNum(v)) throw new KrlError(`${ctx}: integer expected, got ${typeName(v)}`, e.line);
    return v.type === 'INT' ? v.v : Math.round(v.v);
  }
  evalBool(e, ctx) {
    const v = this.eval(e);
    if (!v || v.type !== 'BOOL') {
      throw new KrlError(`${ctx} condition must be BOOL, got ${typeName(v)}`, e.line,
        'In KRL, comparisons bind weaker than AND/OR. Use parentheses: (A > 1) AND (B < 2)');
    }
    return v.v;
  }

  // live=true returns the stored struct object itself (for member assignment)
  eval(e, live = false) {
    switch (e.t) {
      case 'num': return e.isInt ? V.int(e.v) : V.real(e.v);
      case 'bool': return V.bool(e.v);
      case 'str': return V.str(e.v);
      case 'enum': return V.enm(e.v);
      case 'var': {
        const name = e.name;
        if (name === '$POS_ACT') return V.struct('E6POS', { ...this.posAct(), S: 2, T: 0 });
        if (name === '$AXIS_ACT') { const q = this.env.getAxisAct(); return V.struct('E6AXIS', { A1: q[0], A2: q[1], A3: q[2], A4: q[3], A5: q[4], A6: q[5] }); }
        const { rec } = this.lookup(name, e.line, e.raw);
        if (rec.type === 'IO') throw new KrlError(`${name} is an array, give an index: ${name}[1]`, e.line);
        const v = this.getRec(rec);
        if (v === undefined || v === null) {
          throw new KrlError(`Variable '${e.raw || name}' is not initialized (it has no value)`, e.line, `Assign it first: ${e.raw || name} = ...`);
        }
        return live ? v : clone(v);
      }
      case 'index': {
        if (e.obj.t === 'var' && (e.obj.name === '$IN' || e.obj.name === '$OUT')) {
          const n = this.evalInt(e.idx[0], 'index');
          if (n < 1 || n > 4096) throw new KrlError(`${e.obj.name}[${n}] does not exist (1..4096)`, e.line);
          return V.bool(e.obj.name === '$IN' ? this.env.getIn(n) : !!this.outs.get(n));
        }
        if (e.obj.t === 'var' && e.obj.name === '$TIMER') {
          const n = this.evalInt(e.idx[0], 'index');
          return V.int(this.timerValue(n));
        }
        const arr = this.evalArrayRef(e.obj, e.line);
        const idx = e.idx.map((x) => this.evalInt(x, 'index'));
        const { holder, key } = arrayCell(arr, idx, e.line);
        const v = holder[key];
        if (v === undefined || v === null) throw new KrlError(`Array element is not initialized: [${idx.join(',')}]`, e.line);
        return live ? v : clone(v);
      }
      case 'member': {
        const obj = this.eval(e.obj, true);
        if (obj.type !== 'STRUCT') throw new KrlError(`'.${e.field}' only works on structures`, e.line);
        if (!(e.field in obj.v)) {
          const allowed = obj.stype ? STRUCT_FIELDS[obj.stype] : null;
          if (allowed && !allowed.includes(e.field)) throw new KrlError(`${obj.stype} has no component '${e.field}'`, e.line);
          throw new KrlError(`Component '${e.field}' is not initialized`, e.line);
        }
        const v = obj.v[e.field];
        return INT_FIELDS.has(e.field) || obj.stype === 'VEL' && false ? V.int(v) : V.real(v);
      }
      case 'agg': {
        const fields = {};
        const stype = e.typeName && STRUCT_TYPES.has(e.typeName) ? e.typeName : null;
        if (e.typeName && !stype) throw new KrlError(`Unknown aggregate type: ${e.typeName}`, e.line);
        for (const f of e.fields) {
          if (stype && !STRUCT_FIELDS[stype].includes(f.name)) throw new KrlError(`${stype} has no component '${f.name}'`, e.line);
          if (!stype && !Object.values(STRUCT_FIELDS).some((l) => l.includes(f.name))) throw new KrlError(`Unknown component: '${f.name}'`, e.line);
          const v = this.eval(f.expr);
          if (!isNum(v)) throw new KrlError(`Component '${f.name}' must be a number`, e.line);
          fields[f.name] = v.v;
        }
        return V.struct(stype, fields);
      }
      case 'un': {
        const v = this.eval(e.e);
        if (e.op === 'NOT') { if (v.type !== 'BOOL') throw new KrlError('NOT only works on BOOL', e.line); return V.bool(!v.v); }
        if (e.op === 'B_NOT') { if (v.type !== 'INT') throw new KrlError('B_NOT only works on INT', e.line); return V.int(~v.v); }
        if (!isNum(v)) throw new KrlError(`'${e.op}' needs a number`, e.line);
        return e.op === '-' ? { type: v.type, v: -v.v } : v;
      }
      case 'bin': return this.binop(e);
      case 'geo': {
        const l = this.eval(e.l), r = this.eval(e.r);
        for (const x of [l, r]) {
          if (x.type !== 'STRUCT' || !('X' in x.v)) throw new KrlError("The geometric operator ':' only works on FRAME/POS/E6POS", e.line);
        }
        const F = compose(poseToFrame(l.v), poseToFrame(r.v));
        const p = frameToPose(F);
        return V.struct(r.stype || 'FRAME', { ...r.v, ...p });
      }
      case 'call': return this.callFunction(e);
      default: throw new KrlError(`Internal error: expression ${e.t}`, e.line);
    }
  }

  posAct() {
    // $POS_ACT is expressed in the current $BASE with the current $TOOL
    const p = this.env.getPosAct(this.globals.get('$TOOL').value.v);
    const base = poseToFrame(this.globals.get('$BASE').value.v);
    return frameToPose(compose(invert(base), poseToFrame(p)));
  }

  timerValue(n) {
    const g = this.globals.get('$TIMER').value.v;
    const stopRec = this.globals.get('$TIMER_STOP').value.v[n];
    if (!g[n]) throw new KrlError(`$TIMER[${n}] does not exist (1..64)`, 0);
    const tb = this.timerBase.get(n) || { start: this.env.now(), offset: g[n].v };
    if (stopRec.v) {
      if (this.timerBase.has(n) && tb.running) { tb.offset += this.env.now() - tb.start; tb.running = false; }
      return Math.round(tb.offset);
    }
    if (!tb.running) { tb.start = this.env.now(); tb.running = true; this.timerBase.set(n, tb); }
    return Math.round(tb.offset + this.env.now() - tb.start);
  }

  binop(e) {
    const l = this.eval(e.l), r = this.eval(e.r);
    const op = e.op;
    if (['AND', 'OR', 'EXOR'].includes(op)) {
      if (l.type !== 'BOOL' || r.type !== 'BOOL') {
        throw new KrlError(`${op} only works on BOOL values (got ${typeName(l)} ${op} ${typeName(r)})`, e.line,
          'In KRL, comparisons bind weaker than AND/OR. Use parentheses: (A > 1) AND (B < 2)');
      }
      if (op === 'AND') return V.bool(l.v && r.v);
      if (op === 'OR') return V.bool(l.v || r.v);
      return V.bool(l.v !== r.v);
    }
    if (['B_AND', 'B_OR', 'B_EXOR'].includes(op)) {
      if (l.type !== 'INT' || r.type !== 'INT') throw new KrlError(`${op} only works on INT`, e.line);
      return V.int(op === 'B_AND' ? l.v & r.v : op === 'B_OR' ? l.v | r.v : l.v ^ r.v);
    }
    if (COMPARE_OPS.has(op)) {
      if (isNum(l) && isNum(r)) {
        const a = l.v, b = r.v;
        return V.bool(op === '==' ? a === b : op === '<>' ? a !== b : op === '<' ? a < b : op === '>' ? a > b : op === '<=' ? a <= b : a >= b);
      }
      if (l.type === r.type && (op === '==' || op === '<>')) {
        const eq = equalVals(l, r);
        return V.bool(op === '==' ? eq : !eq);
      }
      throw new KrlError(`Cannot compare ${typeName(l)} and ${typeName(r)}`, e.line);
    }
    if (!isNum(l) || !isNum(r)) {
      if (op === '+' && l.type === 'CHAR' && r.type === 'CHAR') return V.str(l.v + r.v);
      throw new KrlError(`'${op}' needs numbers (got ${typeName(l)} and ${typeName(r)})`, e.line);
    }
    const bothInt = l.type === 'INT' && r.type === 'INT';
    switch (op) {
      case '+': return bothInt ? V.int(l.v + r.v) : V.real(l.v + r.v);
      case '-': return bothInt ? V.int(l.v - r.v) : V.real(l.v - r.v);
      case '*': return bothInt ? V.int(l.v * r.v) : V.real(l.v * r.v);
      case '/':
        if (r.v === 0) throw new KrlError('Division by zero', e.line);
        return bothInt ? V.int(Math.trunc(l.v / r.v)) : V.real(l.v / r.v);
      default: throw new KrlError(`Unknown operator ${op}`, e.line);
    }
  }

  callFunction(e) {
    const r = this.prog.routines.get(e.name);
    if (r) {
      if (!r.isFct) throw new KrlError(`'${e.raw}' is a DEF routine and returns no value. Use DEFFCT for a function`, e.line);
      const args = e.args.map((a) => this.argRef(a));
      const gen = this.callRoutine(r, args, e.line);
      let steps = 0;
      for (;;) {
        const { value, done } = gen.next();
        if (done) return value;
        if (value.type !== 'line') throw new KrlError('Motion or WAIT inside a function (DEFFCT) is not supported in this simulator', value.line);
        if (++steps > 1e6) throw new KrlError('Function runs too long (endless loop?)', e.line);
      }
    }
    const f = BUILTINS[e.name];
    if (!f) throw new KrlError(`Unknown function: '${e.raw}'`, e.line);
    const args = e.args.map((a) => this.eval(a));
    if (args.length !== f.n) throw new KrlError(`${e.name} expects ${f.n} argument(s)`, e.line);
    for (const a of args) if (!isNum(a)) throw new KrlError(`${e.name} expects numeric arguments`, e.line);
    return f.fn(...args.map((a) => a.v), e.line);
  }
}

const COMPARE_OPS = new Set(['==', '<>', '<', '>', '<=', '>=']);
const D = Math.PI / 180;
const BUILTINS = {
  SIN: { n: 1, fn: (x) => V.real(Math.sin(x * D)) },
  COS: { n: 1, fn: (x) => V.real(Math.cos(x * D)) },
  TAN: { n: 1, fn: (x) => V.real(Math.tan(x * D)) },
  ASIN: { n: 1, fn: (x) => V.real(Math.asin(x) / D) },
  ACOS: { n: 1, fn: (x) => V.real(Math.acos(x) / D) },
  ATAN2: { n: 2, fn: (y, x) => V.real(Math.atan2(y, x) / D) },
  SQRT: { n: 1, fn: (x, line) => { if (x < 0) throw new KrlError('SQRT of a negative number', line); return V.real(Math.sqrt(x)); } },
  ABS: { n: 1, fn: (x) => V.real(Math.abs(x)) },
};

function typeOfVal(v) { return v.type === 'STRUCT' ? v.stype : v.type; }

function equalVals(a, b) {
  if (isNum(a) && isNum(b)) return a.v === b.v;
  if (a.type !== b.type) return false;
  if (a.type === 'STRUCT') return JSON.stringify(a.v) === JSON.stringify(b.v);
  return a.v === b.v;
}

function clone(v) {
  if (!v) return v;
  if (v.type === 'STRUCT') return { type: 'STRUCT', stype: v.stype, v: { ...v.v } };
  return v;
}

function makeArray(elem, dims) {
  const build = (d) => {
    const n = dims[d];
    const a = [null];
    for (let i = 0; i < n; i++) a.push(d + 1 < dims.length ? build(d + 1) : undefined);
    return a;
  };
  return { type: 'ARRAY', elem, dims, v: build(0) };
}

function arrayCell(arr, idx, line) {
  const dims = arr.dims || [arr.v.length - 1];
  if (idx.length !== dims.length) throw new KrlError(`Array expects ${dims.length} index(es), got ${idx.length}`, line);
  let holder = arr.v;
  for (let d = 0; d < idx.length; d++) {
    const i = idx[d];
    if (i < 1 || i > dims[d]) throw new KrlError(`Array index out of range: ${i} (1..${dims[d]})`, line, 'KRL arrays start at 1');
    if (d < idx.length - 1) holder = holder[i];
    else return { holder, key: i };
  }
  return null;
}
