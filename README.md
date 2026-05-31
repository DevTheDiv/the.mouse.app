# the.mouse.app

A Windows desktop tool for real-time mouse customization, built for aim trainers and competitive gaming. Intercepts raw mouse input at the kernel level via the [Interception](http://www.oblita.com/interception.html) driver and applies modifications before they reach any game or application.

Three independent modules — run any combination, or none (pass-through):

| Module | What it does |
|---|---|
| **Sensitivity Randomizer** | Randomizes your sensitivity on a configurable curve during practice sessions |
| **X/Y Decoupling** | Applies independent horizontal and vertical multipliers |
| **Acceleration Curve** | Maps mouse speed (mm/s) to a sensitivity multiplier via a custom curve |

---

## Requirements

- Windows 10/11 x64
- **Secure Boot must be disabled** (required by the Interception driver)
- Visual Studio 2022 with "Desktop development with C++" (to build from source)
- Node.js 18+ (to build from source)

---

## Installation

### From a release build

1. Run `the.mouse.app Setup.exe` — or use the portable `win-unpacked\` folder directly.
2. On first launch the app installs to the system tray and enables auto-start.
3. Go to **Settings → Interception Driver → Install Driver** and follow the UAC prompt.
4. **Reboot.** The driver requires a reboot to activate.
5. Configure your modules and hit **Start** from the Dashboard.

### Building from source

```powershell
.\build.ps1           # full build: C++ → Vite → electron-builder
.\build.ps1 -SkipCpp  # UI only (C++ already built)
.\build.ps1 -SkipUi   # C++ only
```

Output lands in `build\` — `win-unpacked\` for the portable version and `the.mouse.app Setup.exe` for the installer.

---

## Modules

### Sensitivity Randomizer

Randomizes your sensitivity multiplier over time using a stateful random walk. Two modes:

- **Smooth** — continuous Gaussian-filtered curve, gradual and flowing transitions
- **Step** — discrete jumps held for a configurable number of seconds

Designed for aim trainers like [Kovaak's](https://store.steampowered.com/app/824270/KovaaKs_FPS_Aim_Trainer/). Varying sensitivity during practice builds adaptability and fine motor control beyond what a fixed sensitivity can.

| Setting | Default | Description |
|---|---|---|
| `Baseline_Sensitivity` | `1` | Center of the randomization range |
| `Min_Sensitivity` | `0.5` | Lower bound multiplier |
| `Max_Sensitivity` | `2` | Upper bound multiplier |
| `Spread` | `0.1` | Lognormal variance — how far sensitivity wanders from baseline |
| `Smooth` | `1` | `1` = smooth mode, `0` = step mode |
| `Smoothing` | `5` | Smooth mode only. `0` = raw noise, `5` = maximum smoothing |
| `Timestep` | `3` | Step mode only. Seconds each value is held |

### X/Y Decoupling

Applies a constant independent multiplier to each axis. Useful for:
- Correcting aspect ratio mismatches (e.g. 16:9 → 4:3: Y × 0.5625)
- Matching horizontal/vertical feel across different games
- Fine-tuning vertical sensitivity independently of horizontal

| Setting | Default | Description |
|---|---|---|
| `X_Sensitivity` | `1` | Horizontal axis multiplier |
| `Y_Sensitivity` | `1` | Vertical axis multiplier |

### Acceleration Curve

Maps raw mouse speed (mm/s) to a sensitivity multiplier using a custom curve you draw in the editor. The curve is pre-computed into a 512-entry lookup table and applied on the hot path with a single array lookup — no runtime math.

**Editor features:**
- Smooth (Hermite spline), corner (linear), and jump (step) point types — double-click to cycle
- Multi-curve mode: independent X and Y curves
- Scroll to zoom, middle-drag to pan, Shift to snap to grid
- Hover the axis label strips to scale only that axis
- Live dot and trail shows where your current mouse speed falls on the curve in real-time
- DPI-aware X-axis — set your mouse DPI in Settings to display speed in mm/s

| Setting | Default | Description |
|---|---|---|
| `Mouse_DPI` | `800` | Your mouse DPI, used for mm/s display in the curve editor |

---

## Settings

All settings are managed through the UI and written to `settings.ini`. You can also edit the file directly — the app reads it on each start.

### Global hotkeys

Configurable system-wide shortcuts — set them in **Settings → Global Hotkeys**.

| Setting | Description |
|---|---|
| `Hotkey_StartStop` | Toggle the app on/off from anywhere |
| `Hotkey_Pause` | Pause/resume the randomizer |

---

## Usage

- **Start / Stop** from the Dashboard or the tray right-click menu.
- **Pause / Resume** — use the configured hotkey, or press **P** in the console window.
- **Close** hides to tray. Right-click tray icon → **Quit** to exit fully.
- Each module has its own enable toggle — disabling a module is a pass-through for that transform.

---

## Driver notes

The Interception driver requires:
- Secure Boot **disabled** in BIOS/UEFI
- A **reboot** after install before the driver is active
- A **reboot** after uninstall before the driver files are fully removed
- Admin privileges only for install/uninstall — normal use requires no elevation

When the app is stopped, the Interception driver is a transparent pass-through — your mouse behaves completely normally.

---

## Credits

The sensitivity randomizer engine originated from [Whisper & El Bad](https://github.com/Whisperrr/SensitivityRandomizer). This project has since grown into a standalone mouse customization tool and is maintained independently.
