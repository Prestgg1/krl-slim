// Lightweight code editor: a transparent textarea over a syntax-highlighted <pre>,
// with a line-number gutter that marks the current and the error line.
const KW = /^(DEF|END|DEFFCT|ENDFCT|DEFDAT|ENDDAT|RETURN|GLOBAL|PUBLIC|DECL|CONST|IF|THEN|ELSE|ENDIF|FOR|TO|STEP|ENDFOR|WHILE|ENDWHILE|REPEAT|UNTIL|LOOP|ENDLOOP|EXIT|SWITCH|CASE|DEFAULT|ENDSWITCH|WAIT|SEC|HALT|NOT|AND|OR|EXOR|B_NOT|B_AND|B_OR|B_EXOR|TRUE|FALSE|CONTINUE|IN|OUT|WITH)$/i;
const MOVE = /^(PTP|LIN|CIRC|PTP_REL|LIN_REL|CIRC_REL|SPTP|SLIN|SCIRC|CA|C_PTP|C_DIS|C_VEL|C_ORI|C_SPL)$/i;
const TYPE = /^(INT|REAL|BOOL|CHAR|FRAME|POS|E6POS|AXIS|E6AXIS)$/i;

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function highlight(src) {
  return src.split('\n').map((line) => {
    let out = '';
    let i = 0;
    while (i < line.length) {
      const rest = line.slice(i);
      let m;
      if (rest[0] === ';') { out += `<span class="t-com">${esc(rest)}</span>`; break; }
      if ((m = /^"[^"]*"?/.exec(rest))) { out += `<span class="t-str">${esc(m[0])}</span>`; i += m[0].length; continue; }
      if ((m = /^'[^']*'?/.exec(rest))) { out += `<span class="t-num">${esc(m[0])}</span>`; i += m[0].length; continue; }
      if ((m = /^\$[A-Za-z0-9_]*/.exec(rest))) { out += `<span class="t-sys">${esc(m[0])}</span>`; i += m[0].length; continue; }
      if ((m = /^#[A-Za-z0-9_]*/.exec(rest))) { out += `<span class="t-enum">${esc(m[0])}</span>`; i += m[0].length; continue; }
      if ((m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest))) {
        const w = m[0];
        const cls = MOVE.test(w) ? 't-move' : KW.test(w) ? 't-kw' : TYPE.test(w) ? 't-type' : null;
        out += cls ? `<span class="${cls}">${esc(w)}</span>` : esc(w);
        i += w.length; continue;
      }
      if ((m = /^\d+(\.\d*)?([eE][-+]?\d+)?/.exec(rest))) { out += `<span class="t-num">${m[0]}</span>`; i += m[0].length; continue; }
      if (line[i] === '&' && i === 0) { out += `<span class="t-com">${esc(rest)}</span>`; break; }
      out += esc(line[i]); i++;
    }
    return out;
  }).join('\n');
}

export class Editor {
  constructor(root, onChange) {
    this.root = root;
    this.ta = root.querySelector('textarea');
    this.pre = root.querySelector('pre code');
    this.preEl = root.querySelector('pre');
    this.gutter = root.querySelector('.gutter');
    this.onChange = onChange;
    this.activeLine = 0;
    this.errorLine = 0;
    this.ta.addEventListener('input', () => { this.errorLine = 0; this.refresh(); this.onChange?.(); });
    this.ta.addEventListener('scroll', () => this.syncScroll());
    this.ta.addEventListener('keydown', (e) => this.keydown(e));
    this.refresh();
  }

  get value() { return this.ta.value; }
  set value(v) { this.ta.value = v; this.errorLine = 0; this.activeLine = 0; this.refresh(); this.ta.scrollTop = 0; this.syncScroll(); }

  keydown(e) {
    const ta = this.ta;
    if (e.key === 'Tab') {
      e.preventDefault();
      const s = ta.selectionStart, en = ta.selectionEnd;
      ta.setRangeText('  ', s, en, 'end');
      this.refresh(); this.onChange?.();
    } else if (e.key === 'Enter') {
      // keep indentation of the current line
      const s = ta.selectionStart;
      const lineStart = ta.value.lastIndexOf('\n', s - 1) + 1;
      const indent = /^[ \t]*/.exec(ta.value.slice(lineStart, s))[0];
      e.preventDefault();
      ta.setRangeText('\n' + indent, s, ta.selectionEnd, 'end');
      this.refresh(); this.onChange?.();
    }
  }

  insertLine(text) {
    const ta = this.ta;
    const pos = ta.selectionStart;
    const lineEnd = ta.value.indexOf('\n', pos);
    const at = lineEnd < 0 ? ta.value.length : lineEnd;
    const lineStart = ta.value.lastIndexOf('\n', pos - 1) + 1;
    const indent = /^[ \t]*/.exec(ta.value.slice(lineStart))[0] || '  ';
    ta.setRangeText('\n' + indent + text, at, at, 'end');
    ta.focus();
    this.refresh(); this.onChange?.();
  }

  refresh() {
    this.pre.innerHTML = highlight(this.ta.value) + '\n';
    const n = this.ta.value.split('\n').length;
    let g = '';
    for (let i = 1; i <= n; i++) {
      const cls = i === this.errorLine ? 'ln err' : i === this.activeLine ? 'ln active' : 'ln';
      g += `<div class="${cls}">${i}</div>`;
    }
    this.gutter.innerHTML = g;
    this.drawLineBands();
    this.syncScroll();
  }

  drawLineBands() {
    let band = this.root.querySelector('.band');
    if (!band) { band = document.createElement('div'); band.className = 'band'; this.preEl.parentElement.insertBefore(band, this.preEl); }
    const line = this.errorLine || this.activeLine;
    band.hidden = !line;
    band.classList.toggle('err', !!this.errorLine);
    band.style.setProperty('--line', String(line - 1));
  }

  setActiveLine(n, scroll = true) {
    if (n === this.activeLine) return;
    this.activeLine = n;
    const lines = this.gutter.children;
    for (const el of this.gutter.querySelectorAll('.active')) el.classList.remove('active');
    if (n && lines[n - 1]) lines[n - 1].classList.add('active');
    this.drawLineBands();
    if (scroll && n) this.scrollToLine(n);
  }

  setErrorLine(n) {
    this.errorLine = n;
    this.refresh();
    if (n) this.scrollToLine(n);
  }

  scrollToLine(n) {
    const lh = parseFloat(getComputedStyle(this.ta).lineHeight) || 20;
    const top = (n - 1) * lh;
    const ta = this.ta;
    if (top < ta.scrollTop + lh || top > ta.scrollTop + ta.clientHeight - 2 * lh) {
      ta.scrollTop = Math.max(0, top - ta.clientHeight / 3);
      this.syncScroll();
    }
  }

  syncScroll() {
    const st = this.ta.scrollTop, sl = this.ta.scrollLeft;
    this.preEl.style.transform = `translate(${-sl}px, ${-st}px)`;
    this.gutter.style.transform = `translateY(${-st}px)`;
    const band = this.root.querySelector('.band');
    if (band) band.style.transform = `translateY(${-st}px)`;
  }

  setReadOnly(ro) { this.ta.readOnly = ro; this.root.classList.toggle('ro', ro); }
}
