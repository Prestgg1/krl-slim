import { RobotScene } from './scene.js';
import { Editor } from './editor.js';
import { Runner } from './runner.js';
import { LESSONS } from './lessons.js';
import { ROBOT, HOME, inverse, forward } from './kinematics.js';
import { poseInBase, tcpWorld } from './motion.js';
import { compose, invert, poseToFrame } from './math.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const store = {
  get(k) { try { return localStorage.getItem('krllab:' + k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem('krllab:' + k, v); } catch { /* storage unavailable */ } },
};

const scene = new RobotScene($('#viewport'));
const darkMQ = window.matchMedia('(prefers-color-scheme: dark)');
const applyTheme = () => {
  const t = document.documentElement.dataset.theme;
  scene.setTheme(t ? t === 'dark' : darkMQ.matches);
};
darkMQ.addEventListener?.('change', applyTheme);
new MutationObserver(applyTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
applyTheme();

const STATUS = { idle: 'Hazır', running: 'İşləyir', paused: 'Pauza', done: 'Bitdi', error: 'Xəta' };
let lastTool = { X: 0, Y: 0, Z: 0, A: 0, B: 0, C: 0 };
let lastBase = { X: 0, Y: 0, Z: 0, A: 0, B: 0, C: 0 };
let errCount = 0;

const editor = new Editor($('#editor'), () => {
  store.set('code:' + currentLesson().id, editor.value);
  hideError();
});

// ---------- console ----------
const consoleEl = $('#console');
function log(msg, kind = 'msg', line, hint) {
  if (kind === 'busy') return;
  const d = document.createElement('div');
  d.className = kind;
  d.textContent = (line ? `[sətir ${line}] ` : '') + msg;
  if (hint) { const h = document.createElement('span'); h.className = 'hint'; h.textContent = '↳ ' + hint; d.appendChild(h); }
  if (line) d.addEventListener('click', () => editor.setErrorLine(line));
  consoleEl.appendChild(d);
  while (consoleEl.children.length > 400) consoleEl.firstChild.remove();
  consoleEl.scrollTop = consoleEl.scrollHeight;
}

function showError(err, line) {
  const box = $('#errbox');
  box.hidden = false;
  box.innerHTML = '';
  const t = document.createElement('div');
  t.textContent = (line ? `Sətir ${line}: ` : '') + err.message;
  box.appendChild(t);
  if (err.hint) { const s = document.createElement('small'); s.textContent = err.hint; box.appendChild(s); }
  box.onclick = () => line && editor.setErrorLine(line);
  if (line) editor.setErrorLine(line);
  log(err.message, 'err', line, err.hint);
  errCount++;
  const c = $('#errCount'); c.hidden = false; c.textContent = String(errCount);
}
function hideError() { $('#errbox').hidden = true; }

// ---------- runner ----------
const runner = new Runner({
  onLine: (n) => editor.setActiveLine(n),
  onLog: (m, kind) => log(m, kind || 'msg'),
  onError: (e, line) => showError(e, line),
  onState: (s) => {
    const el = $('#status'); el.dataset.s = s; el.textContent = STATUS[s] || s;
    const active = s === 'running' || s === 'paused';
    editor.setReadOnly(active);
    $('#pause').disabled = s !== 'running';
    $('#stop').disabled = !active;
    $('#run').lastChild.textContent = s === 'paused' ? 'Davam et' : 'İşə sal';
    setJogEnabled(!active);
    refreshVars();
  },
  onMotion: (m, ev) => {
    if (!m) return;
    scene.addPath(m.path, m.kind);
    if (ev) { lastTool = ev.tool; lastBase = ev.base; }
  },
  onOut: (n, v) => {
    renderOuts();
    if (n === 1) {
      const r = scene.setGripper(v);
      if (r === 'grab') log('Tutucu: hissə tutuldu', 'ok');
      else if (r === 'miss') log('Tutucu bağlandı, amma yaxında hissə yoxdur (TCP kubun mərkəzində olmalıdır)', 'info');
      else if (r === 'release') log('Tutucu: hissə buraxıldı', 'ok');
    }
  },
  onOutsReset: () => renderOuts(),
});
runner.override = 0.5;

function freshStart() {
  hideError();
  editor.setErrorLine(0);
  scene.resetParts();
  scene.setGripper(false);
  try {
    runner.load(editor.value);
  } catch (e) {
    runner.setState('error');
    showError(e, e.line);
    return false;
  }
  log(`Proqram yükləndi: ${runner.interp.prog.order[0]}()`, 'ok');
  return true;
}

$('#run').addEventListener('click', () => {
  if (runner.state === 'paused' && runner.gen) { runner.run(); return; }
  if (freshStart()) runner.run();
});
$('#step').addEventListener('click', () => {
  if (!(runner.state === 'paused' && runner.gen)) { if (!freshStart()) return; }
  runner.step();
});
$('#pause').addEventListener('click', () => runner.pause());
$('#stop').addEventListener('click', () => { runner.stop(); log('Dayandırıldı', 'info'); });
window.addEventListener('keydown', (e) => {
  if (e.key === 'F5') { e.preventDefault(); $('#run').click(); }
  if (e.key === 'F10') { e.preventDefault(); $('#step').click(); }
});
const ovr = $('#ovr');
const applyOv = () => { runner.override = ovr.value / 100; $('#ovrOut').textContent = ovr.value + '%'; store.set('ov', ovr.value); };
ovr.value = store.get('ov') || 50;
ovr.addEventListener('input', applyOv);
applyOv();

// ---------- lessons ----------
const sel = $('#lesson');
for (const L of LESSONS) { const o = document.createElement('option'); o.value = L.id; o.textContent = L.title; sel.appendChild(o); }
function currentLesson() { return LESSONS.find((l) => l.id === sel.value) || LESSONS[0]; }
function loadLesson(id) {
  sel.value = id;
  const L = currentLesson();
  $('#lessonText').innerHTML = L.text;
  editor.value = store.get('code:' + L.id) ?? L.code;
  store.set('lesson', L.id);
  runner.stop();
  hideError();
}
sel.addEventListener('change', () => loadLesson(sel.value));
$('#resetCode').addEventListener('click', () => { const L = currentLesson(); editor.value = L.code; store.set('code:' + L.id, L.code); hideError(); });

// ---------- tabs ----------
$$('.tabs button').forEach((b) => b.addEventListener('click', () => {
  $$('.tabs button').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
  $$('.pane').forEach((p) => { p.hidden = p.dataset.pane !== b.dataset.tab; });
  if (b.dataset.tab === 'console') { errCount = 0; $('#errCount').hidden = true; }
  if (b.dataset.tab === 'vars') refreshVars();
}));

// ---------- views ----------
$$('[data-view]').forEach((b) => b.addEventListener('click', () => scene.view(b.dataset.view)));
$('#clearPath').addEventListener('click', () => scene.clearPaths());

// ---------- jog ----------
const axesEl = $('#axes');
const sliders = [];
ROBOT.limits.forEach(([lo, hi], i) => {
  const row = document.createElement('label');
  row.className = 'axis';
  row.innerHTML = `<span>A${i + 1}</span><input type="range" id="jogA${i + 1}" min="${lo}" max="${hi}" step="0.5"><output></output>`;
  const input = row.querySelector('input');
  input.addEventListener('input', () => { const q = runner.q.slice(); q[i] = +input.value; runner.q = q; });
  axesEl.appendChild(row);
  sliders.push({ input, out: row.querySelector('output') });
});
const cartEl = $('#cartJog');
for (const ax of ['X', 'Y', 'Z']) {
  for (const sgn of [-1, 1]) {
    const b = document.createElement('button');
    b.className = 'btn';
    b.textContent = `${ax}${sgn > 0 ? '+' : '−'}`;
    b.addEventListener('click', () => jogCart(ax, sgn));
    cartEl.appendChild(b);
  }
}
// order buttons as X-, Y-, Z- / X+, Y+, Z+
const btns = [...cartEl.children];
cartEl.append(btns[0], btns[2], btns[4], btns[1], btns[3], btns[5]);

function jogCart(axis, sgn) {
  if (runner.state === 'running' || runner.state === 'paused') return;
  const step = +$('#jogStep').value * sgn;
  const tcp = tcpWorld(runner.q, lastTool);
  const p = tcp.p.slice();
  p['XYZ'.indexOf(axis)] += step;
  const flange = compose({ R: tcp.R, p }, invert(poseToFrame(lastTool)));
  const q = inverse(flange, runner.q);
  if (!q) { log(`Jog: ${axis} istiqamətində daha irəli getmək olmur (iş zonasının sərhədi)`, 'info'); return; }
  runner.q = q;
}
function setJogEnabled(on) {
  sliders.forEach((s) => { s.input.disabled = !on; });
  $$('#cartJog .btn, #teachPtp, #teachLin, #goHome').forEach((b) => { b.disabled = !on; });
}
$('#goHome').addEventListener('click', () => { runner.q = HOME.slice(); });
const f1 = (v) => (Math.abs(v) < 0.05 ? 0 : v).toFixed(1).replace(/\.0$/, '');
$('#teachPtp').addEventListener('click', () => {
  const q = runner.q;
  editor.insertLine(`PTP {A1 ${f1(q[0])}, A2 ${f1(q[1])}, A3 ${f1(q[2])}, A4 ${f1(q[3])}, A5 ${f1(q[4])}, A6 ${f1(q[5])}}`);
});
$('#teachLin').addEventListener('click', () => {
  const p = poseInBase(runner.q, lastTool, lastBase);
  editor.insertLine(`LIN {X ${f1(p.X)}, Y ${f1(p.Y)}, Z ${f1(p.Z)}, A ${f1(p.A)}, B ${f1(p.B)}, C ${f1(p.C)}}`);
});

// ---------- I/O ----------
const N_IO = 8;
const OUT_LABELS = { 1: 'tutucu', 2: 'lampa' };
const insEl = $('#ins'), outsEl = $('#outs');
for (let n = 1; n <= N_IO; n++) {
  const row = document.createElement('div');
  row.className = 'sig';
  row.innerHTML = `<button class="switch" role="switch" aria-checked="false" id="in${n}" aria-label="$IN[${n}]"></button><span>$IN[${n}]</span>`;
  const sw = row.querySelector('button');
  sw.addEventListener('click', () => {
    const v = !runner.ins.get(n);
    runner.ins.set(n, v);
    sw.setAttribute('aria-checked', String(v));
  });
  insEl.appendChild(row);
}
function renderOuts() {
  outsEl.innerHTML = '';
  for (let n = 1; n <= N_IO; n++) {
    const on = !!runner.outs.get(n);
    const row = document.createElement('div');
    row.className = 'sig';
    row.innerHTML = `<span class="led${on ? ' on' : ''}"></span><span>$OUT[${n}]</span>${OUT_LABELS[n] ? `<span class="lbl">${OUT_LABELS[n]}</span>` : ''}`;
    outsEl.appendChild(row);
  }
}
renderOuts();

// ---------- variables ----------
function refreshVars() {
  const tb = $('#vars tbody');
  if (!runner.interp) return;
  const rows = runner.interp.watchList();
  tb.innerHTML = '';
  for (const [k, v] of rows) {
    const tr = document.createElement('tr');
    const a = document.createElement('td'); a.textContent = k;
    const b = document.createElement('td'); b.textContent = v;
    tr.append(a, b); tb.appendChild(tr);
  }
}
let varTimer = 0;

// ---------- HUD ----------
const hud = $('#hud');
function renderHud() {
  const q = runner.q;
  const p = poseInBase(q, lastTool, lastBase);
  const n = (v) => (Math.abs(v) < 0.05 ? 0 : v).toFixed(1).padStart(7);
  hud.innerHTML =
    `<div class="row"><span><span class="k">X</span>${n(p.X)}</span><span><span class="k">Y</span>${n(p.Y)}</span><span><span class="k">Z</span>${n(p.Z)}</span></div>` +
    `<div class="row"><span><span class="k">A</span>${n(p.A)}</span><span><span class="k">B</span>${n(p.B)}</span><span><span class="k">C</span>${n(p.C)}</span></div><hr>` +
    `<div class="row">${q.slice(0, 3).map((v, i) => `<span><span class="k">${i + 1}</span>${n(v)}</span>`).join('')}</div>` +
    `<div class="row">${q.slice(3).map((v, i) => `<span><span class="k">${i + 4}</span>${n(v)}</span>`).join('')}</div>`;
}

// ---------- main loop ----------
let last = performance.now();
let lastQ = '';
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  runner.update(dt);
  const q = runner.q;
  const key = q.map((v) => v.toFixed(2)).join(',');
  if (key !== lastQ) {
    lastQ = key;
    scene.setJoints(q);
    scene.setTcpMarker(tcpWorld(q, lastTool));
    renderHud();
    sliders.forEach((s, i) => { if (document.activeElement !== s.input) s.input.value = q[i]; s.out.textContent = q[i].toFixed(1) + '°'; });
  }
  scene.stepPhysics(dt);
  varTimer += dt;
  if (varTimer > 0.2 && runner.state === 'running' && !$('[data-pane="vars"]').hidden) { varTimer = 0; refreshVars(); }
  scene.render();
  requestAnimationFrame(frame);
}
const startLesson = LESSONS.some((l) => l.id === location.hash.slice(1)) ? location.hash.slice(1) : (store.get('lesson') || LESSONS[0].id);
loadLesson(LESSONS.some((l) => l.id === startLesson) ? startLesson : LESSONS[0].id);
window.addEventListener('hashchange', () => { const id = location.hash.slice(1); if (LESSONS.some((l) => l.id === id)) loadLesson(id); });
runner.setState('idle');
requestAnimationFrame(frame);

// Exposed for automated checks and curious students (open the browser console).
window.krl = { runner, scene, forward, editor };
