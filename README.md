# Car Transmission Simulator V1

A Blender + Three.js educational manual-transmission simulator.

## Project structure

```text
CarTransmissionSimulator/
├── index.html
├── style.css
├── main.js
├── README.md
├── models/
│   ├── car_transmission.glb   <- generated/exported from Blender
│   └── .gitkeep
├── sounds/
│   ├── engine_idle.mp3        <- optional
│   ├── engine_loop.mp3        <- optional
│   ├── gear_shift.mp3         <- optional
│   ├── clutch.mp3             <- optional
│   └── reverse.mp3             <- optional
└── blender/
    └── generate_transmission.py
```

## Blender 5.2.2

1. Open Blender 5.2.2.
2. Open the **Scripting** workspace.
3. Create a new text block.
4. Delete the old script contents.
5. Paste `blender/generate_transmission.py`.
6. Press **Alt + P** inside the Text Editor.
7. Check the System Console/output area for `MODEL VALIDATION` and `READY FOR GLB EXPORT`.
8. Save the `.blend` file.
9. Use **File > Export > glTF 2.0**.
10. Choose **GLB** as the format and export all objects to:

```text
CarTransmissionSimulator/models/car_transmission.glb
```

The Three.js app expects the GLB at exactly that path.

## VS Code / Live Server

1. Open `C:\SDV_Projects\CarTransmissionSimulator` in VS Code.
2. Put the files above into that folder.
3. Put the exported GLB into `models/car_transmission.glb`.
4. Right-click `index.html`.
5. Choose **Open with Live Server**.
6. Open the displayed localhost URL.

Do not double-click `index.html`; use a local web server so the GLB module/assets load correctly.

## Controls

- `N`: Neutral
- `1`–`5`: forward gears
- `R`: Reverse
- `C`: clutch toggle
- `Space`: pause/resume
- Mouse drag: orbit
- Scroll: zoom
- Right mouse drag: pan
- RPM slider: 800–6000 RPM
- Reset: Neutral, 3000 RPM, clutch engaged, running

## Physics used

```text
wheelRPM = engineRPM / (abs(gearRatio) * finalDrive)
finalDrive = 3.42
wheelRadius = 0.34 m
engineTorque = 150 Nm
efficiency = 0.90
```

Reverse displays negative wheel RPM and zero drivetrain torque in Neutral or with the clutch disengaged.

## Optional audio

The application does not fail when sound assets are absent. The built-in Web Audio feedback still works for shift/clutch/reverse interaction.
