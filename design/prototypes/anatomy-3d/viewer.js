import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

const PARAMS = new URLSearchParams(location.search);

const TIERS = {
  raw: {
    label: '视觉档',
    url: '../../../docs/research/assets/za-raw-smooth.glb',
  },
  cap3000: {
    label: '性能档',
    url: '../../../docs/research/assets/za-cap3000-smooth.glb',
  },
};

const VIEWS = {
  front: { label: '正视', dir: new THREE.Vector3(0, 0, 1), widthAxis: 'x' },
  back: { label: '背视', dir: new THREE.Vector3(0, 0, -1), widthAxis: 'x' },
  left: { label: '左视', dir: new THREE.Vector3(1, 0, 0), widthAxis: 'z' },
  right: { label: '右视', dir: new THREE.Vector3(-1, 0, 0), widthAxis: 'z' },
};

const PRESETS = new Set(['all', 'shallow', 'deep', 'bone']);
const BATCH_NAMES = ['shallow', 'deep', 'bone'];

const COLORS = {
  left: new THREE.Color('#6ee7f0'),
  right: new THREE.Color('#f0a26e'),
  mid: new THREE.Color('#aab2bd'),
  selected: new THREE.Color('#c8f04a'),
};

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

const QUICK_TARGETS = {
  'gluteus-maximus': { view: 'back', preset: 'all' },
  'transversus-abdominis': { view: 'front', preset: 'deep' },
  multifidus: { view: 'back', preset: 'deep' },
};

function readChoice(value, allowed, fallback) {
  return allowed.has(value) ? value : fallback;
}

let state = {
  tier: readChoice(PARAMS.get('tier'), new Set(Object.keys(TIERS)), 'raw'),
  view: readChoice(PARAMS.get('view'), new Set(Object.keys(VIEWS)), 'front'),
  preset: readChoice(PARAMS.get('preset'), PRESETS, 'all'),
  selectedSite: null,
  isolate: false,
  spin: PARAMS.get('spin') === '1',
  urlStateApplied: false,
  ready: false,
  sites: new Map(),
  instances: [],
  batches: Object.create(null),
  lookups: Object.create(null),
  bounds: new THREE.Box3(),
  viewTarget: new THREE.Vector3(),
  infoHeight: 102,
  layout: { top: 150, bottom: 250, usableH: 400, width: 390, height: 844, offsetY: 0 },
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
  selectedObjectCount: 0,
  highlightColor: null,
  visibleInstances: 0,
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
  setSpin,
  setTier,
  reset,
};
window.__viewer = api;

const body = document.body;
const canvas = document.querySelector('#scene');
const loadingEl = document.querySelector('#loading');
const loadingTitleEl = document.querySelector('#loading-title');
const loadingDetailEl = document.querySelector('#loading-detail');
const statsEl = document.querySelector('.stats');
const bottomStackEl = document.querySelector('.bottom-stack');
const infoEl = document.querySelector('#info');
const hintEl = document.querySelector('#hint');

const statTierEl = document.querySelector('#stat-tier');
const statTrisEl = document.querySelector('#stat-tris');
const statDrawEl = document.querySelector('#stat-draw');
const statFpsEl = document.querySelector('#stat-fps');
const statLoadEl = document.querySelector('#stat-load');
const statMultiEl = document.querySelector('#stat-multi');

const infoZhEl = document.querySelector('#info-zh');
const infoEnEl = document.querySelector('#info-en');
const infoKindEl = document.querySelector('#info-kind');
const infoSideEl = document.querySelector('#info-side');
const infoTrisEl = document.querySelector('#info-tris');
const infoObjectsEl = document.querySelector('#info-objects');
const isolateBtn = document.querySelector('#isolate-btn');
const infoCloseBtn = document.querySelector('#info-close');
const spinToggle = document.querySelector('#spin-toggle');

let renderer;
let scene;
let camera;
let controls;
let raycaster;
let keyLight;
let fillLight;
let dracoLoader;
let spinPivot;
let manifestPromise = null;
let loadSequence = 0;
let framePending = false;
let lastFrameTime = 0;
let spinSamples = [];
let spinSampleTotal = 0;
let lastSpinTimestamp = 0;
let lastStatsUiUpdate = 0;
let spinAngle = 0;
let pointerDown = null;
let activePointers = new Set();
let maxPointersInGesture = 0;

const pointerNdc = new THREE.Vector2();
const focusBox = new THREE.Box3();
const focusCenter = new THREE.Vector3();
const focusSize = new THREE.Vector3();

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
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setSize(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight, false);

  stats.multiDraw = Boolean(renderer.getContext().getExtension('WEBGL_multi_draw'));

  scene = new THREE.Scene();

  const hemisphere = new THREE.HemisphereLight(0xdcebff, 0x182029, 2.7);
  scene.add(hemisphere);

  keyLight = new THREE.DirectionalLight(0xfff6e8, 2.15);
  keyLight.target.position.set(0, 0.9, 0);
  scene.add(keyLight, keyLight.target);

  fillLight = new THREE.DirectionalLight(0x8fe9f2, 0.75);
  fillLight.target.position.set(0, 0.9, 0);
  scene.add(fillLight, fillLight.target);

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
  controls.addEventListener('change', requestRender);

  raycaster = new THREE.Raycaster();

  dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath(new URL('./vendor/draco/', import.meta.url).href);
  dracoLoader.setDecoderConfig({ type: 'wasm' });

  bindUi();
  bindPicking();
  resize();

  const observer = new ResizeObserver(() => resize());
  observer.observe(document.querySelector('#app'));

  updateStatsUi();
  updateUiFromState();
  loadTier(state.tier);
}

function bindUi() {
  for (const button of document.querySelectorAll('[data-tier]')) {
    button.addEventListener('click', () => setTier(button.dataset.tier));
  }
  for (const button of document.querySelectorAll('[data-view]')) {
    button.addEventListener('click', () => setView(button.dataset.view));
  }
  for (const button of document.querySelectorAll('[data-preset]')) {
    button.addEventListener('click', () => setPreset(button.dataset.preset));
  }
  for (const button of document.querySelectorAll('[data-target]')) {
    button.addEventListener('click', () => applyQuickTarget(button.dataset.target));
  }

  isolateBtn.addEventListener('click', () => setIsolate(!state.isolate));
  infoCloseBtn.addEventListener('click', () => selectSite(null));
  spinToggle.addEventListener('click', () => setSpin(!state.spin));
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
    const wasTap =
      pointerDown &&
      pointerDown.pointerId === event.pointerId &&
      maxPointersInGesture === 1 &&
      Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) <= 6 &&
      performance.now() - pointerDown.time <= 650;

    activePointers.delete(event.pointerId);
    if (activePointers.size === 0) {
      pointerDown = null;
      maxPointersInGesture = 0;
    }

    if (wasTap) {
      pickAt(event.clientX, event.clientY);
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
  updateProjectionLayout(width, height);
  if (state.ready) {
    applyView(state.view);
    updateLights();
  }
  requestRender();
}

function updateProjectionLayout(width, height) {
  const statsBottom = statsEl && getComputedStyle(statsEl).display !== 'none'
    ? statsEl.getBoundingClientRect().bottom
    : 72;
  const stackTop = bottomStackEl ? bottomStackEl.getBoundingClientRect().top : height - 250;
  const reservedStackTop = infoEl?.hidden ? stackTop - state.infoHeight - 8 : stackTop;

  const topInset = Math.min(Math.max(statsBottom + 22, 150), height * 0.32);
  const bottomInset = Math.min(Math.max(height - reservedStackTop + 8, 220), height * 0.5);
  const usableH = Math.max(180, height - topInset - bottomInset);
  const desiredCenter = topInset + usableH / 2;
  const offsetY = Math.round(height / 2 - desiredCenter);

  state.layout = { top: topInset, bottom: bottomInset, usableH, width, height, offsetY };
  camera.aspect = width / height;
  if (offsetY !== 0) {
    camera.setViewOffset(width, height, 0, offsetY, width, height);
  } else {
    camera.clearViewOffset();
    camera.aspect = width / height;
  }
  camera.updateProjectionMatrix();
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

function applyView(view) {
  if (!state.ready || !camera || !controls) return;
  updateProjectionLayout(
    Math.max(1, canvas.clientWidth || window.innerWidth),
    Math.max(1, canvas.clientHeight || window.innerHeight),
  );

  const focus = currentFocusBox(focusBox);
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

function updateLights() {
  if (!camera || !keyLight || !fillLight) return;
  keyLight.position.copy(camera.position).add(new THREE.Vector3(1.3, 2.1, 0.8));
  keyLight.target.position.copy(state.viewTarget);
  keyLight.target.updateMatrixWorld();

  fillLight.position.copy(camera.position).add(new THREE.Vector3(-1.8, -0.4, 1.2));
  fillLight.target.position.copy(state.viewTarget);
  fillLight.target.updateMatrixWorld();
}

function currentFocusBox(target) {
  if (state.isolate && state.selectedSite) {
    target.makeEmpty();
    for (const item of state.instances) {
      if (item.siteId === state.selectedSite && item.bounds) {
        target.union(item.bounds);
      }
    }
    if (!target.isEmpty()) return target;
  }
  return target.copy(state.bounds);
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
  renderer.render(scene, camera);

  stats.drawCalls = renderer.info.render.calls;
  stats.renderedTriangles = renderer.info.render.triangles;
  updateFps(now);
  if (!state.spin || now - lastStatsUiUpdate >= 180) {
    updateStatsUi();
    lastStatsUiUpdate = now;
  }
  if (state.spin) scheduleFrame();
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
  updateStatsUi();

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
      const requestedSite = PARAMS.get('site');
      state.selectedSite = requestedSite && state.sites.has(requestedSite) ? requestedSite : null;
      state.isolate = PARAMS.get('isolate') === '1' && Boolean(state.selectedSite);
      state.urlStateApplied = true;
    } else if (state.selectedSite && !state.sites.has(state.selectedSite)) {
      state.selectedSite = null;
      state.isolate = false;
    }

    applyVisibility();
    updateInfoPanel();
    updateUiFromState();
    applyView(state.view);
    updateStatsUi();
    setLoadingState('hidden');
    body.dataset.viewerReady = '1';
    if (state.spin) {
      resetSpinSamples();
      lastStatsUiUpdate = 0;
    }
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
      side,
      triangles,
      bounds: geometry.boundingBox.clone(),
      geometry,
      baseColor: COLORS[side].clone(),
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

    const material = new THREE.MeshLambertMaterial({
      color: 0xffffff,
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
      batched.setColorAt(instanceId, item.baseColor);
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
  const isolating = state.isolate && Boolean(selected);
  const preset = state.preset;
  const visibleByBatch = { shallow: false, deep: false, bone: false };
  let visibleInstances = 0;
  let selectedObjectCount = 0;

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
    batch.setColorAt(
      item.instanceId,
      selected && item.siteId === selected ? COLORS.selected : item.baseColor,
    );
    if (visible) {
      visibleByBatch[item.batch] = true;
      visibleInstances += 1;
    }
    if (selected && item.siteId === selected) selectedObjectCount += 1;
  }

  stats.selectedSite = selected;
  stats.selectedObjectCount = selected ? selectedObjectCount : 0;
  stats.highlightColor = selected ? '#c8f04a' : null;
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
  updateStatsUi();
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
  if (!state.ready || !raycaster) return;
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
      selectSite(item.siteId);
      return;
    }
  }

  selectSite(null);
}

function selectSite(siteId) {
  if (siteId === null || siteId === undefined) {
    state.selectedSite = null;
    state.isolate = false;
  } else if (state.sites.has(siteId)) {
    state.selectedSite = siteId;
  } else {
    return false;
  }

  stopSpinForExplicitAction();
  applyVisibility();
  updateInfoPanel();
  updateUiFromState();
  if (state.ready) {
    updateProjectionLayout(
      Math.max(1, canvas.clientWidth || window.innerWidth),
      Math.max(1, canvas.clientHeight || window.innerHeight),
    );
    applyView(state.view);
  }
  requestRender();
  return true;
}

function updateInfoPanel() {
  if (!state.selectedSite) {
    infoEl.hidden = true;
    return;
  }

  const site = state.sites.get(state.selectedSite);
  if (!site) {
    infoEl.hidden = true;
    return;
  }

  const items = state.instances.filter((item) => item.siteId === state.selectedSite);
  const triangles = items.reduce((total, item) => total + item.triangles, 0);
  const sides = new Set(items.map((item) => item.side));
  const sideKey = sides.has('left') && sides.has('right')
    ? 'both'
    : sides.has('left')
      ? 'left'
      : sides.has('right')
        ? 'right'
        : 'mid';
  const sideLabel = {
    both: '双侧',
    left: '左侧',
    right: '右侧',
    mid: '中线',
  }[sideKey];

  infoZhEl.textContent = site.zh;
  infoEnEl.textContent = site.en;
  infoKindEl.textContent = site.kind === 'bone' ? '骨骼' : '肌肉';
  infoSideEl.textContent = sideLabel;
  infoSideEl.className = `tag side-${sideKey}`;
  infoTrisEl.textContent = `${formatNumber(triangles)} 面`;
  infoObjectsEl.textContent = `${items.length} 个对象`;
  infoEl.hidden = false;
  state.infoHeight = infoEl.getBoundingClientRect().height || state.infoHeight;
}

function applyQuickTarget(siteId) {
  const target = QUICK_TARGETS[siteId];
  if (!target) return false;

  stopSpinForExplicitAction();
  state.view = target.view;
  state.preset = target.preset;
  state.isolate = false;
  state.selectedSite = state.sites.has(siteId) ? siteId : state.selectedSite;
  applyVisibility();
  updateInfoPanel();
  updateUiFromState();
  if (state.ready) applyView(state.view);
  requestRender();
  return true;
}

function setView(view) {
  if (!VIEWS[view]) return false;
  stopSpinForExplicitAction();
  state.view = view;
  updateUiFromState();
  applyView(view);
  return true;
}

function setPreset(preset) {
  if (!PRESETS.has(preset)) return false;
  stopSpinForExplicitAction();
  state.preset = preset;
  applyVisibility();
  updateUiFromState();
  if (state.ready) {
    updateProjectionLayout(
      Math.max(1, canvas.clientWidth || window.innerWidth),
      Math.max(1, canvas.clientHeight || window.innerHeight),
    );
    applyView(state.view);
  }
  return true;
}

function setIsolate(isolate) {
  const next = Boolean(isolate);
  if (next && !state.selectedSite) return false;
  state.isolate = next;
  applyVisibility();
  updateUiFromState();
  if (state.ready) {
    updateProjectionLayout(
      Math.max(1, canvas.clientWidth || window.innerWidth),
      Math.max(1, canvas.clientHeight || window.innerHeight),
    );
    applyView(state.view);
  }
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
    lastStatsUiUpdate = 0;
    if (spinPivot) spinPivot.rotation.y = spinAngle;
  } else {
    lastSpinTimestamp = 0;
    lastFrameTime = 0;
  }

  updateUiFromState();
  updateStatsUi();
  requestRender();
  return true;
}

function reset() {
  stopSpinForExplicitAction();
  state.selectedSite = null;
  state.isolate = false;
  state.preset = 'all';
  state.view = 'front';
  updateInfoPanel();
  updateUiFromState();
  if (state.tier !== 'raw') {
    return loadTier('raw');
  }
  if (state.ready) {
    applyVisibility();
    applyView('front');
  }
  return true;
}

function setTier(tier) {
  if (!TIERS[tier]) return Promise.resolve(false);
  return loadTier(tier);
}

function updateUiFromState() {
  for (const button of document.querySelectorAll('[data-tier]')) {
    button.setAttribute('aria-pressed', String(button.dataset.tier === state.tier));
  }
  for (const button of document.querySelectorAll('[data-view]')) {
    button.setAttribute('aria-pressed', String(button.dataset.view === state.view));
  }
  for (const button of document.querySelectorAll('[data-preset]')) {
    button.setAttribute('aria-pressed', String(button.dataset.preset === state.preset));
  }
  for (const button of document.querySelectorAll('[data-target]')) {
    button.setAttribute('aria-pressed', String(button.dataset.target === state.selectedSite));
  }

  isolateBtn.setAttribute('aria-pressed', String(state.isolate));
  isolateBtn.textContent = state.isolate ? '显示全部' : '只看这块';
  spinToggle.setAttribute('aria-pressed', String(state.spin));

  if (state.selectedSite) {
    hintEl.style.opacity = '0';
  } else {
    hintEl.style.opacity = '1';
  }
}

function updateStatsUi() {
  if (!statTierEl) return;
  statTierEl.textContent = `${TIERS[stats.tier]?.label ?? stats.tier} · ${formatNumber(stats.instances)} 件`;
  statTrisEl.textContent = `${formatNumber(stats.triangles)} 面`;
  statDrawEl.textContent = `draw ${stats.drawCalls}`;
  statFpsEl.textContent = stats.spin
    ? stats.fpsAvg
      ? `${stats.fpsAvg}/${stats.fpsMin} fps`
      : '— fps'
    : '— fps';
  statFpsEl.title = stats.spin ? '自转平均/最低帧率' : '';
  statLoadEl.textContent = stats.loadMs ? `加载 ${Math.round(stats.loadMs)} ms` : '加载 — ms';
  statMultiEl.textContent = stats.multiDraw === null
    ? 'multi_draw —'
    : `multi_draw ${stats.multiDraw ? '有' : '无'}`;

  statDrawEl.classList.toggle('warn', stats.drawCalls > 5);
  statMultiEl.classList.toggle(stats.multiDraw ? 'ok' : 'warn', stats.multiDraw !== null);
}

function setLoadingState(kind, error) {
  if (!loadingEl) return;
  loadingEl.classList.toggle('is-error', kind === 'error');
  loadingEl.classList.toggle('is-hidden', kind === 'hidden');

  if (kind === 'loading') {
    loadingTitleEl.textContent = '正在加载解剖模型';
    loadingDetailEl.textContent = 'Draco 解码 · 合批 · 建立 site 映射';
  } else if (kind === 'error') {
    loadingTitleEl.textContent = '模型加载失败';
    loadingDetailEl.textContent = `${error}。请通过本地 HTTP 打开，见 README。`;
  }
}

function fail(error) {
  const message = error?.message || String(error);
  api.ready = false;
  api.error = message;
  stats.ready = false;
  stats.error = message;
  state.ready = false;
  delete body.dataset.viewerReady;
  body.dataset.viewerError = message;
  setLoadingState('error', message);
  updateStatsUi();
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
  stats.visibleInstances = 0;
  lastSpinTimestamp = 0;
  framePending = false;
}

function disposeGltf(gltf) {
  gltf?.scene?.traverse((object) => {
    object.geometry?.dispose();
  });
}

function formatNumber(value) {
  return Math.round(value).toLocaleString('zh-CN');
}

updateStatsUi();
updateUiFromState();
init();

