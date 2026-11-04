// Lessons. Each lesson: short theory, an exercise, and a starting program.
export const LESSONS = [
  {
    id: 'ptp-axes',
    title: '1. Axes and PTP',
    text: `
<p>The robot has 6 axes: <b>A1</b> (base rotation), <b>A2</b> (shoulder), <b>A3</b> (elbow), <b>A4</b>, <b>A5</b>, <b>A6</b> (wrist).</p>
<p><code>PTP</code> (point-to-point) moves the robot the fastest way: all axes start together and stop together. The tool path is <i>not</i> a straight line (grey dashed line).</p>
<p><code>HOME</code> is a predefined point: <code>{A1 0, A2 -90, A3 90, A4 0, A5 0, A6 0}</code>. Axes you leave out of an aggregate stay where they are.</p>
<p class="task"><b>Exercise:</b> add a line that turns A6 by 180°. Then try -200 for A2 and see what happens.</p>`,
    code: `DEF lesson1()
  ; PTP: motion in axis space
  PTP HOME
  PTP {A1 45}             ; only A1 turns
  PTP {A2 -60, A3 60}     ; shoulder and elbow
  PTP {A5 60}             ; wrist bends
  PTP {A1 -45, A4 90, A6 -90}
  PTP HOME
END
`,
  },
  {
    id: 'cartesian',
    title: '2. Cartesian points',
    text: `
<p>A point can also be given in space instead of in axes: <code>X, Y, Z</code> (mm) and the orientation <code>A, B, C</code> (degrees). <b>A</b> rotates about Z, <b>B</b> about Y, <b>C</b> about X.</p>
<p><code>B 90</code> means the tool points down. Points are stored in variables declared with <code>DECL E6POS</code>. You can change a single component: <code>P2.Z = 450</code>.</p>
<p>If the robot cannot reach a point, the simulator shows an error. The reach is about 950 mm.</p>
<p class="task"><b>Exercise:</b> create a point P3 (X 450, Y 0, Z 800) and send the robot there. Then set X to 1500 and read the error message.</p>`,
    code: `DEF lesson2()
  DECL E6POS P1, P2
  PTP HOME
  ; Tool points down: A 0, B 90, C 0
  P1 = {X 600, Y -250, Z 600, A 0, B 90, C 0}
  P2 = {X 600, Y 250, Z 600, A 0, B 90, C 0}
  PTP P1
  PTP P2
  P2.Z = 450              ; change only Z
  PTP P2
  PTP HOME
END
`,
  },
  {
    id: 'lin',
    title: '3. LIN: straight lines',
    text: `
<p><code>LIN</code> moves the tool centre point (TCP) along a straight line. It is used for welding, gluing and precise approaches. The path is drawn in yellow.</p>
<p>The speed is set with <code>$VEL.CP</code> in <b>m/s</b>. <code>LIN_REL</code> moves relative to the current position.</p>
<p>Note: LIN only accepts Cartesian points. Writing <code>LIN HOME</code> gives an error.</p>
<p class="task"><b>Exercise:</b> turn the square into a triangle. Then set <code>$VEL.CP</code> to 0.1 and compare.</p>`,
    code: `DEF lesson3()
  DECL E6POS P
  BAS(#INITMOV, 0)
  $VEL.CP = 0.3           ; 0.3 m/s
  PTP HOME
  P = {X 550, Y -150, Z 450, A 0, B 90, C 0}
  PTP P
  LIN {X 550, Y 150}      ; missing components are taken from the current position
  LIN {X 750, Y 150}
  LIN {X 750, Y -150}
  LIN P
  LIN_REL {Z 200}         ; 200 mm up
  PTP HOME
END
`,
  },
  {
    id: 'circ',
    title: '4. CIRC: circular arcs',
    text: `
<p><code>CIRC aux, end</code>: the robot starts at the current point and moves on an arc through the auxiliary point to the end point. Three points define one circle. The path is drawn in green.</p>
<p>With <code>CA</code> (circular angle) you set the arc angle: <code>CIRC AUX, END, CA 90</code>. A negative angle goes the other way.</p>
<p>If the three points lie on one straight line, no circle is possible and you get an error.</p>
<p class="task"><b>Exercise:</b> replace CA 90 with CA 270. Then draw a circle with a 100 mm radius.</p>`,
    code: `DEF lesson4()
  DECL E6POS START
  $VEL.CP = 0.25
  PTP HOME
  START = {X 650, Y -150, Z 450, A 0, B 90, C 0}
  PTP START
  ; full circle = two half circles
  CIRC {X 800, Y 0, Z 450}, {X 650, Y 150, Z 450}
  CIRC {X 500, Y 0, Z 450}, START
  LIN_REL {Z 100}
  ; only 90 degrees of the same circle
  CIRC {X 800, Y 0, Z 550}, {X 650, Y 150, Z 550}, CA 90
  PTP HOME
END
`,
  },
  {
    id: 'loops',
    title: '5. Variables and loops',
    text: `
<p>In KRL every variable is declared before use, at the top of the routine: <code>DECL INT i</code>, <code>DECL REAL a</code>, <code>DECL BOOL ok</code>.</p>
<p>Loops: <code>FOR i = 1 TO 4 ... ENDFOR</code>, <code>WHILE condition ... ENDWHILE</code>, <code>REPEAT ... UNTIL condition</code>, <code>LOOP ... ENDLOOP</code> (leave it with <code>EXIT</code>).</p>
<p>Note: INT division gives an integer: <code>7 / 2 = 3</code>. Watch the values in the "Variables" tab and run the program step by step (⏭).</p>
<p class="task"><b>Exercise:</b> write the same program with WHILE instead of FOR. Then try STEP 2.</p>`,
    code: `DEF lesson5()
  DECL INT i
  DECL REAL a
  DECL E6POS P
  $VEL.CP = 0.4
  PTP HOME
  P = {X 600, Y 0, Z 360, A 0, B 90, C 0}
  PTP P
  FOR i = 1 TO 4
    a = 30 * i            ; half the side of the square
    P.Z = 300 + 60 * i    ; a bit higher each time
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
    title: '6. Conditions, inputs and outputs',
    text: `
<p>The robot reads signals from sensors (<code>$IN[n]</code>) and switches devices (<code>$OUT[n]</code>). In the simulator you switch inputs in the <b>I/O</b> tab.</p>
<p><code>WAIT FOR $IN[1]</code> waits until the signal arrives. <code>WAIT SEC 0.5</code> waits for a time.</p>
<p><b>Important KRL rule:</b> comparisons bind weaker than AND/OR, so use parentheses: <code>IF (count &gt; 2) AND $IN[2] THEN</code>.</p>
<p class="task"><b>Exercise:</b> add an IF that leaves the loop immediately when $IN[3] is on.</p>`,
    code: `DEF lesson6()
  DECL INT count
  PTP HOME
  count = 0
  MsgNotify("Switch on input $IN[1] in the I/O tab")
  WAIT FOR $IN[1]
  $OUT[2] = TRUE          ; lamp on
  LOOP
    IF $IN[2] THEN
      PTP {A1 -40}
    ELSE
      PTP {A1 40}
    ENDIF
    count = count + 1
    IF count >= 6 THEN
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
    title: '7. Subroutines and functions',
    text: `
<p>Move repeated work into a subroutine: <code>DEF square(x:IN, a:IN) ... END</code>. Declare the parameters with <code>DECL</code> inside the subroutine.</p>
<p>A function that returns a value is written as <code>DEFFCT REAL name() ... ENDFCT</code> and ends with <code>RETURN</code>. An <code>:OUT</code> parameter can change the caller's variable.</p>
<p class="task"><b>Exercise:</b> write a <code>triangle(x, a)</code> subroutine and call it from the main program.</p>`,
    code: `DEF lesson7()
  DECL INT i
  $VEL.CP = 0.4
  PTP HOME
  FOR i = 1 TO 3
    square(480 + i * 70, 100)
  ENDFOR
  MsgNotify("Area of the square:", area(100.0), "mm2")
  PTP HOME
END

DEF square(x:IN, a:IN)
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

DEFFCT REAL area(a:IN)
  DECL REAL a
  RETURN a * a
ENDFCT
`,
  },
  {
    id: 'pick',
    title: '8. Pick and place (gripper)',
    text: `
<p>A real application: carry the three cubes on the table to the yellow marks. The gripper is controlled with <code>$OUT[1]</code>: <code>TRUE</code> closes it (grip), <code>FALSE</code> opens it.</p>
<p><code>BAS(#TOOL, 1)</code> selects the tool: <code>TOOL_DATA[1]</code> is the gripper tip (120 mm from the flange, tool direction X). After that every point refers to the gripper tip.</p>
<p>Good practice: approach the part from above with PTP, then go down with LIN.</p>
<p class="task"><b>Exercise:</b> stack the cubes on top of each other (each cube is 50 mm high).</p>`,
    code: `DEF lesson8()
  DECL INT i
  DECL E6POS PICK, PLACE
  BAS(#INITMOV, 0)
  BAS(#TOOL, 1)           ; gripper
  $VEL.CP = 0.5
  $OUT[1] = FALSE         ; gripper open
  PTP HOME
  FOR i = 1 TO 3
    PICK = {X 600, Y 0, Z 425, A 0, B 90, C 0}
    PICK.Y = -200 + (i - 1) * 200
    PLACE = PICK
    PLACE.X = 750
    PTP PICK              ; above the cube
    LIN_REL {Z -100}      ; go down
    $OUT[1] = TRUE        ; grip
    WAIT SEC 0.3
    LIN_REL {Z 100}
    PTP PLACE             ; above the mark
    LIN_REL {Z -98}
    $OUT[1] = FALSE       ; release
    WAIT SEC 0.3
    LIN_REL {Z 98}
  ENDFOR
  PTP HOME
END
`,
  },
  {
    id: 'free',
    title: 'Free program',
    text: `
<p>Write your own program. In the <b>Jog</b> tab you can move the robot by hand and use <b>Teach</b> to insert the current point into the code.</p>
<p>Supported: <code>PTP LIN CIRC</code> (+ <code>_REL</code>), <code>DECL</code>, <code>INT REAL BOOL CHAR E6POS POS FRAME E6AXIS AXIS</code>, <code>IF FOR WHILE REPEAT LOOP SWITCH</code>, <code>WAIT</code>, <code>$IN $OUT $VEL $VEL_AXIS $TOOL $BASE $POS_ACT $AXIS_ACT $TIMER</code>, <code>BAS PULSE MsgNotify</code>, <code>SIN COS TAN ACOS ATAN2 SQRT ABS</code>, the geometric operator <code>:</code>.</p>`,
    code: `DEF main()
  ; write your program here
  PTP HOME

END
`,
  },
];
