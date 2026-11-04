// Drives the interpreter generator frame by frame and plays planned motions.
import { Interpreter } from './krl/interpreter.js';
import { plan, sampleAt, tcpWorld } from './motion.js';
import { frameToPose } from './math.js';
import { HOME } from './kinematics.js';

export class Runner {
  constructor(hooks = {}) {
    this.hooks = hooks;           // onLine, onLog, onOut, onError, onState, onMotion
    this.q = HOME.slice();
    this.ins = new Map();
    this.outs = new Map();
    this.override = 1;            // UI override 0..1 (like the pendant's OV)
    this.state = 'idle';          // idle | running | paused | done | error
    this.clock = 0;
    this.reset();
  }

  reset() {
    this.gen = null;
    this.interp = null;
    this.motion = null;
    this.waitLeft = 0;
    this.waitPulse = false;
    this.stepMode = false;
    this.stepBudget = 0;
    this.currentLine = 0;
  }

  env() {
    return {
      getAxisAct: () => this.q.slice(),
      getPosAct: (tool) => frameToPose(tcpWorld(this.q, tool)),
      getIn: (n) => !!this.ins.get(n),
      setOut: (n, v) => { this.outs.set(n, v); this.hooks.onOut?.(n, v); },
      log: (m, kind) => this.hooks.onLog?.(m, kind),
      now: () => this.clock * 1000,
    };
  }

  load(src) {
    this.reset();
    this.outs.clear();
    this.hooks.onOutsReset?.();
    this.interp = new Interpreter(src, this.env());
    this.gen = this.interp.run();
    this.setState('paused');
  }

  setState(s) { this.state = s; this.hooks.onState?.(s); }

  run() { if (!this.gen) return; this.stepMode = false; this.setState('running'); }
  step() { if (!this.gen) return; this.stepMode = true; this.stepBudget = 1; this.setState('running'); }
  pause() { if (this.state === 'running') this.setState('paused'); }
  stop() { this.reset(); this.setState('idle'); this.hooks.onLine?.(0); }

  fail(err) {
    this.gen = null;
    this.motion = null;
    this.setState('error');
    this.hooks.onError?.(err, err.line ?? this.currentLine);
  }

  // Advance by dt seconds of wall time.
  update(dt) {
    this.clock += dt;
    if (this.state !== 'running') return;
    const sdt = dt * this.override;
    if (this.motion) {
      this.motion.t += sdt;
      this.q = sampleAt(this.motion, this.motion.t);
      if (this.motion.t >= this.motion.duration) {
        this.q = this.motion.samples[this.motion.samples.length - 1].slice();
        this.motion = null;
        this.hooks.onMotion?.(null);
      } else return;
    }
    if (this.waitLeft > 0) {
      this.waitLeft -= this.waitPulse ? dt : sdt;
      if (this.waitLeft > 0) return;
    }
    this.pump();
  }

  pump() {
    let budget = 5000;
    while (this.gen && budget-- > 0) {
      if (this.stepMode && this.stepBudget <= 0) { this.setState('paused'); return; }
      let res;
      try { res = this.gen.next(); } catch (e) { this.fail(e); return; }
      if (res.done) {
        this.gen = null;
        this.setState('done');
        this.hooks.onLog?.('Proqram bitdi', 'ok');
        return;
      }
      const ev = res.value;
      this.currentLine = ev.line;
      switch (ev.type) {
        case 'line':
          this.hooks.onLine?.(ev.line);
          if (this.stepMode) this.stepBudget--;
          break;
        case 'motion': {
          let m;
          try { m = plan(ev, this.q); } catch (e) { e.line = ev.line; this.fail(e); return; }
          if (ev.approx && !this.warnedApprox) {
            this.warnedApprox = true;
            this.hooks.onLog?.(`${ev.approx}: yaxınlaşdırma (künc hamarlanması) hələ simulyasiya olunmur, robot nöqtədə dayanır`, 'info');
          }
          m.t = 0;
          m.line = ev.line;
          this.hooks.onMotion?.(m, ev);
          if (m.duration > 0) { this.motion = m; return; }
          this.q = m.samples[m.samples.length - 1].slice();
          break;
        }
        case 'wait':
          this.waitLeft = ev.sec;
          this.waitPulse = !!ev.pulse;
          if (ev.sec > 0) return;
          break;
        case 'tick':
          return;
        case 'halt':
          this.hooks.onLog?.('HALT: proqram dayandırıldı. Davam etmək üçün ▶ basın', 'info');
          this.setState('paused');
          return;
        default: break;
      }
    }
    if (budget <= 0) this.hooks.onLog?.('', 'busy');
  }

  // Run to completion headlessly (for tests). Returns list of motions.
  runHeadless(src, maxSeconds = 600) {
    this.load(src);
    this.run();
    const motions = [];
    const prev = this.hooks.onMotion;
    this.hooks.onMotion = (m, ev) => { if (m) motions.push({ m, ev }); prev?.(m, ev); };
    let t = 0;
    while (this.state === 'running' && t < maxSeconds) { this.update(1 / 60); t += 1 / 60; }
    this.hooks.onMotion = prev;
    return motions;
  }
}
