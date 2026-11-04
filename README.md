# KRL Lab

A free, open-source **KRL (KUKA Robot Language) learning simulator**. Write KRL code in the browser and watch a generic 6-axis industrial robot run it in 3D. Nothing to install.

**Live:** https://prestgg1.github.io/krl-slim/

> This project is not affiliated with KUKA AG. "KUKA" and "KRL" are trademarks of their respective owners. The robot model is generic and does not reproduce any KUKA product.

## Features (phase 1)

- **Motion:** `PTP`, `LIN`, `CIRC` (+ `_REL`, `CA`), `SPTP/SLIN/SCIRC` syntax
- **Language:** `DEF/END`, `DEFFCT/ENDFCT`, `DEFDAT`, `DECL` (`INT REAL BOOL CHAR E6POS POS FRAME E6AXIS AXIS`, arrays), `IF/ELSE`, `FOR/STEP`, `WHILE`, `REPEAT/UNTIL`, `LOOP/EXIT`, `SWITCH/CASE`, `WAIT SEC`, `WAIT FOR`, `HALT`, `:IN/:OUT` parameters
- **System variables:** `$IN $OUT $VEL $VEL_AXIS $ACC $OV_PRO $TOOL $BASE $POS_ACT $AXIS_ACT $TIMER $NULLFRAME`, `HOME`, `TOOL_DATA[] BASE_DATA[]`
- **Functions:** `BAS(#INITMOV|#PTP_PARAMS|#CP_PARAMS|#TOOL|#BASE)`, `PULSE`, `MsgNotify`, `SIN COS TAN ASIN ACOS ATAN2 SQRT ABS`, geometric operator `:`
- Faithful KRL rules: integer division, operator priority (`(a > 1) AND (b < 2)`), DECL at the top of a routine, error on uninitialized variables
- Clear error messages with line number and a hint
- 3D: axis limits, singularity and reachability checks, TCP path trace, gripper and pick-and-place parts
- Step-by-step execution, override (OV), variable watch, I/O panel, jog and teach
- 8 lessons + free mode

## Running locally

```bash
npm run build                 # app.html -> index.html
python3 -m http.server 8080   # then open http://localhost:8080
npm test                      # kinematics, interpreter and lesson tests
```

GitHub Pages: in the repo settings, point Pages at the root of the `main` branch.

## Structure

| File | What it does |
|---|---|
| `src/krl/lexer.js`, `parser.js` | Turn KRL text into an AST |
| `src/krl/interpreter.js` | Runs the AST as a generator (motion, WAIT and line events) |
| `src/kinematics.js` | Generic 6-axis robot: forward and analytic inverse kinematics |
| `src/motion.js` | PTP/LIN/CIRC trajectories and speed profile |
| `src/runner.js` | Drives the interpreter frame by frame |
| `src/scene.js` | Three.js scene |
| `src/editor.js`, `src/main.js`, `app.html` | User interface |
| `src/lessons.js` | Lessons |

## Roadmap

- **Phase 1 (this):** web learning simulator
- Phase 1.x: approximate positioning (`C_DIS`, `C_PTP`) blending, `INTERRUPT`, `TRIGGER`, `STRUC/ENUM`, `.src/.dat` import/export, more languages
- **Phase 2:** open-source desktop app (real KRL projects, connection to a KUKA controller, e.g. via KukavarProxy)

## License

MIT
