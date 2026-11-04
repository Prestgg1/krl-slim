// Lessons (Azerbaijani). Each lesson: short theory, an exercise, and a starting program.
export const LESSONS = [
  {
    id: 'ptp-axes',
    title: '1. Oxlar və PTP',
    text: `
<p>Robotun 6 oxu var: <b>A1</b> (gövdənin fırlanması), <b>A2</b> (çiyin), <b>A3</b> (dirsək), <b>A4</b>, <b>A5</b>, <b>A6</b> (bilək).</p>
<p><code>PTP</code> (point-to-point) əmri robotu ən sürətli yolla aparır: bütün oxlar eyni anda başlayır və eyni anda dayanır. Alətin yolu düz xətt <i>deyil</i> (boz qırıq xətt).</p>
<p><code>HOME</code> hazır nöqtədir: <code>{A1 0, A2 -90, A3 90, A4 0, A5 0, A6 0}</code>. Aqreqatda yazılmayan oxlar yerində qalır.</p>
<p class="task"><b>Tapşırıq:</b> A6 oxunu 180° fırladan bir sətir əlavə edin. Sonra A2 üçün -200 yazıb nə baş verdiyinə baxın.</p>`,
    code: `DEF dars1()
  ; PTP: oxlar fəzasında hərəkət
  PTP HOME
  PTP {A1 45}             ; yalnız A1 dönür
  PTP {A2 -60, A3 60}     ; çiyin və dirsək
  PTP {A5 60}             ; bilək əyilir
  PTP {A1 -45, A4 90, A6 -90}
  PTP HOME
END
`,
  },
  {
    id: 'cartesian',
    title: '2. Kartezian nöqtələr',
    text: `
<p>Nöqtəni oxlarla yox, fəzada da vermək olar: <code>X, Y, Z</code> (mm) və oriyentasiya <code>A, B, C</code> (dərəcə). <b>A</b> Z ətrafında, <b>B</b> Y ətrafında, <b>C</b> X ətrafında fırlanmadır.</p>
<p><code>B 90</code> alətin aşağı baxması deməkdir. Nöqtələri <code>DECL E6POS</code> ilə elan edib saxlayırıq. Bir komponenti ayrıca dəyişmək olar: <code>P2.Z = 450</code>.</p>
<p>Robot nöqtəyə çata bilmirsə, simulyator xəta göstərir. Çatma radiusu təxminən 950 mm-dir.</p>
<p class="task"><b>Tapşırıq:</b> P3 nöqtəsini yaradın (X 450, Y 0, Z 800) və robotu ora göndərin. Sonra X-i 1500 edin və xəta mesajını oxuyun.</p>`,
    code: `DEF dars2()
  DECL E6POS P1, P2
  PTP HOME
  ; Alət aşağı baxır: A 0, B 90, C 0
  P1 = {X 600, Y -250, Z 600, A 0, B 90, C 0}
  P2 = {X 600, Y 250, Z 600, A 0, B 90, C 0}
  PTP P1
  PTP P2
  P2.Z = 450              ; yalnız Z dəyişir
  PTP P2
  PTP HOME
END
`,
  },
  {
    id: 'lin',
    title: '3. LIN: düz xətt',
    text: `
<p><code>LIN</code> aləti (TCP) düz xətt üzrə aparır. Qaynaq, yapışqan çəkmə və dəqiq yaxınlaşma üçün istifadə olunur. Yol sarı rəngdə çəkilir.</p>
<p>Sürət <code>$VEL.CP</code> ilə verilir (<b>m/s</b>). <code>LIN_REL</code> cari mövqeyə nisbətən hərəkətdir.</p>
<p>Diqqət: LIN yalnız Kartezian nöqtə qəbul edir. <code>LIN HOME</code> yazsanız xəta alacaqsınız.</p>
<p class="task"><b>Tapşırıq:</b> Kvadratı üçbucağa çevirin. Sonra <code>$VEL.CP</code>-ni 0.1 edib fərqi görün.</p>`,
    code: `DEF dars3()
  DECL E6POS P
  BAS(#INITMOV, 0)
  $VEL.CP = 0.3           ; 0.3 m/s
  PTP HOME
  P = {X 550, Y -150, Z 450, A 0, B 90, C 0}
  PTP P
  LIN {X 550, Y 150}      ; yazılmayan komponentlər cari mövqedən götürülür
  LIN {X 750, Y 150}
  LIN {X 750, Y -150}
  LIN P
  LIN_REL {Z 200}         ; 200 mm yuxarı
  PTP HOME
END
`,
  },
  {
    id: 'circ',
    title: '4. CIRC: dairəvi qövs',
    text: `
<p><code>CIRC köməkçi, son</code>: robot cari nöqtədən başlayıb köməkçi nöqtədən keçən qövslə son nöqtəyə gedir. Üç nöqtə bir dairəni təyin edir. Yol yaşıl rəngdə çəkilir.</p>
<p><code>CA</code> (circular angle) ilə qövsün bucağını verə bilərsiniz: <code>CIRC AUX, END, CA 90</code>. Mənfi bucaq əks istiqamətdir.</p>
<p>Üç nöqtə bir düz xətt üzərindədirsə, dairə qurmaq olmur və xəta alırsınız.</p>
<p class="task"><b>Tapşırıq:</b> CA 90 əvəzinə CA 270 yazın. Sonra radiusu 100 mm olan dairə çəkin.</p>`,
    code: `DEF dars4()
  DECL E6POS START
  $VEL.CP = 0.25
  PTP HOME
  START = {X 650, Y -150, Z 450, A 0, B 90, C 0}
  PTP START
  ; tam dairə = iki yarımdairə
  CIRC {X 800, Y 0, Z 450}, {X 650, Y 150, Z 450}
  CIRC {X 500, Y 0, Z 450}, START
  LIN_REL {Z 100}
  ; eyni dairənin yalnız 90 dərəcəsi
  CIRC {X 800, Y 0, Z 550}, {X 650, Y 150, Z 550}, CA 90
  PTP HOME
END
`,
  },
  {
    id: 'loops',
    title: '5. Dəyişənlər və dövrlər',
    text: `
<p>KRL-də hər dəyişən istifadədən əvvəl, proqramın əvvəlində elan olunur: <code>DECL INT i</code>, <code>DECL REAL a</code>, <code>DECL BOOL ok</code>.</p>
<p>Dövrlər: <code>FOR i = 1 TO 4 ... ENDFOR</code>, <code>WHILE şərt ... ENDWHILE</code>, <code>REPEAT ... UNTIL şərt</code>, <code>LOOP ... ENDLOOP</code> (<code>EXIT</code> ilə çıxılır).</p>
<p>Diqqət: INT bölməsi tam ədəd verir: <code>7 / 2 = 3</code>. Sağ paneldə "Dəyişənlər" bölməsindən dəyərləri izləyin. Addım-addım (⏭) icra edin.</p>
<p class="task"><b>Tapşırıq:</b> FOR əvəzinə WHILE ilə eyni proqramı yazın. Sonra STEP 2 istifadə edin.</p>`,
    code: `DEF dars5()
  DECL INT i
  DECL REAL a
  DECL E6POS P
  $VEL.CP = 0.4
  PTP HOME
  P = {X 600, Y 0, Z 360, A 0, B 90, C 0}
  PTP P
  FOR i = 1 TO 4
    a = 30 * i            ; kvadratın yarım tərəfi
    P.Z = 300 + 60 * i    ; hər dəfə yuxarı
    P.X = 620 - a
    P.Y = -a
    LIN P
    P.Y = a
    LIN P
    P.X = 620 + a
    LIN P
    P.Y = -a
    LIN P
    P.X = 620 - a
    LIN P
  ENDFOR
  PTP HOME
END
`,
  },
  {
    id: 'io',
    title: '6. Şərtlər, giriş və çıxışlar',
    text: `
<p>Robot sensorlardan siqnal alır (<code>$IN[n]</code>) və cihazları idarə edir (<code>$OUT[n]</code>). Simulyatorda girişləri sağdakı <b>I/O</b> panelindən yandırırsınız.</p>
<p><code>WAIT FOR $IN[1]</code> siqnal gələnə qədər gözləyir. <code>WAIT SEC 0.5</code> vaxt gözləməsidir.</p>
<p><b>Vacib KRL qaydası:</b> müqayisələr AND/OR-dan zəif bağlanır, ona görə mötərizə yazın: <code>IF (say &gt; 2) AND $IN[2] THEN</code>.</p>
<p class="task"><b>Tapşırıq:</b> $IN[3] yanarsa dövrdən dərhal çıxan bir IF əlavə edin.</p>`,
    code: `DEF dars6()
  DECL INT say
  PTP HOME
  say = 0
  MsgNotify("I/O panelindən $IN[1] girişini yandırın")
  WAIT FOR $IN[1]
  $OUT[2] = TRUE          ; lampa yanır
  LOOP
    IF $IN[2] THEN
      PTP {A1 -40}
    ELSE
      PTP {A1 40}
    ENDIF
    say = say + 1
    IF say >= 6 THEN
      EXIT
    ENDIF
    WAIT SEC 0.5
  ENDLOOP
  $OUT[2] = FALSE
  PTP HOME
END
`,
  },
  {
    id: 'subs',
    title: '7. Alt proqramlar və funksiyalar',
    text: `
<p>Təkrarlanan işi alt proqrama çıxarın: <code>DEF kvadrat(x:IN, a:IN) ... END</code>. Parametrləri alt proqramın içində <code>DECL</code> ilə elan edin.</p>
<p>Dəyər qaytaran funksiya <code>DEFFCT REAL ad() ... ENDFCT</code> ilə yazılır və <code>RETURN</code> ilə bitir. <code>:OUT</code> parametri çağıranın dəyişənini dəyişə bilir.</p>
<p class="task"><b>Tapşırıq:</b> <code>ucbucaq(x, a)</code> alt proqramı yazıb əsas proqramdan çağırın.</p>`,
    code: `DEF dars7()
  DECL INT i
  $VEL.CP = 0.4
  PTP HOME
  FOR i = 1 TO 3
    kvadrat(480 + i * 70, 100)
  ENDFOR
  MsgNotify("Kvadratın sahəsi:", sahe(100.0), "mm2")
  PTP HOME
END

DEF kvadrat(x:IN, a:IN)
  DECL REAL x, a
  DECL E6POS P
  P = {X 0, Y 0, Z 420, A 0, B 90, C 0}
  P.X = x
  P.Y = -a / 2
  PTP P
  P.Y = a / 2
  LIN P
  P.X = x + a / 2
  LIN P
  P.Y = -a / 2
  LIN P
  P.X = x
  LIN P
END

DEFFCT REAL sahe(a:IN)
  DECL REAL a
  RETURN a * a
ENDFCT
`,
  },
  {
    id: 'pick',
    title: '8. Götür və qoy (tutucu)',
    text: `
<p>Real tətbiq: masadakı üç kubu sarı işarələrə daşımaq. Tutucu <code>$OUT[1]</code> ilə idarə olunur: <code>TRUE</code> bağlanır (tutur), <code>FALSE</code> açılır.</p>
<p><code>BAS(#TOOL, 1)</code> aləti seçir: <code>TOOL_DATA[1]</code> tutucunun ucudur (flansdan 120 mm, alət istiqaməti X). Bundan sonra bütün nöqtələr tutucunun ucuna aiddir.</p>
<p>Yaxşı təcrübə: hissəyə əvvəlcə yuxarıdan PTP ilə yaxınlaşın, sonra LIN ilə enin.</p>
<p class="task"><b>Tapşırıq:</b> Kubları üst-üstə yığın (hər kub 50 mm hündürdür).</p>`,
    code: `DEF dars8()
  DECL INT i
  DECL E6POS GOTUR, QOY
  BAS(#INITMOV, 0)
  BAS(#TOOL, 1)           ; tutucu
  $VEL.CP = 0.5
  $OUT[1] = FALSE         ; tutucu açıq
  PTP HOME
  FOR i = 1 TO 3
    GOTUR = {X 600, Y 0, Z 425, A 0, B 90, C 0}
    GOTUR.Y = -200 + (i - 1) * 200
    QOY = GOTUR
    QOY.X = 750
    PTP GOTUR             ; kubun üstü
    LIN_REL {Z -100}      ; aşağı en
    $OUT[1] = TRUE        ; tut
    WAIT SEC 0.3
    LIN_REL {Z 100}
    PTP QOY               ; işarənin üstü
    LIN_REL {Z -98}
    $OUT[1] = FALSE       ; burax
    WAIT SEC 0.3
    LIN_REL {Z 98}
  ENDFOR
  PTP HOME
END
`,
  },
  {
    id: 'free',
    title: 'Sərbəst proqram',
    text: `
<p>Öz proqramınızı yazın. Sağdakı <b>Jog</b> panelindən robotu əl ilə hərəkət etdirib <b>Teach</b> düyməsi ilə cari nöqtəni koda əlavə edə bilərsiniz.</p>
<p>Dəstəklənənlər: <code>PTP LIN CIRC</code> (+ <code>_REL</code>), <code>DECL</code>, <code>INT REAL BOOL CHAR E6POS POS FRAME E6AXIS AXIS</code>, <code>IF FOR WHILE REPEAT LOOP SWITCH</code>, <code>WAIT</code>, <code>$IN $OUT $VEL $VEL_AXIS $TOOL $BASE $POS_ACT $AXIS_ACT $TIMER</code>, <code>BAS PULSE MsgNotify</code>, <code>SIN COS TAN ACOS ATAN2 SQRT ABS</code>, həndəsi operator <code>:</code>.</p>`,
    code: `DEF main()
  ; proqramınızı bura yazın
  PTP HOME

END
`,
  },
];
