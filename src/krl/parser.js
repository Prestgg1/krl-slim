// Recursive-descent parser for a teaching subset of KRL.
import { tokenize, TYPES } from './lexer.js';
import { KrlError } from './errors.js';

const MOTION = {
  PTP: ['PTP', false], SPTP: ['PTP', false], PTP_REL: ['PTP', true], SPTP_REL: ['PTP', true],
  LIN: ['LIN', false], SLIN: ['LIN', false], LIN_REL: ['LIN', true], SLIN_REL: ['LIN', true],
  CIRC: ['CIRC', false], SCIRC: ['CIRC', false], CIRC_REL: ['CIRC', true],
};
const APPROX = new Set(['C_PTP', 'C_DIS', 'C_VEL', 'C_ORI', 'C_SPL']);

// Operator priority from the KUKA manual: 1 = binds tightest.
// Note that comparisons bind *weakest*, so `(a > 1) AND (b < 2)` needs parentheses in KRL.
const BINARY = [
  ['OR', 'B_OR'],
  ['EXOR', 'B_EXOR'],
  ['AND', 'B_AND'],
  ['+', '-'],
  ['*', '/'],
];
const COMPARE = new Set(['==', '<>', '<', '>', '<=', '>=']);

export function parse(src) {
  const p = new Parser(tokenize(src));
  return p.program();
}

class Parser {
  constructor(toks) { this.toks = toks; this.i = 0; }
  get cur() { return this.toks[this.i]; }
  peek(k = 1) { return this.toks[this.i + k]; }
  next() { return this.toks[this.i++]; }
  is(type, value) { const t = this.cur; return t.type === type && (value === undefined || t.value === value); }
  isKw(...vals) { return this.cur.type === 'KW' && vals.includes(this.cur.value); }
  isOp(v) { return this.cur.type === 'OP' && this.cur.value === v; }
  accept(type, value) { if (this.is(type, value)) return this.next(); return null; }
  expect(type, value, msg) {
    if (this.is(type, value)) return this.next();
    const t = this.cur;
    const got = t.type === 'NL' ? 'sətrin sonu' : t.type === 'EOF' ? 'faylın sonu' : `'${t.raw || t.value}'`;
    throw new KrlError(msg || `Gözlənilirdi: '${value || type}', tapıldı: ${got}`, t.line);
  }
  skipNL() { while (this.is('NL')) this.next(); }
  endOfStatement() {
    if (!this.is('NL') && !this.is('EOF')) {
      const t = this.cur;
      throw new KrlError(`Əmrdən sonra artıq mətn: '${t.raw || t.value}'`, t.line);
    }
    this.skipNL();
  }

  program() {
    const prog = { routines: new Map(), order: [], dat: [] };
    this.skipNL();
    while (!this.is('EOF')) {
      this.accept('KW', 'GLOBAL');
      if (this.isKw('DEF')) this.routine(prog, false);
      else if (this.isKw('DEFFCT')) this.routine(prog, true);
      else if (this.isKw('DEFDAT')) this.defdat(prog);
      else {
        const t = this.cur;
        throw new KrlError(`Proqram DEF ilə başlamalıdır (məs. DEF main() ... END). Tapıldı: '${t.raw || t.value}'`, t.line);
      }
      this.skipNL();
    }
    if (!prog.order.length) throw new KrlError('Proqramda heç bir DEF tapılmadı', 1);
    return prog;
  }

  defdat(prog) {
    const start = this.next();
    this.expect('ID', undefined, 'DEFDAT-dan sonra ad gözlənilirdi');
    this.accept('KW', 'PUBLIC');
    this.endOfStatement();
    while (!this.isKw('ENDDAT')) {
      if (this.is('EOF')) throw new KrlError('ENDDAT tapılmadı', start.line);
      this.accept('KW', 'GLOBAL');
      const s = this.declaration();
      if (!s) throw new KrlError('DEFDAT içində yalnız DECL ola bilər', this.cur.line);
      prog.dat.push(s);
      this.endOfStatement();
    }
    this.next();
    this.endOfStatement();
  }

  routine(prog, isFct) {
    const start = this.next();
    let retType = null;
    if (isFct) {
      const t = this.next();
      if (!(t.type === 'KW' || t.type === 'ID') || !TYPES.has(t.value)) throw new KrlError('DEFFCT-dən sonra qaytarılan tip gözlənilirdi (məs. DEFFCT REAL f())', t.line);
      retType = t.value;
    }
    const nameTok = this.expect('ID', undefined, 'Proqramın adı gözlənilirdi');
    const params = [];
    this.expect('OP', '(', 'Addan sonra "(" gözlənilirdi, məs. DEF main()');
    while (!this.isOp(')')) {
      const pn = this.expect('ID', undefined, 'Parametr adı gözlənilirdi');
      let mode = 'IN';
      if (this.accept('OP', ':')) mode = this.expect('KW', undefined).value;
      params.push({ name: pn.value, out: mode === 'OUT' });
      if (!this.accept('OP', ',')) break;
    }
    this.expect('OP', ')');
    this.endOfStatement();
    const endKw = isFct ? 'ENDFCT' : 'END';
    const body = this.block([endKw], start.line, isFct ? 'DEFFCT' : 'DEF');
    this.next();
    const r = { name: nameTok.value, params, body, isFct, retType, line: start.line, endLine: this.toks[this.i - 1].line };
    if (prog.routines.has(r.name)) throw new KrlError(`'${nameTok.raw}' adlı proqram artıq var`, start.line);
    prog.routines.set(r.name, r);
    prog.order.push(r.name);
    this.endOfStatement();
  }

  block(terminators, startLine, opener) {
    const stmts = [];
    this.skipNL();
    while (!this.isKw(...terminators)) {
      if (this.is('EOF')) throw new KrlError(`${opener} bağlanmayıb: ${terminators[0]} tapılmadı`, startLine);
      const s = this.statement();
      if (s) stmts.push(s);
    }
    return stmts;
  }

  declaration() {
    const line = this.cur.line;
    const hasDecl = !!this.accept('KW', 'DECL');
    this.accept('KW', 'GLOBAL');
    const isConst = !!this.accept('KW', 'CONST');
    const t = this.cur;
    if (!((t.type === 'KW' || t.type === 'ID') && TYPES.has(t.value))) {
      if (hasDecl) throw new KrlError(`Naməlum tip: '${t.raw || t.value}'. Mövcud tiplər: ${[...TYPES].join(', ')}`, t.line);
      return null;
    }
    this.next();
    const type = t.value;
    const vars = [];
    do {
      const nm = this.expect('ID', undefined, 'Dəyişən adı gözlənilirdi');
      const dims = [];
      if (this.accept('OP', '[')) {
        do { if (!this.isOp(']')) dims.push(this.expr()); } while (this.accept('OP', ','));
        this.expect('OP', ']');
      }
      let init = null;
      if (this.accept('OP', '=')) init = this.expr();
      vars.push({ name: nm.value, raw: nm.raw, dims, init });
    } while (this.accept('OP', ','));
    return { t: 'decl', type, vars, isConst, line };
  }

  statement() {
    const t = this.cur;
    const line = t.line;
    if (t.type === 'KW') {
      switch (t.value) {
        case 'DECL': case 'CONST': { const d = this.declaration(); this.endOfStatement(); return d; }
        case 'GLOBAL': this.next(); return this.statement();
        case 'IF': return this.ifStmt();
        case 'FOR': return this.forStmt();
        case 'WHILE': {
          this.next();
          const cond = this.expr();
          this.endOfStatement();
          const body = this.block(['ENDWHILE'], line, 'WHILE');
          this.next(); this.endOfStatement();
          return { t: 'while', cond, body, line };
        }
        case 'REPEAT': {
          this.next(); this.endOfStatement();
          const body = this.block(['UNTIL'], line, 'REPEAT');
          const ul = this.next().line;
          const cond = this.expr();
          this.endOfStatement();
          return { t: 'repeat', cond, body, line, untilLine: ul };
        }
        case 'LOOP': {
          this.next(); this.endOfStatement();
          const body = this.block(['ENDLOOP'], line, 'LOOP');
          this.next(); this.endOfStatement();
          return { t: 'loop', body, line };
        }
        case 'EXIT': this.next(); this.endOfStatement(); return { t: 'exit', line };
        case 'HALT': this.next(); this.endOfStatement(); return { t: 'halt', line };
        case 'CONTINUE': this.next(); this.endOfStatement(); return null;
        case 'RETURN': {
          this.next();
          let e = null;
          if (!this.is('NL')) e = this.expr();
          this.endOfStatement();
          return { t: 'return', expr: e, line };
        }
        case 'SWITCH': return this.switchStmt();
        case 'WAIT': {
          this.next();
          if (this.accept('KW', 'SEC')) { const e = this.expr(); this.endOfStatement(); return { t: 'waitsec', expr: e, line }; }
          if (this.cur.type === 'ID' && this.cur.value === 'FOR') { /* unreachable: FOR is a keyword */ }
          this.expect('KW', 'FOR', 'WAIT-dən sonra SEC və ya FOR gözlənilirdi');
          const cond = this.expr();
          this.endOfStatement();
          return { t: 'waitfor', cond, line };
        }
        case 'GOTO': throw new KrlError('GOTO bu simulyatorda dəstəklənmir (pis təcrübədir, dövrlərdən istifadə edin)', line);
        case 'INTERRUPT': case 'TRIGGER': case 'STRUC': case 'ENUM':
          throw new KrlError(`${t.value} hələ dəstəklənmir`, line);
        default:
          if (MOTION[t.value]) return this.motion();
          if (['ELSE', 'ENDIF', 'ENDFOR', 'ENDWHILE', 'ENDLOOP', 'UNTIL', 'CASE', 'DEFAULT', 'ENDSWITCH', 'END', 'ENDFCT'].includes(t.value))
            throw new KrlError(`Gözlənilməz '${t.value}' (uyğun açılış əmri yoxdur)`, line);
          if (TYPES.has(t.value)) { const d = this.declaration(); this.endOfStatement(); return d; }
          throw new KrlError(`Gözlənilməz açar söz: '${t.raw || t.value}'`, line);
      }
    }
    if (t.type === 'ID' && TYPES.has(t.value) && this.peek().type === 'ID') {
      const d = this.declaration(); this.endOfStatement(); return d;
    }
    if (t.type === 'ID') {
      const target = this.postfix();
      if (this.accept('OP', '=')) {
        const expr = this.expr();
        this.endOfStatement();
        if (!['var', 'index', 'member'].includes(target.t)) throw new KrlError('Bu ifadəyə dəyər mənimsədilə bilməz', line);
        return { t: 'assign', target, expr, line };
      }
      if (target.t === 'call') { this.endOfStatement(); return { t: 'callstmt', call: target, line }; }
      if (target.t === 'var' && this.is('NL')) { this.endOfStatement(); return { t: 'callstmt', call: { t: 'call', name: target.name, args: [], line }, line }; }
      throw new KrlError(`Gözlənilirdi '=' və ya proqram çağırışı: '${t.raw}'`, line);
    }
    throw new KrlError(`Gözlənilməz simvol: '${t.raw || t.value}'`, line);
  }

  motion() {
    const t = this.next();
    const [kind, rel] = MOTION[t.value];
    const line = t.line;
    if (this.is('NL')) throw new KrlError(`${t.value}-dən sonra hədəf nöqtə gözlənilirdi`, line);
    const args = [this.expr()];
    let ca = null;
    if (kind === 'CIRC') {
      this.expect('OP', ',', 'CIRC iki nöqtə tələb edir: CIRC köməkçi_nöqtə, son_nöqtə');
      args.push(this.expr());
      if (this.accept('OP', ',')) { this.expect('KW', 'CA', 'CA (dairə bucağı) gözlənilirdi'); ca = this.expr(); }
    }
    let approx = null;
    if (this.cur.type === 'KW' && APPROX.has(this.cur.value)) approx = this.next().value;
    if (this.accept('KW', 'WITH')) { // SPTP ... WITH $VEL_AXIS[1]=20 — parse and keep as assignments
      const withs = [];
      do {
        const target = this.postfix();
        this.expect('OP', '=');
        withs.push({ target, expr: this.expr() });
      } while (this.accept('OP', ','));
      if (this.cur.type === 'KW' && APPROX.has(this.cur.value)) approx = this.next().value;
      this.endOfStatement();
      return { t: 'motion', kind, rel, args, ca, approx, withs, line, cmd: t.value };
    }
    this.endOfStatement();
    return { t: 'motion', kind, rel, args, ca, approx, line, cmd: t.value };
  }

  ifStmt() {
    const line = this.next().line;
    const cond = this.expr();
    this.expect('KW', 'THEN', 'IF şərtindən sonra THEN gözlənilirdi');
    this.endOfStatement();
    const thenB = this.block(['ELSE', 'ENDIF'], line, 'IF');
    let elseB = [];
    if (this.accept('KW', 'ELSE')) {
      this.endOfStatement();
      elseB = this.block(['ENDIF'], line, 'IF');
    }
    this.next();
    this.endOfStatement();
    return { t: 'if', cond, then: thenB, else: elseB, line };
  }

  forStmt() {
    const line = this.next().line;
    const v = this.expect('ID', undefined, 'FOR-dan sonra sayğac dəyişəni gözlənilirdi');
    this.expect('OP', '=');
    const from = this.expr();
    this.expect('KW', 'TO', 'FOR ... TO ... gözlənilirdi');
    const to = this.expr();
    let step = null;
    if (this.accept('KW', 'STEP')) step = this.expr();
    this.endOfStatement();
    const body = this.block(['ENDFOR'], line, 'FOR');
    this.next(); this.endOfStatement();
    return { t: 'for', var: v.value, varRaw: v.raw, from, to, step, body, line };
  }

  switchStmt() {
    const line = this.next().line;
    const expr = this.expr();
    this.endOfStatement();
    const cases = [];
    let def = null;
    while (!this.isKw('ENDSWITCH')) {
      if (this.is('EOF')) throw new KrlError('ENDSWITCH tapılmadı', line);
      if (this.accept('KW', 'CASE')) {
        const values = [this.expr()];
        while (this.accept('OP', ',')) values.push(this.expr());
        this.endOfStatement();
        cases.push({ values, body: this.block(['CASE', 'DEFAULT', 'ENDSWITCH'], line, 'SWITCH') });
      } else if (this.accept('KW', 'DEFAULT')) {
        this.endOfStatement();
        def = this.block(['CASE', 'DEFAULT', 'ENDSWITCH'], line, 'SWITCH');
      } else throw new KrlError('SWITCH içində CASE və ya DEFAULT gözlənilirdi', this.cur.line);
    }
    this.next(); this.endOfStatement();
    return { t: 'switch', expr, cases, def, line };
  }

  // ---- expressions ----
  expr() { return this.comparison(); }

  comparison() {
    let l = this.binary(0);
    while (this.cur.type === 'OP' && COMPARE.has(this.cur.value)) {
      const op = this.next();
      const r = this.binary(0);
      l = { t: 'bin', op: op.value, l, r, line: op.line };
    }
    return l;
  }

  binary(level) {
    if (level >= BINARY.length) return this.unary();
    let l = this.binary(level + 1);
    for (;;) {
      const c = this.cur;
      if ((c.type === 'OP' || c.type === 'KW') && BINARY[level].includes(c.value)) {
        this.next();
        const r = this.binary(level + 1);
        l = { t: 'bin', op: c.value, l, r, line: c.line };
      } else return l;
    }
  }

  unary() {
    const c = this.cur;
    if (c.type === 'KW' && (c.value === 'NOT' || c.value === 'B_NOT')) { this.next(); return { t: 'un', op: c.value, e: this.unary(), line: c.line }; }
    if (c.type === 'OP' && (c.value === '-' || c.value === '+')) { this.next(); return { t: 'un', op: c.value, e: this.unary(), line: c.line }; }
    return this.geometric();
  }

  geometric() {
    let l = this.postfix();
    while (this.isOp(':')) {
      const op = this.next();
      const r = this.postfix();
      l = { t: 'geo', l, r, line: op.line };
    }
    return l;
  }

  postfix() {
    let e = this.primary();
    for (;;) {
      if (this.isOp('[')) {
        const line = this.next().line;
        const idx = [];
        do { idx.push(this.expr()); } while (this.accept('OP', ','));
        this.expect('OP', ']');
        e = { t: 'index', obj: e, idx, line };
      } else if (this.isOp('.')) {
        const line = this.next().line;
        const f = this.next();
        if (f.type !== 'ID' && f.type !== 'KW') throw new KrlError("'.'-dan sonra sahə adı gözlənilirdi", line);
        e = { t: 'member', obj: e, field: f.value, line };
      } else return e;
    }
  }

  primary() {
    const t = this.next();
    switch (t.type) {
      case 'NUM': return { t: 'num', v: t.value, isInt: t.isInt, line: t.line };
      case 'STR': return { t: 'str', v: t.value, line: t.line };
      case 'ENUM': return { t: 'enum', v: t.value, line: t.line };
      case 'KW':
        if (t.value === 'TRUE' || t.value === 'FALSE') return { t: 'bool', v: t.value === 'TRUE', line: t.line };
        break;
      case 'ID':
        if (this.isOp('(')) {
          this.next();
          const args = [];
          while (!this.isOp(')')) {
            args.push(this.expr());
            if (!this.accept('OP', ',')) break;
          }
          this.expect('OP', ')', 'Funksiya çağırışında ")" gözlənilirdi');
          return { t: 'call', name: t.value, raw: t.raw, args, line: t.line };
        }
        return { t: 'var', name: t.value, raw: t.raw, line: t.line };
      case 'OP':
        if (t.value === '(') { const e = this.expr(); this.expect('OP', ')', 'Bağlanan mötərizə ")" gözlənilirdi'); return e; }
        if (t.value === '{') return this.aggregate(t);
        break;
      default: break;
    }
    const got = t.type === 'NL' ? 'sətrin sonu' : `'${t.raw || t.value}'`;
    throw new KrlError(`İfadə gözlənilirdi, tapıldı: ${got}`, t.line);
  }

  aggregate(open) {
    // {X 10, Y 20} or {E6POS: X 10} or {POS: X 1, ...}
    let typeName = null;
    if ((this.cur.type === 'ID' || this.cur.type === 'KW') && this.peek().type === 'OP' && this.peek().value === ':') {
      typeName = this.next().value; this.next();
    }
    const fields = [];
    while (!this.isOp('}')) {
      const f = this.next();
      if (f.type !== 'ID' && f.type !== 'KW') throw new KrlError(`Aqreqatda sahə adı gözlənilirdi (məs. X 100), tapıldı: '${f.raw || f.value}'`, f.line);
      const e = this.unaryValue();
      fields.push({ name: f.value, expr: e });
      if (!this.accept('OP', ',')) break;
    }
    this.expect('OP', '}', 'Aqreqat "}" ilə bağlanmalıdır');
    return { t: 'agg', typeName, fields, line: open.line };
  }

  unaryValue() {
    // Aggregate component values: numbers (possibly signed), or nested aggregate / expression.
    return this.binary(3); // allows + - * / and unary, but not comma/compare
  }
}
