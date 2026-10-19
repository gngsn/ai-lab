import gsap from 'gsap';
import * as THREE from 'three';
import { sfx, unlockAudio } from './game/audio';
import { BANANA_TIME, COUNTDOWN, ENERGY_TIME, GAP_LIMIT, ITEM_SLOTS, MUSCAT_TIME, MAX_V, PACE_COLORS, PACE_LABELS } from './game/constants';
import { SteerInput } from './game/input';
import { computeStats } from './game/stats';
import { createSim, hasGrip, isEnergized, isSprinting, isTurbo, prepareCourse, useItem, type ItemKind, stepSim, type SimState } from './game/sim';
import { sampleAt, worldAt, type Course } from './route/course';
import { parseGpx } from './route/gpx';
import { formatPace, formatTime } from './route/pace';
import { SAMPLE_RUNS } from './route/samples';
import type { Run } from './route/types';
import { Minimap } from './ui/minimap';
import { CHARACTERS, createRunner, renderThumbnails, type CharacterId } from './world/character';
import { buildCoins, type CoinsView } from './world/coins';
import { buildFruits, type FruitsView } from './world/fruits';
import { buildGels, type GelsView } from './world/gels';
import { buildNature, type NatureView } from './world/nature';
import { buildRoad, type RoadView } from './world/road';
import { createWorld, followSun } from './world/scene';

type Screen = 'home' | 'select' | 'stats' | 'preview' | 'character' | 'play' | 'result' | 'over';
type CamMode = 'portrait' | 'overview' | 'chase' | 'finish';
type PlayPhase = 'intro' | 'countdown' | 'running' | 'ending';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------- world ----------
const world = createWorld($<HTMLCanvasElement>('gl'));
const { scene, camera } = world;
const fog = scene.fog as THREE.Fog;
const input = new SteerInput($('gl'));
/** The player's main runner: shown on Home and preselected for every race. */
const CHAR_KEY = 'pace-runner:character';
function loadCharacter(): CharacterId {
  try {
    const v = localStorage.getItem(CHAR_KEY);
    if (CHARACTERS.some((c) => c.id === v)) return v as CharacterId;
  } catch {
    /* storage unavailable */
  }
  return CHARACTERS[0].id;
}
let mainId = loadCharacter();
/** runner currently on screen (the race pick, or the main runner in menus) */
let characterId = mainId;
let runner = createRunner({ kind: characterId });
let ghost = createRunner({ ghost: true, kind: characterId });
scene.add(runner.group, ghost.group);
if ('ontouchstart' in window) document.body.classList.add('touch');

const hudMap = new Minimap($<HTMLCanvasElement>('hud-map'), { line: 3.5, pad: 12, streets: 0.6 });
const previewMap = new Minimap($<HTMLCanvasElement>('pv-map'), { line: 5, pad: 26, glow: true, streets: 1, pin: true });

const runs: Run[] = [];
const courses = new Map<string, Course>();
const courseFor = (run: Run) => {
  let c = courses.get(run.id);
  if (!c) courses.set(run.id, (c = prepareCourse(run)));
  return c;
};

let course: Course | null = null;
let road: RoadView | null = null;
let nature: NatureView | null = null;
let coinsView: CoinsView | null = null;
let gelsView: GelsView | null = null;
let fruitsView: FruitsView | null = null;

function dispose(obj: THREE.Object3D) {
  obj.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        (m as THREE.MeshBasicMaterial).map?.dispose();
        m.dispose();
      }
    }
  });
  obj.removeFromParent();
}

/** Make `id` the main runner (persisted) and show it. */
function setMain(id: CharacterId) {
  mainId = id;
  try {
    localStorage.setItem(CHAR_KEY, id);
  } catch {
    /* storage unavailable */
  }
  setCharacter(id);
  renderPickers();
}

/** Show `id` as the current runner. The race pick doesn't change the main runner. */
function setCharacter(id: CharacterId) {
  if (id === characterId) return;
  characterId = id;
  const { position, rotation } = runner.group;
  const ghostVisible = ghost.group.visible;
  const gp = ghost.group.position.clone();
  const gr = ghost.group.rotation.y;
  dispose(runner.group);
  dispose(ghost.group);
  runner = createRunner({ kind: id });
  ghost = createRunner({ ghost: true, kind: id });
  runner.group.position.copy(position);
  runner.group.rotation.y = rotation.y;
  ghost.group.position.copy(gp);
  ghost.group.rotation.y = gr;
  ghost.group.visible = ghostVisible;
  scene.add(runner.group, ghost.group);
  gsap.fromTo(runner.group.scale, { x: 0.6, y: 1.3, z: 0.6 }, { x: 1, y: 1, z: 1, duration: 0.6, ease: 'elastic.out(1, 0.45)' });
  renderPickers();
}

// ---------- character picker ----------
const thumbs = renderThumbnails();

function renderPickers() {
  for (const el of document.querySelectorAll<HTMLElement>('.char-picker')) {
    el.innerHTML = '';
    for (const c of CHARACTERS) {
      // the main-runner picker (My Stats) edits mainId; the race picker edits the current runner
      const isMainPicker = el.classList.contains('main-picker');
      const selected = isMainPicker ? mainId : characterId;
      const b = document.createElement('button');
      b.className = 'char-option' + (c.id === selected ? ' selected' : '') + (c.id === mainId ? ' is-main' : '');
      b.setAttribute('aria-pressed', String(c.id === selected));
      b.title = c.blurb;
      b.innerHTML = '<img alt="" /><span></span><small></small>';
      b.querySelector('img')!.src = thumbs[c.id];
      b.querySelector('span')!.textContent = c.name;
      b.querySelector('small')!.textContent = c.blurb;
      b.addEventListener('click', () => (isMainPicker ? setMain(c.id) : setCharacter(c.id)));
      el.appendChild(b);
    }
  }
}
renderPickers();

function loadCourse(c: Course) {
  if (course === c) return;
  if (road) dispose(road.group);
  if (nature) dispose(nature.group);
  if (coinsView) dispose(coinsView.group);
  if (gelsView) dispose(gelsView.group);
  if (fruitsView) dispose(fruitsView.group);
  course = c;
  road = buildRoad(c);
  nature = buildNature(c);
  coinsView = buildCoins(c);
  gelsView = buildGels(c);
  fruitsView = buildFruits(c);
  scene.add(road.group, nature.group, coinsView.group, gelsView.group, fruitsView.group);
  hudMap.setCourse(c);
  placeRunner(0, 0, 0);
  ghost.group.visible = false;
}

// ---------- state ----------
let screen: Screen = 'home';
let camMode: CamMode = 'portrait';
let phase: PlayPhase = 'intro';
let phaseTime = 0;
let sim: SimState = createSim();
let postDist = 0;
let postV = 0;
let shake = 0;
let clockTime = 0;
let camLerp = 6;

const camPos = new THREE.Vector3(0, 4, 10);
const camLook = new THREE.Vector3();
const tmpPos = new THREE.Vector3();
const tmpLook = new THREE.Vector3();
/** smoothed chase-camera heading (x, z) */
const camHeading = new THREE.Vector2(0, 1);

function placeRunner(dist: number, lateral: number, yaw: number) {
  if (!course) return;
  const p = worldAt(course, dist, lateral);
  runner.group.position.set(p.x, 0, p.z);
  runner.group.rotation.y = Math.atan2(p.tx, p.tz) + yaw;
}

// ---------- screens ----------
const SCREENS: Record<Screen, string> = {
  home: 'screen-home',
  select: 'screen-select',
  preview: 'screen-preview',
  character: 'screen-character',
  stats: 'screen-stats',
  play: 'hud',
  result: 'screen-result',
  over: 'screen-over',
};

function show(next: Screen) {
  screen = next;
  for (const [key, id] of Object.entries(SCREENS)) {
    const el = $(id);
    const on = key === next;
    el.classList.toggle('active', on);
    if (on) gsap.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.35, ease: 'power2.out' });
  }
  const panel = $(SCREENS[next]).querySelector('.panel, .home, .routes-head');
  if (panel) gsap.fromTo(panel, { y: 24, scale: 0.97 }, { y: 0, scale: 1, duration: 0.5, ease: 'back.out(1.6)' });
}

let toastTimer = 0;
function toast(msg: string) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('show'), 2600);
}

const bestKey = (id: string) => `pace-runner:best:${id}`;
function getBest(id: string): number | null {
  try {
    const v = localStorage.getItem(bestKey(id));
    return v ? Number(v) : null;
  } catch {
    return null;
  }
}
function setBest(id: string, t: number) {
  try {
    localStorage.setItem(bestKey(id), String(t));
  } catch {
    /* storage unavailable — best time just won't persist */
  }
}

const coinKey = (id: string) => `pace-runner:coins:${id}`;
function getBestCoins(id: string): number {
  try {
    return Number(localStorage.getItem(coinKey(id)) ?? 0);
  } catch {
    return 0;
  }
}
function setBestCoins(id: string, n: number) {
  try {
    localStorage.setItem(coinKey(id), String(n));
  } catch {
    /* storage unavailable */
  }
}

const fmtClock = (sec: number) => {
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
};

// ---------- home ----------
$('btn-sync').addEventListener('click', () => {
  unlockAudio();
  const btn = $<HTMLButtonElement>('btn-sync');
  btn.disabled = true;
  $('sync-status').textContent = 'Loading your runs…';
  // MVP: phone sync is simulated with bundled sample runs; GPX upload covers real data.
  setTimeout(() => {
    ensureRuns();
    btn.disabled = false;
    $('sync-status').textContent = '';
    openSelect();
  }, 700);
});

// ---------- select ----------
/** Routes grid: each finished run is a collectible — big route art, stats and reward badges. */
function openSelect() {
  setCharacter(mainId);
  show('select');
  camMode = 'portrait';
  ghost.group.visible = false;
  const list = $('run-list');
  list.innerHTML = '';
  let totalKm = 0;
  let played = 0;
  runs.forEach((run, idx) => {
    let c: Course;
    try {
      c = courseFor(run);
    } catch {
      return;
    }
    totalKm += c.realDistanceM / 1000;
    const best = getBest(run.id);
    if (best) played++;
    const li = document.createElement('li');
    li.className = `route-card tint-${idx % 4}`;
    li.tabIndex = 0;
    li.innerHTML = `
      <div class="route-art"><canvas></canvas><span class="route-km"></span></div>
      <div class="route-info">
        <h3></h3>
        <p class="route-date"></p>
        <div class="route-stats"><span class="t"></span><span class="p"></span></div>
        <div class="route-badges"></div>
      </div>`;
    li.querySelector('.route-km')!.textContent = `${(c.realDistanceM / 1000).toFixed(1)} km`;
    li.querySelector('h3')!.textContent = run.name;
    li.querySelector('.route-date')!.textContent = run.date;
    li.querySelector('.route-stats .t')!.textContent = fmtClock(c.realDurationSec);
    li.querySelector('.route-stats .p')!.textContent = `${formatPace(c.avgPace)}/km`;
    const badges = li.querySelector('.route-badges')!;
    const badge = (cls: string, text: string) => {
      const b = document.createElement('span');
      b.className = `badge ${cls}`;
      b.textContent = text;
      badges.appendChild(b);
    };
    if (best) badge('best', `★ ${formatTime(best)}`);
    else badge('new', 'New');
    badge('coin', `${best ? getBestCoins(run.id) : 0}/${c.coins.length}`);
    if (c.gels.length) badge('gel', `${c.gels.length} gel${c.gels.length > 1 ? 's' : ''}`);
    const open = () => openPreview(run);
    li.addEventListener('click', open);
    li.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && open());
    list.appendChild(li);
    new Minimap(li.querySelector('canvas')!, { line: 5, pad: 20, padTop: 44, glow: true, streets: 1, pin: true }).setCourse(c);
  });

  // "add a run" card opens the GPX picker
  const add = document.createElement('li');
  add.className = 'route-card add';
  add.innerHTML = `<label for="gpx-input"><span class="plus">+</span><b>Add a run</b><small>Upload a GPX file</small></label>`;
  list.appendChild(add);

  $('routes-sum').textContent = `${runs.length} routes · ${totalKm.toFixed(1)} km · ${played} raced`;
  gsap.fromTo('.route-card', { y: 18, opacity: 0 }, { y: 0, opacity: 1, duration: 0.45, stagger: 0.05, ease: 'power2.out' });
}

$('btn-select-back').addEventListener('click', goHome);
$('btn-routes-stats').addEventListener('click', () => openStats('select'));

function goHome() {
  setCharacter(mainId);
  show('home');
  camMode = 'portrait';
}

// ---------- my stats ----------
let statsBack: Screen = 'home';

function ensureRuns() {
  if (!runs.length) runs.push(...SAMPLE_RUNS);
}

function openStats(from: Screen) {
  ensureRuns();
  statsBack = from;
  setCharacter(mainId);
  show('stats');
  camMode = 'portrait';
  ghost.group.visible = false;
  renderPickers();
  const courses = runs.flatMap((r) => {
    try {
      return [courseFor(r)];
    } catch {
      return [];
    }
  });
  const st = computeStats(courses, getBest, getBestCoins);
  const cell = (k: string, v: string, sub = '') =>
    `<div><dt>${k}</dt><dd>${v}</dd>${sub ? `<small>${sub}</small>` : ''}</div>`;
  const esc = (t: string) => t.replace(/[&<>"]/g, (ch) => `&#${ch.charCodeAt(0)};`);
  $('st-summary').innerHTML = [
    cell('Total distance', `${st.totalKm.toFixed(1)} km`),
    cell('Total time', fmtClock(st.totalSec)),
    cell('Runs', String(st.runs)),
    cell('Avg pace', `${formatPace(st.avgPace)}/km`),
    cell('Longest run', st.longest ? `${st.longest.km.toFixed(1)} km` : '—', st.longest ? esc(st.longest.name) : ''),
    cell('Fastest run', st.fastest ? `${formatPace(st.fastest.pace)}/km` : '—', st.fastest ? esc(st.fastest.name) : ''),
  ].join('');
  $('st-pace-bar').innerHTML = st.paceShare
    .map((share, b) => `<i style="flex:${share};background:${PACE_COLORS[b]}" title="${PACE_LABELS[b]}"></i>`)
    .join('');
  $('st-pace-legend').innerHTML = st.paceShare
    .map((share, b) => `<li><i style="background:${PACE_COLORS[b]}"></i>${PACE_LABELS[b]} <b>${Math.round(share * 100)}%</b></li>`)
    .join('');
  const medalIcon = { gold: '🥇', silver: '🥈', bronze: '🥉' } as const;
  $('st-bests').innerHTML = st.bests
    .map(
      (b) => `<li>
        <span class="medal">${b.medal ? medalIcon[b.medal] : '·'}</span>
        <span class="name">${esc(b.name)}<small>${b.km.toFixed(1)} km</small></span>
        <span class="time">${b.bestTime === null ? 'Not raced' : formatTime(b.bestTime)}</span>
        <span class="coins">$ ${b.bestCoins}/${b.totalCoins}</span>
      </li>`,
    )
    .join('');
}

$('btn-stats').addEventListener('click', () => {
  unlockAudio();
  openStats('home');
});
$('btn-stats-back').addEventListener('click', () => (statsBack === 'select' ? openSelect() : goHome()));

$<HTMLInputElement>('gpx-input').addEventListener('change', async (e) => {
  const inputEl = e.target as HTMLInputElement;
  const file = inputEl.files?.[0];
  inputEl.value = '';
  if (!file) return;
  try {
    const run = parseGpx(await file.text(), file.name.replace(/\.gpx$/i, ''));
    courseFor(run);
    runs.unshift(run);
    toast(`Added '${run.name}'`);
    openSelect();
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Could not read that GPX file');
  }
});

// ---------- preview ----------
let selectedRun: Run | null = null;

function openPreview(run: Run) {
  selectedRun = run;
  const c = courseFor(run);
  loadCourse(c);
  show('preview');
  camMode = 'overview';
  $('pv-date').textContent = run.date;
  $('pv-name').textContent = run.name;
  $('pv-stats').innerHTML = '';
  const stats: [string, string][] = [
    ['Distance', `${(c.realDistanceM / 1000).toFixed(2)}km`],
    ['Real time', fmtClock(c.realDurationSec)],
    ['Avg pace', formatPace(c.avgPace)],
  ];
  for (const [k, v] of stats) {
    const d = document.createElement('div');
    d.innerHTML = '<dt></dt><dd></dd>';
    d.querySelector('dt')!.textContent = k;
    d.querySelector('dd')!.textContent = v;
    $('pv-stats').appendChild(d);
  }
  const legend = $('pv-legend');
  legend.innerHTML = '';
  const step = (c.paceMax - c.paceMin) / 4;
  PACE_COLORS.forEach((color, b) => {
    const li = document.createElement('li');
    li.innerHTML = `<i></i><span></span><small></small>`;
    li.querySelector('i')!.style.background = color;
    li.querySelector('span')!.textContent = PACE_LABELS[b];
    li.querySelector('small')!.textContent = `${formatPace(c.paceMin + step * b)}–${formatPace(c.paceMin + step * (b + 1))}`;
    legend.appendChild(li);
  });
  previewMap.setCourse(c);
}

$('btn-preview-back').addEventListener('click', openSelect);
$('btn-choose-course').addEventListener('click', openCharacter);

// ---------- character select ----------
function openCharacter() {
  if (!selectedRun) return;
  unlockAudio();
  setCharacter(mainId);
  show('character');
  camMode = 'portrait';
  ghost.group.visible = false;
  placeRunner(0, 0, 0);
  $('ch-course').textContent = selectedRun.name;
  renderPickers();
}

$('btn-character-back').addEventListener('click', () => selectedRun && openPreview(selectedRun));
$('btn-start').addEventListener('click', () => {
  unlockAudio();
  startRun();
});

// ---------- play ----------
function startRun() {
  if (!course) return;
  sim = createSim();
  input.reset();
  postDist = 0;
  postV = 0;
  phase = 'intro';
  phaseTime = 0;
  camLerp = 2.2;
  camMode = 'chase';
  placeRunner(0, 0, 0);
  if (course) {
    const p0 = worldAt(course, 0, 0);
    camHeading.set(p0.tx, p0.tz);
  }
  ghost.group.visible = true;
  show('play');
  hudMap.layout();
  renderItemSlots();
  $('countdown').textContent = '';
}

function quitRun() {
  if (screen === 'play') openSelect();
}
$('btn-quit').addEventListener('click', quitRun);
window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape') quitRun();
  if (screen === 'play' && phase === 'running' && !e.repeat) {
    const slot = e.code === 'Space' ? 0 : ['Digit1', 'Digit2', 'Digit3'].indexOf(e.code);
    if (slot >= 0) {
      e.preventDefault();
      activateItem(slot);
    }
  }
  if ((e.code === 'Enter' || e.code === 'Space') && (screen === 'result' || screen === 'over')) startRun();
});

for (const id of ['btn-rs-retry', 'btn-ov-retry']) $(id).addEventListener('click', startRun);
for (const id of ['btn-rs-select', 'btn-ov-select']) $(id).addEventListener('click', openSelect);

function flash(kind: 'turbo' | 'offroad' | 'gel') {
  const el = $('flash');
  el.classList.toggle('offroad', kind === 'offroad');
  el.classList.toggle('gel', kind === 'gel');
  gsap.fromTo(el, { opacity: 1 }, { opacity: 0, duration: kind === 'turbo' ? 0.9 : 0.5, ease: 'power2.out' });
}

function bumpCoins() {
  gsap.fromTo('#hud-coins-chip', { scale: 1.25 }, { scale: 1, duration: 0.3, ease: 'back.out(3)' });
}

// ---------- carried items ----------
const ITEM_INFO: Record<ItemKind, { name: string; banner: string; icon: string }> = {
  gel: {
    name: 'Energy gel',
    banner: 'ENERGY GEL!',
    icon: '<svg viewBox="0 0 24 32"><rect x="3" y="7" width="18" height="23" rx="5" fill="#e8414f"/><rect x="7" y="2" width="10" height="7" rx="3" fill="#f8a9b4"/><path d="M13 12l-4 7h3l-1 6 5-8h-3z" fill="#fff"/></svg>',
  },
  banana: {
    name: 'Banana',
    banner: 'BANANA GRIP!',
    icon: '<svg viewBox="0 0 32 32"><path d="M5 9c2 10 10 16 22 13-2 4-9 6-15 3S3 16 5 9z" fill="#ffd84d" stroke="#e0a81e" stroke-width="1.5"/><circle cx="5" cy="9" r="2" fill="#8a5a2b"/></svg>',
  },
  muscat: {
    name: 'Shine muscat',
    banner: 'SHINE MUSCAT SPRINT!',
    icon: '<svg viewBox="0 0 32 32"><circle cx="16" cy="18" r="11" fill="#b8e86a" stroke="#86b83a" stroke-width="1.5"/><circle cx="12" cy="14" r="3" fill="#f4ffe0"/><path d="M16 7l2-5" stroke="#7a9a3a" stroke-width="2.5" stroke-linecap="round"/></svg>',
  },
};

function renderItemSlots(popLast = false) {
  const wrap = $('hud-items');
  wrap.innerHTML = '';
  for (let i = 0; i < ITEM_SLOTS; i++) {
    const kind = sim.inventory[i];
    const b = document.createElement('button');
    b.className = 'item-slot' + (kind ? ' full' : '');
    b.disabled = !kind;
    b.setAttribute('aria-label', kind ? `Use ${ITEM_INFO[kind].name}` : 'Empty slot');
    b.innerHTML = `${kind ? ITEM_INFO[kind].icon : ''}<kbd>${i === 0 ? 'Space' : i + 1}</kbd>`;
    b.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      activateItem(i);
    });
    wrap.appendChild(b);
  }
  if (popLast && sim.inventory.length) {
    gsap.fromTo(wrap.children[sim.inventory.length - 1], { scale: 1.35 }, { scale: 1, duration: 0.35, ease: 'back.out(3)' });
  }
}

function activateItem(slot: number) {
  const kind = useItem(sim, slot);
  if (!kind) return;
  renderItemSlots();
  sfx.gel();
  flash('gel');
  countdownText(ITEM_INFO[kind].banner, true);
}

let bagFullAt = -10;
function showBagFull() {
  if (clockTime - bagFullAt < 1.5) return;
  bagFullAt = clockTime;
  const el = $('hud-bag');
  el.textContent = 'Bag full — use an item!';
  gsap.fromTo(el, { opacity: 1, y: 0 }, { opacity: 0, y: -10, duration: 1.4, delay: 0.6 });
}

function countdownText(text: string, banner = false) {
  const el = $('countdown');
  el.textContent = text;
  el.classList.toggle('banner', banner);
  gsap.killTweensOf(el);
  gsap.fromTo(el, { scale: 1.6, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.35, ease: 'back.out(2)' });
  if (text === 'GO!' || banner) gsap.to(el, { opacity: 0, scale: 1.2, duration: 0.4, delay: banner ? 1.1 : 0.5 });
}

function updatePlay(dt: number) {
  if (!course) return;
  phaseTime += dt;
  const steer = input.update(dt);

  if (phase === 'intro') {
    runner.idle(clockTime);
    if (phaseTime > 1.3) {
      phase = 'countdown';
      phaseTime = 0;
      countdownText(String(COUNTDOWN));
      sfx.tick();
    }
  } else if (phase === 'countdown') {
    runner.idle(clockTime);
    const before = Math.ceil(COUNTDOWN - (phaseTime - dt));
    const now = Math.ceil(COUNTDOWN - phaseTime);
    if (now !== before && now > 0) {
      countdownText(String(now));
      sfx.tick();
    }
    if (phaseTime >= COUNTDOWN) {
      phase = 'running';
      phaseTime = 0;
      camLerp = 6;
      countdownText('GO!');
      sfx.go();
    }
  } else if (phase === 'running') {
    const wasTurbo = isTurbo(sim);
    for (const ev of stepSim(sim, course, steer, dt)) {
      if (ev === 'pickup') {
        sfx.coin();
        renderItemSlots(true);
      } else if (ev === 'full') {
        showBagFull();
      } else if (ev === 'coin') {
        sfx.coin();
        bumpCoins();
      } else if (ev === 'turbo') {
        sfx.turbo();
        flash('turbo');
      } else if (ev === 'offroad') {
        sfx.bump();
        flash('offroad');
        shake = Math.max(shake, 0.35);
      } else if (ev === 'finish') {
        sfx.finish();
        phase = 'ending';
        phaseTime = 0;
        postV = sim.v;
      } else if (ev === 'gameover') {
        sfx.over();
        phase = 'ending';
        phaseTime = 0;
        postV = sim.v;
      }
    }
    if (sim.offRoad) shake = Math.max(shake, 0.12 * (sim.v / MAX_V));
    runner.update(dt, sim.v, steer, isTurbo(sim) || wasTurbo);
    placeRunner(sim.dist, sim.lateral, steer * 0.25);
  } else if (phase === 'ending') {
    postV *= Math.exp(-dt * (sim.phase === 'finished' ? 1.6 : 2.5));
    postDist += postV * dt;
    if (postV > 3) runner.update(dt, postV, 0, false);
    else if (sim.phase === 'finished') runner.celebrate(clockTime);
    else runner.idle(clockTime);
    placeRunner(sim.dist + postDist, sim.lateral, 0);
    if (sim.phase === 'finished' && phaseTime > 0.6) camMode = 'finish';
    if (phaseTime > (sim.phase === 'finished' ? 2.4 : 1.6)) {
      if (sim.phase === 'finished') showResult();
      else showGameOver();
    }
  }

  // ghost keeps running on its own clock, offset to the left lane
  const gt = phase === 'running' || phase === 'ending' ? sim.ghostDist : 0;
  const gp = worldAt(course, gt, -1.6);
  ghost.group.position.set(gp.x, 0, gp.z);
  ghost.group.rotation.y = Math.atan2(gp.tx, gp.tz);
  if (gt > 0 && gt < course.length) ghost.update(dt, MAX_V * 0.8, 0, false);
  else ghost.idle(clockTime + 1);
  // A ghost just behind the runner sits between runner and camera: fade it out so it never blocks the view.
  const behind = sim.dist + postDist - gt;
  const ghostAlpha = 0.42 * Math.min(1, Math.max(0, 1 - (behind - 0.5) / 3.5));
  ghost.group.traverse((o) => {
    if (o instanceof THREE.Mesh) (o.material as THREE.Material).opacity = ghostAlpha;
  });
  ghost.group.visible = ghostAlpha > 0.01;

  updateHud();
}

function realSpeedKmh(v: number): number {
  if (!course) return 0;
  // game units → real metres, game seconds → real seconds (ghost ≙ the real run)
  const mPerUnit = course.realDistanceM / course.length;
  const timeScale = course.realDurationSec / course.ghostDuration;
  return ((v * mPerUnit) / timeScale) * 3.6;
}

function updateHud() {
  if (!course) return;
  $('hud-time').textContent = formatTime(sim.phase === 'finished' ? sim.finishTime : sim.t);
  const gapUnits = sim.dist - sim.ghostDist;
  const gapM = Math.round((Math.abs(gapUnits) / course.length) * course.realDistanceM);
  $('hud-gap-label').textContent =
    phase === 'intro' || phase === 'countdown' || gapM < 3
      ? 'Side by side with past you'
      : gapUnits > 0
        ? `${gapM}m ahead of past you`
        : `${gapM}m behind past you`;
  const ratio = Math.max(-1, Math.min(1, gapUnits / GAP_LIMIT));
  const fill = $('hud-gap');
  fill.style.width = `${Math.abs(ratio) * 50}%`;
  fill.style.left = ratio >= 0 ? '50%' : `${50 - Math.abs(ratio) * 50}%`;
  fill.style.background = ratio >= 0 ? 'var(--green)' : ratio > -0.6 ? 'var(--orange)' : 'var(--red)';

  const here = sampleAt(course, sim.dist);
  ($('hud-pace').querySelector('.dot') as HTMLElement).style.background = PACE_COLORS[here.bucket];
  $('hud-pace-text').textContent = `${PACE_LABELS[here.bucket]} · real ${formatPace(here.pace)}`;
  $('hud-speed').textContent = realSpeedKmh(phase === 'ending' ? postV : sim.v).toFixed(1);
  // active item effect (sprint > grip > energy)
  const effect = isSprinting(sim)
    ? { label: 'Sprint', left: sim.sprintUntil - sim.t, total: MUSCAT_TIME, cls: 'sprint' }
    : hasGrip(sim)
      ? { label: 'Grip', left: sim.gripUntil - sim.t, total: BANANA_TIME, cls: 'grip' }
      : isEnergized(sim)
        ? { label: 'Energy boost', left: sim.energyUntil - sim.t, total: ENERGY_TIME, cls: 'energy' }
        : null;
  const energyEl = $('hud-energy');
  energyEl.classList.toggle('on', !!effect && sim.phase === 'running');
  if (effect) {
    energyEl.dataset.effect = effect.cls;
    $('hud-energy-label').textContent = effect.label;
    $('hud-energy-bar').style.width = `${(Math.max(0, effect.left) / effect.total) * 100}%`;
  }
  $('hud-coins').textContent = String(sim.coins);
  $('hud-coins-total').textContent = `/ ${course.coins.length}`;
  $('hud-progress').style.width = `${(sim.dist / course.length) * 100}%`;
  const p = worldAt(course, sim.dist, sim.lateral);
  const g = worldAt(course, sim.ghostDist, 0);
  hudMap.draw(p, g);
}

function showResult() {
  if (!course || !selectedRun) return;
  const t = sim.finishTime;
  const prev = getBest(selectedRun.id);
  const prevCoins = getBestCoins(selectedRun.id);
  if (sim.coins > prevCoins) setBestCoins(selectedRun.id, sim.coins);
  const isBest = prev === null || t < prev;
  if (isBest) setBest(selectedRun.id, t);
  $('rs-eyebrow').textContent = isBest && prev !== null ? 'NEW RECORD' : 'FINISH';
  $('rs-title').textContent = isBest && prev !== null ? 'New record!' : 'Finished!';
  $('rs-time').textContent = formatTime(t);
  const diff = course.ghostDuration - t;
  const equivalent = course.realDurationSec * (t / course.ghostDuration);
  $('rs-vs').textContent = `${Math.abs(diff).toFixed(2)}s ${diff >= 0 ? 'faster than past you!' : 'slower than past you'}`;
  const stats: [string, string][] = [
    ['Equiv. time', `${fmtClock(equivalent)}`],
    ['Equiv. pace', formatPace(course.avgPace * (t / course.ghostDuration))],
    ['Coins', `${sim.coins} / ${course.coins.length}${sim.coins > prevCoins && prevCoins > 0 ? ' ★' : ''}`],
    ['Turbo · Items', `${sim.turbos} · ${sim.itemsUsed}`],
    ['Off road', `${sim.offRoadTime.toFixed(1)}s`],
    ['Best', formatTime(isBest ? t : prev!)],
  ];
  const dl = $('rs-stats');
  dl.innerHTML = '';
  for (const [k, v] of stats) {
    const d = document.createElement('div');
    d.innerHTML = '<dt></dt><dd></dd>';
    d.querySelector('dt')!.textContent = k;
    d.querySelector('dd')!.textContent = v;
    dl.appendChild(d);
  }
  show('result');
}

function showGameOver() {
  if (!course) return;
  const pct = Math.round((sim.dist / course.length) * 100);
  $('ov-text').textContent = `Caught at ${pct}% of the course. Hit the blue turbo pads and stay off the grass to win time back!`;
  show('over');
}

// ---------- camera ----------
function cameraTargets(dt: number) {
  if (!course) return;
  const b = course.bounds;
  if (camMode === 'portrait') {
    // sway around the runner's front so the face stays in view
    const a = runner.group.rotation.y + Math.sin(clockTime * 0.25) * 0.9;
    const r = runner.group.position;
    // narrow screens put UI at the bottom: pull back and aim low so the character sits up top
    const narrow = camera.aspect < 1;
    const dist = narrow ? 9 : 6.5;
    // character select on wide screens: pan right (camera + target) so the runner stands left of the panel
    const pan = camera.aspect > 1.2 ? (screen === 'character' ? 2.3 : screen === 'home' ? -1.8 : 0) : 0;
    const px = Math.cos(a) * pan;
    const pz = -Math.sin(a) * pan;
    tmpPos.set(r.x + Math.sin(a) * dist + px, narrow ? 2.2 : 2.6, r.z + Math.cos(a) * dist + pz);
    tmpLook.set(r.x + px, narrow ? -0.9 : 1.1, r.z + pz);
    fogTo(40, 220, dt);
  } else if (camMode === 'overview') {
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    const ext = Math.max(b.maxX - b.minX, b.maxZ - b.minZ);
    const a = clockTime * 0.05;
    // shift look target so the course sits left of the panel on wide screens
    const aspectShift = camera.aspect > 1.2 ? ext * 0.18 : 0;
    tmpLook.set(cx + Math.cos(a) * aspectShift, 0, cz - Math.sin(a) * aspectShift);
    tmpPos.set(cx + Math.sin(a) * ext * 0.42, ext * 0.55, cz + Math.cos(a) * ext * 0.42);
    const d = tmpPos.distanceTo(tmpLook);
    fogTo(d * 0.9, d * 2.2, dt);
  } else if (camMode === 'chase') {
    // portrait screens are narrow: follow the runner's lateral position more tightly
    const portrait = camera.aspect < 1;
    const d = sim.dist + postDist;
    // Sit behind the runner along a smoothed heading, not at the path point 8.5 units back:
    // on a hairpin that point is on the other leg of the route, right next to the runner.
    const here = worldAt(course, d, sim.lateral * (portrait ? 0.95 : 0.7));
    const a = worldAt(course, d - 4, 0);
    const b = worldAt(course, d + 4, 0);
    let hx = b.x - a.x;
    let hz = b.z - a.z;
    const hl = Math.hypot(hx, hz) || 1;
    hx /= hl;
    hz /= hl;
    // ease the heading so the camera swings smoothly round tight turns
    const k = Math.min(1, dt * 4);
    camHeading.x += (hx - camHeading.x) * k;
    camHeading.y += (hz - camHeading.y) * k;
    camHeading.normalize();
    tmpPos.set(here.x - camHeading.x * 8.5, 4.2, here.z - camHeading.y * 8.5);
    const ahead = worldAt(course, d, sim.lateral * (portrait ? 0.85 : 0.4));
    tmpLook.set(ahead.x + camHeading.x * 10, 1.0, ahead.z + camHeading.y * 10);
    fogTo(70, 320, dt);
  } else {
    const r = runner.group.position;
    const a = clockTime * 0.6;
    tmpPos.set(r.x + Math.sin(a) * 6, 2.4, r.z + Math.cos(a) * 6);
    tmpLook.set(r.x, 1.2, r.z);
  }
}

function fogTo(near: number, far: number, dt: number) {
  const k = Math.min(1, dt * 3);
  fog.near += (near - fog.near) * k;
  fog.far += (far - fog.far) * k;
}

function updateCamera(dt: number) {
  cameraTargets(dt);
  const k = 1 - Math.exp(-dt * (camMode === 'overview' ? 2 : camLerp));
  camPos.lerp(tmpPos, k);
  camLook.lerp(tmpLook, k);
  camera.position.copy(camPos);
  if (shake > 0.001) {
    camera.position.x += (Math.random() - 0.5) * shake;
    camera.position.y += (Math.random() - 0.5) * shake;
    shake *= Math.exp(-dt * 8);
  }
  camera.lookAt(camLook);
  const turbo = screen === 'play' && isTurbo(sim);
  const speedFov = screen === 'play' ? (sim.v / MAX_V) * 8 + (isEnergized(sim) ? 4 : 0) : 0;
  const fov = 58 + speedFov + (turbo ? 10 : 0);
  camera.fov += (fov - camera.fov) * Math.min(1, dt * 4);
  camera.updateProjectionMatrix();
}

// ---------- loop ----------
let lastFrame = performance.now();
function frame(now = performance.now()) {
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  clockTime += dt;
  if (screen === 'play') updatePlay(dt);
  else if (screen === 'result') runner.celebrate(clockTime);
  else runner.idle(clockTime);
  // runner's distance along the course; overview cameras see the whole course
  const racing = screen === 'play' || screen === 'result' || screen === 'over';
  const playerS = camMode === 'overview' ? undefined : racing ? sim.dist + postDist : 0;
  road?.update(clockTime, sim.usedPads, playerS);
  gelsView?.update(clockTime, sim.gelsTaken, playerS);
  fruitsView?.update(clockTime, sim.itemsTaken, playerS);
  coinsView?.update(clockTime, sim.collected, playerS);
  nature?.update(clockTime);
  updateCamera(dt);
  const r = runner.group.position;
  followSun(world.sun, r.x, r.z);
  world.renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

window.addEventListener('resize', () => {
  if (screen === 'play') hudMap.layout();
  if (screen === 'preview') previewMap.layout();
});

// Boot: show the first sample course behind the home screen.
function boot() {
  loadCourse(courseFor(SAMPLE_RUNS[0]));
  selectedRun = SAMPLE_RUNS[0];
  camPos.set(runner.group.position.x + 6, 2.6, runner.group.position.z + 6);
  show('home');
  frame();
}
// Gel labels are drawn on a canvas, so wait (briefly) for the display font first.
Promise.race([Promise.all([document.fonts.load('700 48px Lexend'), document.fonts.load('800 48px Lexend'), document.fonts.load('48px "Hanalei Fill"')]), new Promise((r) => setTimeout(r, 1500))]).finally(boot);

// Dev-only handle for automated play-testing.
if (import.meta.env.DEV) {
  Object.assign(window, {
    __game: {
      get sim() {
        return sim;
      },
      get course() {
        return course;
      },
      get screen() {
        return screen;
      },
    },
  });
}
