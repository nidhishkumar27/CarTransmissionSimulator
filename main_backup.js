import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js';

import { OrbitControls } from 'https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/controls/OrbitControls.js';

import { GLTFLoader } from 'https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/loaders/GLTFLoader.js';


// ============================================================
// MANUAL TRANSMISSION SIMULATOR - THREE.JS V1
// ============================================================

const MODEL_URL = './models/car_transmission.glb';

const GEAR_RATIOS = Object.freeze({
  N: 0,
  1: 3.8,
  2: 2.2,
  3: 1.5,
  4: 1.1,
  5: 0.85,
  R: 3.6
});

const FINAL_DRIVE = 3.42;
const EFFICIENCY = 0.90;
const WHEEL_RADIUS_M = 0.34;
const ENGINE_TORQUE_NM = 150;

const INITIAL_RPM = 3000;
const MIN_RPM = 800;
const MAX_RPM = 6000;

const GEAR_NAMES = Object.freeze({
  N: 'Neutral',
  1: '1st',
  2: '2nd',
  3: '3rd',
  4: '4th',
  5: '5th',
  R: 'Reverse'
});

const FORWARD_GEARS = [1, 2, 3, 4, 5];

const state = {
  gear: 'N',
  targetGear: 'N',
  engineRPM: INITIAL_RPM,
  clutchEngaged: true,
  paused: false,
  shifting: false,
  shiftElapsed: 0,
  shiftDuration: 0.46,
  torqueBlend: 1,
  wheelRPM: 0,
  outputTorque: 0
};

let scene;
let camera;
let renderer;
let controls;
let clock;
let transmissionRoot;
let loadedModel;

const refs = {
  gear: {},
  gears: {},
  synchronizers: {},
  sleeves: {},
  forks: {},
  shafts: {},
  wheels: {},
  diff: null,
  flowGroup: null
};

const dom = {};

// ============================================================
// SHIFT-BY-WIRE / TCU
// ============================================================

const SBW_ALLOWED_GEARS = Object.freeze([
  'N',
  '1',
  '2',
  '3',
  '4',
  '5',
  'R'
]);

const SBW_COMMAND_DELAY_MS = 180;

const sbwState = {
  mode: 'SBW',
  tcuStatus: 'ONLINE',
  requestedGear: 'N',
  receivedGear: 'N',
  validatedGear: 'N',
  actualGear: 'N',
  communication: 'OK',
  security: 'NORMAL',
  activeFault: 'NONE',
  sequence: 0,
  eventLog: [],
  maxLogEntries: 12
};

const HIGHLIGHT_COLOR = new THREE.Color(0x2eb8ff);
const REVERSE_HIGHLIGHT_COLOR = new THREE.Color(0xff8f3d);

// ============================================================
// DOM
// ============================================================

function cacheDom() {
  dom.loading = document.getElementById('loading');
  dom.error = document.getElementById('error');
  dom.errorDetail = document.getElementById('error-detail');

  dom.canvasWrap = document.getElementById('canvas-wrap');

  dom.gearReadout = document.getElementById('gear-readout');
  dom.rpmReadout = document.getElementById('rpm-readout');
  dom.engineTorque = document.getElementById('engine-torque');
  dom.outputTorque = document.getElementById('output-torque');
  dom.wheelRPM = document.getElementById('wheel-rpm');
  dom.speed = document.getElementById('speed');
  dom.power = document.getElementById('power');
  dom.ratio = document.getElementById('ratio-readout');

  dom.flow = document.getElementById('flow-readout');

  dom.clutchButton = document.getElementById('clutch-button');
  dom.clutchStatus = document.getElementById('clutch-status');

  dom.transmissionStatus = document.getElementById(
    'transmission-status'
  );

  dom.rpmSlider = document.getElementById('rpm-slider');
  dom.rpmSliderValue = document.getElementById(
    'rpm-slider-value'
  );

  dom.pauseButton = document.getElementById('pause-button');
  dom.resetButton = document.getElementById('reset-button');

  dom.gearButtons = [
    ...document.querySelectorAll('.gear-button')
  ];

  // Shift-by-wire / TCU
  dom.sbwMode = document.getElementById('sbw-mode');
  dom.sbwStatus = document.getElementById('sbw-status');
  dom.sbwRequested = document.getElementById('sbw-requested');
  dom.sbwReceived = document.getElementById('sbw-received');
  dom.sbwValidated = document.getElementById('sbw-validated');
  dom.sbwActual = document.getElementById('sbw-actual');
  dom.sbwCommunication = document.getElementById(
    'sbw-communication'
  );
  dom.sbwSecurity = document.getElementById('sbw-security');
  dom.sbwEventLog = document.getElementById('sbw-event-log');
  dom.clearFaultButton = document.getElementById(
    'clear-fault-button'
  );

  dom.faultButtons = [
    ...document.querySelectorAll(
      '.fault-button[data-fault]'
    )
  ];
}

// ============================================================
// THREE.JS SCENE
// ============================================================

function initThree() {
  // ==========================================================
  // SCENE
  // ==========================================================

  scene = new THREE.Scene();

  // Brighter studio-style background.
  scene.background = new THREE.Color(0x122033);

  // Softer fog so distant drivetrain parts don't disappear.
  scene.fog = new THREE.Fog(
    0x122033,
    42,
    95
  );

  // ==========================================================
  // CAMERA
  // ==========================================================

  camera = new THREE.PerspectiveCamera(
    48,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
  );

  // Wider framing so the engine + gearbox + differential
  // are all visible together.
  camera.position.set(
    3.0,
    -31.0,
    19.0
  );

  controls = new OrbitControls(
    camera,
    renderer?.domElement
  );

  // ----------------------------------------------------------
  // RENDERER
  // ----------------------------------------------------------

  renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false
  });

  renderer.setPixelRatio(
    Math.min(
      window.devicePixelRatio,
      2
    )
  );

  renderer.setSize(
    window.innerWidth,
    window.innerHeight
  );

  renderer.shadowMap.enabled = true;

  renderer.shadowMap.type =
    THREE.PCFSoftShadowMap;

  renderer.outputColorSpace =
    THREE.SRGBColorSpace;

  renderer.toneMapping =
    THREE.ACESFilmicToneMapping;

  renderer.toneMappingExposure = 1.28;

  dom.canvasWrap.appendChild(
    renderer.domElement
  );

  // ==========================================================
  // ORBIT CONTROLS
  // ==========================================================

  controls = new OrbitControls(
    camera,
    renderer.domElement
  );

  controls.enableDamping = true;

  controls.dampingFactor = 0.065;

  controls.minDistance = 14;

  controls.maxDistance = 52;

  // Move the focus slightly toward the engine side.
  controls.target.set(
    0.0,
    0.0,
    1.45
  );

  controls.enablePan = true;

  controls.screenSpacePanning = true;

  // ==========================================================
  // MAIN STUDIO LIGHT
  // ==========================================================

  const hemisphere =
    new THREE.HemisphereLight(
      0xd9ecff,
      0x253448,
      1.8
    );

  scene.add(
    hemisphere
  );

  // ==========================================================
  // KEY LIGHT
  // ==========================================================

  const key =
    new THREE.DirectionalLight(
      0xffffff,
      3.2
    );

  key.position.set(
    -12,
    -18,
    25
  );

  key.castShadow = true;

  key.shadow.mapSize.set(
    2048,
    2048
  );

  key.shadow.camera.near = 1;

  key.shadow.camera.far = 90;

  scene.add(
    key
  );

  // ==========================================================
  // ENGINE LIGHT
  // ==========================================================

  // Dedicated light for the engine area so the dark-red
  // engine block remains clearly visible.
  const engineLight =
    new THREE.DirectionalLight(
      0xffd6b0,
      2.4
    );

  engineLight.position.set(
    -16,
    -10,
    15
  );

  scene.add(
    engineLight
  );

  // ==========================================================
  // GEARBOX FILL LIGHT
  // ==========================================================

  const gearboxLight =
    new THREE.DirectionalLight(
      0xaed8ff,
      1.5
    );

  gearboxLight.position.set(
    8,
    13,
    12
  );

  scene.add(
    gearboxLight
  );

  // ==========================================================
  // RIM LIGHT
  // ==========================================================

  const rim =
    new THREE.PointLight(
      0xffa45c,
      1.8,
      50
    );

  rim.position.set(
    14,
    -7,
    10
  );

  scene.add(
    rim
  );

  // ==========================================================
  // FLOOR
  // ==========================================================

  const floor =
    new THREE.Mesh(
      new THREE.PlaneGeometry(
        80,
        60
      ),
      new THREE.MeshStandardMaterial({
        color: 0x182536,
        roughness: 0.82,
        metalness: 0.12
      })
    );

  floor.rotation.x =
    -Math.PI / 2;

  floor.position.y = 0;

  floor.position.z = 0;

  floor.receiveShadow = true;

  scene.add(
    floor
  );

  // ==========================================================
  // SOFT FLOOR GLOW
  // ==========================================================

  const floorGlow =
    new THREE.PointLight(
      0x4c8fd6,
      1.0,
      35
    );

  floorGlow.position.set(
    -3,
    2,
    3
  );

  scene.add(
    floorGlow
  );

  // ==========================================================
  // CLOCK / RESIZE
  // ==========================================================

  clock =
    new THREE.Clock();

  window.addEventListener(
    'resize',
    onResize
  );
}

function onResize() {
  camera.aspect =
    window.innerWidth /
    window.innerHeight;

  camera.updateProjectionMatrix();

  renderer.setSize(
    window.innerWidth,
    window.innerHeight
  );
}

// ============================================================
// MODEL LOADING
// ============================================================

function loadModel() {
  return new Promise(
    (resolve, reject) => {
      const loader =
        new GLTFLoader();

      loader.load(
        MODEL_URL,

        (gltf) => {
          loadedModel =
            gltf.scene;

          transmissionRoot =
            loadedModel.getObjectByName(
              'TransmissionRoot'
            ) || loadedModel;

          scene.add(
            loadedModel
          );

          loadedModel.traverse(
            (obj) => {
              if (!obj.isMesh) return;

              obj.castShadow = true;
              obj.receiveShadow = true;

              if (obj.material) {
                obj.userData.originalMaterial =
                  obj.material;
              }
            }
          );

          createObjectReferences();

          setupPowerFlow();

          dom.loading.classList.add(
            'hidden'
          );

          resolve(gltf);
        },

        undefined,

        (error) => {
          reject(error);
        }
      );
    }
  );
}

function find(name) {
  return loadedModel?.getObjectByName(name) || null;
}

function requiredObject(name) {
  const obj = find(name);

  if (!obj) {
    throw new Error(
      `Required GLB object missing: ${name}`
    );
  }

  return obj;
}

function createObjectReferences() {
  refs.shafts.input =
    requiredObject('Input_Shaft');

  refs.shafts.output =
    requiredObject('Output_Shaft');

  refs.shafts.driveshaft =
    requiredObject('Driveshaft');

  refs.shafts.rearAxle =
    requiredObject('Rear_Axle');

  refs.diff =
    requiredObject(
      'Differential_Housing'
    );

  for (
    const gear of FORWARD_GEARS
  ) {
    refs.gears[gear] = {
      input:
        requiredObject(
          `Gear_${gear}_Input`
        ),

      output:
        requiredObject(
          `Gear_${gear}_Output`
        )
    };

    refs.synchronizers[gear] =
      requiredObject(
        `Synchronizer_${gear}`
      );

    refs.sleeves[gear] =
      requiredObject(
        `SynchroSleeve_${gear}`
      );

    refs.forks[gear] =
      requiredObject(
        `ShiftFork_${gear}`
      );
  }

  refs.gears.R = {
    input:
      requiredObject(
        'Reverse_Input'
      ),

    idler:
      requiredObject(
        'Reverse_Idler'
      ),

    output:
      requiredObject(
        'Reverse_Output'
      )
  };

  refs.synchronizers.R =
    requiredObject(
      'Reverse_Synchronizer'
    );

  refs.sleeves.R =
    requiredObject(
      'Reverse_SynchroSleeve'
    );

  refs.forks.R =
    requiredObject(
      'Reverse_ShiftFork'
    );

  refs.wheels.RL =
    requiredObject(
      'Wheel_Tire_RL'
    );

  refs.wheels.RR =
    requiredObject(
      'Wheel_Tire_RR'
    );

  refs.wheels.FL =
    requiredObject(
      'Wheel_Tire_FL'
    );

  refs.wheels.FR =
    requiredObject(
      'Wheel_Tire_FR'
    );
}
// ============================================================
// HIGHLIGHTING
// ============================================================

function applyEmissiveHighlight(
  object,
  color,
  intensity = 2.0
) {
  object.traverse?.(
    (child) => {
      if (
        !child.isMesh ||
        !child.material
      ) {
        return;
      }

      if (
        !child.userData.highlightMaterial
      ) {
        child.userData.highlightMaterial =
          child.material.clone();
      }

      child.material =
        child.userData.highlightMaterial;

      if (
        'emissive'
        in child.material
      ) {
        child.material.emissive.copy(
          color
        );
      }

      if (
        'emissiveIntensity'
        in child.material
      ) {
        child.material.emissiveIntensity =
          intensity;
      }
    }
  );
}

function clearHighlight(object) {
  object.traverse?.(
    (child) => {
      if (!child.isMesh) return;

      if (
        child.userData.originalMaterial
      ) {
        child.material =
          child.userData.originalMaterial;
      }
    }
  );
}

function updateHighlighting() {
  for (
    const gear of [
      ...FORWARD_GEARS,
      'R'
    ]
  ) {
    const group =
      refs.gears[gear];

    if (group) {
      clearHighlight(
        group.input
      );

      clearHighlight(
        group.output
      );

      if (group.idler) {
        clearHighlight(
          group.idler
        );
      }
    }

    clearHighlight(
      refs.synchronizers[gear]
    );

    clearHighlight(
      refs.sleeves[gear]
    );

    clearHighlight(
      refs.forks[gear]
    );
  }

  if (
    state.gear === 'N' ||
    state.shifting
  ) {
    return;
  }

  const color =
    state.gear === 'R'
      ? REVERSE_HIGHLIGHT_COLOR
      : HIGHLIGHT_COLOR;

  const group =
    refs.gears[state.gear];

  applyEmissiveHighlight(
    group.input,
    color,
    2.2
  );

  applyEmissiveHighlight(
    group.output,
    color,
    2.2
  );

  if (group.idler) {
    applyEmissiveHighlight(
      group.idler,
      REVERSE_HIGHLIGHT_COLOR,
      2.35
    );
  }

  applyEmissiveHighlight(
    refs.synchronizers[state.gear],
    color,
    2.1
  );

  applyEmissiveHighlight(
    refs.sleeves[state.gear],
    color,
    2.25
  );

  applyEmissiveHighlight(
    refs.forks[state.gear],
    color,
    2.0
  );
}

// ============================================================
// PHYSICS
// ============================================================

function getSelectedRatio() {
  return GEAR_RATIOS[
    state.gear
  ];
}

function updatePhysics() {
  const ratio =
    getSelectedRatio();

  const clutchFactor =
    state.clutchEngaged
      ? 1
      : 0;

  const shiftFactor =
    state.shifting
      ? 0
      : state.torqueBlend;

  const torqueTransfer =
    clutchFactor *
    shiftFactor;

  if (
    state.gear === 'N' ||
    !ratio
  ) {
    state.wheelRPM = 0;
    state.outputTorque = 0;
  } else {
    const signedWheel =
      state.engineRPM /
      (
        Math.abs(ratio) *
        FINAL_DRIVE
      );

    state.wheelRPM =
      (
        state.gear === 'R'
          ? -signedWheel
          : signedWheel
      ) * torqueTransfer;

    state.outputTorque =
      ENGINE_TORQUE_NM *
      Math.abs(ratio) *
      FINAL_DRIVE *
      EFFICIENCY *
      torqueTransfer;
  }
}

function getEnginePowerKW() {
  return (
    ENGINE_TORQUE_NM *
    state.engineRPM *
    2 *
    Math.PI /
    60 /
    1000
  );
}

function getVehicleSpeedKmh() {
  const circumference =
    2 *
    Math.PI *
    WHEEL_RADIUS_M;

  return (
    Math.abs(state.wheelRPM) *
    circumference *
    60 /
    1000
  );
}

// ============================================================
// SHIFT-BY-WIRE CONTROLLER
// ============================================================

function sbwLog(message) {
  const time = new Date().toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  sbwState.eventLog.unshift(
    `[${time}] ${message}`
  );

  sbwState.eventLog =
    sbwState.eventLog.slice(
      0,
      sbwState.maxLogEntries
    );

  if (dom.sbwEventLog) {
    dom.sbwEventLog.textContent =
      sbwState.eventLog.join('\n');
  }
}

function requestGear(gear) {
  if (
    !SBW_ALLOWED_GEARS.includes(gear)
  ) {
    return;
  }

  sbwState.requestedGear = gear;

  if (
    sbwState.mode === 'MECHANICAL'
  ) {
    sbwState.receivedGear = gear;
    sbwState.validatedGear = gear;
    sbwState.communication = 'N/A';
    sbwState.security = 'NORMAL';
    sbwState.tcuStatus = 'BYPASSED';

    sbwLog(
      `MECHANICAL: selector → ${gear}`
    );

    setGear(gear);
    updateUI();
    return;
  }

  if (
    sbwState.activeFault ===
    'LOST_COMMUNICATION'
  ) {
    sbwState.tcuStatus =
      'SAFE HOLD';

    sbwState.communication =
      'LOST';

    sbwState.security =
      'COMMUNICATION FAULT';

    sbwLog(
      `COMMAND ${gear} blocked: communication lost`
    );

    updateUI();
    return;
  }

  if (state.shifting) {
    sbwLog(
      `COMMAND ${gear} ignored: transmission busy`
    );

    updateUI();
    return;
  }

  sbwState.tcuStatus =
    'PROCESSING';

  sbwState.communication =
    'TX';

  sbwState.security =
    'NORMAL';

  sbwState.sequence += 1;

  const packet = {
    sequence:
      sbwState.sequence,

    requestedGear:
      gear,

    timestamp:
      performance.now()
  };

  sbwState.receivedGear =
    gear;

  sbwLog(
    `TX → TCU: gear ${gear} [SEQ ${packet.sequence}]`
  );

  updateUI();

  window.setTimeout(
    () => {
      processSBWCommand(packet);
    },
    SBW_COMMAND_DELAY_MS
  );
}

function processSBWCommand(packet) {
  if (
    packet.sequence !==
    sbwState.sequence
  ) {
    return;
  }

  if (
    sbwState.mode !== 'SBW'
  ) {
    return;
  }

  if (
    sbwState.activeFault ===
    'LOST_COMMUNICATION'
  ) {
    sbwState.tcuStatus =
      'SAFE HOLD';

    sbwState.communication =
      'LOST';

    sbwState.security =
      'COMMUNICATION FAULT';

    sbwLog(
      'RX blocked: communication lost'
    );

    updateUI();
    return;
  }

  if (
    sbwState.activeFault ===
    'INVALID_COMMAND'
  ) {
    const injectedGear =
      packet.requestedGear === 'R'
        ? '3'
        : 'R';

    sbwState.receivedGear =
      injectedGear;

    sbwState.validatedGear =
      '—';

    sbwState.tcuStatus =
      'SAFE HOLD';

    sbwState.communication =
      'COMPROMISED';

    sbwState.security =
      'COMMAND REJECTED';

    sbwLog(
      `FAULT: injected ${injectedGear} instead of ${packet.requestedGear}`
    );

    sbwLog(
      'TCU validation rejected command — SAFE HOLD'
    );

    updateUI();
    return;
  }

  if (
    sbwState.activeFault ===
    'STALE_COMMAND'
  ) {
    const simulatedAge =
      2000;

    sbwState.receivedGear =
      packet.requestedGear;

    sbwState.validatedGear =
      '—';

    sbwState.tcuStatus =
      'SAFE HOLD';

    sbwState.communication =
      'STALE';

    sbwState.security =
      'STALE COMMAND REJECTED';

    sbwLog(
      `FAULT: command age ${simulatedAge} ms`
    );

    sbwLog(
      'TCU rejected stale command — SAFE HOLD'
    );

    updateUI();
    return;
  }

  if (
    sbwState.activeFault ===
    'CONFLICTING_STATUS'
  ) {
    sbwState.receivedGear =
      packet.requestedGear;

    sbwState.validatedGear =
      state.gear;

    sbwState.tcuStatus =
      'SAFE HOLD';

    sbwState.communication =
      'CONFLICT';

    sbwState.security =
      'STATUS CONFLICT';

    sbwLog(
      `FAULT: requested ${packet.requestedGear}, status reports ${state.gear}`
    );

    sbwLog(
      'TCU rejected conflicting status — SAFE HOLD'
    );

    updateUI();
    return;
  }

  if (
    !SBW_ALLOWED_GEARS.includes(
      packet.requestedGear
    )
  ) {
    sbwState.validatedGear =
      '—';

    sbwState.tcuStatus =
      'SAFE HOLD';

    sbwState.security =
      'INVALID GEAR';

    sbwLog(
      'TCU rejected invalid gear value'
    );

    updateUI();
    return;
  }

  sbwState.receivedGear =
    packet.requestedGear;

  sbwState.validatedGear =
    packet.requestedGear;

  sbwState.communication =
    'OK';

  sbwState.security =
    'COMMAND VALID';

  sbwState.tcuStatus =
    'ACTUATING';

  sbwLog(
    `TCU validated ${packet.requestedGear} — actuator command sent`
  );

  // Existing transmission animation performs
  // the physical shift.
  setGear(
    packet.requestedGear
  );

  updateUI();
}

function injectSBWFault(type) {
  const validFaults = [
    'INVALID_COMMAND',
    'LOST_COMMUNICATION',
    'STALE_COMMAND',
    'CONFLICTING_STATUS'
  ];

  if (
    !validFaults.includes(type)
  ) {
    return;
  }

  sbwState.activeFault =
    type;

  switch (type) {
    case 'INVALID_COMMAND':
      sbwState.tcuStatus =
        'MONITORING';

      sbwState.communication =
        'OK';

      sbwState.security =
        'FAULT INJECTED';

      sbwLog(
        'FAULT INJECTION: INVALID COMMAND'
      );
      break;

    case 'LOST_COMMUNICATION':
      sbwState.tcuStatus =
        'SAFE HOLD';

      sbwState.communication =
        'LOST';

      sbwState.security =
        'COMMUNICATION FAULT';

      sbwLog(
        'FAULT INJECTION: LOST COMMUNICATION'
      );
      break;

    case 'STALE_COMMAND':
      sbwState.tcuStatus =
        'MONITORING';

      sbwState.communication =
        'STALE';

      sbwState.security =
        'FAULT INJECTED';

      sbwLog(
        'FAULT INJECTION: STALE COMMAND'
      );
      break;

    case 'CONFLICTING_STATUS':
      sbwState.tcuStatus =
        'MONITORING';

      sbwState.communication =
        'CONFLICT';

      sbwState.security =
        'FAULT INJECTED';

      sbwLog(
        'FAULT INJECTION: CONFLICTING STATUS'
      );
      break;
  }

  updateUI();
}

function clearSBWFault() {
  sbwState.activeFault =
    'NONE';

  sbwState.tcuStatus =
    sbwState.mode === 'SBW'
      ? 'ONLINE'
      : 'BYPASSED';

  sbwState.communication =
    sbwState.mode === 'SBW'
      ? 'OK'
      : 'N/A';

  sbwState.security =
    'NORMAL';

  sbwState.requestedGear =
    state.gear;

  sbwState.receivedGear =
    state.gear;

  sbwState.validatedGear =
    state.gear;

  sbwLog(
    'FAULT CLEARED — TCU returned to normal'
  );

  updateUI();
}

// ============================================================
// GEAR SHIFTING
// ============================================================

function setGear(gear) {
  if (
    !(gear in GEAR_RATIOS)
  ) {
    return;
  }

  if (
    state.shifting &&
    state.targetGear === gear
  ) {
    return;
  }

  if (
    !state.shifting &&
    state.gear === gear
  ) {
    return;
  }

  startEngineAudio();

  state.targetGear =
    gear;

  state.shifting =
    true;

  state.shiftElapsed =
    0;

  state.torqueBlend =
    0;

  playSound(
    'gear_shift'
  );

  updateHighlighting();
}

function updateShiftAnimation(
  delta
) {
  if (!state.shifting) {
    return;
  }

  state.shiftElapsed +=
    delta;

  const t =
    Math.min(
      state.shiftElapsed /
      state.shiftDuration,
      1
    );

  const engageStage =
    t < 0.42
      ? 0
      : (
          t - 0.42
        ) / 0.58;

  const selected =
    state.targetGear === 'N'
      ? null
      : refs.sleeves[
          state.targetGear
        ];

  const selectedFork =
    state.targetGear === 'N'
      ? null
      : refs.forks[
          state.targetGear
        ];

  // Retract current synchronizer/fork first.
  const current =
    state.gear;

  if (
    current !== 'N'
  ) {
    const currentSleeve =
      refs.sleeves[current];

    const currentFork =
      refs.forks[current];

    const currentBase =
      currentSleeve.userData.baseX ??
      currentSleeve.position.x;

    currentSleeve.position.x =
      THREE.MathUtils.lerp(
        currentBase + 0.62,
        currentBase,
        Math.min(
          t / 0.42,
          1
        )
      );

    moveFork(
      currentFork,
      0.42,
      Math.min(
        t / 0.42,
        1
      )
    );
  }

  // Engage target synchronizer/fork.
  if (selected) {
    const base =
      selected.userData.baseX ??
      selected.position.x;

    selected.position.x =
      THREE.MathUtils.lerp(
        base,
        base + 0.62,
        THREE.MathUtils.smoothstep(
          engageStage,
          0,
          1
        )
      );

    moveFork(
      selectedFork,
      -0.42,
      THREE.MathUtils.smoothstep(
        engageStage,
        0,
        1
      )
    );
  }

  if (t >= 1) {
    state.gear =
      state.targetGear;

    state.shifting =
      false;

    state.torqueBlend =
      1;

    resetSelectorPositions();

    updateHighlighting();

    playSound(
      state.gear === 'R'
        ? 'reverse'
        : 'synchronizer'
    );
  }
}

function moveFork(
  fork,
  offset,
  amount
) {
  if (!fork) return;

  const base =
    fork.userData.baseY ??
    fork.position.y;

  fork.position.y =
    base +
    offset *
    amount;
}

function resetSelectorPositions() {
  for (
    const gear of [
      ...FORWARD_GEARS,
      'R'
    ]
  ) {
    const sleeve =
      refs.sleeves[gear];

    const fork =
      refs.forks[gear];

    if (sleeve) {
      sleeve.userData.baseX ??=
        sleeve.position.x;

      sleeve.position.x =
        sleeve.userData.baseX;
    }

    if (fork) {
      fork.userData.baseY ??=
        fork.position.y;

      fork.position.y =
        fork.userData.baseY;
    }
  }
}

// ============================================================
// ROTATION ANIMATION
// ============================================================

// ============================================================
// ROTATION ANIMATION
// ============================================================

function updateGearRotation(delta) {
  if (state.paused) {
    return;
  }

  // ----------------------------------------------------------
  // ENGINE RPM -> angular velocity
  // ----------------------------------------------------------

  const engineRad =
    state.engineRPM *
    2 *
    Math.PI /
    60;

  const counterRad =
    -engineRad;

  // ----------------------------------------------------------
  // ENGINE / CLUTCH
  // ----------------------------------------------------------

  rotateObjectByName(
    'Flywheel',
    engineRad * delta
  );

  rotateObjectByName(
    'Clutch',
    engineRad * delta
  );

  rotateObjectByName(
    'Pressure_Plate',
    engineRad * delta
  );

  // ----------------------------------------------------------
  // INPUT SHAFT
  // ----------------------------------------------------------

  refs.shafts.input.rotateX(
    counterRad * delta
  );

  // ----------------------------------------------------------
  // OUTPUT SHAFT
  // ----------------------------------------------------------

  const wheelAngularVelocity =
    state.wheelRPM *
    2 *
    Math.PI /
    60;

  refs.shafts.output.rotateX(
    wheelAngularVelocity * delta
  );

  // ----------------------------------------------------------
  // FORWARD GEARS
  // ----------------------------------------------------------

  for (
    const gear of FORWARD_GEARS
  ) {
    // Countershaft gears always rotate with input shaft.
    refs.gears[
      gear
    ].input.rotateX(
      counterRad * delta
    );

    // Selected output gear rotates with output shaft.
    if (
      state.gear === gear &&
      !state.shifting &&
      state.clutchEngaged
    ) {
      refs.gears[
        gear
      ].output.rotateX(
        wheelAngularVelocity * delta
      );
    }
  }

  // ----------------------------------------------------------
  // REVERSE GEARS
  // ----------------------------------------------------------

  refs.gears.R.input.rotateX(
    counterRad * delta
  );

  refs.gears.R.idler.rotateX(
    engineRad * delta
  );

  if (
    state.gear === 'R' &&
    !state.shifting &&
    state.clutchEngaged
  ) {
    refs.gears.R.output.rotateX(
      wheelAngularVelocity * delta
    );
  }

  // ----------------------------------------------------------
  // DRIVESHAFT
  // ----------------------------------------------------------

  refs.shafts.driveshaft.rotateX(
    wheelAngularVelocity * delta
  );

  // ----------------------------------------------------------
  // DIFFERENTIAL
  // ----------------------------------------------------------

  refs.diff.rotateX(
    wheelAngularVelocity * delta
  );

  // ----------------------------------------------------------
  // REAR AXLE
  // ----------------------------------------------------------

  refs.shafts.rearAxle.rotateZ(
    wheelAngularVelocity * delta
  );

  // ----------------------------------------------------------
  // REAR WHEELS - POWERED
  // ----------------------------------------------------------

  refs.wheels.RL.rotateY(
    wheelAngularVelocity * delta
  );

  refs.wheels.RR.rotateY(
    wheelAngularVelocity * delta
  );

  // ----------------------------------------------------------
  // FRONT WHEELS - NOT POWERED
  // ----------------------------------------------------------

  // These are free-rolling wheels.
  // They do not receive engine torque directly.
  // They simply roll according to vehicle wheel speed.

  // This makes the front wheels visually consistent with
  // the rear wheels while keeping the drivetrain RWD.
  // ----------------------------------------------------------
  // ----------------------------------------------------------
// REAR AXLE
// ----------------------------------------------------------

refs.shafts.rearAxle.rotateZ(
  wheelAngularVelocity * delta
);

// ----------------------------------------------------------
// REAR WHEELS - POWERED
// ----------------------------------------------------------

refs.wheels.RL.rotateY(
  wheelAngularVelocity * delta
);

refs.wheels.RR.rotateY(
  wheelAngularVelocity * delta
);
}

// ============================================================
// FRONT WHEEL VISUAL ROLL
// ============================================================

function rotateObjectByName(
  name,
  amount
) {
  const obj =
    find(name);

  if (obj) {
    obj.rotateX(amount);
  }
}

// ============================================================
// POWER FLOW
// ============================================================

function setupPowerFlow() {
  refs.flowGroup =
    new THREE.Group();

  refs.flowGroup.visible =
    false;

  scene.add(
    refs.flowGroup
  );

  for (
    let i = 0;
    i < 12;
    i++
  ) {
    const mesh =
      new THREE.Mesh(
        new THREE.SphereGeometry(
          0.075,
          12,
          8
        ),
        new THREE.MeshBasicMaterial({
          color:
            i % 2
              ? 0xffb347
              : 0xff7a2f
        })
      );

    refs.flowGroup.add(
      mesh
    );
  }
}

function getWorldPoint(
  obj,
  yOffset = 0,
  zOffset = 0
) {
  const p =
    new THREE.Vector3();

  obj.getWorldPosition(
    p
  );

  p.y += yOffset;
  p.z += zOffset;

  return p;
}

function buildFlowPath() {
  if (
    state.gear === 'N'
  ) {
    return [];
  }

  const input =
    refs.gears[
      state.gear
    ].input;

  const output =
    refs.gears[
      state.gear
    ].output;

  const points = [
    getWorldPoint(
      find('Flywheel')
    ),

    getWorldPoint(
      input
    )
  ];

  if (
    state.gear === 'R'
  ) {
    points.push(
      getWorldPoint(
        refs.gears.R.idler
      )
    );
  }

  points.push(
    getWorldPoint(
      output
    )
  );

  points.push(
    getWorldPoint(
      refs.shafts.driveshaft
    )
  );

  points.push(
    getWorldPoint(
      refs.diff
    )
  );

  points.push(
    getWorldPoint(
      refs.wheels.RL
    )
  );

  return points;
}

function interpolatePath(
  points,
  distance
) {
  if (
    points.length < 2
  ) {
    return (
      points[0]?.clone() ??
      new THREE.Vector3()
    );
  }

  let remaining =
    distance;

  for (
    let i = 0;
    i < points.length - 1;
    i++
  ) {
    const a =
      points[i];

    const b =
      points[i + 1];

    const seg =
      a.distanceTo(
        b
      );

    if (
      remaining <= seg
    ) {
      return a.clone().lerp(
        b,
        remaining /
        Math.max(
          seg,
          1e-6
        )
      );
    }

    remaining -=
      seg;
  }

  return points[
    points.length - 1
  ].clone();
}

let flowDistance = 0;

function updatePowerFlow(
  delta
) {
  const connected =
    state.gear !== 'N' &&
    state.clutchEngaged &&
    !state.shifting &&
    !state.paused;

  refs.flowGroup.visible =
    connected;

  if (!connected) {
    dom.flow.textContent =
      'POWER FLOW: DISCONNECTED';

    dom.flow.className =
      'flow-readout disconnected';

    return;
  }

  dom.flow.textContent =
    state.gear === 'R'
      ? 'POWER FLOW: ENGINE → REVERSE IDLER → WHEELS'
      : 'POWER FLOW: ENGINE → GEARBOX → WHEELS';

  dom.flow.className =
    'flow-readout connected';

  const path =
    buildFlowPath();

  if (
    path.length < 2
  ) {
    return;
  }

  const total =
    path.reduce(
      (
        sum,
        point,
        i
      ) =>
        i
          ? sum +
            point.distanceTo(
              path[i - 1]
            )
          : 0,
      0
    );

  flowDistance =
    (
      flowDistance +
      delta *
      (
        1.6 +
        Math.abs(
          state.wheelRPM
        ) /
        500
      )
    ) %
    Math.max(
      total,
      0.01
    );

  refs.flowGroup.children.forEach(
    (
      particle,
      i
    ) => {
      const distance =
        (
          flowDistance +
          (
            i /
            refs.flowGroup.children.length
          ) *
          total
        ) % total;

      particle.position.copy(
        interpolatePath(
          path,
          distance
        )
      );
    }
  );
}

// ============================================================
// UI
// ============================================================

function updateUI() {
  const ratio =
    getSelectedRatio();

  const speed =
    getVehicleSpeedKmh();

  const power =
    getEnginePowerKW();

  dom.gearReadout.textContent =
    GEAR_NAMES[
      state.gear
    ];

  dom.rpmReadout.textContent =
    Math.round(
      state.engineRPM
    ).toString();

  dom.rpmSliderValue.textContent =
    Math.round(
      state.engineRPM
    ).toString();

  dom.engineTorque.textContent =
    `${ENGINE_TORQUE_NM} Nm`;

  dom.outputTorque.textContent =
    `${Math.round(
      state.outputTorque
    )} Nm`;

  dom.wheelRPM.textContent =
    state.gear === 'R'
      ? `${Math.round(
          state.wheelRPM
        )}`
      : Math.round(
          state.wheelRPM
        ).toString();

  dom.speed.textContent =
    `${speed.toFixed(1)} km/h`;

  dom.power.textContent =
    `${power.toFixed(1)} kW`;

  dom.ratio.textContent =
    ratio
      ? ratio.toFixed(2)
      : '—';

  dom.clutchButton.textContent =
    `CLUTCH: ${
      state.clutchEngaged
        ? 'ENGAGED'
        : 'DISENGAGED'
    }`;

  dom.clutchButton.className =
    `wide-button ${
      state.clutchEngaged
        ? 'clutch-engaged'
        : 'clutch-disengaged'
    }`;

  dom.clutchStatus.textContent =
    state.clutchEngaged
      ? 'CLUTCH ENGAGED'
      : 'CLUTCH DISENGAGED';

  dom.clutchStatus.className =
    `status-pill ${
      state.clutchEngaged
        ? 'neutral'
        : ''
    }`;

  dom.transmissionStatus.textContent =
    state.paused
      ? 'PAUSED'
      : state.shifting
        ? 'SHIFTING'
        : 'RUNNING';

  dom.transmissionStatus.style.color =
    state.paused
      ? '#b9c7d8'
      : state.shifting
        ? '#ffd08a'
        : '#ffb85f';

  for (
    const button of dom.gearButtons
  ) {
    button.classList.toggle(
      'active',
      button.dataset.gear ===
        state.gear &&
        !state.shifting
    );
  }

  // Shift-by-wire telemetry
  sbwState.actualGear =
    state.gear;

  if (
    sbwState.mode === 'SBW' &&
    !state.shifting &&
    sbwState.activeFault === 'NONE'
  ) {
    sbwState.tcuStatus =
      'ONLINE';

    sbwState.communication =
      'OK';

    sbwState.security =
      'NORMAL';

    sbwState.validatedGear =
      state.gear;
  }

  if (dom.sbwMode) {
    dom.sbwMode.value =
      sbwState.mode;
  }

  if (dom.sbwStatus) {
    dom.sbwStatus.textContent =
      sbwState.tcuStatus;
  }

  if (dom.sbwRequested) {
    dom.sbwRequested.textContent =
      sbwState.requestedGear;
  }

  if (dom.sbwReceived) {
    dom.sbwReceived.textContent =
      sbwState.receivedGear;
  }

  if (dom.sbwValidated) {
    dom.sbwValidated.textContent =
      sbwState.validatedGear;
  }

  if (dom.sbwActual) {
    dom.sbwActual.textContent =
      sbwState.actualGear;
  }

  if (dom.sbwCommunication) {
    dom.sbwCommunication.textContent =
      sbwState.communication;
  }

  if (dom.sbwSecurity) {
    dom.sbwSecurity.textContent =
      `SECURITY: ${sbwState.security}`;

    const dangerStates = [
      'COMMAND REJECTED',
      'COMMUNICATION FAULT',
      'STALE COMMAND REJECTED',
      'STATUS CONFLICT',
      'INVALID GEAR'
    ];

    const warningStates = [
      'FAULT INJECTED',
      'COMMAND VALID'
    ];

    dom.sbwSecurity.className =
      `sbw-security ${
        dangerStates.includes(
          sbwState.security
        )
          ? 'danger'
          : warningStates.includes(
              sbwState.security
            )
            ? 'warning'
            : 'normal'
      }`;
  }

  if (
    dom.sbwEventLog &&
    sbwState.eventLog.length === 0
  ) {
    dom.sbwEventLog.textContent =
      'TCU initialized.';
  }
}

// ============================================================
// UI EVENTS
// ============================================================

function attachUIEvents() {
  dom.gearButtons.forEach(
    (button) => {
      button.addEventListener(
        'click',
        () => {
          startEngineAudio();

          requestGear(
            button.dataset.gear
          );
        }
      );
    }
  );

  dom.rpmSlider.addEventListener(
    'input',
    () => {
      startEngineAudio();

      state.engineRPM =
        Number(
          dom.rpmSlider.value
        );
    }
  );

  dom.clutchButton.addEventListener(
    'click',
    () => {
      startEngineAudio();

      toggleClutch();
    }
  );

  dom.pauseButton.addEventListener(
    'click',
    () => {
      startEngineAudio();

      togglePause();
    }
  );

  dom.resetButton.addEventListener(
    'click',
    () => {
      startEngineAudio();

      resetSimulation();
    }
  );

  window.addEventListener(
    'keydown',
    (event) => {
      startEngineAudio();

      const key =
        event.key.toUpperCase();

      if (
        [
          'N',
          '1',
          '2',
          '3',
          '4',
          '5',
          'R'
        ].includes(key)
      ) {
        requestGear(key);
      } else if (
        key === 'C'
      ) {
        toggleClutch();
      } else if (
        event.code === 'Space'
      ) {
        event.preventDefault();

        togglePause();
      }
    }
  );

  // Shift-by-wire mode
  dom.sbwMode?.addEventListener(
    'change',
    () => {
      sbwState.mode =
        dom.sbwMode.value;

      if (
        sbwState.mode ===
        'MECHANICAL'
      ) {
        sbwState.tcuStatus =
          'BYPASSED';

        sbwState.communication =
          'N/A';

        sbwState.security =
          'NORMAL';

        sbwLog(
          'CONTROL MODE: MECHANICAL — TCU BYPASSED'
        );
      } else {
        sbwState.tcuStatus =
          'ONLINE';

        sbwState.communication =
          'OK';

        sbwState.security =
          'NORMAL';

        sbwLog(
          'CONTROL MODE: SHIFT-BY-WIRE — TCU ONLINE'
        );
      }

      updateUI();
    }
  );

  // Cybersecurity fault injection
  dom.faultButtons.forEach(
    (button) => {
      button.addEventListener(
        'click',
        () => {
          injectSBWFault(
            button.dataset.fault
          );
        }
      );
    }
  );

  dom.clearFaultButton?.addEventListener(
    'click',
    () => {
      clearSBWFault();
    }
  );
}

function toggleClutch() {
  state.clutchEngaged =
    !state.clutchEngaged;

  playSound(
    'clutch'
  );

  updatePhysics();
  updateUI();
}

function togglePause() {
  state.paused =
    !state.paused;

  dom.pauseButton.textContent =
    state.paused
      ? 'PLAY'
      : 'PAUSE';

  updateUI();
}

function resetSimulation() {
  state.gear = 'N';

  state.targetGear = 'N';

  state.engineRPM =
    INITIAL_RPM;

  state.clutchEngaged =
    true;

  state.paused =
    false;

  state.shifting =
    false;

  state.shiftElapsed =
    0;

  state.torqueBlend =
    1;

  dom.rpmSlider.value =
    INITIAL_RPM;

  dom.pauseButton.textContent =
    'PAUSE';

  resetSelectorPositions();

  // Reset TCU / shift-by-wire state
  sbwState.sequence += 1;

  sbwState.mode =
    'SBW';

  sbwState.tcuStatus =
    'ONLINE';

  sbwState.requestedGear =
    'N';

  sbwState.receivedGear =
    'N';

  sbwState.validatedGear =
    'N';

  sbwState.actualGear =
    'N';

  sbwState.communication =
    'OK';

  sbwState.security =
    'NORMAL';

  sbwState.activeFault =
    'NONE';

  sbwState.eventLog =
    [];

  sbwLog(
    'TCU reset — system initialized'
  );

  if (dom.sbwMode) {
    dom.sbwMode.value =
      'SBW';
  }

  updateHighlighting();
  updatePhysics();
  updateUI();
}

// ============================================================
// SOUND ARCHITECTURE
// ============================================================

const soundFiles = {
  engine:
    './sounds/engine_loop.mp3',

  clutch:
    './sounds/clutch.mp3',

  gearShift:
    './sounds/gear_shift.mp3',

  reverse:
    './sounds/reverse.mp3'
};

const soundState = {
  initialized: false,

  engine: null,

  clutch: null,

  gearShift: null,

  reverse: null
};

function initAudio() {
  if (
    soundState.initialized
  ) {
    return;
  }

  try {
    soundState.engine =
      new Audio(
        soundFiles.engine
      );

    soundState.engine.loop =
      true;

    soundState.engine.preload =
      'auto';

    soundState.engine.volume =
      0.45;

    soundState.engine.playbackRate =
      0.65;

    soundState.clutch =
      new Audio(
        soundFiles.clutch
      );

    soundState.gearShift =
      new Audio(
        soundFiles.gearShift
      );

    soundState.reverse =
      new Audio(
        soundFiles.reverse
      );

    soundState.initialized =
      true;
  } catch (error) {
    console.warn(
      'Engine audio unavailable:',
      error
    );
  }
}

function startEngineAudio() {
  initAudio();

  if (
    !soundState.engine
  ) {
    return;
  }

  const promise =
    soundState.engine.play();

  if (promise) {
    promise.catch(
      () => {
        // Browser may require user interaction.
      }
    );
  }
}

function updateEngineSound() {
  if (
    !soundState.initialized ||
    !soundState.engine
  ) {
    return;
  }

  const rpmNormalized =
    THREE.MathUtils.clamp(
      (
        state.engineRPM -
        MIN_RPM
      ) /
      (
        MAX_RPM -
        MIN_RPM
      ),
      0,
      1
    );

  // RPM -> engine pitch.
  const targetPlaybackRate =
    THREE.MathUtils.lerp(
      0.65,
      1.85,
      rpmNormalized
    );

  // Smooth pitch changes.
  soundState.engine.playbackRate +=
    (
      targetPlaybackRate -
      soundState.engine.playbackRate
    ) * 0.10;

  // RPM -> volume.
  let targetVolume =
    THREE.MathUtils.lerp(
      0.20,
      0.65,
      rpmNormalized
    );

  if (
    state.paused
  ) {
    targetVolume = 0;
  }

  if (
    !state.clutchEngaged &&
    !state.paused
  ) {
    targetVolume *= 0.75;
  }

  soundState.engine.volume +=
    (
      targetVolume -
      soundState.engine.volume
    ) * 0.10;

  if (
    !state.paused &&
    soundState.engine.paused
  ) {
    soundState.engine
      .play()
      .catch(() => {});
  }

  if (
    state.paused &&
    !soundState.engine.paused
  ) {
    soundState.engine.pause();
  }
}

function playSound(type) {
  try {
    initAudio();

    let sound = null;

    if (
      type === 'clutch'
    ) {
      sound =
        soundState.clutch;
    } else if (
      type === 'reverse'
    ) {
      sound =
        soundState.reverse;
    } else {
      sound =
        soundState.gearShift;
    }

    if (!sound) {
      return;
    }

    sound.currentTime =
      0;

    sound.volume =
      0.55;

    sound.play().catch(
      () => {
        // Browser may block until interaction.
      }
    );
  } catch (error) {
    console.warn(
      'Sound unavailable:',
      error
    );
  }
}

// Browser audio needs a user gesture.
window.addEventListener(
  'pointerdown',
  startEngineAudio,
  { once: true }
);

window.addEventListener(
  'keydown',
  startEngineAudio,
  { once: true }
);

// ============================================================
// MAIN LOOP
// ============================================================

function animate() {
  requestAnimationFrame(
    animate
  );

  const delta =
    Math.min(
      clock.getDelta(),
      0.05
    );

  if (!state.paused) {
    updatePhysics();

    updateGearRotation(
      delta
    );

    updateShiftAnimation(
      delta
    );

    updatePowerFlow(
      delta
    );

    updateUI();
  }

  // Engine sound must update even when paused
  // so the volume fades correctly.
  updateEngineSound();

  controls.update();

  updateUI();

  renderer.render(
    scene,
    camera
  );
}

// ============================================================
// BOOT
// ============================================================

async function boot() {
  cacheDom();

  initThree();

  attachUIEvents();

  try {
    await loadModel();

    resetSelectorPositions();

    updatePhysics();

    updateHighlighting();

    updateUI();

    animate();
  } catch (error) {
    console.error(error);

    dom.loading.classList.add(
      'hidden'
    );

    dom.error.classList.remove(
      'hidden'
    );

    dom.errorDetail.textContent =
      String(
        error?.message ||
        error
      );
  }
}

boot();