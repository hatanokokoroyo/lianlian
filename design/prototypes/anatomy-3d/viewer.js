import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import {
  DEFAULT_PALETTE,
  FRAME_COMMAND_TYPES,
  attentionFocusView,
  buildAttention,
  colorForInstance,
  createCards,
  createHighlight,
  createViewerState,
  exportViewerState,
  isolationControl,
  isAbnormalInstance,
  missingHighlightSites,
  nextTierForFps,
  normalizeColor,
  reduce,
  resolveCard,
  restoreViewerState,
} from './viewer-state.js';

const PARAMS = new URLSearchParams(location.search);
const TIER_TEST_MODE = PARAMS.get('tierTest') === '1';
const AUTO_TIER_ENABLED = PARAMS.get('autoTier') !== '0' && !TIER_TEST_MODE;

const TIERS = {
  raw: {
    label: '视觉档',
    url: '../../../docs/research/assets/za-raw-smooth.glb',
  },
  cap3000: {
    label: '性能档',
    url: '../../../docs/research/assets/za-cap3000-smooth.glb',
  },
  cap2000: {
    label: '流畅档',
    url: '../../../docs/research/assets/za-cap2000-smooth.glb',
  },
};

const VIEWS = {
  front: { label: '正视', dir: new THREE.Vector3(0, 0, 1), widthAxis: 'x', depthAxis: 'z' },
  back: { label: '背视', dir: new THREE.Vector3(0, 0, -1), widthAxis: 'x', depthAxis: 'z' },
  left: { label: '左视', dir: new THREE.Vector3(1, 0, 0), widthAxis: 'z', depthAxis: 'x' },
  right: { label: '右视', dir: new THREE.Vector3(-1, 0, 0), widthAxis: 'z', depthAxis: 'x' },
};

const PRESETS = new Set(['all', 'shallow', 'deep', 'bone']);
const BATCH_NAMES = ['shallow', 'deep', 'bone'];

// Deep view: intrinsic/core muscles. Everything else is treated as superficial.
const DEEP_SITES = new Set([
  'transversus-abdominis',
  'quadratus-lumborum',
  'multifidus',
  'psoas-major',
  'iliacus',
  'diaphragm',
  'obturator-internus',
  'piriformis',
  'gemellus-superior',
  'gemellus-inferior',
  'quadratus-femoris',
  'gluteus-minimus',
  'adductor-brevis',
  'adductor-magnus',
  'pectineus',
  'iliocostalis',
  'longissimus',
  'spinalis',
  'semispinalis-capitis',
  'splenius-capitis',
  'longus-colli',
  'longus-capitis',
  'scalenus-anterior',
  'scalenus-medius',
  'subscapularis',
  'supraspinatus',
  'infraspinatus',
  'teres-minor',
  'brachialis',
  'supinator',
]);

// The deep preset exposes every intrinsic muscle, including the rotator cuff
// and arm muscles that are still visible from the outside. The "hidden in the
// whole body" hint only covers sites that the superficial layer actually
// covers, so those stay out of it.
const HIDDEN_DEEP_SITES = new Set(
  [...DEEP_SITES].filter((site) => ![
    'supraspinatus',
    'infraspinatus',
    'teres-minor',
    'brachialis',
    'supinator',
  ].includes(site)),
);

const PRESET_LABELS = {
  all: '全身',
  shallow: '浅层',
  deep: '深层',
  bone: '骨骼',
};

const HINT_KEY = 'lianlian.anatomy3d.hintSeen';
const SLOW_LOAD_MS = 3000;
const AUTO_TIER_SAMPLE_MS = 2000;
const AUTO_TIER_MIN_FRAMES = 3;
const TIER_NOTICE_MS = 3000;

function readChoice(value, allowed, fallback) {
  return allowed.has(value) ? value : fallback;
}

let state = {
  ...createViewerState({
    tier: readChoice(PARAMS.get('tier'), new Set(Object.keys(TIERS)), 'raw'),
    view: readChoice(PARAMS.get('view'), new Set(Object.keys(VIEWS)), 'front'),
    preset: readChoice(PARAMS.get('preset'), PRESETS, 'all'),
  }),
  highlight: createHighlight(),
  cards: [],
  spin: PARAMS.get('spin') === '1',
  urlStateApplied: false,
  ready: false,
  sites: new Map(),
  instances: [],
  batches: Object.create(null),
  lookups: Object.create(null),
  bounds: new THREE.Box3(),
  viewTarget: new THREE.Vector3(),
  layout: { top: 24, bottom: 190, usableH: 400, width: 390, height: 844, offsetY: 0 },
  attentionAutoOpened: false,
};

const stats = {
  tier: state.tier,
  triangles: 0,
  renderedTriangles: 0,
  drawCalls: 0,
  fps: 0,
  fpsAvg: 0,
  fpsMin: 0,
  spin: state.spin,
  spinYaw: 0,
  loadMs: 0,
  multiDraw: null,
  instances: 0,
  sites: 0,
  selectedSite: null,
  selectedSide: null,
  selectedObjectCount: 0,
  cards: 0,
  highlightColor: null,
  highlightSites: [],
  highlightedSiteIds: [],
  abnormalObjectCount: 0,
  abnormalColors: [],
  missingSites: [],
  palette: { ...createHighlight().palette },
  visibleInstances: 0,
  view: state.view,
  preset: state.preset,
  cameraDistance: 0,
  cameraTarget: null,
  cameraPosition: null,
  cameraMinDistance: 0,
  cameraMaxDistance: 0,
  isolate: false,
  isolateLabel: '只看这块',
  archiveAvailable: false,
  presetLocked: false,
  attentionOpen: false,
  attentionCount: 0,
  attentionGroups: 0,
  attentionMissing: 0,
  attentionLeft: 0,
  attentionRight: 0,
  attentionDeep: 0,
  markerCount: 0,
  sheetCardIndex: null,
  sheetNeedsSideChoice: false,
  sheetAvailableSides: [],
  sheetSideButtons: 0,
  layoutTop: 0,
  layoutBottom: 0,
  layoutUsableH: 0,
  layoutOffsetY: 0,
  frameCommands: 0,
  lastFrameCommand: null,
  autoTier: AUTO_TIER_ENABLED,
  autoTierSampledFps: 0,
  autoTierDecision: null,
  tierNoticeCount: 0,
  tierNoticeVisible: false,
  slowDevice: false,
  slowDeviceCount: 0,
  ready: false,
  error: null,
};

const api = {
  ready: false,
  error: null,
  stats,
  setView,
  setPreset,
  selectSite,
  setIsolate,
  setHighlight,
  exportState,
  restoreState,
  openAttention,
  setSpin,
  setTier,
  reset,
};
if (TIER_TEST_MODE) {
  api.testTierFps = testTierFps;
}
window.__viewer = api;

const body = document.body;
const canvas = document.querySelector('#scene');
const loadingEl = document.querySelector('#loading');
const loadingTitleEl = document.querySelector('#loading-title');
const loadingSlowEl = document.querySelector('#loading-slow');
const loadingRetryEl = document.querySelector('#loading-retry');
const bottomStackEl = document.querySelector('.bottom-stack');
const gestureHintEl = document.querySelector('#gesture-hint');
const overviewEl = document.querySelector('#overview');
const overviewCountEl = document.querySelector('#overview-count');
const overviewSubEl = document.querySelector('#overview-sub');
const overviewChipsEl = document.querySelector('#overview-chips');
const markersEl = document.querySelector('#markers');
const focusPillEl = document.querySelector('#focus-pill');
const focusTextEl = document.querySelector('#focus-text');
const focusOpenEl = document.querySelector('#focus-open');
const sheetEl = document.querySelector('#detail-sheet');
const sheetHeadEl = document.querySelector('#sheet-head');
const sheetCloseEl = document.querySelector('#sheet-close');
const sheetTitleEl = document.querySelector('#sheet-title');
const sheetSideEl = document.querySelector('#sheet-side');
const sheetSidesEl = document.querySelector('#sheet-sides');
const sheetMetaEl = document.querySelector('#sheet-meta');
const sheetAxesEl = document.querySelector('#sheet-axes');
const sheetWorstEl = document.querySelector('#sheet-worst');
const sheetRelatedEl = document.querySelector('#sheet-related');
const sheetIsolateEl = document.querySelector('#sheet-isolate');
const sheetOpenEl = document.querySelector('#sheet-open');
const attentionTriggerEl = document.querySelector('#attention-trigger');
const attentionCountEl = document.querySelector('#attention-count');
const attentionSheetEl = document.querySelector('#attention-sheet');
const attentionHeadEl = document.querySelector('#attention-head');
const attentionCloseEl = document.querySelector('#attention-close');
const attentionTitleEl = document.querySelector('#attention-title');
const attentionListEl = document.querySelector('#attention-list');
const viewButtons = Array.from(document.querySelectorAll('[data-view]'));
const presetButtons = Array.from(document.querySelectorAll('[data-preset]'));
const presetTrigger = document.querySelector('#preset-trigger');
const presetMenu = document.querySelector('#preset-menu');
const presetLabel = document.querySelector('#preset-label');
const tierNoticeEl = document.querySelector('#tier-notice');

let renderer;
let scene;
let camera;
let controls;
let raycaster;
let keyLight;
let fillLight;
let rimLight;
let dracoLoader;
let spinPivot;
let manifestPromise = null;
let loadSequence = 0;
let framePending = false;
let lastFrameTime = 0;
let spinSamples = [];
let spinSampleTotal = 0;
let lastSpinTimestamp = 0;
let spinAngle = 0;
let pointerDown = null;
let activePointers = new Set();
let maxPointersInGesture = 0;
let slowLoadTimer = 0;
let menuOpen = false;
let sheetOpen = false;
let attentionOpen = false;
let focusedSite = null;
let focusedSide = null;
let sheetCard = null;
let reopenAttentionOnClose = false;
let selectionOffsetBoost = 0;
let attentionFacingApplied = false;
let userMovedCamera = false;
let cameraGestureActive = false;
let pendingRestore = null;
let statePublishTimer = 0;
let autoTierActive = false;
let autoTierStarted = false;
let autoTierDone = false;
let autoTierSamples = [];
let autoTierWindowStart = 0;
let autoTierLastTimestamp = 0;
let tierNoticeShown = false;
let tierNoticeTimer = 0;
let tierNoticeHideTimer = 0;
let slowDevicePosted = false;

const FRAME_COMMANDS = new Set(FRAME_COMMAND_TYPES);

const pointerNdc = new THREE.Vector2();
const focusBox = new THREE.Box3();
const focusCenter = new THREE.Vector3();
const focusSize = new THREE.Vector3();
const attentionBox = new THREE.Box3();
const attentionCenter = new THREE.Vector3();
const viewDirection = new THREE.Vector3();
const colorCache = new Map();

function toColor(value) {
  const hex = normalizeColor(value) ?? DEFAULT_PALETTE.mid;
  let color = colorCache.get(hex);
  if (!color) {
    color = new THREE.Color(hex);
    colorCache.set(hex, color);
  }
  return color;
}

body.dataset.ui = PARAMS.get('ui') === '0' ? '0' : '1';

function init() {
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
  } catch (error) {
    fail(error);
    return;
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.06;
  renderer.setSize(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight, false);

  stats.multiDraw = Boolean(renderer.getContext().getExtension('WEBGL_multi_draw'));

  scene = new THREE.Scene();

  const hemisphere = new THREE.HemisphereLight(0xfff1e2, 0x1b1a18, 1.15);
  scene.add(hemisphere);

  keyLight = new THREE.DirectionalLight(0xfff3e3, 1.5);
  keyLight.target.position.set(0, 0.9, 0);
  scene.add(keyLight, keyLight.target);

  fillLight = new THREE.DirectionalLight(0xcfe6ef, 0.42);
  fillLight.target.position.set(0, 0.9, 0);
  scene.add(fillLight, fillLight.target);

  rimLight = new THREE.DirectionalLight(0x9fd8e8, 0.75);
  rimLight.target.position.set(0, 0.9, 0);
  scene.add(rimLight, rimLight.target);

  spinPivot = new THREE.Group();
  spinPivot.name = 'anatomy-spin';
  scene.add(spinPivot);

  camera = new THREE.PerspectiveCamera(32, 1, 0.01, 60);
  camera.position.set(0, 0.95, 5);

  controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.085;
  controls.enablePan = false;
  controls.rotateSpeed = 0.82;
  controls.zoomSpeed = 0.9;
  controls.minDistance = 0.75;
  controls.maxDistance = 14;
  controls.minPolarAngle = Math.PI * 0.12;
  controls.maxPolarAngle = Math.PI * 0.88;
  controls.touches.TWO = THREE.TOUCH.DOLLY_ROTATE;
  controls.addEventListener('start', () => {
    cameraGestureActive = true;
  });
  controls.addEventListener('change', () => {
    if (cameraGestureActive) userMovedCamera = true;
    syncViewFromCamera();
    requestRender();
  });
  controls.addEventListener('end', () => {
    cameraGestureActive = false;
    scheduleStatePublish();
  });

  raycaster = new THREE.Raycaster();

  dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath(new URL('./vendor/draco/', import.meta.url).href);
  dracoLoader.setDecoderConfig({ type: 'wasm' });

  bindUi();
  bindPicking();
  applyPaletteVars(state.highlight.palette);
  resize();

  const observer = new ResizeObserver(() => resize());
  observer.observe(document.querySelector('#app'));

  initGestureHint();
  updateUiFromState();
  loadTier(state.tier);
}

function bindUi() {
  for (const button of viewButtons) {
    button.addEventListener('click', () => setView(button.dataset.view));
  }

  for (const button of presetButtons) {
    button.addEventListener('click', () => {
      if (isIsolated()) return;
      setPreset(button.dataset.preset);
      setMenuOpen(false, { focusTrigger: true });
    });
  }

  presetTrigger.addEventListener('click', () => {
    if (isIsolated()) return;
    setMenuOpen(!menuOpen);
  });
  document.addEventListener('pointerdown', (event) => {
    if (!menuOpen) return;
    if (presetMenu.contains(event.target) || presetTrigger.contains(event.target)) return;
    setMenuOpen(false);
  }, true);
  document.addEventListener('keydown', (event) => {
    if (!menuOpen || event.key !== 'Escape') return;
    event.preventDefault();
    setMenuOpen(false, { focusTrigger: true });
  });
  document.addEventListener('keydown', (event) => {
    if (!attentionOpen || event.key !== 'Escape') return;
    event.preventDefault();
    closeAttention();
  });

  loadingRetryEl.addEventListener('click', () => location.reload());
  focusOpenEl.addEventListener('click', () => {
    if (focusedSite === null) return;
    const site = focusedSite;
    const side = focusedSide;
    focusedSite = null;
    focusedSide = null;
    selectSite(site, side);
  });
  canvas.addEventListener('wheel', noteUserInteraction, { passive: true });
  bindSheet();
  bindAttention();
}

/** Theme colors arrive through setHighlight; the sheet only reads CSS vars. */
function applyPaletteVars(palette) {
  const style = document.documentElement.style;
  style.setProperty('--palette-left', palette.left);
  style.setProperty('--palette-right', palette.right);
  style.setProperty('--palette-mid', palette.mid);
  style.setProperty('--palette-muscle', palette.muscle);
  style.setProperty('--palette-bone', palette.bone);
  style.setProperty('--palette-abnormal', palette.abnormal);
  style.setProperty('--palette-selected', palette.selected);
}

function bindSheet() {
  sheetCloseEl.addEventListener('click', () => selectSite(null));
  sheetIsolateEl.addEventListener('click', () => setIsolate(!isIsolated()));
  sheetOpenEl.addEventListener('click', () => {
    if (!sheetCard) return;
    try {
      window.nsh?.postMessage(JSON.stringify({
        type: 'anatomy3d:open-section',
        siteId: sheetCard.siteId,
        side: sheetCard.side,
      }));
    } catch {
      // Outside NSH (plain browser) there is nobody to notify.
    }
  });

  let drag = null;
  sheetHeadEl.addEventListener('pointerdown', (event) => {
    if (event.target.closest('button')) return;
    drag = {
      pointerId: event.pointerId,
      y: event.clientY,
      at: performance.now(),
    };
    sheetEl.classList.add('is-dragging');
    try {
      sheetHeadEl.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is an enhancement; the move/up listeners still work.
    }
  });
  sheetHeadEl.addEventListener('pointermove', (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const distance = Math.max(0, event.clientY - drag.y);
    sheetEl.style.transform = `translateY(${distance}px)`;
  });
  const finishDrag = (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const distance = Math.max(0, event.clientY - drag.y);
    const elapsed = performance.now() - drag.at;
    drag = null;
    sheetEl.classList.remove('is-dragging');
    if (distance > 56 || (distance > 24 && elapsed < 220)) {
      selectSite(null);
    } else {
      sheetEl.style.transform = '';
    }
  };
  sheetHeadEl.addEventListener('pointerup', finishDrag);
  sheetHeadEl.addEventListener('pointercancel', finishDrag);
}

function bindAttention() {
  attentionTriggerEl.addEventListener('click', () => {
    if (attentionOpen) {
      closeAttention();
    } else {
      openAttention();
    }
  });
  attentionCloseEl.addEventListener('click', () => closeAttention());

  let drag = null;
  attentionHeadEl.addEventListener('pointerdown', (event) => {
    if (event.target.closest('button')) return;
    drag = {
      pointerId: event.pointerId,
      y: event.clientY,
      at: performance.now(),
    };
    attentionSheetEl.classList.add('is-dragging');
    try {
      attentionHeadEl.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is an enhancement; the move/up listeners still work.
    }
  });
  attentionHeadEl.addEventListener('pointermove', (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const distance = Math.max(0, event.clientY - drag.y);
    attentionSheetEl.style.transform = `translateY(${distance}px)`;
  });
  const finishDrag = (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const distance = Math.max(0, event.clientY - drag.y);
    const elapsed = performance.now() - drag.at;
    drag = null;
    attentionSheetEl.classList.remove('is-dragging');
    if (distance > 56 || (distance > 24 && elapsed < 220)) {
      closeAttention();
    } else {
      attentionSheetEl.style.transform = '';
    }
  };
  attentionHeadEl.addEventListener('pointerup', finishDrag);
  attentionHeadEl.addEventListener('pointercancel', finishDrag);
}

function bindPicking() {
  canvas.addEventListener('pointerdown', (event) => {
    activePointers.add(event.pointerId);
    maxPointersInGesture = Math.max(maxPointersInGesture, activePointers.size);
    if (activePointers.size === 1) {
      pointerDown = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        time: performance.now(),
      };
    }
  });

  canvas.addEventListener('pointerup', (event) => {
    const moved = pointerDown && pointerDown.pointerId === event.pointerId
      ? Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y)
      : 0;
    const wasTap =
      pointerDown &&
      pointerDown.pointerId === event.pointerId &&
      maxPointersInGesture === 1 &&
      moved <= 6 &&
      performance.now() - pointerDown.time <= 650;

    if (maxPointersInGesture > 1 || moved > 6) {
      noteUserInteraction();
    }

    activePointers.delete(event.pointerId);
    if (activePointers.size === 0) {
      pointerDown = null;
      maxPointersInGesture = 0;
    }

    if (wasTap && attentionOpen) {
      closeAttention({ focus: false });
    }
    if (wasTap && pickAt(event.clientX, event.clientY)) {
      noteUserInteraction();
    }
  });

  const cancelGesture = (event) => {
    activePointers.delete(event.pointerId);
    if (activePointers.size === 0) {
      pointerDown = null;
      maxPointersInGesture = 0;
    }
  };
  canvas.addEventListener('pointercancel', cancelGesture);
  canvas.addEventListener('lostpointercapture', cancelGesture);
}

function resize() {
  if (!renderer || !camera) return;
  const width = Math.max(1, canvas.clientWidth || window.innerWidth);
  const height = Math.max(1, canvas.clientHeight || window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  applyOverlayLayout(width, height);
  if (state.ready) {
    updateLights();
  }
  requestRender();
}

/** Room the in-viewer summary needs above the model. */
const UI_TOP_RESERVE = 78;

function elementVisible(el) {
  return Boolean(el) && !el.hidden && el.offsetParent !== null;
}

/**
 * Bottom pixels covered by chrome: the control stack or an open sheet. Sheets
 * are measured by height because their slide-in transform would otherwise make
 * `getBoundingClientRect().top` lie until the transition ends.
 */
function overlayBottomInset(height) {
  let inset = 0;
  if (elementVisible(bottomStackEl)) {
    const rect = bottomStackEl.getBoundingClientRect();
    if (rect.height > 0) inset = Math.max(inset, height - rect.top + 8);
  }
  for (const el of [sheetEl, attentionSheetEl]) {
    if (!elementVisible(el) || el.offsetHeight <= 0) continue;
    inset = Math.max(inset, el.offsetHeight + 8);
  }
  return inset;
}

function updateProjectionLayout(width, height) {
  const uiVisible = body.dataset.ui !== '0';
  const baseTop = Math.min(Math.max(height * 0.02, 16), 48);
  const topInset = uiVisible
    ? Math.min(Math.max(UI_TOP_RESERVE, baseTop), height * 0.22)
    : baseTop;
  const bottomInset = Math.min(overlayBottomInset(height), height * 0.72);
  const usableH = Math.max(160, height - topInset - bottomInset);
  const desiredCenter = topInset + usableH / 2;
  const offsetY = Math.round(height / 2 - desiredCenter + selectionOffsetBoost);

  state.layout = { top: topInset, bottom: bottomInset, usableH, width, height, offsetY };
  stats.layoutTop = topInset;
  stats.layoutBottom = bottomInset;
  stats.layoutUsableH = usableH;
  stats.layoutOffsetY = offsetY;
  camera.aspect = width / height;
  if (offsetY !== 0) {
    camera.setViewOffset(width, height, 0, offsetY, width, height);
  } else {
    camera.clearViewOffset();
    camera.aspect = width / height;
  }
  camera.updateProjectionMatrix();
}

const projectionPoint = new THREE.Vector3();

function projectedBounds(box, width, height) {
  if (!box || box.isEmpty() || !camera) return null;
  camera.updateMatrixWorld();
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let seen = false;
  for (let corner = 0; corner < 8; corner += 1) {
    projectionPoint.set(
      corner & 1 ? box.max.x : box.min.x,
      corner & 2 ? box.max.y : box.min.y,
      corner & 4 ? box.max.z : box.min.z,
    ).project(camera);
    if (projectionPoint.z < -1 || projectionPoint.z > 1) continue;
    const x = ((projectionPoint.x + 1) * width) / 2;
    const y = ((1 - projectionPoint.y) * height) / 2;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
    seen = true;
  }
  return seen ? { minX, maxX, minY, maxY } : null;
}

/** Extra upward shift that keeps the selected part above an open sheet. */
function selectionOverflow(width, height) {
  if (!state.selectedSite || !sheetOpen) return 0;
  const bounds = projectedBounds(focusBoxFor(state.selectedSite), width, height);
  if (!bounds) return 0;
  const safeBottom = height - sheetEl.offsetHeight - 20;
  const safeTop = state.layout.top + 8;
  const wanted = Math.max(0, bounds.maxY - safeBottom);
  const room = Math.max(0, bounds.minY - safeTop);
  return Math.min(wanted, room);
}

/**
 * Re-lay out the projection for the chrome that is on screen. Opening a sheet
 * lifts the model instead of moving the camera, so a pick keeps its framing.
 */
function applyOverlayLayout(
  width = Math.max(1, canvas.clientWidth || window.innerWidth),
  height = Math.max(1, canvas.clientHeight || window.innerHeight),
) {
  if (!camera) return;
  selectionOffsetBoost = 0;
  updateProjectionLayout(width, height);
  const shift = selectionOverflow(width, height);
  if (shift > 0.5) {
    selectionOffsetBoost = shift;
    updateProjectionLayout(width, height);
  }
  requestRender();
}

function syncViewFromCamera() {
  if (!state.ready || !camera || !controls) return;

  viewDirection.copy(camera.position).sub(controls.target);
  if (viewDirection.lengthSq() === 0) return;
  viewDirection.normalize();

  let nearest = state.view;
  let best = -Infinity;
  for (const view of Object.keys(VIEWS)) {
    const dot = viewDirection.dot(VIEWS[view].dir);
    if (dot > best) {
      best = dot;
      nearest = view;
    }
  }

  if (nearest !== state.view) {
    state.view = nearest;
    updateViewButtons();
    updateOverview();
  }
}

function setMenuOpen(open, options = {}) {
  menuOpen = Boolean(open) && !isIsolated();
  presetMenu.hidden = !menuOpen;
  presetTrigger.setAttribute('aria-expanded', String(menuOpen));
  if (options.focusTrigger) {
    presetTrigger.focus();
  }
}

function isIsolated() {
  return isolationControl(state).active;
}

function siteHasInstances(siteId) {
  return Boolean(siteId)
    && state.instances.some((item) => item.siteId === siteId);
}

function siteHasCard(siteId) {
  return Boolean(siteId)
    && state.cards.some((card) => card.siteId === siteId);
}

function loadedSiteIds() {
  if (!state.ready) return null;
  return new Set(state.instances.map((item) => item.siteId));
}

function attentionModel() {
  const model = buildAttention(
    state.cards,
    state.highlight.sites,
    loadedSiteIds(),
    HIDDEN_DEEP_SITES,
  );
  for (const section of model.sections) {
    for (const row of section.rows) {
      if (row.siteZh === row.siteId) row.siteZh = siteName(row.siteId);
    }
  }
  return model;
}

function attentionRows(model = attentionModel()) {
  return model.sections.flatMap((section) => section.rows.map((row) => ({
    ...row,
    groupId: section.groupId,
    groupZh: section.groupZh,
  })));
}

const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';

function circledNumber(value) {
  if (!Number.isInteger(value) || value < 1) return '';
  return CIRCLED[value - 1] ?? `${value}`;
}

const bodyCenter = new THREE.Vector3();
const bodySize = new THREE.Vector3();
const siteBox = new THREE.Box3();

function meshCenterFor(siteId, side) {
  siteBox.makeEmpty();
  for (const item of state.instances) {
    if (!item.bounds || item.siteId !== siteId) continue;
    if (side !== null && side !== undefined && item.side !== side) continue;
    siteBox.union(item.bounds);
  }
  if (siteBox.isEmpty()) return null;
  return siteBox.getCenter(new THREE.Vector3());
}

function facesView(center, view) {
  if (!center || !VIEWS[view]) return false;
  state.bounds.getCenter(bodyCenter);
  state.bounds.getSize(bodySize);
  const axis = VIEWS[view].depthAxis;
  const threshold = Math.max(0.008, bodySize.length() * 0.008);
  return (center[axis] - bodyCenter[axis]) * VIEWS[view].dir[axis] > threshold;
}

function renderAttentionRow(row) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'attention-row';
  button.dataset.siteId = row.siteId;
  button.dataset.side = row.side ?? '';
  button.dataset.deep = row.deep ? '1' : '0';
  button.setAttribute(
    'aria-label',
    `${row.index} ${row.siteZh}${row.sideZh ?? '中线'}，${row.worst}${row.deep ? '，深层' : ''}${row.missing ? '，模型里暂缺' : ''}`,
  );

  const num = document.createElement('span');
  num.className = 'attention-num';
  num.textContent = String(row.index);

  const main = document.createElement('span');
  main.className = 'attention-row-main';
  const head = document.createElement('span');
  head.className = 'attention-row-head';
  const site = document.createElement('span');
  site.className = 'attention-site';
  site.textContent = row.siteZh;
  const side = document.createElement('span');
  side.className = 'attention-side';
  side.textContent = row.sideZh ?? '中线';
  head.append(site, side);
  const worst = document.createElement('span');
  worst.className = 'attention-worst';
  worst.textContent = row.worst;
  main.append(head, worst);
  button.append(num, main);

  if (row.deep) {
    const deep = document.createElement('span');
    deep.className = 'attention-deep';
    deep.textContent = '深层';
    button.append(deep);
  }

  if (row.missing) {
    const missing = document.createElement('span');
    missing.className = 'attention-missing';
    missing.textContent = '模型里暂缺';
    button.append(missing);
  }

  const sev = document.createElement('span');
  sev.className = 'attention-sev';
  sev.textContent = row.severity > 1 ? `${row.severity}/10` : '异常';
  button.append(sev);

  button.addEventListener('click', () => selectAttentionRow(row.siteId, row.side));
  return button;
}

function renderAttention(model = attentionModel()) {
  attentionTitleEl.textContent = `需要注意 · ${model.count} 处`;
  attentionListEl.replaceChildren(
    ...model.sections.map((section) => {
      const group = document.createElement('section');
      group.className = 'attention-group';
      const title = document.createElement('h3');
      title.className = 'attention-group-title';
      title.textContent = `${section.groupZh} · ${section.rows.length} 处`;
      const rows = document.createElement('div');
      rows.className = 'attention-rows';
      rows.replaceChildren(...section.rows.map(renderAttentionRow));
      group.append(title, rows);
      return group;
    }),
  );
}

function viewFacingCount(view, rows) {
  let count = 0;
  for (const row of rows) {
    if (row.deep) continue;
    const center = meshCenterFor(row.siteId, row.side);
    if (center && facesView(center, view)) count += 1;
  }
  return count;
}

function overviewChip(text, className, onPress) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `chip ${className}`;
  button.textContent = text;
  button.addEventListener('click', onPress);
  return button;
}

function updateOverview(model = attentionModel()) {
  const rows = attentionRows(model);
  if (body.dataset.ui === '0' || rows.length === 0) {
    overviewEl.hidden = true;
    return;
  }
  overviewEl.hidden = false;
  overviewCountEl.textContent = String(rows.length);
  const left = rows.filter((row) => row.side === 'left').length;
  const right = rows.filter((row) => row.side === 'right').length;
  const deep = rows.filter((row) => row.deep).length;
  overviewSubEl.textContent =
    `${model.sections.length} 个肌群 · 左 ${left} · 右 ${right}`;

  const chips = [];
  if (deep > 0) {
    chips.push(overviewChip(`深层 ${deep}`, 'chip-deep', () => {
      if (!isIsolated()) setPreset('deep');
    }));
  }
  const otherView = state.view === 'back' ? 'front' : 'back';
  const otherCount = viewFacingCount(otherView, rows);
  if (otherCount > 0) {
    chips.push(overviewChip(
      `${otherView === 'back' ? '背面' : '正面'} ${otherCount} ›`,
      '',
      () => setView(otherView),
    ));
  }
  overviewChipsEl.replaceChildren(...chips);
  stats.attentionLeft = left;
  stats.attentionRight = right;
  stats.attentionDeep = deep;
}

const markerNodes = new Map();

function focusAttentionRow(row) {
  focusedSite = row.siteId;
  focusedSide = row.side;
  updateFocusPill();
  updateMarkers();
  requestRender();
}

function clearFocus() {
  if (focusedSite === null) return;
  focusedSite = null;
  focusedSide = null;
  updateFocusPill();
  updateMarkers();
  requestRender();
}

function updateFocusPill() {
  if (focusedSite === null || sheetOpen) {
    focusPillEl.hidden = true;
    return;
  }
  const row = attentionRows().find(
    (entry) => entry.siteId === focusedSite && entry.side === focusedSide,
  );
  if (!row) {
    focusPillEl.hidden = true;
    return;
  }
  focusPillEl.hidden = false;
  focusPillEl.classList.toggle('is-deep', Boolean(row.deep));
  const label = document.createElement('b');
  label.textContent = `${circledNumber(row.index)} ${row.siteZh} · ${row.sideZh ?? '中线'}`;
  const rest = document.createElement('span');
  rest.textContent = row.worst ? ` · ${row.worst}` : '';
  focusTextEl.replaceChildren(label, rest);
}

function updateMarkers(model = attentionModel()) {
  const width = Math.max(1, canvas.clientWidth || window.innerWidth);
  const height = Math.max(1, canvas.clientHeight || window.innerHeight);
  const canShow = body.dataset.ui !== '0'
    && state.ready
    && state.preset !== 'bone'
    && camera;

  const projected = [];
  if (canShow) {
    camera.updateMatrixWorld();
    for (const row of attentionRows(model)) {
      if (state.isolate && state.selectedSite && row.siteId !== state.selectedSite) {
        continue;
      }
      const center = meshCenterFor(row.siteId, row.side);
      if (!center || !facesView(center, state.view)) continue;
      projectionPoint.copy(center).project(camera);
      if (projectionPoint.z < -1 || projectionPoint.z > 1) continue;
      const x = ((projectionPoint.x + 1) * width) / 2;
      const y = ((1 - projectionPoint.y) * height) / 2;
      if (x < 10 || x > width - 10 || y < state.layout.top || y > height - 10) {
        continue;
      }
      projected.push({ row, x, y });
      if (projected.length >= 4) break;
    }
  }

  const keep = new Set();
  for (const { row, x, y } of projected) {
    keep.add(row.index);
    let marker = markerNodes.get(row.index);
    if (!marker) {
      marker = document.createElement('button');
      marker.type = 'button';
      marker.className = 'marker';
      marker.addEventListener('click', (event) => {
        event.stopPropagation();
        const latest = attentionRows().find((entry) => entry.index === row.index);
        if (latest) focusAttentionRow(latest);
      });
      markerNodes.set(row.index, marker);
      markersEl.append(marker);
    }
    marker.textContent = String(row.index);
    marker.dataset.siteId = row.siteId;
    marker.dataset.side = row.side ?? '';
    marker.style.left = `${x}px`;
    marker.style.top = `${y}px`;
    marker.setAttribute(
      'aria-label',
      `${row.index} ${row.siteZh} ${row.sideZh ?? '中线'}${row.deep ? '，深层' : ''}`,
    );
    const selected = state.selectedSite === row.siteId
      && (state.selectedSide === null || state.selectedSide === row.side);
    const focused = focusedSite === row.siteId && focusedSide === row.side;
    marker.classList.toggle('is-deep', Boolean(row.deep));
    marker.classList.toggle('is-focused', selected || focused);
    marker.classList.toggle('is-dimmed', Boolean(focusedSite || state.selectedSite) && !(selected || focused));
  }

  for (const [index, marker] of markerNodes) {
    if (keep.has(index)) continue;
    marker.remove();
    markerNodes.delete(index);
  }
  stats.markerCount = projected.length;
}

function updateAttentionUi() {
  const model = attentionModel();
  const count = model.count;
  attentionCountEl.textContent = String(count);
  attentionTriggerEl.hidden = count === 0;
  attentionTriggerEl.setAttribute('aria-expanded', String(attentionOpen));
  stats.attentionCount = count;
  stats.attentionGroups = model.sections.length;
  stats.attentionMissing = model.sections.reduce(
    (total, section) => total + section.rows.filter((row) => row.missing).length,
    0,
  );
  stats.attentionOpen = attentionOpen;
  updateOverview(model);
  updateMarkers(model);
  updateFocusPill();

  if (count === 0) {
    if (attentionOpen) closeAttention({ focus: false });
    return;
  }
  if (attentionOpen) renderAttention(model);
}

function openAttention() {
  const model = attentionModel();
  if (model.count === 0) return false;
  reopenAttentionOnClose = false;
  if (sheetOpen) closeSheet({ focus: false });
  renderAttention(model);
  attentionOpen = true;
  attentionSheetEl.hidden = false;
  attentionTriggerEl.setAttribute('aria-expanded', 'true');
  stats.attentionOpen = true;
  requestAnimationFrame(() => {
    if (attentionOpen) attentionSheetEl.classList.add('is-open');
  });
  try {
    attentionSheetEl.focus({ preventScroll: true });
  } catch {
    // Focus is best-effort on hosts that do not expose options.
  }
  applyOverlayLayout();
  return true;
}

function closeAttention(options = {}) {
  attentionTriggerEl.setAttribute('aria-expanded', 'false');
  stats.attentionOpen = false;
  if (!attentionOpen) {
    attentionSheetEl.hidden = true;
    return;
  }
  attentionOpen = false;
  attentionSheetEl.classList.remove('is-open', 'is-dragging');
  attentionSheetEl.style.transform = '';
  attentionSheetEl.hidden = true;
  applyOverlayLayout();
  if (options.focus !== false) {
    try {
      attentionTriggerEl.focus({ preventScroll: true });
    } catch {
      // Keyboard focus is optional.
    }
  }
}

function selectAttentionRow(siteId, side) {
  closeAttention({ focus: false });
  selectSite(siteId, side);
  reopenAttentionOnClose = true;
}

function maybeAutoOpenAttention() {
  if (state.attentionAutoOpened) return false;
  if (PARAMS.get('focus') !== 'attention') return false;
  if (attentionModel().count === 0) return false;
  state.attentionAutoOpened = true;
  return openAttention();
}

/** Mesh-center z for each abnormal site that exists in the loaded model. */
function attentionMeshCenters() {
  const centers = [];
  for (const entry of state.highlight.sites) {
    attentionBox.makeEmpty();
    for (const item of state.instances) {
      if (item.kind === 'bone' || item.siteId !== entry.siteId || !item.bounds) {
        continue;
      }
      if (entry.side !== null && item.side !== entry.side) {
        continue;
      }
      attentionBox.union(item.bounds);
    }
    if (!attentionBox.isEmpty()) {
      attentionBox.getCenter(attentionCenter);
      centers.push(attentionCenter.z);
    }
  }
  return centers;
}

/**
 * Attention entry starts on the side where most abnormal meshes live. This is
 * a one-shot reorient after the first non-empty abnormal set and the initial
 * whole-body framing; any earlier camera move by the user wins.
 */
function maybeApplyAttentionFacing() {
  if (attentionFacingApplied) return false;
  if (PARAMS.get('focus') !== 'attention') return false;
  if (!state.ready || !state.framed) return false;
  if (state.highlight.sites.length === 0) return false;

  attentionFacingApplied = true;
  if (userMovedCamera) return false;

  const centers = attentionMeshCenters();
  if (centers.length === 0) return false;
  const view = attentionFocusView(centers);
  dispatch({ type: 'view', view });
  updateUiFromState();
  return true;
}

function hintWasSeen() {
  try {
    return localStorage.getItem(HINT_KEY) === '1';
  } catch {
    return false;
  }
}

function initGestureHint() {
  if (hintWasSeen()) {
    dismissGestureHint(true);
  }
}

function dismissGestureHint(immediately = false) {
  if (gestureHintEl.classList.contains('is-dismissed')) {
    gestureHintEl.hidden = true;
    return;
  }
  gestureHintEl.classList.add('is-dismissed');
  gestureHintEl.setAttribute('aria-hidden', 'true');
  if (immediately) {
    gestureHintEl.hidden = true;
    return;
  }
  setTimeout(() => {
    gestureHintEl.hidden = true;
  }, 260);
}

function noteUserInteraction() {
  if (gestureHintEl.classList.contains('is-dismissed')) return;
  dismissGestureHint();
  try {
    localStorage.setItem(HINT_KEY, '1');
  } catch {
    // Storage can be unavailable; the hint still goes away for this session.
  }
}

function siteName(siteId) {
  return state.sites.get(siteId)?.zh ?? siteId;
}

/**
 * Left / right follow the picked instance; a null selection is "双侧" only
 * when the site actually has meshes on both sides, otherwise "中线".
 */
function selectionSideLabel() {
  if (state.selectedSide === 'left') return '左侧';
  if (state.selectedSide === 'right') return '右侧';
  const sideOf = (wanted) => state.instances.some(
    (item) => item.siteId === state.selectedSite && item.side === wanted,
  );
  return sideOf('left') && sideOf('right') ? '双侧' : '中线';
}

function axisChip(axis) {
  const chip = document.createElement('span');
  chip.className = 'axis-chip';
  chip.dataset.axis = axis.axis;
  chip.dataset.state = axis.abnormal
    ? 'abnormal'
    : axis.measured
      ? 'normal'
      : 'unmeasured';
  chip.textContent = axis.measured
    ? `${axis.label} ${axis.value}`
    : `${axis.label} 未测`;
  return chip;
}

function attentionRowFor(siteId, side) {
  return attentionRows().find(
    (row) => row.siteId === siteId && row.side === (side ?? null),
  ) ?? null;
}

function formatMonthDay(at) {
  if (!Number.isFinite(at) || at <= 0) return null;
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return null;
  return (date.getMonth() + 1) + '/' + date.getDate();
}

function selectSheetSide(side) {
  if (!state.selectedSite) return;
  if (side !== 'left' && side !== 'right') return;
  dispatch({ type: 'select', siteId: state.selectedSite, side });
  updateUiFromState();
  requestRender();
}

function renderSheet() {
  if (!state.selectedSite) return;

  const resolved = resolveCard(state.cards, state.selectedSite, state.selectedSide);
  const card = resolved.card;
  sheetCard = card;
  const site = state.sites.get(state.selectedSite);
  const canIsolate = siteHasInstances(state.selectedSite);
  const shownSiteId = card?.siteId ?? state.selectedSite;
  const shownSide = card ? card.side : state.selectedSide;
  const sides = resolved.availableSides ?? [];
  const row = attentionRowFor(shownSiteId, shownSide)
    ?? attentionRowFor(state.selectedSite, state.selectedSide)
    ?? (sides.length ? attentionRowFor(shownSiteId, sides[0]) : null);
  const index = row?.index ?? null;
  const title = card?.siteZh ?? row?.siteZh ?? siteName(state.selectedSite);
  sheetTitleEl.textContent = index ? circledNumber(index) + ' ' + title : title;

  const showSideToggle = sides.length > 0 && !(card && card.side === null);
  sheetSideEl.hidden = showSideToggle;
  sheetSidesEl.hidden = !showSideToggle;
  if (showSideToggle) {
    sheetSidesEl.replaceChildren(...sides.map((side) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.side = side;
      button.textContent = side === 'left' ? '左' : '右';
      button.setAttribute('aria-label', side === 'left' ? '左侧' : '右侧');
      button.setAttribute('aria-pressed', String(shownSide === side));
      button.addEventListener('click', () => selectSheetSide(side));
      return button;
    }));
  } else {
    sheetSideEl.textContent = canIsolate
      ? selectionSideLabel()
      : (card?.sideZh ?? '中线');
  }

  const meta = [];
  if (card?.groupZh || row?.groupZh) meta.push(card?.groupZh || row?.groupZh);
  const day = formatMonthDay(card?.at);
  if (day) meta.push('最近 ' + day);
  if (Number.isFinite(card?.confidence)) {
    meta.push('置信度 ' + Math.round(card.confidence));
  }
  sheetMetaEl.textContent = meta.join(' · ');
  sheetMetaEl.hidden = meta.length === 0;

  sheetAxesEl.replaceChildren(
    ...(card?.axes ?? []).map((axis) => axisChip(axis)),
  );
  if (card) {
    sheetWorstEl.textContent = !card.worst || card.worst === '状态平稳'
      ? '状态平稳'
      : '最差：' + card.worst;
  } else if (resolved.needsSideChoice) {
    sheetWorstEl.textContent = '左右都有判定，先选一侧';
  } else if (site?.kind === 'bone') {
    sheetWorstEl.textContent = '骨骼部位请在档案里查看';
  } else {
    sheetWorstEl.textContent = resolved.reason === 'side'
      ? '这一侧还没有判定'
      : '这个部位还没有判定';
  }

  const related = card?.groupId
    ? attentionRows().find(
      (entry) => entry.groupId === card.groupId
        && !(entry.siteId === shownSiteId && entry.side === shownSide)
        && !entry.missing,
    )
    : null;
  sheetRelatedEl.hidden = !related;
  if (related) {
    const lead = document.createTextNode('同区域还有：');
    const label = document.createElement('b');
    label.textContent = related.siteZh + ' · ' + (related.sideZh ?? '中线');
    const rest = document.createTextNode(related.worst ? ' · ' + related.worst : '');
    sheetRelatedEl.replaceChildren(lead, label, rest);
    sheetRelatedEl.onclick = () => selectSite(related.siteId, related.side);
  } else {
    sheetRelatedEl.onclick = null;
  }

  const hasCard = Boolean(card);
  sheetOpenEl.hidden = !hasCard;
  sheetOpenEl.disabled = !hasCard;
  stats.archiveAvailable = hasCard;
  stats.sheetCardIndex = index;
  stats.sheetNeedsSideChoice = Boolean(resolved.needsSideChoice);
  stats.sheetAvailableSides = [...sides];
  stats.sheetSideButtons = showSideToggle ? sides.length : 0;
  applyIsolateUi();
}

function openSheet() {
  if (!state.selectedSite) {
    closeSheet({ focus: false });
    return;
  }
  renderSheet();
  const wasOpen = sheetOpen;
  sheetOpen = true;
  sheetEl.hidden = false;
  applyOverlayLayout();
  requestAnimationFrame(() => {
    if (sheetOpen) sheetEl.classList.add('is-open');
    if (sheetOpen) applyOverlayLayout();
  });
  if (!wasOpen) {
    try {
      sheetEl.focus({ preventScroll: true });
    } catch {
      // Focus is best-effort on hosts that do not expose options.
    }
  }
}

function closeSheet(options = {}) {
  const reopenAttention = reopenAttentionOnClose;
  reopenAttentionOnClose = false;
  if (!sheetOpen) {
    sheetEl.hidden = true;
    applyOverlayLayout();
    if (reopenAttention && !attentionOpen && attentionModel().count > 0) {
      openAttention();
    }
    return;
  }
  sheetOpen = false;
  selectionOffsetBoost = 0;
  sheetEl.classList.remove('is-open', 'is-dragging');
  sheetEl.style.transform = '';
  sheetEl.hidden = true;
  applyOverlayLayout();
  if (reopenAttention && !attentionOpen && attentionModel().count > 0) {
    openAttention();
  }
  if (options.focus !== false) {
    try {
      canvas.focus({ preventScroll: true });
    } catch {
      // Canvas focus is only for keyboard continuity.
    }
  }
}

function fitDistance(view, size) {
  const { usableH, width, height } = state.layout;
  const widthAxis = VIEWS[view].widthAxis;
  const modelWidth = Math.max(0.05, size[widthAxis] * 1.1);
  const modelHeight = Math.max(0.05, size.y * 1.08);
  const vFov = THREE.MathUtils.degToRad(camera.fov);
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * (width / height));

  const distForHeight = (modelHeight / 2) / Math.tan(vFov / 2) * (height / usableH);
  const distForWidth = (modelWidth / 2) / Math.tan(hFov / 2);
  return Math.max(0.9, Math.max(distForHeight, distForWidth) * 1.06);
}

function focusBoxFor(siteId) {
  if (!siteId) return focusBox.copy(state.bounds);

  focusBox.makeEmpty();
  for (const item of state.instances) {
    if (item.siteId === siteId && item.bounds) {
      focusBox.union(item.bounds);
    }
  }
  return focusBox.isEmpty() ? focusBox.copy(state.bounds) : focusBox;
}

function frameFocus(view, siteId = null) {
  if (!state.ready || !camera || !controls) return;
  selectionOffsetBoost = 0;
  updateProjectionLayout(
    Math.max(1, canvas.clientWidth || window.innerWidth),
    Math.max(1, canvas.clientHeight || window.innerHeight),
  );

  const focus = focusBoxFor(siteId);
  focus.getCenter(focusCenter);
  focus.getSize(focusSize);
  state.viewTarget.copy(focusCenter);

  const distance = fitDistance(view, focusSize);
  camera.position.copy(focusCenter).addScaledVector(VIEWS[view].dir, distance);
  camera.up.set(0, 1, 0);
  camera.near = Math.max(0.01, distance / 120);
  camera.far = Math.max(30, distance * 12);
  camera.updateProjectionMatrix();
  controls.target.copy(focusCenter);
  controls.minDistance = Math.max(0.55, distance * 0.22);
  controls.maxDistance = distance * 2.4;
  controls.update();
  updateLights();
  requestRender();
}

function reorientTo(view) {
  if (!state.ready || !camera || !controls) return;
  const target = controls.target;
  const distance = camera.position.distanceTo(target);
  if (!(distance > 0)) return;

  camera.position.copy(target).addScaledVector(VIEWS[view].dir, distance);
  camera.up.set(0, 1, 0);
  state.viewTarget.copy(target);
  controls.update();
  updateLights();
  if (sheetOpen) {
    applyOverlayLayout();
  } else {
    requestRender();
  }
}

function snapshotCamera() {
  if (!camera || !controls) return null;
  return {
    position: camera.position.toArray(),
    target: controls.target.toArray(),
    up: camera.up.toArray(),
    fov: camera.fov,
    near: camera.near,
    far: camera.far,
    minDistance: controls.minDistance,
    maxDistance: controls.maxDistance,
  };
}

function restoreCamera(snapshot, view = 'front') {
  if (!camera || !controls) return;
  if (!snapshot) {
    // A URL that starts isolated has no "before" camera; leaving it returns to
    // the whole body instead of staying at the isolated framing.
    frameFocus(view, null);
    return;
  }
  controls.target.fromArray(snapshot.target);
  camera.position.fromArray(snapshot.position);
  camera.up.fromArray(snapshot.up);
  camera.fov = snapshot.fov;
  camera.near = snapshot.near;
  camera.far = snapshot.far;
  camera.updateProjectionMatrix();
  controls.minDistance = snapshot.minDistance;
  controls.maxDistance = snapshot.maxDistance;
  state.viewTarget.copy(controls.target);
  selectionOffsetBoost = 0;
  controls.update();
  updateLights();
  if (sheetOpen) {
    applyOverlayLayout();
  } else {
    requestRender();
  }
}

function exportState() {
  if (!state.ready) return null;
  return exportViewerState(state, snapshotCamera());
}

function applyRestoredSnapshot(restored) {
  state = { ...state, ...restored.state };
  if (restored.camera) {
    // Apply directly instead of dispatching a frame command: a restore must
    // never show the whole body first and then jump to the saved view.
    restoreCamera(restored.camera, restored.state.view);
  }
  updateUiFromState();
  if (state.ready) applyVisibility();
  if (state.selectedSite) {
    openSheet();
  } else {
    closeSheet({ focus: false });
  }
  requestRender();
  return true;
}

/**
 * Cross-page restore entry point. Before the model is ready the snapshot only
 * hydrates state and sets `framed`; `loadTier` applies the camera after the
 * first build. Marking attention facing as applied keeps `focus=attention`
 * from replacing the saved view when the user returns from the archive.
 */
function restoreState(snapshot) {
  const restored = restoreViewerState(snapshot);
  attentionFacingApplied = true;

  if (!state.ready) {
    pendingRestore = snapshot;
    state = { ...state, ...restored.state };
    updateUiFromState();
    return true;
  }

  return applyRestoredSnapshot(restored);
}

function applyCommand(command) {
  if (FRAME_COMMANDS.has(command.type)) {
    stats.frameCommands += 1;
    stats.lastFrameCommand = command.type;
  }
  switch (command.type) {
    case 'frameBody':
      frameFocus(command.view, null);
      break;
    case 'frameSite':
      frameFocus(command.view, command.siteId);
      break;
    case 'reorient':
      reorientTo(command.view);
      break;
    case 'restoreCamera':
      restoreCamera(command.camera, command.view);
      break;
    case 'setVisibility':
      applyVisibility();
      break;
    default:
      break;
  }
}

function dispatch(action) {
  const result = reduce(state, action);
  state = result.state;
  for (const command of result.commands) applyCommand(command);
  scheduleStatePublish();
  return result;
}

/**
 * Keep the native page's in-memory snapshot current. The system back gesture can
 * unmount us without calling the header's back handler, so a state pushed after
 * every explicit action and orbit is the only reliable save point.
 */
function publishState() {
  if (!state.ready) return;
  const snapshot = exportState();
  if (!snapshot) return;
  try {
    window.nsh?.postMessage(JSON.stringify({ type: 'anatomy3d:state', state: snapshot }));
  } catch {
    // Plain browser: nobody listens.
  }
}

function scheduleStatePublish() {
  if (statePublishTimer) return;
  statePublishTimer = setTimeout(() => {
    statePublishTimer = 0;
    publishState();
  }, 250);
}

function updateLights() {
  if (!camera || !keyLight || !fillLight) return;
  keyLight.position.copy(camera.position).add(new THREE.Vector3(1.3, 2.1, 0.8));
  keyLight.target.position.copy(state.viewTarget);
  keyLight.target.updateMatrixWorld();

  fillLight.position.copy(camera.position).add(new THREE.Vector3(-1.8, -0.4, 1.2));
  fillLight.target.position.copy(state.viewTarget);
  fillLight.target.updateMatrixWorld();

  if (rimLight) {
    viewDirection.copy(camera.position).sub(state.viewTarget).normalize();
    rimLight.position.copy(state.viewTarget)
      .addScaledVector(viewDirection, -2.4)
      .add(new THREE.Vector3(0.9, 1.7, 0));
    rimLight.target.position.copy(state.viewTarget);
    rimLight.target.updateMatrixWorld();
  }
}

function requestRender() {
  if (!state.ready) return;
  scheduleFrame();
}

function scheduleFrame() {
  if (framePending) return;
  framePending = true;
  requestAnimationFrame(renderFrame);
}

function renderFrame(now) {
  framePending = false;
  if (!state.ready || !renderer) return;

  if (state.spin) {
    if (lastSpinTimestamp) {
      const delta = Math.min(now - lastSpinTimestamp, 100);
      spinAngle = (spinAngle + delta * 0.001 * 0.45) % (Math.PI * 2);
      if (spinPivot) spinPivot.rotation.y = spinAngle;
      stats.spinYaw = spinAngle;
    }
    lastSpinTimestamp = now;
  }

  controls.update();
  updateLights();
  updateMarkers();
  renderer.render(scene, camera);

  stats.drawCalls = renderer.info.render.calls;
  stats.renderedTriangles = renderer.info.render.triangles;
  stats.cameraDistance = camera.position.distanceTo(controls.target);
  stats.cameraTarget = controls.target.toArray();
  stats.cameraPosition = camera.position.toArray();
  stats.cameraMinDistance = controls.minDistance;
  stats.cameraMaxDistance = controls.maxDistance;
  updateFps(now);
  updateAutoTierSample(now);
  if (state.spin || autoTierActive) scheduleFrame();
}

function resetSpinSamples() {
  spinSamples = [];
  spinSampleTotal = 0;
  lastFrameTime = 0;
  lastSpinTimestamp = 0;
  stats.fps = 0;
  stats.fpsAvg = 0;
  stats.fpsMin = 0;
}

function updateFps(now) {
  if (!state.spin) return;

  if (lastFrameTime) {
    const delta = now - lastFrameTime;
    if (delta > 0 && delta < 1000) {
      spinSamples.push(delta);
      spinSampleTotal += delta;
      while (spinSampleTotal > 2000 && spinSamples.length > 1) {
        spinSampleTotal -= spinSamples.shift();
      }

      if (spinSamples.length >= 3) {
        const average = Math.round((spinSamples.length * 1000) / spinSampleTotal);
        let slowestFrame = 0;
        for (const sample of spinSamples) slowestFrame = Math.max(slowestFrame, sample);
        const minimum = Math.max(1, Math.round(1000 / slowestFrame));
        stats.fps = average;
        stats.fpsAvg = average;
        stats.fpsMin = Math.min(average, minimum);
      }
    } else if (delta >= 1000) {
      spinSamples = [];
      spinSampleTotal = 0;
    }
  }
  lastFrameTime = now;
}

/**
 * Automatic tier sampling. This runs only for a bounded window, renders every
 * frame so it measures real drawing cost rather than display refresh, and then
 * hands the average to the pure ladder in `viewer-state.js`.
 */
function startAutoTierSampling() {
  if (!AUTO_TIER_ENABLED || autoTierDone || autoTierStarted || !state.ready) return;
  autoTierStarted = true;
  beginAutoTierWindow();
}

function beginAutoTierWindow() {
  if (!AUTO_TIER_ENABLED || autoTierDone || !state.ready) return;
  stopAutoTierSampling();
  autoTierActive = true;
  autoTierSamples = [];
  autoTierWindowStart = 0;
  autoTierLastTimestamp = 0;
  scheduleFrame();
}

function stopAutoTierSampling() {
  autoTierActive = false;
  autoTierSamples = [];
  autoTierWindowStart = 0;
  autoTierLastTimestamp = 0;
}

function updateAutoTierSample(now) {
  if (!autoTierActive) return;

  if (!autoTierWindowStart) {
    autoTierWindowStart = now;
    autoTierLastTimestamp = now;
    return;
  }

  const delta = now - autoTierLastTimestamp;
  autoTierLastTimestamp = now;
  if (delta > 0 && delta < 1000) autoTierSamples.push(delta);

  if (now - autoTierWindowStart < AUTO_TIER_SAMPLE_MS) return;

  autoTierActive = false;
  const samples = autoTierSamples.slice();
  autoTierSamples = [];
  autoTierWindowStart = 0;
  autoTierLastTimestamp = 0;

  if (samples.length < AUTO_TIER_MIN_FRAMES) {
    stats.autoTierSampledFps = 0;
    stats.autoTierDecision = null;
    autoTierDone = true;
    return;
  }

  const total = samples.reduce((sum, sample) => sum + sample, 0);
  const avgFps = (samples.length * 1000) / total;
  stats.autoTierSampledFps = Math.round(avgFps * 10) / 10;
  const decision = nextTierForFps(avgFps, state.tier);
  stats.autoTierDecision = decision;
  void applyTierDecision(decision).then((result) => {
    if (result.switched && !autoTierDone) beginAutoTierWindow();
  });
}

async function applyTierDecision(decision) {
  if (!decision) {
    autoTierDone = true;
    return { decision: null, switched: false };
  }
  if (decision === 'slow') {
    autoTierDone = true;
    reportSlowDevice();
    return { decision, switched: false };
  }

  dispatch({ type: 'downgrade', tier: decision });
  const loaded = await loadTier(decision);
  if (loaded) {
    showTierNoticeOnce();
  } else {
    autoTierDone = true;
    stopAutoTierSampling();
  }
  return { decision, switched: loaded };
}

/** Deterministic hook for the headless contract check; never shown in the UI. */
async function testTierFps(fps) {
  if (!TIER_TEST_MODE) return null;
  const value = Number(fps);
  if (!Number.isFinite(value)) return null;
  autoTierDone = true;
  stopAutoTierSampling();
  const decision = nextTierForFps(value, state.tier);
  stats.autoTierSampledFps = Math.round(value * 10) / 10;
  stats.autoTierDecision = decision;
  return applyTierDecision(decision);
}

function showTierNoticeOnce() {
  if (tierNoticeShown) return;
  tierNoticeShown = true;
  stats.tierNoticeCount += 1;
  if (!tierNoticeEl) return;

  tierNoticeEl.hidden = false;
  requestAnimationFrame(() => {
    tierNoticeEl.classList.add('is-visible');
    stats.tierNoticeVisible = true;
  });
  tierNoticeTimer = setTimeout(() => {
    tierNoticeTimer = 0;
    tierNoticeEl.classList.remove('is-visible');
    stats.tierNoticeVisible = false;
    tierNoticeHideTimer = setTimeout(() => {
      tierNoticeHideTimer = 0;
      tierNoticeEl.hidden = true;
    }, 260);
  }, TIER_NOTICE_MS);
}

function stopTierNoticeTimers() {
  if (tierNoticeTimer) {
    clearTimeout(tierNoticeTimer);
    tierNoticeTimer = 0;
  }
  if (tierNoticeHideTimer) {
    clearTimeout(tierNoticeHideTimer);
    tierNoticeHideTimer = 0;
  }
  if (tierNoticeEl) {
    tierNoticeEl.classList.remove('is-visible');
    tierNoticeEl.hidden = true;
  }
  stats.tierNoticeVisible = false;
}

function reportSlowDevice() {
  if (slowDevicePosted) return;
  slowDevicePosted = true;
  stats.slowDevice = true;
  stats.slowDeviceCount += 1;
  try {
    window.nsh?.postMessage(JSON.stringify({ type: 'anatomy3d:slow-device' }));
  } catch {
    // Outside NSH (plain browser) there is nobody to notify.
  }
}

function getManifest() {
  if (!manifestPromise) {
    manifestPromise = (async () => {
      let response;
      try {
        response = await fetch('/scripts/anatomy/za-export.json', { cache: 'no-store' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
      } catch {
        response = await fetch(new URL('../../../scripts/anatomy/za-export.json', import.meta.url), {
          cache: 'no-store',
        });
      }
      if (!response.ok) {
        throw new Error(`site 映射加载失败：HTTP ${response.status}`);
      }
      const manifest = await response.json();
      if (!Array.isArray(manifest)) {
        throw new Error('site 映射格式不正确');
      }
      return manifest;
    })().catch((error) => {
      manifestPromise = null;
      throw error;
    });
  }
  return manifestPromise;
}

function loadGlb(tier) {
  const loader = new GLTFLoader();
  loader.setDRACOLoader(dracoLoader);
  return loader.loadAsync(new URL(TIERS[tier].url, import.meta.url).href);
}

async function loadTier(tier) {
  if (!TIERS[tier]) return false;

  const sequence = ++loadSequence;
  const startedAt = performance.now();
  teardownModel();
  state.tier = tier;
  stats.tier = tier;
  stats.loadMs = 0;
  stats.triangles = 0;
  stats.renderedTriangles = 0;
  stats.drawCalls = 0;
  stats.instances = 0;
  stats.sites = 0;
  stats.spin = state.spin;
  stats.ready = false;
  stats.error = null;
  api.ready = false;
  api.error = null;
  delete body.dataset.viewerReady;
  delete body.dataset.viewerError;
  setLoadingState('loading');
  updateUiFromState();

  try {
    const [manifest, gltf] = await Promise.all([getManifest(), loadGlb(tier)]);

    if (sequence !== loadSequence) {
      disposeGltf(gltf);
      return false;
    }

    buildBatches(manifest, gltf);
    disposeGltf(gltf);

    state.ready = true;
    stats.ready = true;
    stats.loadMs = performance.now() - startedAt;
    stats.multiDraw = Boolean(renderer.getContext().getExtension('WEBGL_multi_draw'));
    api.ready = true;
    api.error = null;

    if (!state.urlStateApplied) {
      if (pendingRestore) {
        // A queued restore is a stronger source than the entry URL.
        state.urlStateApplied = true;
      } else {
        const requestedSite = PARAMS.get('site');
        state.selectedSite = requestedSite && state.sites.has(requestedSite) ? requestedSite : null;
        state.selectedSide = null;
        state.isolate = PARAMS.get('isolate') === '1' && Boolean(state.selectedSite);
        if (state.isolate) {
          state.saved = {
            camera: null,
            preset: state.preset,
            selectedSite: state.selectedSite,
            selectedSide: null,
            view: state.view,
          };
        }
        state.urlStateApplied = true;
      }
    } else if (
      state.selectedSite
      && !state.sites.has(state.selectedSite)
      && !siteHasCard(state.selectedSite)
    ) {
      state.selectedSite = null;
      state.selectedSide = null;
      state.isolate = false;
      state.saved = null;
    }

    if (pendingRestore) {
      const snapshot = pendingRestore;
      pendingRestore = null;
      applyRestoredSnapshot(restoreViewerState(snapshot));
    }
    updateUiFromState();
    dispatch({ type: 'modelLoaded' });
    maybeApplyAttentionFacing();
    setLoadingState('hidden');
    body.dataset.viewerReady = '1';
    if (state.spin) {
      resetSpinSamples();
    }
    startAutoTierSampling();
    requestRender();
    return true;
  } catch (error) {
    if (sequence === loadSequence) fail(error);
    return false;
  }
}

function buildBatches(manifest, gltf) {
  const siteByObject = new Map();
  const sites = new Map();
  for (const site of manifest) {
    sites.set(site.site_id, site);
    for (const objectName of site.objects) {
      siteByObject.set(objectName, site.site_id);
    }
  }

  gltf.scene.updateMatrixWorld(true);

  const pending = [];
  const bounds = new THREE.Box3();
  let unmapped = 0;

  gltf.scene.traverse((object) => {
    if (!object.isMesh || !object.geometry) return;

    // GLTFLoader sanitizes node names (spaces and dots are replaced), so read
    // the original glTF node name through the parser association instead.
    const association = gltf.parser?.associations?.get(object);
    const nodeIndex = association?.nodes;
    const objectName = nodeIndex !== undefined
      ? gltf.parser.json.nodes[nodeIndex]?.name ?? object.name
      : object.name;
    const siteId = siteByObject.get(objectName);
    if (!siteId) {
      unmapped += 1;
      return;
    }

    const site = sites.get(siteId);
    const batch = site.kind === 'bone' ? 'bone' : DEEP_SITES.has(siteId) ? 'deep' : 'shallow';
    const worldMatrix = object.matrixWorld.clone();
    const geometry = object.geometry.clone();
    geometry.applyMatrix4(worldMatrix);
    geometry.clearGroups();

    for (const attributeName of Object.keys(geometry.attributes)) {
      if (attributeName !== 'position' && attributeName !== 'normal') {
        geometry.deleteAttribute(attributeName);
      }
    }

    if (!geometry.getAttribute('normal')) {
      geometry.computeVertexNormals();
    }

    ensureIndex(geometry);

    // Mirrored glTF nodes use a negative determinant. Baking that matrix flips
    // winding, so reverse each triangle to keep front faces pointing outward.
    if (worldMatrix.determinant() < 0) {
      reverseWinding(geometry);
    }

    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    bounds.union(geometry.boundingBox);

    const center = geometry.boundingBox.getCenter(new THREE.Vector3());
    const side = detectSide(objectName, center.x);
    const triangles = geometry.getIndex().count / 3;

    pending.push({
      objectName,
      siteId,
      batch,
      kind: site.kind,
      side,
      triangles,
      bounds: geometry.boundingBox.clone(),
      geometry,
    });
  });

  if (!pending.length) {
    throw new Error('GLB 中没有可用的网格');
  }

  state.bounds.copy(bounds);
  bounds.getCenter(state.viewTarget);
  spinPivot.position.set(state.viewTarget.x, 0, state.viewTarget.z);
  spinPivot.rotation.y = 0;
  spinAngle = 0;
  stats.spinYaw = 0;
  state.instances = [];
  state.batches = Object.create(null);
  state.lookups = Object.create(null);

  for (const batchName of BATCH_NAMES) {
    const group = pending.filter((item) => item.batch === batchName);
    if (!group.length) continue;

    const maxVertexCount = group.reduce(
      (total, item) => total + item.geometry.getAttribute('position').count,
      0,
    );
    const maxIndexCount = group.reduce(
      (total, item) => total + item.geometry.getIndex().count,
      0,
    );

    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.72,
      metalness: 0.02,
      side: THREE.FrontSide,
      transparent: false,
      opacity: 1,
      depthWrite: true,
    });

    const batched = new THREE.BatchedMesh(group.length, maxVertexCount, maxIndexCount, material);
    batched.name = `anatomy-${batchName}`;
    batched.userData.batchName = batchName;
    batched.userData.ghost = false;
    batched.perObjectFrustumCulled = true;
    batched.sortObjects = true;

    const lookup = new Map();
    for (const item of group) {
      const geometryId = batched.addGeometry(item.geometry);
      const instanceId = batched.addInstance(geometryId);
      batched.setColorAt(
        instanceId,
        toColor(colorForInstance(item, state.highlight, null)),
      );
      item.instanceId = instanceId;
      lookup.set(instanceId, item);
      state.instances.push(item);
      item.geometry.dispose();
      item.geometry = null;
    }

    batched.computeBoundingBox();
    batched.computeBoundingSphere();
    batched.position.set(-spinPivot.position.x, 0, -spinPivot.position.z);
    spinPivot.add(batched);
    state.batches[batchName] = batched;
    state.lookups[batchName] = lookup;
  }

  for (const item of pending) {
    if (item.geometry) item.geometry.dispose();
  }

  const loadedSiteIds = new Set(state.instances.map((item) => item.siteId));
  state.sites = new Map([...sites].filter(([siteId]) => loadedSiteIds.has(siteId)));
  stats.triangles = state.instances.reduce((total, item) => total + item.triangles, 0);
  stats.instances = state.instances.length;
  stats.sites = state.sites.size;
  stats.unmappedObjects = unmapped;
  updateProjectionLayout(
    Math.max(1, canvas.clientWidth || window.innerWidth),
    Math.max(1, canvas.clientHeight || window.innerHeight),
  );
}

function ensureIndex(geometry) {
  if (geometry.getIndex()) return;
  const position = geometry.getAttribute('position');
  const IndexArray = position.count > 65535 ? Uint32Array : Uint16Array;
  const index = new IndexArray(position.count);
  for (let i = 0; i < position.count; i += 1) index[i] = i;
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
}

function reverseWinding(geometry) {
  const index = geometry.getIndex();
  const array = index.array;
  for (let i = 0; i < array.length; i += 3) {
    const swap = array[i + 1];
    array[i + 1] = array[i + 2];
    array[i + 2] = swap;
  }
  index.needsUpdate = true;
}

function detectSide(objectName, centerX) {
  if (/\.l$/i.test(objectName)) return 'left';
  if (/\.r$/i.test(objectName)) return 'right';
  if (centerX > 0.018) return 'left';
  if (centerX < -0.018) return 'right';
  return 'mid';
}

function applyVisibility() {
  const selected = state.selectedSite;
  const selectedSide = state.selectedSide;
  const isolating = isIsolated();
  const preset = state.preset;
  const visibleByBatch = { shallow: false, deep: false, bone: false };
  let visibleInstances = 0;
  let selectedObjectCount = 0;
  let selectedSiteInstanceCount = 0;
  let abnormalObjectCount = 0;
  const abnormalColors = new Set();
  const highlightedSiteIds = new Set();

  for (const item of state.instances) {
    let visible;
    if (isolating) {
      visible = item.siteId === selected;
    } else if (preset === 'all') {
      visible = true;
    } else if (preset === 'shallow') {
      visible = item.batch === 'shallow';
    } else if (preset === 'deep') {
      visible = item.batch === 'deep' || item.batch === 'shallow';
    } else {
      visible = item.batch === 'bone';
    }

    const batch = state.batches[item.batch];
    if (!batch) continue;
    batch.setVisibleAt(item.instanceId, visible);
    const abnormal = isAbnormalInstance(item, state.highlight);
    const selectedItem = Boolean(selected)
      && item.siteId === selected
      && (selectedSide === null || selectedSide === item.side);
    const color = toColor(
      colorForInstance(item, state.highlight, selected, selectedSide),
    );
    batch.setColorAt(item.instanceId, color);
    if (visible) {
      visibleByBatch[item.batch] = true;
      visibleInstances += 1;
    }
    if (selected && item.siteId === selected) selectedSiteInstanceCount += 1;
    if (selectedItem) selectedObjectCount += 1;
    if (abnormal && !selectedItem) {
      abnormalObjectCount += 1;
      abnormalColors.add(color.getHexString());
      highlightedSiteIds.add(item.siteId);
    }
  }

  stats.selectedSite = selected;
  stats.selectedSide = selectedSide;
  stats.selectedObjectCount = selected ? selectedObjectCount : 0;
  stats.selectedSiteInstanceCount = selected ? selectedSiteInstanceCount : 0;
  stats.highlightColor = selected ? state.highlight.palette.selected : null;
  stats.highlightSites = state.highlight.sites.map((entry) => ({ ...entry }));
  stats.highlightedSiteIds = [...highlightedSiteIds];
  stats.abnormalObjectCount = abnormalObjectCount;
  stats.abnormalColors = [...abnormalColors];
  stats.missingSites = missingHighlightSites(
    state.highlight,
    new Set(state.instances.map((item) => item.siteId)),
  );
  stats.visibleInstances = visibleInstances;

  for (const batchName of BATCH_NAMES) {
    const batch = state.batches[batchName];
    if (!batch) continue;
    batch.visible = visibleByBatch[batchName];
  }

  const ghostShallow = !isolating && preset === 'deep';
  setGhost('shallow', ghostShallow);
  setGhost('deep', false);
  setGhost('bone', false);
  requestRender();
}

function stopSpinForExplicitAction() {
  state.spin = false;
  stats.spin = false;
  resetSpinSamples();
  spinAngle = 0;
  stats.spinYaw = 0;
  if (spinPivot) spinPivot.rotation.y = 0;
}

function setGhost(batchName, ghost) {
  const batch = state.batches[batchName];
  if (!batch) return;
  const material = batch.material;
  if (batch.userData.ghost === ghost) return;

  batch.userData.ghost = ghost;
  material.transparent = ghost;
  material.opacity = ghost ? 0.06 : 1;
  material.depthWrite = !ghost;
  material.needsUpdate = true;
  batch.renderOrder = ghost ? 2 : 0;
}

function pickAt(clientX, clientY) {
  if (!state.ready || !raycaster) return false;
  const rect = canvas.getBoundingClientRect();
  pointerNdc.set(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,
  );
  raycaster.setFromCamera(pointerNdc, camera);

  const pickable = Object.values(state.batches).filter((batch) => batch.visible);
  const hits = raycaster.intersectObjects(pickable, false);

  for (const hit of hits) {
    const batch = hit.object;
    if (batch.userData.ghost) continue;

    // three r180 BatchedMesh puts the instance id on `batchId` (not instanceId).
    const instanceId = hit.batchId ?? hit.instanceId;
    const lookup = state.lookups[batch.userData.batchName];
    const item = lookup?.get(instanceId);
    if (item) {
      selectSite(item.siteId, item.side);
      return true;
    }
  }

  selectSite(null);
  clearFocus();
  return false;
}

function isDeepSite(siteId) {
  return state.instances.some(
    (item) => item.siteId === siteId && item.batch === 'deep',
  );
}

function selectSite(siteId, side = null) {
  const clear = siteId === null || siteId === undefined;
  if (!clear && !state.sites.has(siteId) && !siteHasCard(siteId)) return false;
  if (!clear) reopenAttentionOnClose = false;
  focusedSite = null;
  focusedSide = null;
  if (!clear && state.isolate && !siteHasInstances(siteId)) {
    dispatch({ type: 'isolate', enabled: false });
  }
  stopSpinForExplicitAction();
  const selectedSide = side === 'left' || side === 'right' ? side : null;
  const preset = !clear
    && isDeepSite(siteId)
    && (state.preset === 'all' || state.preset === 'bone')
    ? 'deep'
    : undefined;
  dispatch({
    type: 'select',
    siteId: clear ? null : siteId,
    side: selectedSide,
    preset,
  });
  updateUiFromState();
  if (clear) {
    closeSheet();
  } else {
    openSheet();
  }
  requestRender();
  return true;
}

function setView(view) {
  if (!VIEWS[view]) return false;
  stopSpinForExplicitAction();
  userMovedCamera = true;
  dispatch({ type: 'view', view });
  updateUiFromState();
  return true;
}

function setPreset(preset) {
  if (!PRESETS.has(preset)) return false;
  if (isIsolated()) return false;
  stopSpinForExplicitAction();
  dispatch({ type: 'preset', preset });
  updateUiFromState();
  return true;
}

function setIsolate(isolate) {
  const next = Boolean(isolate);
  if (next && !siteHasInstances(state.selectedSite)) return false;
  if (next === Boolean(state.isolate)) return true;
  stopSpinForExplicitAction();
  userMovedCamera = true;
  dispatch({ type: 'isolate', enabled: next, camera: snapshotCamera() });
  updateUiFromState();
  return true;
}

/**
 * Native highlight contract. Stores the palette and abnormal sites, then
 * recolors what is already loaded; it never reloads the model. A call made
 * before the model is ready is kept and applied by `buildBatches` /
 * `applyVisibility` when the first tier finishes.
 */
function setHighlight(options = {}) {
  state.highlight = createHighlight(options?.palette, options?.sites);
  state.cards = createCards(options?.cards);
  applyPaletteVars(state.highlight.palette);
  stats.highlightSites = state.highlight.sites.map((entry) => ({ ...entry }));
  stats.palette = { ...state.highlight.palette };
  stats.cards = state.cards.length;
  if (state.ready) {
    applyVisibility();
  } else {
    stats.highlightColor = state.selectedSite
      ? state.highlight.palette.selected
      : null;
    stats.highlightedSiteIds = [];
    stats.abnormalObjectCount = 0;
    stats.missingSites = [];
    requestRender();
  }
  if (sheetOpen) renderSheet();
  updateAttentionUi();
  maybeApplyAttentionFacing();
  maybeAutoOpenAttention();
  return true;
}

function setSpin(spin) {
  const next = Boolean(spin);
  if (state.spin === next) {
    if (next) requestRender();
    return true;
  }

  state.spin = next;
  stats.spin = next;

  if (next) {
    resetSpinSamples();
    if (spinPivot) spinPivot.rotation.y = spinAngle;
  } else {
    lastSpinTimestamp = 0;
    lastFrameTime = 0;
  }

  updateUiFromState();
  requestRender();
  return true;
}

function reset() {
  reopenAttentionOnClose = false;
  stopTierNoticeTimers();
  stopSpinForExplicitAction();
  userMovedCamera = true;
  pendingRestore = null;
  closeSheet({ focus: false });
  closeAttention({ focus: false });
  const result = reduce(state, { type: 'reset' });
  state = result.state;
  updateUiFromState();
  for (const command of result.commands) applyCommand(command);
  scheduleStatePublish();
  return true;
}

function setTier(tier) {
  if (!TIERS[tier]) return Promise.resolve(false);
  autoTierDone = true;
  stopAutoTierSampling();
  dispatch({ type: 'setTier', tier });
  return loadTier(tier);
}

function updateUiFromState() {
  updateViewButtons();
  updateIsolateUi();
  updateAttentionUi();

  const label = PRESET_LABELS[state.preset] ?? state.preset;
  presetLabel.textContent = label;
  presetTrigger.setAttribute('aria-label', `层级：${label}`);
  for (const button of presetButtons) {
    button.setAttribute('aria-checked', String(button.dataset.preset === state.preset));
  }
  stats.preset = state.preset;
  if (sheetOpen) renderSheet();
}

function applyIsolateUi() {
  const control = isolationControl(state);
  const missing = Boolean(state.selectedSite)
    && !siteHasInstances(state.selectedSite);
  sheetIsolateEl.textContent = missing ? '模型里暂缺' : control.label;
  sheetIsolateEl.disabled = missing;
  sheetIsolateEl.setAttribute('aria-pressed', String(control.pressed && !missing));
  if (missing) {
    sheetIsolateEl.title = '模型里暂缺，无法只看这块';
    sheetIsolateEl.setAttribute('aria-label', '模型里暂缺，无法只看这块');
  } else {
    sheetIsolateEl.removeAttribute('title');
    sheetIsolateEl.removeAttribute('aria-label');
  }
}

function updateIsolateUi() {
  const control = isolationControl(state);
  applyIsolateUi();

  presetTrigger.setAttribute('aria-disabled', String(control.active));
  for (const button of presetButtons) {
    button.setAttribute('aria-disabled', String(control.active));
  }
  if (control.active && menuOpen) {
    menuOpen = false;
    presetMenu.hidden = true;
    presetTrigger.setAttribute('aria-expanded', 'false');
  }

  stats.isolate = control.active;
  stats.isolateLabel = control.label;
  stats.presetLocked = control.active;
}

function updateViewButtons() {
  for (const button of viewButtons) {
    button.setAttribute('aria-pressed', String(button.dataset.view === state.view));
  }
  stats.view = state.view;
}

function sentence(message) {
  const text = String(message ?? '').trim() || '未知原因';
  return /[。！？.!?]$/.test(text) ? text : `${text}。`;
}

function clearSlowLoadTimer() {
  if (!slowLoadTimer) return;
  clearTimeout(slowLoadTimer);
  slowLoadTimer = 0;
}

function setLoadingState(kind, error) {
  if (!loadingEl) return;
  clearSlowLoadTimer();
  loadingEl.classList.toggle('is-error', kind === 'error');
  loadingEl.classList.toggle('is-hidden', kind === 'hidden');

  if (kind === 'loading') {
    loadingEl.setAttribute('role', 'status');
    loadingTitleEl.textContent = '正在载入身体模型…';
    loadingSlowEl.textContent = '设备较慢时，可以先回档案页看依据';
    loadingSlowEl.hidden = true;
    loadingRetryEl.hidden = true;
    slowLoadTimer = setTimeout(() => {
      if (!loadingEl.classList.contains('is-error') && !loadingEl.classList.contains('is-hidden')) {
        loadingSlowEl.hidden = false;
      }
    }, SLOW_LOAD_MS);
  } else if (kind === 'error') {
    loadingEl.setAttribute('role', 'alert');
    loadingTitleEl.textContent = '3D 身体图没能载入';
    loadingSlowEl.textContent = sentence(error);
    loadingSlowEl.hidden = false;
    loadingRetryEl.hidden = false;
  } else {
    loadingSlowEl.hidden = true;
    loadingRetryEl.hidden = true;
  }
}

function fail(error) {
  const message = error?.message || String(error);
  autoTierDone = true;
  stopAutoTierSampling();
  api.ready = false;
  api.error = message;
  stats.ready = false;
  stats.error = message;
  state.ready = false;
  delete body.dataset.viewerReady;
  body.dataset.viewerError = message;
  setLoadingState('error', message);
  try {
    window.nsh?.postMessage(JSON.stringify({ type: 'anatomy3d:error', message }));
  } catch {
    // Outside NSH (plain browser) there is nobody to notify.
  }
  console.error('[anatomy-3d]', error);
}

function teardownModel() {
  state.ready = false;
  if (!scene) return;

  for (const batch of Object.values(state.batches)) {
    batch.parent?.remove(batch);
    batch.material?.dispose();
    batch.dispose();
  }
  state.batches = Object.create(null);
  state.lookups = Object.create(null);
  state.instances = [];
  stats.selectedSite = null;
  stats.selectedObjectCount = 0;
  stats.highlightColor = null;
  stats.highlightedSiteIds = [];
  stats.abnormalObjectCount = 0;
  stats.missingSites = [];
  stats.visibleInstances = 0;
  lastSpinTimestamp = 0;
  framePending = false;
}

function disposeGltf(gltf) {
  gltf?.scene?.traverse((object) => {
    object.geometry?.dispose();
  });
}

initGestureHint();
updateUiFromState();
init();

