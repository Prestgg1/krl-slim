# KRL Lab

Pulsuz, açıq mənbəli **KRL (KUKA Robot Language) öyrənmə simulyatoru**. Brauzerdə KRL kodu yazın və ümumi (generic) 6 oxlu sənaye robotunun onu 3D-də icra etməsinə baxın. Quraşdırma tələb etmir.

> Bu layihə KUKA AG ilə əlaqəli deyil. "KUKA" və "KRL" öz sahiblərinin ticarət nişanlarıdır. Robot modeli ümumidir, heç bir KUKA məhsulunun dəqiq modeli deyil.

## İmkanlar (Faza 1)

- **Hərəkət:** `PTP`, `LIN`, `CIRC` (+ `_REL`, `CA`), `SPTP/SLIN/SCIRC` sintaksisi
- **Proqramlaşdırma:** `DEF/END`, `DEFFCT/ENDFCT`, `DEFDAT`, `DECL` (`INT REAL BOOL CHAR E6POS POS FRAME E6AXIS AXIS`, massivlər), `IF/ELSE`, `FOR/STEP`, `WHILE`, `REPEAT/UNTIL`, `LOOP/EXIT`, `SWITCH/CASE`, `WAIT SEC`, `WAIT FOR`, `HALT`, `:IN/:OUT` parametrləri
- **Sistem dəyişənləri:** `$IN $OUT $VEL $VEL_AXIS $ACC $OV_PRO $TOOL $BASE $POS_ACT $AXIS_ACT $TIMER $NULLFRAME`, `HOME`, `TOOL_DATA[] BASE_DATA[]`
- **Funksiyalar:** `BAS(#INITMOV|#PTP_PARAMS|#CP_PARAMS|#TOOL|#BASE)`, `PULSE`, `MsgNotify`, `SIN COS TAN ASIN ACOS ATAN2 SQRT ABS`, həndəsi operator `:`
- KRL-ə sadiq qaydalar: INT bölməsi, operator prioriteti (`(a > 1) AND (b < 2)`), DECL proqramın əvvəlində, işə salınmamış dəyişən xətası
- Azərbaycan dilində izahlı xəta mesajları (sətir nömrəsi + məsləhət)
- 3D: oxların hədləri, sinqulyarlıq və əlçatmazlıq aşkarlanması, TCP yolunun çəkilməsi, tutucu və götür-qoy hissələri
- Addım-addım icra, OV (override), dəyişənlərə baxış, I/O paneli, Jog və Teach
- 8 dərs + sərbəst rejim

## İşə salmaq

```bash
npm run build      # app.html -> index.html
python3 -m http.server 8080   # sonra http://localhost:8080
npm test           # kinematika, interpretator və dərs testləri
```

GitHub Pages: repo parametrlərində Pages-i `main` budağının kök qovluğuna yönəldin.

## Struktur

| Fayl | Nə edir |
|---|---|
| `src/krl/lexer.js`, `parser.js` | KRL mətnini AST-yə çevirir |
| `src/krl/interpreter.js` | AST-ni generator kimi icra edir (hərəkət, WAIT, sətir hadisələri) |
| `src/kinematics.js` | Ümumi 6 oxlu robot: FK və analitik IK |
| `src/motion.js` | PTP/LIN/CIRC trayektoriyaları, sürət profili |
| `src/runner.js` | İnterpretatoru kadr-kadr idarə edir |
| `src/scene.js` | Three.js səhnəsi |
| `src/editor.js`, `src/main.js`, `app.html` | İnterfeys |
| `src/lessons.js` | Dərslər |

## Yol xəritəsi

- **Faza 1 (bu):** veb öyrənmə simulyatoru
- Faza 1.x: yaxınlaşdırma (`C_DIS`, `C_PTP`) hamarlanması, `INTERRUPT`, `TRIGGER`, `STRUC/ENUM`, `.src/.dat` fayl idxalı/ixracı, ingilis dili
- **Faza 2:** açıq mənbəli desktop proqram (real KRL layihələri, KUKA robotuna qoşulma, məs. KukavarProxy vasitəsilə)

## Lisenziya

MIT
