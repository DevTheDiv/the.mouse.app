# TheMouse.app

A Windows desktop tool for real-time mouse customization, built for aim trainers and competitive gaming. Intercepts raw mouse input at the kernel level via the [Interception](http://www.oblita.com/interception.html) driver and applies modifications before they reach any game or application.

Four independent modules — run any combination, or none (pass-through):

| Module | What it does |
|---|---|
| **Sensitivity** | Applies unified or independent horizontal and vertical multipliers |
| **Sensitivity Randomizer** | Randomizes your sensitivity on a configurable curve during practice sessions |
| **Acceleration Curve** | Maps axial mouse speed (mm/s) to sensitivity multipliers via custom curves |
| **Angle Correction** | Rotates raw input to compensate for physical mouse grip tilt |

---

## Requirements

- Windows 10/11 x64
- **Secure Boot must be disabled** (required by the Interception driver)
- Visual Studio 2022 with "Desktop development with C++" (to build from source)
- Node.js 18+ (to build from source)

---

## Installation

### From a release build

1. Run `TheMouse.app Setup.exe` — or use the portable `win-unpacked\` folder directly.
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

Output lands in `build\` — `win-unpacked\` for the portable version and `TheMouse.app Setup.exe` for the installer.

---

## Modules

### Sensitivity (formerly X/Y Decoupling)

Applies a constant multiplier to your mouse movement. Supports both linked and independent axis control.

- **Linked Mode** — a single slider controls both X and Y axes for perfect uniformity.
- **Decoupled Mode** — set independent horizontal and vertical multipliers. Useful for aspect ratio corrections (e.g. 16:9 → 4:3) or fine-tuning vertical feel.

| Setting | Default | Description |
|---|---|---|
| `X_Sensitivity` | `1` | Horizontal axis multiplier |
| `Y_Sensitivity` | `1` | Vertical axis multiplier |

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

### Acceleration Curve

Maps raw mouse speed (mm/s) to a sensitivity multiplier using custom curves. Features **True Axial Independence** — horizontal and vertical multipliers are calculated based on their own axial velocities.

**Editor features:**
- **Split X/Y Mode**: Draw completely independent curves for horizontal and vertical acceleration.
- **Visibility & Locking**: Toggle visibility or lock curves to edit one without affecting the other.
- **Professional Visualizer**: High-fidelity live dots with trails, crosshairs, and axis labels show your exact speed and multiplier in real-time (30Hz).
- **Point Types**: Smooth (Hermite spline), corner (linear), and jump (step) — double-click to cycle.
- **Interaction**: Scroll to zoom, middle-drag to pan, Shift to snap to grid.

### Angle Correction

Compensates for physical mouse grip tilt. If you hold your mouse at an angle, straight physical movements become diagonal on screen — this rotates the raw input back to align with your hand.

- **Interactive dial** — drag to set rotation visually, or type an exact value
- Range: **-180° to +180°**
- Applied first in the pipeline, before sensitivity and acceleration

| Setting | Default | Description |
|---|---|---|
| `Angle_Enabled` | `0` | `1` = rotation active |
| `Angle_Value` | `0` | Degrees of rotation (-180 to 180) |

---

## Settings

### Windows Mouse Settings

Directly control Windows system-level settings within the app:
- **Enhance Pointer Precision**: Toggle the built-in Windows mouse acceleration.
- **Pointer Speed**: Adjust the base Windows sensitivity (1-20).

### Global hotkeys

Configurable system-wide shortcuts.

| Setting | Default | Description |
|---|---|---|
| `Hotkey_StartStop` | `Ctrl+F12` | Toggle the app on/off from anywhere |
| `Hotkey_Pause` | `None` | Pause/resume the randomizer |

### Persistence & Reliability

- **State Persistence**: The app remembers if the engine was active and automatically resumes on startup.
- **Auto-Recovery**: Automatically repairs or regenerates `settings.ini` if it becomes missing or corrupted.
- **Migration**: Seamlessly merges new features and defaults when upgrading from older versions.

---

## Usage

- **Start / Stop** from the Dashboard, system tray, or via **Ctrl+F12**.
- **Close** hides to tray. Right-click tray icon → **Quit** to exit fully.
- **Apply** settings to restart the driver and activate changes.

---

## Driver notes

The Interception driver requires:
- Secure Boot **disabled** in BIOS/UEFI
- A **reboot** after install before the driver is active
- Admin privileges only for install/uninstall — normal use requires no elevation

When the app is stopped, the Interception driver is a transparent pass-through — your mouse behaves completely normally.

---

## Credits

The sensitivity randomizer engine originated from [Whisper & El Bad](https://github.com/Whisperrr/SensitivityRandomizer). This project has since grown into a standalone mouse customization tool and is maintained independently.
