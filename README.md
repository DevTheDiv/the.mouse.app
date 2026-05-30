# the.mouse.app

A fork of [SensitivityRandomizer](https://github.com/Whisperrr/SensitivityRandomizer) by **Whisper & El Bad** — all credit for the original C++ randomizer engine goes to them.

This fork adds:
- A desktop UI (Electron + React) with a system tray, auto-start, and live controls
- Built-in driver install / uninstall (no more bat files)
- X/Y axis decoupling — fix your horizontal/vertical ratio without touching in-game settings
- A single `build.ps1` that compiles everything end-to-end

---

## What it does

Intercepts raw mouse input at the kernel level (via the [Interception](http://www.oblita.com/interception.html) driver) and applies a randomized sensitivity multiplier in real-time. Two curve modes:

- **Smooth** — continuous Gaussian-filtered curve, gradual transitions
- **Step** — discrete jumps held for a configurable number of seconds

Designed for aim trainers like [Kovaak's FPS Aim Trainer](https://store.steampowered.com/app/824270/KovaaKs_FPS_Aim_Trainer/). The idea is that varying sensitivity during practice builds adaptability and fine motor control beyond what a single fixed sensitivity can.

---

## Requirements

- Windows 10/11 x64
- **Secure Boot must be disabled** (required by the Interception driver)
- Visual Studio 2022 with "Desktop development with C++" (to build from source)
- Node.js 18+

---

## Installation

### From a release build

1. Run `the.mouse.app Setup.exe` — or use the portable `win-unpacked\` folder directly.
2. On first launch the app installs to the system tray and enables auto-start.
3. Go to **Settings → Interception Driver → Install Driver** and follow the UAC prompt.
4. **Reboot.** The driver requires a reboot to activate.
5. Return to the **Randomizer** tab and hit **Start**.

### Building from source

```powershell
.\build.ps1           # full build: C++ -> Vite -> electron-builder
.\build.ps1 -SkipCpp  # UI only (C++ already built)
.\build.ps1 -SkipUi   # C++ only
```

Output lands in `build\` — `win-unpacked\` for the portable version and `the.mouse.app Setup.exe` for the installer.

---

## Settings

All settings are managed through the UI and saved to `settings.ini`. You can also edit the file directly — the app reads it on startup.

| Setting | Default | Description |
|---|---|---|
| `Smooth` | `1` | Curve mode: `1` = smooth (continuous Gaussian curve), `0` = step (discrete jumps) |
| `Baseline_Sensitivity` | `1` | Center of the randomization range. `1` = your current in-game sensitivity |
| `Min_Sensitivity` | `0.5` | Lower bound multiplier (0.5 = half your sensitivity) |
| `Max_Sensitivity` | `2` | Upper bound multiplier (2 = double your sensitivity) |
| `Spread` | `0.1` | Lognormal variance of the random walk — controls how far sensitivity wanders from baseline |
| `Smoothing` | `5` | **Smooth mode only.** `0` = off (raw noise), `1` = low, `2` = medium, `3` = high, `4` = very high, `5` = maximum |
| `Timestep` | `3` | **Step mode only.** Seconds each sensitivity value is held before the next jump |
| `Runtime` | `0` | Session length in minutes. `0` = run indefinitely |
| `X_Sensitivity` | `1` | Constant horizontal axis multiplier (applied on top of the randomizer) |
| `Y_Sensitivity` | `1` | Constant vertical axis multiplier (applied on top of the randomizer) |

### Tips

- **Baseline should almost always be 1** — you're multiplying around your existing in-game sensitivity, not replacing it.
- **Spread** is counterintuitive: very high values don't always produce wilder swings. Because the Gaussian smoothing actively fights noise, too much spread can actually flatten the curve. The original authors recommended starting around **0.6** and *decreasing* toward 0.1 if you want less variation, not increasing it.
- **Smoothing 0** in smooth mode is a fun experiment — it produces raw, jagged noise rather than a flowing curve.
- **X/Y decoupling** is a constant multiplier applied regardless of whether the randomizer is running. Useful for aspect ratio corrections (e.g. 16:9 → 4:3 ≈ Y × 0.5625).

---

## Usage

- **Start / Stop** from the Randomizer tab or the tray right-click menu.
- **Pause / Resume** — press **P** in the console window while the randomizer is running.
- **Close** hides to tray. Right-click the tray icon → **Quit** to exit fully.

---

## Driver notes

The Interception driver requires:
- Secure Boot **disabled** in BIOS/UEFI
- A **reboot** after install or uninstall before the change takes effect
- Admin privileges only for install/uninstall — normal use requires no elevation

---

## Credits

Original tool by **Whisper** and **El Bad**:
- GitHub: [Whisperrr/SensitivityRandomizer](https://github.com/Whisperrr/SensitivityRandomizer)
- Reddit write-up: [r/FPSAimTrainer](https://www.reddit.com/r/FPSAimTrainer/comments/cve6oi/tool_for_smoothly_randomizing_sensitivity/)

This fork is maintained separately and is not affiliated with the original authors.
