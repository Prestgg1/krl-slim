# KRL Lab Desktop: plan (phase 2)

Status: **draft for review**. No code yet. Nothing in this plan connects to a physical robot; every step that touches real hardware needs the owner's explicit approval first (see [Safety](#5-safety-requirements)).

## 1. Goal

A free, open-source (MIT) desktop app for writing, checking, simulating and (later) deploying KUKA KRL programs to real controllers. Phase 1 (the browser simulator in this repo) stays the learning tool; the desktop app reuses its KRL core and adds real-project workflows.

Non-goals for the first desktop release:

- Replacing KUKA WorkVisual or KUKA.Sim (no controller configuration, no bus/fieldbus setup, no safety configuration).
- Real-time motion control of a robot from the PC.
- Supporting other robot brands. The core is designed so this can come later (ABB RAPID, Fanuc TP, URScript), but KRL comes first.

## 2. What already exists (open source landscape)

| Project | What it is | License | How we use it |
|---|---|---|---|
| This repo (`src/krl`, `kinematics.js`, `motion.js`) | Our own KRL lexer, parser, interpreter, IK, trajectory planner | MIT (ours) | The shared core of the desktop app |
| [OpenKuka](https://openkuka.github.io) ([repo](https://github.com/OpenKuka/openkuka.github.io)) | Community KRL language reference (types, system variables, functions, messages) in YAML | **Unverified.** No license file was visible on the site repo when checked. | Read as reference only until a license is confirmed. If it is MIT, we can import the YAML for autocomplete/hover docs with attribution. |
| [kuka-ros/kuka_drivers](https://github.com/kuka-ros/kuka_drivers) (`kuka_rsi_driver`) | KUKA-maintained ROS 2 drivers for RSI, EKI, mxAutomation, iiQKA | Apache-2.0 | Reference for the RSI/EKI protocols and XML formats. Apache-2.0 is MIT-compatible, so small parts may be reused with the NOTICE kept. |
| ROS-Industrial `kuka_experimental` (`kuka_rsi_hw_interface`, `kuka_eki_hw_interface`) | Older ROS 1 RSI/EKI interfaces | Apache-2.0 / BSD (check per package) | Protocol reference |
| KukavarProxy (IMTS) | KRC-side TCP server (port 7000) that reads/writes global variables via the KUKA cross-comm interface | No clear license found | **Do not copy or redistribute.** Users can install it themselves; we write our own client from the protocol description. |
| KukavarClient / OpenShowVar clients | PC-side clients for KukavarProxy | No license | **Do not copy code.** Clean-room implementation only. |
| KUKA official options: RSI, EKI (Ethernet KRL), mxAutomation, OPC UA | Paid controller options | Proprietary | We talk to them over their documented network protocols, only when the user owns the option |

Takeaway: nothing open source covers "KRL IDE + simulator + deploy" end to end. The parts we must write ourselves are the IDE, the simulator (we have it) and a clean, permissively licensed communication layer.

## 3. Stack

**Recommendation: Tauri 2 (Rust backend, web frontend) with the existing JS KRL core.**

| Option | Pros | Cons |
|---|---|---|
| **Tauri 2** (recommended) | Small installers (~10 MB), low RAM, Rust for the network/safety layer (memory safe, good for long-running sockets), reuses our HTML/JS/Three.js UI, auto-updater, Windows/Linux/macOS | Two languages (JS + Rust); WebView differs per OS (WebView2 on Windows, WebKitGTK on Linux), so Three.js must be tested on each |
| Electron | One language (JS/Node), same Chromium everywhere, huge ecosystem | ~150 MB installers, heavier RAM; the comms layer would be Node, which is fine but less strict |
| Qt / C++ | Native, used by industrial tools | Rewrite of everything we have; slower to build |

Why Tauri: most KUKA users are on Windows shop-floor PCs, often old ones; small and light matters. The robot-communication code is the part where bugs cost the most, and Rust is the best fit for it. If Rust is a blocker for contributors, Electron is the fallback and the architecture below does not change.

Other choices:

- **Editor:** Monaco (the VS Code editor) with a KRL language definition, or CodeMirror 6 (lighter). Recommend CodeMirror 6 for size.
- **3D:** keep Three.js. Load robot models from URDF + meshes (generic models first; real KUKA models only from sources whose license allows it).
- **KRL language server:** wrap our parser as an LSP server (Node or WASM). This also gives a free VS Code extension as a side product.
- **Packaging:** GitHub Actions builds signed installers for Windows (MSI), Linux (AppImage/deb) and macOS (dmg).
- **Tests:** keep `node test/*.mjs` for the core; add Rust unit tests and a **mock KRC** (fake controller server) for all comms tests. CI never talks to real hardware.

## 4. Architecture

```
┌────────────────────────── Desktop app (Tauri) ──────────────────────────┐
│  UI (web)                                                               │
│   ├─ Project explorer (.src/.dat, R1/Program, KRC/R1/System)            │
│   ├─ KRL editor (CodeMirror + LSP: errors, autocomplete, go-to-def)     │
│   ├─ 3D simulator (Three.js, reused from phase 1)                       │
│   └─ Online panel (variables, I/O, messages) — read-only by default     │
│                                                                         │
│  packages/krl-core  (shared with the web app, pure JS, no DOM)          │
│   ├─ lexer / parser / interpreter / kinematics / motion                 │
│   └─ project model: multiple .src/.dat files, GLOBAL, $config.dat       │
│                                                                         │
│  Rust backend                                                           │
│   ├─ file system + project import/export (KRC archive .zip)             │
│   ├─ comms crate: transport adapters (see below), all behind one trait  │
│   └─ safety gate: every write/motion request passes through it          │
└─────────────────────────────────────────────────────────────────────────┘
                 │  (only when the user explicitly goes online)
                 ▼
        KUKA KRC4 / KRC5 controller on the cell network
```

### Repository layout

Turn this repo into a small monorepo:

```
packages/krl-core/    shared KRL engine (moved from src/krl, kinematics, motion)
apps/web/             phase 1 browser simulator (current app)
apps/desktop/         Tauri app
crates/krl-comms/     Rust communication layer
tools/mock-krc/       fake controller for tests and demos
```

The web app keeps working and keeps deploying to GitHub Pages.

### Communication layer (our own design)

One Rust trait, several adapters, added in this order:

1. **Offline / file transfer (no live link).** Export a project as files or a KRC-style archive, user copies it with a USB stick or WorkVisual. Zero risk, covers most users. *First release.*
2. **Variable monitor (read-only)** via a KukavarProxy-compatible protocol. Clean-room client written from the public description of the message format (message id, length, mode read/write, variable name, value). Writes disabled in the first versions.
3. **Network file share** to the controller's program folder (when the integrator has set it up), with diff and backup before upload.
4. **EKI / OPC UA** for users who own those options: read variables, I/O status, messages.
5. **RSI** (real-time path correction) only much later, if ever. It needs real-time timing (4 or 12 ms cycles) and has the highest risk.

Each adapter declares its capabilities (`read_vars`, `write_vars`, `upload_files`, `start_program`, `motion`), and the UI only shows what the adapter can do *and* the safety gate allows.

## 5. Safety requirements

A KUKA robot can kill a person. The software must assume the user can make mistakes and must never be the only safeguard.

**Hard rules (part of the design, not options):**

1. **The app never replaces the controller's safety.** E-stop, enabling switch, safety fences, SafeOperation and operating modes (T1/T2/AUT/EXT) stay on the controller and the smartPAD. The app never tries to change or bypass them.
2. **Offline by default.** A fresh install has no robot connections. Going online is an explicit action with a visible, always-on "ONLINE: <robot name>" banner.
3. **Read-only by default.** Writing variables, uploading programs or starting programs are separate permissions per robot profile, off by default, each turned on with a confirmation that names the robot and its IP.
4. **No motion commands from the PC in the first releases.** No jogging, no `PTP` sent live, no program start. Programs are uploaded and then started by a person at the smartPAD, in T1 first.
5. **Simulate before upload.** An upload is blocked unless the same program version ran in the simulator without errors (reachability, axis limits, singularities). The user can override only with a typed confirmation, and the override is logged.
6. **Diff, backup, confirm.** Before any upload: show a diff against the controller's current file, download a backup, then ask for confirmation.
7. **Allow-list for writes.** Variable writes only to variables the user listed in the robot profile (e.g. `MY_FLAG`, `COUNTER`). System variables (`$OV_PRO`, `$TOOL`, `$BASE`, `$OUT[...]` driving safety-relevant outputs) are never writable from the app.
8. **Audit log.** Every connect, read session, write, upload and override is logged locally with time, user and robot.
9. **Fail safe on link loss.** If the connection drops, the app stops all pending writes, does not retry writes automatically, and shows the state clearly.
10. **Network hygiene.** Only connect to addresses in the robot profile; warn if the controller is reachable from a non-private network; no telemetry from the app.
11. **Testing.** Every comms feature is tested against `tools/mock-krc` in CI. Real-hardware tests follow a written checklist, on a robot in T1 with reduced speed, a trained operator holding the enabling switch, and the cell cleared.
12. **Clear disclaimer** in the app and README: not certified safety software, not affiliated with KUKA, provided "as is" (the MIT license already says this).

**For this project's own work:** no session of ours connects to a physical robot or sends any command to real hardware without the owner's explicit, per-occasion approval.

## 6. Roadmap

| Milestone | Content | Hardware needed |
|---|---|---|
| **M0: core split** | Move KRL engine to `packages/krl-core`, web app unchanged, tests green | None |
| **M1: offline IDE** | Tauri shell, project explorer, multi-file `.src/.dat`, editor with LSP errors, built-in simulator, export to files/archive | None |
| **M1.1: language** | `C_DIS/C_PTP` blending, `INTERRUPT`, `TRIGGER`, `STRUC/ENUM`, `GLOBAL`, `$config.dat` | None |
| **M2: mock KRC** | Fake controller server; read-only variable monitor UI tested against it | None |
| **M3: read-only online** | KukavarProxy-compatible read-only client, robot profiles, online banner, audit log | A test controller or KUKA.OfficeLite (with owner approval) |
| **M4: upload** | Diff, backup, simulate-before-upload gate, upload via network share | Test controller (with owner approval) |
| **M5: optional adapters** | EKI / OPC UA read; limited allow-listed variable writes | Controller with those options (with owner approval) |

## 7. Open questions for the owner

1. Which controllers and software do you (or your users) have: KRC4 or KRC5, KSS 8.x version, any options (EKI, RSI, OPC UA, KukavarProxy already installed)?
2. Is there a test robot or KUKA.OfficeLite available, and who would be the trained operator for real tests?
3. Tauri (Rust) or Electron (all JS)? Tauri is recommended; Electron if you prefer one language.
4. Is "offline IDE + export" a good first release, with live connection only from M3?
5. Which UI languages besides English (Azerbaijani, Turkish, Russian)?
6. Keep one repo (`krl-slim` as a monorepo) or start a separate `krl-desktop` repo?
7. Should we contact the OpenKuka maintainers to confirm the license of their KRL reference before we use it?
