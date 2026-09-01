const $ = (id) => document.getElementById(id);

// The four shades a Game Boy's screen shows, lightest first.
const DMG_SHADES = [[0x9b, 0xbc, 0x0f], [0x8b, 0xac, 0x0f], [0x30, 0x62, 0x30], [0x0f, 0x38, 0x0f]];

const worker = new Worker('./worker.js', { type: 'module' });
const pending = new Map();
let nextId = 0;
let workerBroken = false;

worker.onerror = () => {
  const failed = new Error('The converter could not start. Rebuild it with ./build.sh, '
    + 'and serve this directory over HTTP rather than opening the file.');
  for (const [, job] of pending) job.reject(failed);
  pending.clear();
  workerBroken = true;
  showError(failed.message);
};

worker.onmessage = (e) => {
  const { id, ok, result, error } = e.data;
  const job = pending.get(id);
  if (!job) return;
  pending.delete(id);
  ok ? job.resolve(result) : job.reject(new Error(error));
};

function runConvert(rgba, width, height, opts) {
  if (workerBroken) return Promise.reject(new Error('The converter is not running.'));
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, rgba, width, height, opts }, [rgba.buffer]);
  });
}

// ── state ──────────────────────────────────────────────────

const state = {
  name: 'image',
  source: null,     // ImageData of the loaded file
  out: null,        // last conversion
  zoomStep: 1,    // 1 means as large as the viewport can hold
  tileZoom: 4,
  hasAlpha: false,
  panX: 0,
  panY: 0,
  seq: 0,
};

// ── loading an image ───────────────────────────────────────

async function loadFile(file) {
  if (!file || !file.type.startsWith('image/')) {
    showError('That file is not an image.');
    return;
  }
  state.name = file.name.replace(/\.[^.]+$/, '') || 'image';

  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    showError('Could not decode that image.');
    return;
  }

  const cv = document.createElement('canvas');
  cv.width = bitmap.width;
  cv.height = bitmap.height;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  state.source = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  bitmap.close();

  // Reserving index 0 only pays off when something is actually transparent.
  const px = state.source.data;
  state.hasAlpha = false;
  for (let i = 3; i < px.length; i += 4) {
    if (px[i] < 128) { state.hasAlpha = true; break; }
  }

  $('opts').hidden = false;
  $('empty').hidden = true;
  state.zoomStep = 1;
  state.panX = state.panY = 0;
  drawSource();
  schedule();
}

// ── options ────────────────────────────────────────────────

function readOptions() {
  const dmg = $('c-dmg').checked;
  const quantizing = $('do-quantize').checked;
  return {
    obj: $('do-obj').checked,
    dmg,
    quantizeWidth: quantizing ? Math.max(8, +$('qw').value | 0) : 0,
    quantizeHeight: quantizing ? Math.max(8, +$('qh').value | 0) : 0,
    maxPalettes: dmg ? 1 : +$('maxpal').value,
    dither: $('do-dither').checked ? +$('dither-w').value : -1,
    ditherMethod: $('dither-m').value,
    gbcCorrection: !dmg && quantizing && $('gbc-correct').checked,
    metaWidth: $('do-meta').checked ? Math.max(8, +$('mw').value | 0) : 0,
    metaHeight: $('do-meta').checked ? Math.max(8, +$('mh').value | 0) : 0,
    map: $('do-map').checked,
    dedup: $('do-map').checked && $('do-dedup').checked,
    flip: $('do-map').checked && $('do-dedup').checked && !dmg && $('do-flip').checked,
  };
}

// Keep the form from offering combinations the converter refuses.
function syncForm() {
  const dmg = $('c-dmg').checked;
  const quantizing = $('do-quantize').checked;
  const map = $('do-map').checked;
  const dedup = map && $('do-dedup').checked;

  setEnabled($('do-dedup'), map);
  setEnabled($('do-flip'), dedup && !dmg);
  setEnabled($('gbc-correct'), !dmg && quantizing);
  $('palette-set').classList.toggle('is-hidden', dmg);
  $('size-row').classList.toggle('is-hidden', !quantizing);
  $('size-note').classList.toggle('is-hidden', !quantizing);
  $('dither-body').classList.toggle('is-hidden', !$('do-dither').checked);
  $('meta-row').classList.toggle('is-hidden', !$('do-meta').checked);

  $('obj-note').hidden = !($('do-obj').checked && state.source && !state.hasAlpha);
  $('maxpal-out').value = $('maxpal').value;
  $('dither-out').value = (+$('dither-w').value).toFixed(2);
  $('cap-result').textContent = dmg ? 'game boy' : 'game boy color';
}

function setEnabled(input, on) {
  input.disabled = !on;
  input.closest('.check').classList.toggle('is-off', !on);
}

// ── conversion ─────────────────────────────────────────────

let timer = null;
function schedule() {
  clearTimeout(timer);
  timer = setTimeout(convertNow, 180);
}

async function convertNow() {
  if (!state.source) return;
  syncForm();

  const seq = ++state.seq;
  const opts = readOptions();
  const rgba = new Uint8Array(state.source.data); // the worker takes ownership

  showError(null);
  $('busy').hidden = false;
  for (const id of ['cv-result', 'dock', 'dlbar', 'rail']) $(id).hidden = true;

  try {
    const out = await runConvert(rgba, state.source.width, state.source.height, opts);
    if (seq !== state.seq) return; // a newer run has started
    state.out = { ...out, opts };
    render();
  } catch (err) {
    if (seq !== state.seq) return;
    state.out = null;
    for (const id of ['cv-result', 'dock', 'dlbar', 'rail', 'zoom-wrap']) $(id).hidden = true;
    showError(err.message);
  } finally {
    if (seq === state.seq) $('busy').hidden = true;
  }
}

// ── rendering ──────────────────────────────────────────────

function render() {
  for (const id of ['cv-result', 'dock', 'dlbar', 'zoom-wrap']) $(id).hidden = false;
  $('rail').hidden = false;
  drawPreview();
  drawDownloads();
  drawTiles();
  drawPalettes();
  drawStats();
}

function drawSource() {
  const { width: w, height: h } = state.source;
  const max = 264;   // a corner thumbnail, not a second view
  const scale = Math.min(1, max / w, max / h);
  const cv = $('cv-source');
  cv.width = Math.max(1, Math.round(w * scale));
  cv.height = Math.max(1, Math.round(h * scale));
  cv.style.width = cv.width + 'px';
  const tmp = document.createElement('canvas');
  tmp.width = w; tmp.height = h;
  tmp.getContext('2d').putImageData(state.source, 0, 0);
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(tmp, 0, 0, cv.width, cv.height);
  $('thumb').hidden = false;
}

function drawPreview() {
  const o = state.out;
  const cv = $('cv-result');
  cv.width = o.previewWidth;
  cv.height = o.previewHeight;
  cv.getContext('2d').putImageData(
    new ImageData(new Uint8ClampedArray(o.preview), o.previewWidth, o.previewHeight), 0, 0);
  cv.classList.toggle('checker', o.opts.obj);
  applyView();
}

// The largest whole multiple that still fits, so the pixels stay square.
function fitZoom() {
  const o = state.out;
  if (!o) return 1;
  const vp = $('viewport').getBoundingClientRect();
  const pad = 32;
  return Math.max(1, Math.min(
    Math.floor((vp.width - pad) / o.previewWidth),
    Math.floor((vp.height - pad) / o.previewHeight)));
}

// Position the result, holding it inside the viewport unless it is larger.
function applyView() {
  const o = state.out;
  if (!o) return;
  const cv = $('cv-result');
  const vp = $('viewport').getBoundingClientRect();
  const scale = fitZoom() * state.zoomStep;
  const w = o.previewWidth * scale;
  const h = o.previewHeight * scale;

  const slackX = Math.max(0, (w - vp.width) / 2);
  const slackY = Math.max(0, (h - vp.height) / 2);
  state.panX = Math.min(slackX, Math.max(-slackX, state.panX));
  state.panY = Math.min(slackY, Math.max(-slackY, state.panY));

  cv.style.transform =
    `translate(-50%, -50%) translate(${state.panX}px, ${state.panY}px) scale(${scale})`;
  $('viewport').classList.toggle('can-pan', slackX > 0 || slackY > 0);
  $('zoom-label').textContent = state.zoomStep + '\u00d7';
  $('zoom-out').disabled = state.zoomStep <= 1;
}

// Every tile drawn with the palette of the first cell that uses it.
function drawTiles() {
  const o = state.out;
  const grid = $('tilegrid');
  grid.textContent = '';

  const count = o.tiles.length / 16;
  $('tile-count').textContent =
    count === o.totalTiles ? `${count}` : `${count} kept of ${o.totalTiles}`;

  const palettes = readPalettes(o);
  const palOf = new Array(count).fill(0);
  if (o.attributes.length) {
    const cells = o.map.length ? o.map : null;
    for (let cell = o.attributes.length - 1; cell >= 0; cell--) {
      const t = cells ? cells[cell] : cell;
      if (t < count) palOf[t] = o.attributes[cell] & 0x07;
    }
  }

  const frag = document.createDocumentFragment();
  for (let t = 0; t < count; t++) {
    const cv = document.createElement('canvas');
    cv.width = 8; cv.height = 8;
    cv.title = `tile ${t}`;
    const img = new ImageData(8, 8);
    const pal = palettes[palOf[t]] || palettes[0];
    for (let r = 0; r < 8; r++) {
      const lo = o.tiles[t * 16 + r * 2], hi = o.tiles[t * 16 + r * 2 + 1];
      for (let c = 0; c < 8; c++) {
        const i = ((lo >> (7 - c)) & 1) | (((hi >> (7 - c)) & 1) << 1);
        const p = (r * 8 + c) * 4;
        const rgb = pal[i];
        img.data[p] = rgb[0]; img.data[p + 1] = rgb[1]; img.data[p + 2] = rgb[2];
        img.data[p + 3] = o.opts.obj && i === 0 ? 0 : 255;
      }
    }
    cv.getContext('2d').putImageData(img, 0, 0);
    if (o.opts.obj) cv.classList.add('checker');
    frag.append(cv);
  }
  grid.append(frag);
}

function readPalettes(o) {
  if (!o.palettes.length) return [DMG_SHADES];
  const out = [];
  for (let p = 0; p + 8 <= o.palettes.length; p += 8) {
    const pal = [];
    for (let i = 0; i < 4; i++) {
      const v = o.palettes[p + i * 2] | (o.palettes[p + i * 2 + 1] << 8);
      // Each channel is five bits; repeating the top bits into the bottom ones
      // spreads 0..31 over the whole 0..255 range.
      const e = (x) => (x << 3) | (x >> 2);
      const rgb = [e(v & 31), e((v >> 5) & 31), e((v >> 10) & 31)];
      rgb.raw = v;
      pal.push(rgb);
    }
    out.push(pal);
  }
  return out;
}

function drawPalettes() {
  const o = state.out;
  const box = $('palettes');
  box.textContent = '';
  const palettes = readPalettes(o);
  $('pal-title').textContent = o.palettes.length ? 'Palettes' : 'Shades';
  $('pal-count').textContent = o.palettes.length ? `${palettes.length}` : '';

  palettes.forEach((pal, i) => {
    const el = document.createElement('div');
    el.className = 'pal';
    const head = document.createElement('div');
    head.className = 'pal-head';
    head.textContent = o.palettes.length ? `palette ${i}` : 'game boy';
    const row = document.createElement('div');
    row.className = 'pal-swatches';
    pal.forEach(([r, g, b], j) => {
      const sw = document.createElement('div');
      sw.className = 'pal-swatch';
      sw.style.background = `rgb(${r},${g},${b})`;
      const code = document.createElement('code');
      const raw = pal[j].raw;   // absent on a DMG, which has no stored palette
      if (o.opts.obj && j === 0) {
        code.textContent = '\u2014';
        sw.title = 'transparent';
      } else if (raw === undefined) {
        code.textContent = String(j);
        sw.title = `shade ${j} \u2014 the program picks it with BGP; `
          + `this is what a Game Boy's screen shows (${hex(r, g, b)})`;
      } else {
        const h4 = raw.toString(16).toUpperCase().padStart(4, '0');
        code.textContent = '$' + h4;
        sw.title = `RGB555 $${h4}  (r${raw & 31} g${(raw >> 5) & 31} b${(raw >> 10) & 31})`
          + `  \u2248 ${hex(r, g, b)}`;
      }
      sw.append(code);
      row.append(sw);
    });
    el.append(head, row);
    box.append(el);
  });
}

const hex = (r, g, b) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');

function drawStats() {
  const o = state.out;
  const rows = [
    ['size', `${o.previewWidth}\u00d7${o.previewHeight}`],
    ['tiles', `${o.uniqueTiles}`],
    ['palettes', o.palettes.length ? o.paletteCount : '\u2014'],
    ['took', `${o.ms} ms`],
  ];
  $('stats').innerHTML = rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
}

// ── the Game Boy ROM ───────────────────────────────────────

// The viewer draws a whole screen of tiles, one per cell, in reading order.
const ROM_SCREEN = { w: 160, h: 144, tiles: 360 };

let romCache = null;
async function loadRom() {
  if (!romCache) {
    const [rom, offsets] = await Promise.all([
      fetch('./rom/viewer.gbc').then((r) => r.arrayBuffer()),
      fetch('./rom/offsets.json').then((r) => r.json()),
    ]);
    romCache = { rom: new Uint8Array(rom), offsets };
  }
  return romCache;
}

function romFits(o) {
  return o.previewWidth === ROM_SCREEN.w
    && o.previewHeight === ROM_SCREEN.h
    && o.tiles.length === ROM_SCREEN.tiles * 16
    && !o.opts.metaWidth;
}

// Why the conversion cannot go in the ROM, in the page's own terms.
function romBlocker(o) {
  if (o.previewWidth !== ROM_SCREEN.w || o.previewHeight !== ROM_SCREEN.h) {
    return 'the ROM shows a whole 160x144 screen';
  }
  if (o.opts.metaWidth) return 'the ROM draws a background, not sprites';
  if (o.tiles.length !== ROM_SCREEN.tiles * 16) {
    return 'the ROM wants one tile per cell, so leave the folding off';
  }
  return '';
}

async function buildRom() {
  const o = state.out;
  const { rom, offsets } = await loadRom();
  const out = rom.slice();

  const put = (name, data) => {
    const { offset, size } = offsets[name];
    out.set(data.subarray(0, size), offset);
    out.fill(0, offset + Math.min(data.length, size), offset + size);
  };

  put('tiles', o.tiles);
  if (o.palettes.length) {
    put('palettes', o.palettes);
    put('attributes', o.attributes);
  } else {
    // Clearing the header's colour flag makes this a Game Boy cartridge, and
    // the ROM reads that flag too, so it takes its shades from BGP instead.
    put('palettes', new Uint8Array(offsets.palettes.size));
    put('attributes', new Uint8Array(offsets.attributes.size));
    out[0x143] = 0x00;
    let header = 0;
    for (let i = 0x134; i <= 0x14c; i++) header = (header - out[i] - 1) & 0xff;
    out[0x14d] = header;
  }

  // The global checksum covers the whole cartridge, so it has to be redone.
  let sum = 0;
  for (let i = 0; i < out.length; i++) if (i !== 0x14e && i !== 0x14f) sum += out[i];
  out[0x14e] = (sum >> 8) & 0xff;
  out[0x14f] = sum & 0xff;
  return out;
}

const FILE_NOTES = {
  tiles: '2bpp tile data, 16 bytes each',
  palettes: 'RGB555, 8 bytes per palette',
  attributes: 'palette and flips, one byte per cell',
  map: 'which tile each cell holds',
};

function drawDownloads() {
  const o = state.out;
  const box = $('downloads');
  box.textContent = '';

  const files = [
    ['tiles', o.tiles],
    ['palettes', o.palettes],
    ['attributes', o.attributes],
    ['map', o.map],
  ].filter(([, d]) => d.length);

  for (const [kind, data] of files) {
    box.append(card(`${kind}.bin`, bytes(data.length), FILE_NOTES[kind],
      () => save(`${state.name}_${kind}.bin`, data)));
  }
  box.append(card('preview.png', 'png', 'the image as the console shows it',
    () => $('cv-result').toBlob((b) => saveBlob(`${state.name}_preview.png`, b))));

  const blocker = romBlocker(o);
  const ext = o.palettes.length ? 'gbc' : 'gb';
  const rom = card(`${state.name}.${ext}`, ext,
    blocker || 'a Game Boy program that shows this image',
    async () => save(`${state.name}.${ext}`, await buildRom()));
  rom.classList.add('dl-rom');
  rom.disabled = !romFits(o);
  box.append(rom);
}

function card(name, size, title, onClick) {
  const b = document.createElement('button');
  b.className = 'dl';
  b.type = 'button';
  b.title = title;
  const arrow = document.createElement('span');
  arrow.className = 'dl-arrow';
  arrow.textContent = '\u2193';
  const n = document.createElement('span');
  n.className = 'dl-name';
  n.textContent = name;
  const z = document.createElement('span');
  z.className = 'dl-size';
  z.textContent = size;
  b.append(arrow, n, z);
  b.onclick = onClick;
  return b;
}

const bytes = (n) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} kB`);

function save(name, data) {
  saveBlob(name, new Blob([data], { type: 'application/octet-stream' }));
}
function saveBlob(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// The converter reports in command-line terms; say it in the page's terms.
const CONTROL_NAMES = {
  '--quantize': 'the target size',
  '--dither': 'Dither',
  '--map': 'Tile map',
  '--dedup': 'Fold identical tiles',
  '--flip': 'Also fold mirrored',
  '--dmg': 'Game Boy mode',
  '--gbc-correction': 'Correct for the console screen',
  '--obj': 'Transparent index 0',
  '--metasprite': 'Metasprite cells',
};

function humanize(msg) {
  return msg
    .replace(/\s*\n\s*/g, ' ')
    .replace(/--[a-z-]+/g, (f) => CONTROL_NAMES[f] ? `\u201c${CONTROL_NAMES[f]}\u201d` : f)
    .replace(/\(smaller \u201cthe target size\u201d, or drop \u201cDither\u201d\)/, '(a smaller size, or no dithering)')
    .replace(/, or drop \u201cTile map\u201d and place the tiles yourself\./,
             ', or turn \u201cTile map\u201d off and place the tiles yourself.');
}

function showError(msg) {
  $('error').hidden = !msg;
  $('error-text').textContent = msg ? humanize(msg) : '';
}

// ── wiring ─────────────────────────────────────────────────

$('file').addEventListener('change', (e) => loadFile(e.target.files[0]));

async function loadExample() {
  // Skip the HTTP cache: this file changes, and it is served without an ETag.
  const res = await fetch('./sample.png', { cache: 'reload' });
  await loadFile(new File([await res.blob()], 'example.png', { type: 'image/png' }));
}
$('try-example').onclick = loadExample;
if (new URLSearchParams(location.search).has('demo')) loadExample();

const drop = $('drop');
for (const ev of ['dragenter', 'dragover']) {
  drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('is-over'); });
}
for (const ev of ['dragleave', 'drop']) {
  drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('is-over'); });
}
drop.addEventListener('drop', (e) => loadFile(e.dataTransfer.files[0]));
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => {
  e.preventDefault();
  if (e.dataTransfer.files.length) loadFile(e.dataTransfer.files[0]);
});

$('opts').addEventListener('input', () => { syncForm(); schedule(); });
$('opts').addEventListener('change', () => { syncForm(); schedule(); });

$('preset-screen').onclick = () => {
  $('qw').value = 160; $('qh').value = 144;
  schedule();
};

// 1x is whatever fills the viewport; the steps above it are whole multiples of
// that, so the pixels stay square.
const setZoom = (step) => {
  const next = Math.min(8, Math.max(1, step));
  const k = next / state.zoomStep;
  state.panX *= k;
  state.panY *= k;
  state.zoomStep = next;
  applyView();
};
$('zoom-in').onclick = () => setZoom(state.zoomStep + 1);
$('zoom-out').onclick = () => setZoom(state.zoomStep - 1);

// Drag to move the result once it is bigger than the space it sits in.
const vp = $('viewport');
let drag = null;
vp.addEventListener('pointerdown', (e) => {
  if (!state.out || !vp.classList.contains('can-pan')) return;
  drag = { x: e.clientX, y: e.clientY, px: state.panX, py: state.panY };
  vp.setPointerCapture(e.pointerId);
  vp.classList.add('is-panning');
});
vp.addEventListener('pointermove', (e) => {
  if (!drag) return;
  state.panX = drag.px + (e.clientX - drag.x);
  state.panY = drag.py + (e.clientY - drag.y);
  applyView();
});
for (const ev of ['pointerup', 'pointercancel']) {
  vp.addEventListener(ev, () => { drag = null; vp.classList.remove('is-panning'); });
}

addEventListener('resize', () => { if (state.out) applyView(); });

// The tiles are drawn at 8x8 and sized in CSS, so this costs nothing to change.
const setTileZoom = (z) => {
  state.tileZoom = Math.min(16, Math.max(1, z));
  $('tilegrid').style.setProperty('--tz', state.tileZoom);
  $('tile-zoom').textContent = state.tileZoom + '\u00d7';
  $('tile-out').disabled = state.tileZoom <= 1;
  $('tile-in').disabled = state.tileZoom >= 16;
};
$('tile-in').onclick = () => setTileZoom(state.tileZoom + 1);
$('tile-out').onclick = () => setTileZoom(state.tileZoom - 1);
setTileZoom(state.tileZoom);

syncForm();

window.__gbfxReady = true;
