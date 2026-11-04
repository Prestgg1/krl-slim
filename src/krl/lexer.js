// KRL lexer. KRL is case-insensitive and line oriented; NEWLINE tokens end statements.
import { KrlError } from './errors.js';

export const TYPES = new Set(['INT', 'REAL', 'BOOL', 'CHAR', 'FRAME', 'POS', 'E6POS', 'AXIS', 'E6AXIS']);

export const KEYWORDS = new Set([
  'DEF', 'END', 'DEFFCT', 'ENDFCT', 'DEFDAT', 'ENDDAT', 'RETURN', 'GLOBAL', 'PUBLIC', 'DECL', 'CONST', 'IN', 'OUT',
  'IF', 'THEN', 'ELSE', 'ENDIF', 'FOR', 'TO', 'STEP', 'ENDFOR', 'WHILE', 'ENDWHILE', 'REPEAT', 'UNTIL',
  'LOOP', 'ENDLOOP', 'EXIT', 'SWITCH', 'CASE', 'DEFAULT', 'ENDSWITCH', 'WAIT', 'SEC', 'HALT',
  'PTP', 'LIN', 'CIRC', 'PTP_REL', 'LIN_REL', 'CIRC_REL', 'SPTP', 'SLIN', 'SCIRC', 'SPTP_REL', 'SLIN_REL',
  'CA', 'C_PTP', 'C_DIS', 'C_VEL', 'C_ORI', 'C_SPL', 'NOT', 'AND', 'OR', 'EXOR', 'B_NOT', 'B_AND', 'B_OR', 'B_EXOR',
  'TRUE', 'FALSE', 'CONTINUE', 'GOTO', 'STRUC', 'ENUM', 'INTERRUPT', 'TRIGGER', 'WITH',
]);

export function tokenize(src) {
  const toks = [];
  let i = 0, line = 1, col = 1;
  const n = src.length;
  const push = (type, value, extra = {}) => toks.push({ type, value, line, col, ...extra });

  while (i < n) {
    const ch = src[i];
    const startCol = col;
    if (ch === '\n') {
      push('NL', '\n');
      i++; line++; col = 1;
      continue;
    }
    if (ch === '\r' || ch === ' ' || ch === '\t') { i++; col++; continue; }
    if (ch === ';') { // comment to end of line (includes ;FOLD / ;ENDFOLD)
      while (i < n && src[i] !== '\n') { i++; col++; }
      continue;
    }
    if (ch === '&' && (toks.length === 0 || toks[toks.length - 1].type === 'NL')) { // &ACCESS header lines
      while (i < n && src[i] !== '\n') { i++; col++; }
      continue;
    }
    // Numbers: 12, 1.5, .5, 1E3, 'B1010', 'H1F'
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      let j = i;
      while (j < n && /[0-9]/.test(src[j])) j++;
      let isReal = false;
      if (src[j] === '.' && /[0-9]/.test(src[j + 1] || '')) { isReal = true; j++; while (j < n && /[0-9]/.test(src[j])) j++; }
      else if (src[j] === '.' && !/[A-Za-z_$]/.test(src[j + 1] || '')) { isReal = true; j++; }
      if (/[eE]/.test(src[j] || '') && /[-+0-9]/.test(src[j + 1] || '')) {
        let k = j + 1;
        if (/[-+]/.test(src[k])) k++;
        if (/[0-9]/.test(src[k] || '')) { isReal = true; j = k; while (j < n && /[0-9]/.test(src[j])) j++; }
      }
      const text = src.slice(i, j);
      push('NUM', parseFloat(text), { isInt: !isReal, col: startCol });
      col += j - i; i = j;
      continue;
    }
    if (ch === "'") { // 'B0101' or 'H1F' or a char literal
      const j = src.indexOf("'", i + 1);
      if (j < 0 || src.slice(i, j).includes('\n')) throw new KrlError("Bağlanmamış ' simvolu", line);
      const body = src.slice(i + 1, j);
      if (/^[Bb][01]+$/.test(body)) push('NUM', parseInt(body.slice(1), 2), { isInt: true });
      else if (/^[Hh][0-9A-Fa-f]+$/.test(body)) push('NUM', parseInt(body.slice(1), 16), { isInt: true });
      else push('STR', body);
      col += j - i + 1; i = j + 1;
      continue;
    }
    if (ch === '"') {
      const j = src.indexOf('"', i + 1);
      if (j < 0 || src.slice(i, j).includes('\n')) throw new KrlError('Bağlanmamış " simvolu (mətn)', line);
      push('STR', src.slice(i + 1, j));
      col += j - i + 1; i = j + 1;
      continue;
    }
    if (/[A-Za-z_$#]/.test(ch)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_$]/.test(src[j])) j++;
      const raw = src.slice(i, j);
      const up = raw.toUpperCase();
      if (up.startsWith('#')) push('ENUM', up.slice(1), { raw });
      else if (KEYWORDS.has(up)) push('KW', up, { raw });
      else push('ID', up, { raw });
      col += j - i; i = j;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (['==', '<>', '<=', '>='].includes(two)) { push('OP', two); i += 2; col += 2; continue; }
    if ('=<>+-*/:,()[]{}.%'.includes(ch)) { push('OP', ch); i++; col++; continue; }
    throw new KrlError(`Tanınmayan simvol: '${ch}'`, line);
  }
  push('NL', '\n');
  push('EOF', null);
  return toks;
}
