import { Renderer, loadModel, MeshBuilder } from './gl.js';
import { m4, v3, q, clamp, lerp, smooth, angDiff, lerpAng, rng } from './math.js';
import { Lucia, buildNpcMesh, NpcRig, npcOutfit, LUCIA_SCALE, GUN_SCALE, GUN_GRIP, GUN_MUZZLE } from './chars.js';
import * as O from './overrides.js';

const $ = (id) => document.getElementById(id);
const TIPS = ['Chĩa súng vào người đi đường, họ sẽ giơ tay — nhấn NHẶT/CƯỚP để lấy tiền.', 'Bắn hoặc đấm người khác sẽ bị cảnh sát truy nã (★).', 'Nhặt hộp đạn màu cam rơi ra từ NPC để nạp thêm.', 'Rút súng (nút ✋🔫) rồi bấm ngắm để bắn chính xác.', 'Cống thoát nước và biển hiệu neon rải khắp thành phố.', 'Chạm bản đồ góc phải để xem toàn thành phố.'];
$('tip').textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
const setProg = (p, t) => { $('bar').style.width = (p * 100).toFixed(0) + '%'; $('pct').textContent = (p * 100).toFixed(0) + '%'; if (t) $('lstat').textContent = t; };

/* ================= constants ================= */
const PERIOD = 82, LOT = 64, SW = 3.5, NB = 3, HALF = NB * PERIOD + PERIOD / 2 + 4;
const isTouch = matchMedia('(pointer:coarse)').matches;
const R0 = rng(1337);
const rnd = (a = 1, b) => (b === undefined ? R0() * a : a + R0() * (b - a));
const pick = (a) => a[Math.floor(R0() * a.length)];
const NEON = [[1, 0.1, 0.55], [0.1, 0.9, 1], [0.7, 0.2, 1], [1, 0.75, 0.1], [0.2, 1, 0.5], [1, 0.3, 0.2]];

/* ================= audio ================= */
const A = { ctx: null, on: true, master: null };
function audioInit() {
  if (A.ctx) return; try {
    A.ctx = new (window.AudioContext || window.webkitAudioContext)(); A.master = A.ctx.createGain(); A.master.gain.value = 0.5; A.master.connect(A.ctx.destination);
    const nb = A.ctx.createBuffer(1, A.ctx.sampleRate, A.ctx.sampleRate), d = nb.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; A.noise = nb;
    // synthwave pad/arp
    const notes = [57, 60, 64, 67, 55, 59, 62, 66]; let step = 0;
    A.music = setInterval(() => { if (!A.on || !A.ctx) return; const t = A.ctx.currentTime, o = A.ctx.createOscillator(), g = A.ctx.createGain(), f = A.ctx.createBiquadFilter(); const n = notes[(step >> 1) % 4 + (Math.floor(step / 32) % 2) * 4] + (step % 2 ? 12 : 0); o.type = 'sawtooth'; o.frequency.value = 440 * Math.pow(2, (n - 69) / 12); f.type = 'lowpass'; f.frequency.value = 900; g.gain.setValueAtTime(0.05, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.28); o.connect(f); f.connect(g); g.connect(A.master); o.start(t); o.stop(t + 0.3); if (step % 8 === 0) { const b = A.ctx.createOscillator(), bg = A.ctx.createGain(); b.type = 'sine'; b.frequency.setValueAtTime(110, t); b.frequency.exponentialRampToValueAtTime(40, t + 0.3); bg.gain.setValueAtTime(0.25, t); bg.gain.exponentialRampToValueAtTime(0.001, t + 0.35); b.connect(bg); bg.connect(A.master); b.start(t); b.stop(t + 0.4); } step++; }, 235);
  } catch (e) { }
}
function sfx(type, vol = 1) {
  if (!A.ctx || !A.on) return; const t = A.ctx.currentTime, c = A.ctx;
  const nz = (dur, fr, vv, q0 = 1, type2 = 'lowpass') => { const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain(); s.buffer = A.noise; f.type = type2; f.frequency.value = fr; f.Q.value = q0; g.gain.setValueAtTime(vv * vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur); s.connect(f); f.connect(g); g.connect(A.master); s.start(t, Math.random()); s.stop(t + dur); };
  const tone = (f0, f1, dur, vv, ty = 'sine') => { const o = c.createOscillator(), g = c.createGain(); o.type = ty; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur); g.gain.setValueAtTime(vv * vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur); o.connect(g); g.connect(A.master); o.start(t); o.stop(t + dur); };
  if (type === 'shot') { nz(0.25, 3200, 0.9, 0.7); tone(180, 40, 0.18, 0.8); } else if (type === 'punch') { nz(0.12, 500, 0.7); tone(120, 50, 0.1, 0.6); } else if (type === 'pick') { tone(600, 1200, 0.12, 0.3, 'square'); } else if (type === 'cash') { tone(900, 1800, 0.1, 0.25, 'triangle'); setTimeout(() => sfx('pick', 0.5), 70); }
  else if (type === 'hit') { nz(0.08, 1800, 0.4, 3, 'bandpass'); } else if (type === 'reload') { nz(0.05, 2500, 0.4, 5, 'bandpass'); setTimeout(() => nz(0.06, 1800, 0.5, 5, 'bandpass'), 350); } else if (type === 'empty') { nz(0.04, 3000, 0.3, 6, 'bandpass'); }
  else if (type === 'scream') { tone(700 + Math.random() * 400, 1400, 0.35, 0.18, 'sawtooth'); } else if (type === 'casing') { tone(4200, 3000, 0.05, 0.08, 'triangle'); } else if (type === 'siren') { tone(700, 1000, 0.5, 0.05, 'sine'); }
}

/* ================= renderer ================= */
const canvas = $('c');
let R;
try { R = new Renderer(canvas, { preserve: new URLSearchParams(location.search).has('shot') }); } catch (e) { setProg(0, 'Lỗi: ' + e.message); throw e; }
const GFX = [{ n: 'THẤP', s: 0.6, bloom: false, ms: 0 }, { n: 'TB', s: 0.8, bloom: true, ms: 0 }, { n: 'CAO', s: 1, bloom: true, ms: 0 }, { n: '4K', s: 1.5, bloom: true, ms: 4 }];
let gfx = +(localStorage.getItem('gfx') ?? (isTouch ? 1 : 2));
function applyGfx() { const g = GFX[gfx]; R.settings.bloom = g.bloom; R.settings.msaa = g.ms; const dpr = Math.min(window.devicePixelRatio || 1, 2); R.resize(innerWidth, innerHeight, g.s > 1 ? dpr : Math.min(dpr, 1.5) * (g.s), g.s > 1 ? 1 : 1); $('bGfx').textContent = g.n; }
addEventListener('resize', () => R && R.W && applyGfx());

/* ================= world data ================= */
const colliders = []; const grid = new Map(); const GC = 24;
const gkey = (x, z) => ((Math.floor(x / GC) + 100) << 10) | (Math.floor(z / GC) + 100);
function addCollider(x0, z0, x1, z1, h) {
  const c = { x0, z0, x1, z1, h }; colliders.push(c);
  for (let gx = Math.floor(x0 / GC); gx <= Math.floor(x1 / GC); gx++) for (let gz = Math.floor(z0 / GC); gz <= Math.floor(z1 / GC); gz++) { const k = ((gx + 100) << 10) | (gz + 100); let l = grid.get(k); if (!l) grid.set(k, (l = [])); l.push(c); }
}
function nearColl(x, z, r) { const out = new Set(); for (let gx = Math.floor((x - r) / GC); gx <= Math.floor((x + r) / GC); gx++) for (let gz = Math.floor((z - r) / GC); gz <= Math.floor((z + r) / GC); gz++) { const l = grid.get(((gx + 100) << 10) | (gz + 100)); if (l) l.forEach((c) => out.add(c)); } return out; }
function pushOut(p, r) {
  for (const c of nearColl(p[0], p[2], r + 1)) {
    if (p[1] > c.h) continue;
    const cx = clamp(p[0], c.x0, c.x1), cz = clamp(p[2], c.z0, c.z1), dx = p[0] - cx, dz = p[2] - cz, d2 = dx * dx + dz * dz;
    if (d2 < r * r) {
      if (d2 > 1e-8) { const d = Math.sqrt(d2), k = (r - d) / d; p[0] += dx * k; p[2] += dz * k; }
      else { const l = p[0] - c.x0, rr = c.x1 - p[0], t = p[2] - c.z0, b = c.z1 - p[2], m = Math.min(l, rr, t, b); if (m === l) p[0] = c.x0 - r; else if (m === rr) p[0] = c.x1 + r; else if (m === t) p[2] = c.z0 - r; else p[2] = c.z1 + r; }
    }
  }
  p[0] = clamp(p[0], -HALF + 4, HALF - 4); p[2] = clamp(p[2], -HALF + 4, HALF - 4);
}
// segment vs colliders: returns t in [0,1] or 1
function rayWorld(a, b) {
  let best = 1; const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2]; const L = Math.hypot(dx, dz);
  const steps = Math.max(1, Math.ceil(L / GC)); const seen = new Set();
  for (let s = 0; s <= steps; s++) { const x = a[0] + dx * s / steps, z = a[2] + dz * s / steps; for (const c of nearColl(x, z, 1)) {
    if (seen.has(c)) continue; seen.add(c);
    let t0 = 0, t1 = 1;
    for (const [o, d, mn, mx] of [[a[0], dx, c.x0, c.x1], [a[2], dz, c.z0, c.z1]]) { if (Math.abs(d) < 1e-9) { if (o < mn || o > mx) { t0 = 2; break; } } else { let ta = (mn - o) / d, tb = (mx - o) / d; if (ta > tb) [ta, tb] = [tb, ta]; t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t0 > t1) { t0 = 2; break; } } }
    if (t0 <= 1 && t0 < best) { const y = a[1] + dy * t0; if (y >= 0 && y <= c.h) best = t0; }
  } }
  if (dy < 0) { const t = -a[1] / dy; if (t > 0 && t < best) best = t; }
  return best;
}

/* ================= procedural textures ================= */
function makeGroundTex() {
  const S = 1024, k = S / PERIOD; const c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d');
  const m = document.createElement('canvas'); m.width = m.height = S; const h = m.getContext('2d');
  const rect = (ctx, x0, z0, x1, z1) => ctx.fillRect(x0 * k, z0 * k, (x1 - x0) * k, (z1 - z0) * k);
  const C = PERIOD / 2;
  g.fillStyle = '#1a1b26'; g.fillRect(0, 0, S, S); h.fillStyle = '#fff'; h.fillRect(0, 0, S, S);
  for (let i = 0; i < 9000; i++) { g.fillStyle = `rgba(${40 + R0() * 40},${40 + R0() * 40},${55 + R0() * 40},${R0() * 0.25})`; g.fillRect(R0() * S, R0() * S, 2 + R0() * 4, 2 + R0() * 4); }
  g.fillStyle = '#3a3a4a'; rect(g, C - 35.5, C - 35.5, C + 35.5, C + 35.5); h.fillStyle = '#555'; rect(h, C - 35.5, C - 35.5, C + 35.5, C + 35.5);
  g.strokeStyle = '#2c2c3a'; g.lineWidth = 1; for (let x = C - 35.5; x < C + 35.5; x += 1.5) { g.beginPath(); g.moveTo(x * k, (C - 35.5) * k); g.lineTo(x * k, (C + 35.5) * k); g.stroke(); g.beginPath(); g.moveTo((C - 35.5) * k, x * k); g.lineTo((C + 35.5) * k, x * k); g.stroke(); }
  g.fillStyle = '#23232f'; rect(g, C - LOT / 2, C - LOT / 2, C + LOT / 2, C + LOT / 2); h.fillStyle = '#444'; rect(h, C - LOT / 2, C - LOT / 2, C + LOT / 2, C + LOT / 2);
  g.fillStyle = '#9a9aaa'; for (const s of [-1, 1]) { rect(g, C - 35.6, C + s * 35.5 - (s > 0 ? 0 : 0.2), C + 35.6, C + s * 35.5 + 0.2); rect(g, C + s * 35.5 - 0.1, C - 35.6, C + s * 35.5 + 0.3, C + 35.6); }
  // lane lines on tile edges
  g.fillStyle = '#e8c21a'; for (const e of [0, PERIOD]) { rect(g, e - 0.2, 0, e - 0.05, PERIOD); rect(g, e + 0.05, 0, e + 0.2, PERIOD); rect(g, 0, e - 0.2, PERIOD, e - 0.05); rect(g, 0, e + 0.05, PERIOD, e + 0.2); }
  g.fillStyle = '#dcdce8'; for (const e of [0, PERIOD]) for (const o of [-2.75, 2.75]) { for (let t = 8; t < PERIOD - 8; t += 6) { rect(g, e + o - 0.08, t, e + o + 0.08, t + 3); rect(g, t, e + o - 0.08, t + 3, e + o + 0.08); } }
  // zebra crossings
  for (const e of [0, PERIOD]) for (const cx of [C - 32, C + 32]) for (let t = 0.3; t < 5.2; t += 1.0) { for (const sgn of [-1, 1]) { rect(g, cx - 1.6, e + sgn * t - 0.25, cx + 1.6, e + sgn * t + 0.25); rect(g, e + sgn * t - 0.25, cx - 1.6, e + sgn * t + 0.25, cx + 1.6); } }
  for (const e of [0, PERIOD]) for (const sgn of [-1, 1]) { rect(g, C - 36.8, e + sgn * 2.0 - 0.1, C - 35.8, e + sgn * 2.0 + 0.1); }
  const id = g.getImageData(0, 0, S, S), md = h.getImageData(0, 0, S, S);
  for (let i = 0; i < S * S; i++) id.data[i * 4 + 3] = md.data[i * 4];
  g.putImageData(id, 0, 0);
  return R.makeTex(g.getImageData(0, 0, S, S), S, S, { srgb: true });
}
function makeFacade(seed, palette) {
  const r = rng(seed), S = 256; const b = document.createElement('canvas'); b.width = b.height = S; const e = document.createElement('canvas'); e.width = e.height = S;
  const g = b.getContext('2d'), h = e.getContext('2d'); g.fillStyle = palette.wall; g.fillRect(0, 0, S, S); h.fillStyle = '#000'; h.fillRect(0, 0, S, S);
  for (let i = 0; i < 2500; i++) { g.fillStyle = `rgba(${r() * 255 | 0},${r() * 255 | 0},${r() * 255 | 0},0.04)`; g.fillRect(r() * S, r() * S, 3, 3); }
  const n = 4, w = S / n;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const x0 = x * w + w * 0.18, y0 = y * w + w * 0.2, ww = w * 0.64, hh = w * 0.6;
    g.fillStyle = palette.glass; g.fillRect(x0, y0, ww, hh); g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(x0, y0, ww * 0.4, hh);
    if (r() < palette.lit) { const col = pick2(r, palette.lights); h.fillStyle = col; h.globalAlpha = 0.7 + r() * 0.3; h.fillRect(x0, y0, ww, hh); h.globalAlpha = 1; g.fillStyle = col; g.globalAlpha = 0.3; g.fillRect(x0, y0, ww, hh); g.globalAlpha = 1; }
    g.fillStyle = palette.ledge; g.fillRect(x * w, y * w + w - 6, w, 6);
  }
  return [R.texFromCanvas(b), R.texFromCanvas(e)];
}
const pick2 = (r, a) => a[Math.floor(r() * a.length)];
function makeSignAtlas() {
  const S = 1024, c = document.createElement('canvas'); c.width = S; c.height = 512; const g = c.getContext('2d'); g.fillStyle = '#05030a'; g.fillRect(0, 0, S, 512);
  const words = ['PHỞ 24H', 'KARAOKE', 'HOTEL', 'RAMEN', 'BAR', 'CYBER', 'ĐIỆN MÁY', 'NEON', 'CAFÉ', 'CLUB', 'MOTEL', 'SUSHI'];
  const cols = ['#ff2d87', '#00e5ff', '#b46bff', '#ffd23c', '#5dff9a', '#ff6a3c'];
  words.forEach((w, i) => { const x = (i % 3) * 341, y = Math.floor(i / 3) * 128; g.save(); g.font = 'bold 64px Impact,Arial Black,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; const col = cols[i % cols.length]; g.strokeStyle = col; g.lineWidth = 6; g.shadowColor = col; g.shadowBlur = 18; g.strokeRect(x + 12, y + 12, 317, 104); g.fillStyle = '#fff'; g.fillText(w, x + 170, y + 66, 290); g.restore(); });
  return R.texFromCanvas(c);
}

/* ================= world build ================= */
const W = { blocks: [], lamps: [], statLights: [], signs: [], chunks: [], sidewalkPts: [] };
let groundMat, mats = {}, groundMesh;
function buildWorld(assets) {
  groundMat = { ...R.defaultMat, base: makeGroundTex(), wet: 0.85, spec: 0.6, shin: 36, ground: 1, uvScale: [1, 1], tint: [1, 1, 1] };
  const gb = new MeshBuilder(), ext = HALF + 60;
  const gv = (x, z) => gb.vert(x, 0, z, 0, 1, 0, x / PERIOD + 0.5, z / PERIOD + 0.5, [1, 1, 1, 1]);
  const g0 = gv(-ext, -ext), g1 = gv(ext, -ext), g2 = gv(ext, ext), g3 = gv(-ext, ext); gb.quad(g0, g3, g2, g1);
  groundMesh = gb.build(R, groundMat);
  const pals = [
    { wall: '#2a2838', glass: '#0c1020', ledge: '#3d3a52', lit: 0.4, lights: ['#ffcf7a', '#ffe9b0', '#7fe9ff', '#ff7ad9'] },
    { wall: '#1c2330', glass: '#06101c', ledge: '#2d3b52', lit: 0.5, lights: ['#7fe9ff', '#9fffe0', '#ffffff', '#ffcf7a'] },
    { wall: '#33233a', glass: '#10081a', ledge: '#4a2f55', lit: 0.35, lights: ['#ff7ad9', '#b48bff', '#ffcf7a', '#ff6a8a'] }];
  mats.facade = pals.map((p, i) => { const [b, e] = makeFacade(100 + i, p); return { ...R.defaultMat, base: b, emis: e, emisCol: [0.9, 0.9, 0.9], spec: 0.25, shin: 30, tint: [1, 1, 1], uvScale: [1, 1] }; });
  mats.roof = { ...R.defaultMat, spec: 0.1, tint: [1, 1, 1] };
  mats.neon = { ...R.defaultMat, unlit: 1, glow: 2.6, tint: [1, 1, 1] };
  mats.sign = { ...R.defaultMat, base: makeSignAtlas(), unlit: 1, glow: 2.2, tint: [1, 1, 1] };
  mats.metal = { ...R.defaultMat, spec: 0.5, shin: 30, tint: [1, 1, 1] };
  // props from models
  const boards = extractBoards(assets.signs);
  const manholes = extractItems(assets.manhole);
  const mhMats = [], mhIdx = []; manholes.forEach((m, i) => { mhMats.push([]); });
  const signPlace = boards.map(() => []), manPlace = manholes.map(() => []);
  const japanPlace = [];
  for (let bi = -NB; bi <= NB; bi++) for (let bj = -NB; bj <= NB; bj++) buildBlock(bi, bj, signPlace, manPlace, boards, japanPlace);
  // manholes along roads
  for (let i = 0; i < 260; i++) {
    const k = Math.floor(R0() * manholes.length), horiz = R0() < 0.5, e = (Math.floor(R0() * (2 * NB + 2)) - NB - 0.5) * PERIOD, t = (R0() - 0.5) * 2 * (HALF - 20), off = (R0() - 0.5) * 8;
    const x = horiz ? t : e + off, z = horiz ? e + off : t; const s = 0.55 + R0() * 0.15;
    manPlace[k].push(m4.fromTRS(m4.create(), [x, 0.01, z], q.axis([0, 1, 0], R0() * 6.28), [s, s, s]));
  }
  W.props = [];
  boards.forEach((b, i) => { if (!signPlace[i].length) return; const inst = R.staticInst(signPlace[i]); b.items.forEach((it) => W.props.push({ prim: it.prim, mat: it.mat, model: it.matrix, inst })); });
  manholes.forEach((b, i) => { const inst = R.staticInst(manPlace[i]); b.items.forEach((it) => W.props.push({ prim: it.prim, mat: it.mat, model: it.matrix, inst })); });
  // Japanese alley landmarks
  W.japan = { inst: assets.japan.instance(), list: japanPlace };
  W.japan.inst.update(m4.create());
  // sidewalk graph points
  return W;
}
function extractItems(model) { // each top-level mesh node group -> centred item
  const flat = model.flatten(), groups = []; const byRoot = new Map();
  for (const it of flat) { const key = it.node; groups.push({ items: [{ prim: it.prim, mat: it.prim.mat, matrix: it.matrix }], ctr: null }); }
  for (const g of groups) { const it = g.items[0], p = it.prim; const mn = m4.point(it.matrix, p.min), mx = m4.point(it.matrix, p.max); const cx = (mn[0] + mx[0]) / 2, cz = (mn[2] + mx[2]) / 2, y0 = Math.min(mn[1], mx[1]); const T = m4.create(); T[12] = -cx; T[13] = -y0; T[14] = -cz; it.matrix = m4.mul(m4.create(), T, it.matrix); }
  // merge parts by proximity so a vent (several meshes) stays together: group when centres are close
  return groups;
}
function extractBoards(model) {
  const gl = model.gltf.nodes, par = model.parent; const groups = new Map();
  for (const i of model.order) { if (gl[i].mesh === undefined) continue; let n = i, id = null; while (n >= 0) { const m = /^board(\d+)/.exec(model.names[n]); if (m) { id = m[1]; break; } n = par[n]; } if (id === null) continue; if (!groups.has(id)) groups.set(id, []); for (const p of model.meshes[gl[i].mesh].prims) groups.get(id).push({ prim: p, mat: p.mat, matrix: model.bindWorld[i] }); }
  const out = [];
  for (const [id, items] of groups) {
    const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9]; for (const it of items) for (let c = 0; c < 8; c++) { const pt = m4.point(it.matrix, [c & 1 ? it.prim.max[0] : it.prim.min[0], c & 2 ? it.prim.max[1] : it.prim.min[1], c & 4 ? it.prim.max[2] : it.prim.min[2]]); for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], pt[k]); mx[k] = Math.max(mx[k], pt[k]); } }
    const w = mx[0] - mn[0], h = mx[1] - mn[1]; if (w > 12 || h > 12 || w < 0.3) continue;
    const T = m4.create(); T[12] = -(mn[0] + mx[0]) / 2; T[13] = -(mn[1] + mx[1]) / 2; T[14] = -mx[2];
    out.push({ w, h, items: items.map((it) => ({ ...it, matrix: m4.mul(m4.create(), T, it.matrix) })) });
  }
  return out;
}

function buildBlock(bi, bj, signPlace, manPlace, boards, japanPlace) {
  const cx = bi * PERIOD, cz = bj * PERIOD, r = rng(bi * 73 + bj * 131 + 9);
  const fac = [new MeshBuilder(), new MeshBuilder(), new MeshBuilder()], roof = new MeshBuilder(), neon = new MeshBuilder(), prop = new MeshBuilder(), sgn = new MeshBuilder();
  const blk = { cx, cz, lamps: [], min: [cx - 40, 0, cz - 40], max: [cx + 40, 90, cz + 40] }; W.blocks.push(blk);
  const center = bi === 0 && bj === 0, plaza = (bi === 2 && bj === -1) || (bi === -2 && bj === 1);
  const L2 = LOT / 2;
  if (center) { W.japanAt = [cx, cz]; japanPlace.push({ x: cx, z: cz, s: 2.0, yaw: 0 }); addCollider(cx - 31, cz - 28, cx + 31, cz + 28, 40); }
  else if (plaza) {
    // open plaza with neon pylons and benches
    for (let k = 0; k < 8; k++) { const x = cx + (r() - 0.5) * 50, z = cz + (r() - 0.5) * 50, col = pick(NEON); neon.box(x, 4, z, 0.15, 4, 0.15, 0, col); neon.box(x, 8.2, z, 1.2, 0.12, 0.12, 0, col); addCollider(x - 0.4, z - 0.4, x + 0.4, z + 0.4, 9); blk.lamps.push({ x, y: 7, z, r: 20, c: col.map((v) => v * 1.6) }); }
    for (let k = 0; k < 6; k++) { const x = cx + (r() - 0.5) * 40, z = cz + (r() - 0.5) * 40; prop.box(x, 0.4, z, 1.0, 0.4, 0.3, r() * 3, [0.2, 0.2, 0.28, 1]); addCollider(x - 1, z - 1, x + 1, z + 1, 1); }
    const kx = cx, kz = cz; prop.box(kx, 1.5, kz, 6, 1.5, 6, 0, [0.12, 0.12, 0.2, 1]); addCollider(kx - 6, kz - 6, kx + 6, kz + 6, 3); neon.box(kx, 3.1, kz, 6.2, 0.1, 6.2, 0, [1, 0.1, 0.55]);
  } else {
    // 2x2 buildings
    const sizes = [r() * 0.3 + 0.35]; const sx = sizes[0] * LOT, sz = (r() * 0.3 + 0.35) * LOT; const xs = [-L2, -L2 + sx, L2], zs = [-L2, -L2 + sz, L2];
    for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) {
      const x0 = cx + xs[a] + 0.4, x1 = cx + xs[a + 1] - 0.4, z0 = cz + zs[b] + 0.4, z1 = cz + zs[b + 1] - 0.4;
      const tall = r() < 0.35, h = tall ? 45 + r() * 50 : 14 + r() * 24; const px = (x0 + x1) / 2, pz = (z0 + z1) / 2, hx = (x1 - x0) / 2, hz = (z1 - z0) / 2;
      const f = fac[Math.floor(r() * 3)], tint = [0.8 + r() * 0.4, 0.8 + r() * 0.4, 0.8 + r() * 0.4, 1];
      f.box(px, h / 2, pz, hx, h / 2, hz, 0, tint, 12, { skip: [2, 3], uo: r(), vo: r() });
      roof.box(px, h + 0.4, pz, hx - 0.2, 0.4, hz - 0.2, 0, [0.07, 0.07, 0.1, 1]);
      if (r() < 0.6) roof.box(px + (r() - 0.5) * hx, h + 1.6, pz + (r() - 0.5) * hz, 1.5 + r() * 2, 1.2, 1.5 + r() * 2, 0, [0.1, 0.1, 0.13, 1]);
      if (tall) { neon.box(px, h + 6, pz, 0.12, 6, 0.12, 0, [1, 0.1, 0.2]); blk.lamps.push({ x: px, y: h + 8, z: pz, r: 14, c: [1.4, 0.1, 0.15], beacon: true }); }
      const nc = pick(NEON); // vertical neon corner strips + top band
      for (const [sx2, sz2] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) if (r() < 0.5) neon.box(px + sx2 * (hx + 0.08), h * 0.5, pz + sz2 * (hz + 0.08), 0.1, h * 0.5, 0.1, 0, nc);
      neon.box(px, h - 0.5, pz, hx + 0.12, 0.18, hz + 0.12, 0, pick(NEON));
      addCollider(x0, z0, x1, z1, h + 1);
      // ground floor shop glow + signs on outward faces
      const faces = [[0, -1, px, z0 - 0.3, 0], [0, 1, px, z1 + 0.3, Math.PI], [-1, 0, x0 - 0.3, pz, -Math.PI / 2], [1, 0, x1 + 0.3, pz, Math.PI / 2]];
      for (const [dx, dz, fx, fz, yaw] of faces) {
        const onEdge = (dz === -1 && b === 0) || (dz === 1 && b === 1) || (dx === -1 && a === 0) || (dx === 1 && a === 1); if (!onEdge) continue;
        const along = dx === 0 ? hx : hz; const col = pick(NEON); const span = along * 1.6;
        if (r() < 0.85) { const w2 = Math.min(span * 0.7, 18); const ox = dx === 0 ? 1 : 0, oz = dz === 0 ? 1 : 0; neon.box(fx + dx * 0.1 + (r() - 0.5) * along * 0.5 * ox, 3.2, fz + dz * 0.1 + (r() - 0.5) * along * 0.5 * oz, dx === 0 ? w2 / 2 : 0.1, 0.12, dz === 0 ? w2 / 2 : 0.1, 0, col); blk.lamps.push({ x: fx + dx * 2, y: 3, z: fz + dz * 2, r: 13, c: col.map((v) => v * 1.2) }); }
        // atlas sign
        if (r() < 0.8) { const si = Math.floor(r() * 12), u0 = (si % 3) * 341 / 1024, v0 = Math.floor(si / 3) * 128 / 512, u1 = u0 + 341 / 1024, v1 = v0 + 128 / 512; const sw = 4 + r() * 3, sh = sw * 0.376; const y0 = 5 + r() * Math.min(10, h - 8); const ox = dx === 0 ? 1 : 0, oz = dz === 0 ? 1 : 0; const t = (r() - 0.5) * along * 0.8; const cxp = fx + ox * t + dx * 0.25, czp = fz + oz * t + dz * 0.25; const nx = dx, nz = dz;
          const p0 = [cxp - oz * sw / 2 * 1 + (dx !== 0 ? 0 : -sw / 2), y0, czp], _ = 0;
          const ax = dx === 0 ? [1, 0, 0] : [0, 0, 1]; const sgnv = dx === 0 ? (dz > 0 ? 1 : -1) : (dx > 0 ? -1 : 1); const A0 = [cxp - ax[0] * sw / 2 * sgnv, y0, czp - ax[2] * sw / 2 * sgnv], A1 = [cxp + ax[0] * sw / 2 * sgnv, y0, czp + ax[2] * sw / 2 * sgnv];
          const t0 = [A0[0], y0 + sh, A0[2]], t1 = [A1[0], y0 + sh, A1[2]];
          sgn.quadPts(A0, A1, t1, t0, [nx, 0, nz], [1, 1, 1, 1], [[u0, v1], [u1, v1], [u1, v0], [u0, v0]]); }
        // big brand board
        if (boards.length && r() < 0.5) { const bd = boards[Math.floor(r() * boards.length)]; const s = clamp(5 / Math.max(bd.w, 1), 0.5, 1.1); const ox = dx === 0 ? 1 : 0, oz = dz === 0 ? 1 : 0; const t = (r() - 0.5) * along * 0.9; const y = 6 + r() * Math.min(18, h - 10) + bd.h * s / 2; const pos = [fx + ox * t + dx * 0.3, y, fz + oz * t + dz * 0.3]; const m = m4.fromTRS(m4.create(), pos, q.axis([0, 1, 0], yaw), [s, s, s]); signPlace[boards.indexOf(bd)].push(m); blk.lamps.push({ x: pos[0] + dx * 3, y: pos[1], z: pos[2] + dz * 3, r: 16, c: [1.1, 0.9, 0.8] }); }
      }
    }
  }
  // lamps / sidewalk props
  const so = L2 + SW / 2;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = cx + sx * (L2 + 3), z = cz + sz * (L2 + 3); lampPost(prop, neon, blk, x, z, sx, sz, r);
    W.sidewalkPts.push([cx + sx * so, cz + sz * so]);
  }
  for (const s of [-1, 1]) { lampPost(prop, neon, blk, cx + s * (L2 + 3), cz + (r() - 0.5) * 30, s, 0, r); lampPost(prop, neon, blk, cx + (r() - 0.5) * 30, cz + s * (L2 + 3), 0, s, r); }
  // vending / bins
  for (let k = 0; k < 4; k++) { const side = pick([-1, 1]), x = cx + (r() - 0.5) * 40, z = cz + side * (L2 + 1.6); const col = pick(NEON); prop.box(x, 0.9, z, 0.5, 0.9, 0.4, 0, [0.08, 0.08, 0.12, 1]); neon.box(x, 1.1, z + side * -0.42, 0.4, 0.5, 0.02, 0, col); addCollider(x - 0.5, z - 0.4, x + 0.5, z + 0.4, 2); }
  const chunk = { min: [cx - 42, 0, cz - 42], max: [cx + 42, 100, cz + 42], prims: [] };
  fac.forEach((f, i) => { if (f.i.length) { const m = f.build(R, mats.facade[i]); m.prims[0].mat = mats.facade[i]; chunk.prims.push(m.prims[0]); } });
  [[roof, mats.roof], [neon, mats.neon], [prop, mats.metal], [sgn, mats.sign]].forEach(([b, mt]) => { if (b.i.length) { const m = b.build(R, mt); m.prims[0].mat = mt; chunk.prims.push(m.prims[0]); } });
  W.chunks.push(chunk); blk.chunk = chunk;
  W.lamps.push(...blk.lamps);
}
function lampPost(prop, neon, blk, x, z, sx, sz, r) {
  const col = pick([[1, 0.8, 0.5], [0.5, 0.9, 1], [1, 0.4, 0.8]]); prop.cyl(x, 0, z, 0.12, 0.09, 6.5, 6, [0.07, 0.07, 0.1, 1]);
  const ax = -sx * 0.9, az = -sz * 0.9; prop.box(x + ax / 2, 6.5, z + az / 2, Math.abs(ax) / 2 + 0.06, 0.06, Math.abs(az) / 2 + 0.06, 0, [0.07, 0.07, 0.1, 1]); neon.box(x + ax, 6.4, z + az, 0.35, 0.08, 0.35, 0, col);
  blk.lamps.push({ x: x + ax, y: 6, z: z + az, r: 19, c: col.map((v) => v * 1.5), lamp: true }); addCollider(x - 0.2, z - 0.2, x + 0.2, z + 0.2, 7);
}

/* ================= state ================= */
const G = { t: 0, state: 'load', cash: 0, hp: 100, armor: 0, stars: 0, crime: 0, crimeT: 0, hasGun: false, drawn: false, mag: 0, reserve: 0, kills: 0, msg: 0, dead: 0, reloadT: 0, punchT: 0, fireT: 0, jumpV: 0, onGround: true };
const P = { pos: [6, 0, 46], yaw: 0, vel: [0, 0, 0] };
const cam = { yaw: Math.PI, pitch: 0.18, dist: 3.4, pos: [0, 5, 0], target: [0, 1.5, 0], fov: 0.95 };
const inp = { mx: 0, mz: 0, fire: false, aim: false, jump: false, sprint: false, use: false };
let lucia, gunInst, npcMeshes = [], npcs = [], pickups = [], bullets = [], casings = [], parts = [], flashT = 0, flashPos = [0, 0, 0], shakeT = 0, hitMark = 0;
let casingSet, cashSet, ammoSet, partBuf, glowBuf;
let assets;

/* ================= pickups / fx ================= */
function addPart(p, v, life, size, col, grav = 0, add = true, grow = 0) { if (parts.length < 900) parts.push({ p: p.slice(), v, life, max: life, size, col, grav, add, grow }); }
function sparks(p, n, col = [1, 0.7, 0.3]) { for (let i = 0; i < n; i++) addPart(p, [(Math.random() - 0.5) * 6, Math.random() * 4, (Math.random() - 0.5) * 6], 0.25 + Math.random() * 0.3, 0.05, col, -14); }
function spawnPickup(type, p, val) { pickups.push({ type, p: [p[0], 0.5, p[2]], val, t: Math.random() * 6, life: type === 'gun' ? 1e9 : 60 }); }
function popMsg(t, d = 2) { const m = $('msg'); m.textContent = t; m.style.display = 'block'; G.msg = d; }
function addCrime(pts) { G.crime += pts; G.crimeT = 0; const s = Math.min(5, Math.floor(G.crime / 3)); if (s > G.stars) { G.stars = s; popMsg('TRUY NÃ ' + '★'.repeat(s), 2.5); } }

/* ================= NPCs ================= */
function sidePoint() { const b = W.blocks[Math.floor(Math.random() * W.blocks.length)], L2 = LOT / 2 + SW / 2, s = Math.random() < 0.5 ? -1 : 1; return Math.random() < 0.5 ? [b.cx + (Math.random() - 0.5) * 60, b.cz + s * L2] : [b.cx + s * L2, b.cz + (Math.random() - 0.5) * 60]; }
function spawnNpc(kind, near) {
  let pt, tries = 0; do { pt = sidePoint(); tries++; } while (tries < 30 && (Math.hypot(pt[0] - P.pos[0], pt[1] - P.pos[2]) < (near ? 40 : 55) || Math.hypot(pt[0] - P.pos[0], pt[1] - P.pos[2]) > (near ? 90 : 130)));
  const mesh = npcMeshes[kind][Math.floor(Math.random() * npcMeshes[kind].length)];
  const n = { kind, rig: new NpcRig(R, mesh), pos: [pt[0], 0, pt[1]], yaw: Math.random() * 6.28, speed: 0, state: 'walk', t: 0, hp: kind === 'cop' ? 140 : 100, dest: null, dead: 0, hu: 0, brave: Math.random() < 0.3, cd: 0, punchT: 0, punchSide: 0, stagger: 0, st: {}, gun: kind !== 'civ', walkSpd: 1.2 + Math.random() * 0.5, cash: 20 + Math.floor(Math.random() * 100), flee: [0, 0], scared: 0 };
  n.dest = [pt[0], pt[1]]; pickDest(n); npcs.push(n); return n;
}
function pickDest(n) {
  const x = n.pos[0], z = n.pos[2]; const bi = Math.round(x / PERIOD), bj = Math.round(z / PERIOD); const L = LOT / 2 + SW / 2;
  const sx = Math.sign(x - bi * PERIOD) || 1, sz = Math.sign(z - bj * PERIOD) || 1; let tx, tz; const r = Math.random();
  const nearX = Math.abs(Math.abs(x - bi * PERIOD) - L) < 3, nearZ = Math.abs(Math.abs(z - bj * PERIOD) - L) < 3;
  if (nearX && r < 0.5) { tx = bi * PERIOD + sx * L; tz = bj * PERIOD + (Math.random() < 0.5 ? -1 : 1) * L; if (Math.random() < 0.3) { tx += sx * (PERIOD - 2 * L) + sx * 0; tx = clamp(tx, -HALF + 8, HALF - 8); } }
  else if (nearZ) { tz = bj * PERIOD + sz * L; tx = bi * PERIOD + (Math.random() < 0.5 ? -1 : 1) * L; if (Math.random() < 0.3) tz = clamp(tz + sz * (PERIOD - 2 * L), -HALF + 8, HALF - 8); }
  else { const c = [[bi * PERIOD + L, bj * PERIOD + L], [bi * PERIOD - L, bj * PERIOD + L], [bi * PERIOD + L, bj * PERIOD - L], [bi * PERIOD - L, bj * PERIOD - L]]; c.sort((a, b) => Math.hypot(a[0] - x, a[1] - z) - Math.hypot(b[0] - x, b[1] - z)); tx = c[0][0]; tz = c[0][1]; }
  n.dest = [tx, tz];
}
function hurtNpc(n, dmg, fromPos, headshot) {
  if (n.dead) return; n.hp -= dmg; n.stagger = 0.3; n.flashHit = 0.15;
  if (n.hp <= 0) { n.dead = 0.001; n.state = 'dead'; G.kills++; addCrime(n.kind === 'cop' ? 5 : 3); dropLoot(n); sfx('scream', 0.5); }
  else { addCrime(1.2); if (n.kind === 'civ') { if (n.brave) { n.state = 'fight'; } else { n.state = 'flee'; n.scared = 8; } sfx('scream', 0.5); } else n.state = 'fight'; }
  alertNear(fromPos, 22);
}
function dropLoot(n) { spawnPickup('cash', [n.pos[0] + Math.random() - 0.5, 0, n.pos[2] + Math.random() - 0.5], n.cash); if (Math.random() < (n.kind === 'civ' ? 0.3 : 0.7)) spawnPickup('ammo', [n.pos[0] + 0.6, 0, n.pos[2] + 0.4], 12); }
function alertNear(p, r) { for (const n of npcs) { if (n.dead || n.state === 'fight') continue; const d = Math.hypot(n.pos[0] - p[0], n.pos[2] - p[2]); if (d < r && n.kind === 'civ') { n.state = 'flee'; n.scared = 6 + Math.random() * 4; } } }
function updateNpc(n, dt) {
  const pp = P.pos, dx = pp[0] - n.pos[0], dz = pp[2] - n.pos[2], dist = Math.hypot(dx, dz); n.t += dt; n.cd -= dt; n.stagger = Math.max(0, n.stagger - dt); n.flashHit = Math.max(0, (n.flashHit || 0) - dt);
  let want = 0, tyaw = n.yaw, st = n.st; st.handsUp = 0; st.aim = 0; st.punch = 0; st.dead = 0; st.phone = 0;
  if (n.state === 'dead') { n.dead = Math.min(1, n.dead + dt * 2.5); st.dead = n.dead; n.rot = (n.rot || 0) + dt; if (n.rot > 14) n.remove = true; n.speed = 0; return; }
  if (n.kind === 'cop' && G.stars === 0 && n.state !== 'walk') n.state = 'walk';
  if (n.kind === 'cop' && G.stars > 0) n.state = 'fight';
  // aimed at -> hands up
  if (n.kind === 'civ' && n.state !== 'flee' && n.state !== 'fight' && G.drawn && G.hasGun && (inp.aim || aimBlend > 0.5) && dist < 11 && !G.dead) {
    const fx = Math.sin(cam.yaw), fz = Math.cos(cam.yaw); const cosA = (-fx * -dx + -fz * -dz) / (dist || 1);
    const toN = [-dx / dist, -dz / dist], look = [-Math.sin(cam.yaw), -Math.cos(cam.yaw)]; const c2 = toN[0] * look[0] + toN[1] * look[1];
    if (c2 > 0.93) { n.state = 'handsup'; n.hut = 4; }
  }
  if (n.state === 'handsup') { n.hut -= dt; n.hu = Math.min(1, n.hu + dt * 3); st.handsUp = n.hu; n.speed = 0; tyaw = Math.atan2(dx, dz); n.yaw = lerpAng(n.yaw, tyaw, dt * 6); if (n.hut <= 0 || !(G.drawn && G.hasGun)) { n.state = 'flee'; n.scared = 7; n.hu = 0; } return; }
  n.hu = Math.max(0, n.hu - dt * 3);
  if (n.state === 'flee') {
    n.scared -= dt; const ax = -dx, az = -dz, l = Math.hypot(ax, az) || 1; n.flee = [ax / l, az / l]; tyaw = Math.atan2(n.flee[0], n.flee[1]); want = 4.4; if (n.scared <= 0) { n.state = 'walk'; pickDest(n); }
    if (n.flee[0] * 0 + dist > 80) n.state = 'walk';
  } else if (n.state === 'fight') {
    tyaw = Math.atan2(dx, dz); const armed = n.gun;
    if (armed) {
      if (dist > 14 || (dist > 7 && n.kind === 'cop')) want = n.kind === 'cop' ? 4.5 : 3.8; else want = 0;
      if (dist < 40) { st.aim = 1; if (n.cd <= 0 && !G.dead) { n.cd = n.kind === 'cop' ? 0.7 + Math.random() * 0.6 : 1.2 + Math.random(); npcShoot(n); } }
    } else { if (dist > 1.1) want = 3.6; else { want = 0; if (n.cd <= 0 && !G.dead) { n.cd = 1.0; n.punchT = 0.4; n.punchSide ^= 1; setTimeout(() => { if (!G.dead && Math.hypot(P.pos[0] - n.pos[0], P.pos[2] - n.pos[2]) < 1.8) hurtPlayer(6, n.pos); }, 180); sfx('punch', 0.6); } } }
    if (dist > 60 && n.kind !== 'cop') { n.state = 'walk'; pickDest(n); }
  } else { // walk
    if (n.t % 12 < 0.016 && Math.random() < 0.05) n.idle = 2.5;
    if (n.idle > 0) { n.idle -= dt; want = 0; st.phone = 1; } else {
      const ddx = n.dest[0] - n.pos[0], ddz = n.dest[1] - n.pos[2], dd = Math.hypot(ddx, ddz); if (dd < 1.2) pickDest(n); else { tyaw = Math.atan2(ddx, ddz); want = n.walkSpd; }
    }
  }
  if (n.punchT > 0) { n.punchT -= dt; st.punch = 1 - n.punchT / 0.4; st.punchSide = n.punchSide; want = 0; }
  if (n.stagger > 0) want *= 0.3; st.stagger = n.stagger;
  n.speed = lerp(n.speed, want, Math.min(1, dt * 6)); n.yaw = lerpAng(n.yaw, tyaw, Math.min(1, dt * 7));
  if (n.speed > 0.05) { n.pos[0] += Math.sin(n.yaw) * n.speed * dt; n.pos[2] += Math.cos(n.yaw) * n.speed * dt; pushOut(n.pos, 0.35); }
  // personal space with other npcs
  st.speed = n.speed;
}
function npcShoot(n) {
  const o = [n.pos[0] + Math.sin(n.yaw) * 0.5, 1.4, n.pos[2] + Math.cos(n.yaw) * 0.5]; const tg = [P.pos[0], 1.1, P.pos[2]]; const d = v3.sub(tg, o), len = v3.len(d);
  const acc = n.kind === 'cop' ? 0.82 : 0.65; const hit = Math.random() < acc * clamp(1.3 - len / 50, 0.3, 1);
  const end = hit ? tg : v3.add(tg, [(Math.random() - 0.5) * 3, (Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 3]);
  const tw = rayWorld(o, end); if (tw < 1) { const hp = v3.lerp(o, end, tw); sparks(hp, 6); } else if (hit) hurtPlayer(n.kind === 'cop' ? 7 : 6, n.pos);
  bullets.push({ a: o, b: v3.lerp(o, end, tw), t: 0, dur: Math.max(0.05, len / 140), col: [1, 0.6, 0.3] }); flashPos = o; flashT = 0.07; sfx('shot', clamp(1 - len / 90, 0.1, 0.6));
}
function hurtPlayer(d, from) { if (G.dead) return; if (G.armor > 0) { const a = Math.min(G.armor, d * 0.7); G.armor -= a; d -= a; } G.hp -= d; R.post.hurt = 0.7; shakeT = 0.2; sfx('hit', 0.6); if (G.hp <= 0) die(); }
function die() { G.dead = 0.001; G.hp = 0; $('wasted').style.display = 'flex'; const lost = Math.floor(G.cash * 0.1); G.cash -= lost; $('wsub').textContent = 'Mất $' + lost + ' · Đang hồi sinh…'; }
function respawn() { G.dead = 0; G.hp = 100; G.armor = 0; G.stars = 0; G.crime = 0; P.pos = [6, 0, 46]; for (const n of npcs) if (n.kind === 'cop') n.remove = true; $('wasted').style.display = 'none'; R.post.hurt = 0; if (G.hasGun) { /* keep */ } }

/* ================= player combat ================= */
let aimBlend = 0, drawBlend = 0, camRay = { o: [0, 0, 0], d: [0, 0, 1] };
function camForward() { const cp = Math.cos(cam.pitch); return [-Math.sin(cam.yaw) * cp, -Math.sin(cam.pitch), -Math.cos(cam.yaw) * cp]; }
function aimTarget() {
  const f = camForward(), o = cam.pos.slice(); const end = v3.add(o, v3.scale(f, 70)); let tw = rayWorld(o, end); let hitT = tw * 70, hitNpc = null, head = false;
  for (const n of npcs) {
    if (n.dead) continue; const px = n.pos[0] - o[0], pz = n.pos[2] - o[2]; const t = px * f[0] + pz * f[2]; const fl = Math.hypot(f[0], f[2]); if (t <= 0 || t / fl > hitT) continue;
    const tt = t / (fl * fl); const cx = o[0] + f[0] * tt - n.pos[0], cz = o[2] + f[2] * tt - n.pos[2], y = o[1] + f[1] * tt; if (Math.hypot(cx, cz) < 0.42 && y > 0 && y < 1.85) { if (tt < hitT) { hitT = tt; hitNpc = n; head = y > 1.5; } }
  }
  // aim assist (touch)
  if (!hitNpc && isTouch) { let bestA = 0.07; for (const n of npcs) { if (n.dead) continue; const d = v3.sub([n.pos[0], 1.2, n.pos[2]], o), l = v3.len(d); if (l > 45) continue; const c = v3.dot(v3.scale(d, 1 / l), f); if (1 - c < bestA && rayWorld(o, [n.pos[0], 1.2, n.pos[2]]) >= 1) { bestA = 1 - c; hitNpc = n; hitT = l; } } }
  return { hit: v3.add(o, v3.scale(f, hitT)), npc: hitNpc, head, dist: hitT, o };
}
function fire() {
  if (G.dead || !G.hasGun || !G.drawn || drawBlend < 0.85 || G.reloadT > 0 || G.fireT > 0) return;
  if (G.mag <= 0) { sfx('empty'); G.fireT = 0.25; if (G.reserve > 0) reload(); return; }
  G.mag--; G.fireT = 0.16; lucia.s.kick = 1; shakeT = 0.06; const tg = aimTarget(); const mz = lucia.muzzleWorld();
  let end = tg.hit; if (tg.npc) end = v3.add([tg.npc.pos[0], tg.head ? 1.62 : 1.2, tg.npc.pos[2]], [0, 0, 0]);
  const dir = v3.norm(v3.sub(end, mz)); const far = v3.add(mz, v3.scale(dir, Math.max(2, Math.min(80, tg.dist)))); const fin = tg.npc ? end : tg.hit;
  bullets.push({ a: mz, b: fin, t: 0, dur: Math.max(0.04, v3.dist(mz, fin) / 160), col: [1, 0.85, 0.4] });
  flashPos = mz; flashT = 0.06; sfx('shot', 1); hitMark = 0;
  for (let i = 0; i < 5; i++) addPart(mz, v3.add(v3.scale(dir, 4 + Math.random() * 5), [(Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2]), 0.08 + Math.random() * 0.06, 0.12 + Math.random() * 0.08, [1, 0.8, 0.4], 0, true);
  addPart(mz, [0, 0.4, 0], 0.07, 0.4, [1, 0.9, 0.6], 0, true);
  if (tg.npc) { hurtNpc(tg.npc, tg.head ? 100 : 34, P.pos, tg.head); hitMark = 0.15; sparks(end, 5, [1, 0.2, 0.4]); } else { sparks(fin, 8); }
  // casing
  const r = q.rot(q.axis([0, 1, 0], P.yaw), [1, 0.4, 0]); casings.push({ p: mz.slice(), v: v3.add(v3.scale(r, 2.5 + Math.random()), [0, 2.5 + Math.random(), 0]), rot: Math.random() * 6, spin: 15 + Math.random() * 15, t: 0 });
  alertNear(P.pos, 32); addCrime(0.5);
}
function reload() { if (G.reloadT > 0 || !G.hasGun || G.mag >= 12 || G.reserve <= 0) return; G.reloadT = 1.3; sfx('reload'); }
function punch() {
  if (G.punchT > 0 || G.dead) return; G.punchT = 0.42; lucia.s.punchSide ^= 1; sfx('punch', 0.6);
  setTimeout(() => {
    const f = [Math.sin(P.yaw), Math.cos(P.yaw)]; for (const n of npcs) { if (n.dead) continue; const dx = n.pos[0] - P.pos[0], dz = n.pos[2] - P.pos[2], d = Math.hypot(dx, dz); if (d < 1.7 && (dx * f[0] + dz * f[1]) / (d || 1) > 0.35) { hurtNpc(n, 22, P.pos); n.pos[0] += f[0] * 0.5; n.pos[2] += f[1] * 0.5; sparks([n.pos[0], 1.2, n.pos[2]], 6, [1, 0.3, 0.6]); sfx('hit', 0.8); hitMark = 0.15; } }
  }, 160);
}
function useAction() {
  if (G.dead) return;
  // gun pickup
  for (const p of pickups) if (p.type === 'gun' && Math.hypot(p.p[0] - P.pos[0], p.p[2] - P.pos[2]) < 2.4) { p.life = 0; G.hasGun = true; if (G.mag === 0 && G.reserve === 0) { G.mag = 12; G.reserve = 36; } sfx('pick'); popMsg('Đã nhặt USP 9mm', 1.5); toggleWeapon(true); return; }
  // rob
  if (G.hasGun) for (const n of npcs) if (n.state === 'handsup' && Math.hypot(n.pos[0] - P.pos[0], n.pos[2] - P.pos[2]) < 4.5) { n.state = 'flee'; n.scared = 9; n.hu = 0; for (let i = 0; i < 3; i++) spawnPickup('cash', [n.pos[0] + (Math.random() - 0.5) * 1.5, 0, n.pos[2] + (Math.random() - 0.5) * 1.5], Math.ceil(n.cash / 3)); sfx('cash'); addCrime(2); popMsg('CƯỚP THÀNH CÔNG!', 1.2); return; }
}
function dropGun() { if (!G.hasGun) return; G.hasGun = false; G.drawn = false; const f = [Math.sin(P.yaw), Math.cos(P.yaw)]; spawnPickup('gun', [P.pos[0] + f[0] * 1.3, 0, P.pos[2] + f[1] * 1.3], 0); const p = pickups[pickups.length - 1]; p.fall = 1.5; p.dropAmmo = [G.mag, G.reserve]; p.p[1] = 1.4; }
function toggleWeapon(force) { if (!G.hasGun) { popMsg('Chưa có súng — tìm vật phát sáng!', 1.5); return; } G.drawn = force === true ? true : !G.drawn; sfx('pick', 0.5); }

/* ================= input ================= */
const keys = {};
function bindBtn(id, down, up) { const e = $(id); e.addEventListener('pointerdown', (ev) => { ev.preventDefault(); e.setPointerCapture(ev.pointerId); e.classList.add('on'); audioInit(); down && down(); }); const u = (ev) => { e.classList.remove('on'); up && up(); }; e.addEventListener('pointerup', u); e.addEventListener('pointercancel', u); }
function setupInput() {
  bindBtn('bFire', () => (inp.fire = true), () => (inp.fire = false)); bindBtn('bAim', () => (inp.aim = !inp.aim)); bindBtn('bJump', () => (inp.jump = true), () => (inp.jump = false));
  bindBtn('bUse', () => useAction()); bindBtn('bWeap', () => toggleWeapon()); bindBtn('bRel', () => reload()); bindBtn('bRun', () => (inp.sprint = !inp.sprint));
  bindBtn('bMap', () => { $('bigmap').style.display = 'flex'; }); $('mapClose').addEventListener('pointerdown', () => ($('bigmap').style.display = 'none'));
  bindBtn('bGfx', () => { gfx = (gfx + 1) % GFX.length; localStorage.setItem('gfx', gfx); applyGfx(); popMsg('Đồ họa: ' + GFX[gfx].n, 1); });
  bindBtn('bMute', () => { A.on = !A.on; $('bMute').textContent = A.on ? '♪' : '✕'; });
  // joystick
  const joy = $('joy'), stick = $('stick'); let jid = null, jc = [0, 0];
  const jm = (e) => { const r = joy.getBoundingClientRect(); let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2); const l = Math.hypot(dx, dy), m = r.width / 2; if (l > m) { dx *= m / l; dy *= m / l; } stick.style.transform = `translate(${dx}px,${dy}px)`; inp.mx = dx / m; inp.mz = dy / m; };
  joy.addEventListener('pointerdown', (e) => { jid = e.pointerId; joy.setPointerCapture(jid); audioInit(); jm(e); }); joy.addEventListener('pointermove', (e) => { if (e.pointerId === jid) jm(e); });
  const jend = (e) => { if (e.pointerId === jid) { jid = null; stick.style.transform = ''; inp.mx = inp.mz = 0; } }; joy.addEventListener('pointerup', jend); joy.addEventListener('pointercancel', jend);
  // look
  const look = $('look'); let lid = null, lp = [0, 0];
  look.addEventListener('pointerdown', (e) => { lid = e.pointerId; look.setPointerCapture(lid); lp = [e.clientX, e.clientY]; audioInit(); });
  look.addEventListener('pointermove', (e) => { if (e.pointerId !== lid) return; cam.yaw -= (e.clientX - lp[0]) * 0.006; cam.pitch = clamp(cam.pitch + (e.clientY - lp[1]) * 0.005, -0.7, 1.1); lp = [e.clientX, e.clientY]; });
  const lend = (e) => { if (e.pointerId === lid) lid = null; }; look.addEventListener('pointerup', lend); look.addEventListener('pointercancel', lend);
  // desktop
  addEventListener('keydown', (e) => { keys[e.code] = true; audioInit(); if (e.code === 'KeyE' || e.code === 'KeyF') useAction(); if (e.code === 'KeyQ') toggleWeapon(); if (e.code === 'KeyR') reload(); if (e.code === 'KeyG') dropGun(); if (e.code === 'KeyM') { const b = $('bigmap'); b.style.display = b.style.display === 'flex' ? 'none' : 'flex'; } if (e.code === 'Space') inp.jump = true; });
  addEventListener('keyup', (e) => { keys[e.code] = false; if (e.code === 'Space') inp.jump = false; });
  canvas.addEventListener('mousedown', (e) => { audioInit(); if (!isTouch && document.pointerLockElement !== canvas) canvas.requestPointerLock && canvas.requestPointerLock(); if (e.button === 0) inp.fire = true; if (e.button === 2) inp.aim = true; });
  addEventListener('mouseup', (e) => { if (e.button === 0) inp.fire = false; if (e.button === 2) inp.aim = false; });
  addEventListener('contextmenu', (e) => e.preventDefault());
  addEventListener('mousemove', (e) => { if (document.pointerLockElement === canvas) { cam.yaw -= e.movementX * 0.0025; cam.pitch = clamp(cam.pitch + e.movementY * 0.002, -0.7, 1.1); } });
}

/* ================= HUD ================= */
const mini = $('mini').getContext('2d'), big = $('bm').getContext('2d');
function drawMap(ctx, size, scale, centered, rotate) {
  ctx.save(); ctx.clearRect(0, 0, size, size); ctx.fillStyle = '#0b0618'; ctx.fillRect(0, 0, size, size); ctx.translate(size / 2, size / 2);
  const px = centered ? P.pos[0] : 0, pz = centered ? P.pos[2] : 0; if (rotate) ctx.rotate(cam.yaw + Math.PI);
  ctx.scale(scale, scale); ctx.translate(-px, -pz);
  ctx.fillStyle = '#1d1636'; for (const b of W.blocks) ctx.fillRect(b.cx - 33, b.cz - 33, 66, 66);
  ctx.fillStyle = '#2f2556'; for (const b of W.blocks) ctx.fillRect(b.cx - 29, b.cz - 29, 58, 58);
  const dot = (x, z, c, r) => { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, z, r / scale, 0, 7); ctx.fill(); };
  for (const p of pickups) if (p.type === 'gun') dot(p.p[0], p.p[2], '#ffd23c', 5); else if (p.type === 'cash') dot(p.p[0], p.p[2], '#5dff9a', 2.5);
  for (const n of npcs) if (!n.dead && (centered ? Math.hypot(n.pos[0] - px, n.pos[2] - pz) < 120 : true)) dot(n.pos[0], n.pos[2], n.kind === 'cop' ? '#3fa0ff' : n.state === 'fight' ? '#ff2d55' : '#ffffff66', n.kind === 'cop' ? 4 : 2.5);
  ctx.save(); ctx.translate(P.pos[0], P.pos[2]); ctx.rotate(-P.yaw + Math.PI); ctx.fillStyle = '#ff2d87'; ctx.beginPath(); ctx.moveTo(0, -7 / scale); ctx.lineTo(5 / scale, 5 / scale); ctx.lineTo(-5 / scale, 5 / scale); ctx.fill(); ctx.restore(); ctx.restore();
}
function updateHud(dt) {
  $('hpb').style.width = Math.max(0, G.hp) + '%'; $('arb').style.width = G.armor + '%'; $('cash').textContent = '$' + G.cash.toLocaleString('en-US'); $('stars').textContent = G.stars ? '★'.repeat(G.stars) + '☆'.repeat(5 - G.stars) : '';
  $('wname').textContent = G.hasGun ? (G.drawn ? 'USP 9mm' : 'USP (cất)') : 'TAY KHÔNG'; $('ammo').textContent = G.hasGun ? G.mag + ' / ' + G.reserve : '—';
  $('cross').style.opacity = G.drawn && aimBlend > 0.4 ? 1 : 0; $('cross').style.borderColor = hitMark > 0 ? '#ff2d55' : '#ffffffcc';
  if (G.msg > 0) { G.msg -= dt; if (G.msg <= 0) $('msg').style.display = 'none'; }
  // prompt
  let pr = ''; for (const p of pickups) if (p.type === 'gun' && Math.hypot(p.p[0] - P.pos[0], p.p[2] - P.pos[2]) < 2.4) pr = isTouch ? 'Chạm ✋ để nhặt súng' : 'Nhấn E nhặt súng';
  if (!pr && G.hasGun) for (const n of npcs) if (n.state === 'handsup' && Math.hypot(n.pos[0] - P.pos[0], n.pos[2] - P.pos[2]) < 4.5) pr = isTouch ? 'Chạm ✋ để CƯỚP' : 'Nhấn E để CƯỚP';
  const el = $('prompt'); el.style.display = pr ? 'block' : 'none'; el.textContent = pr;
  drawMap(mini, 256, 1.0, true, true);
  if ($('bigmap').style.display === 'flex') drawMap(big, 800, 800 / (HALF * 2.1), false, false);
}

/* ================= main update ================= */
function update(dt) {
  G.t += dt; const L = lucia, s = L.s;
  if (G.dead) { G.dead += dt; s.dead = Math.min(1, G.dead * 1.5); if (G.dead > 4) respawn(); }
  // weapon blend
  drawBlend = lerp(drawBlend, G.drawn && G.hasGun ? 1 : 0, Math.min(1, dt * 6)); if (!G.hasGun) drawBlend = 0;
  const wantAim = (G.drawn && G.hasGun) && (inp.aim || inp.fire); aimBlend = lerp(aimBlend, wantAim ? 1 : 0, Math.min(1, dt * 8));
  G.fireT = Math.max(0, G.fireT - dt); G.punchT = Math.max(0, G.punchT - dt);
  if (G.reloadT > 0) { G.reloadT -= dt; if (G.reloadT <= 0) { const n = Math.min(12 - G.mag, G.reserve); G.mag += n; G.reserve -= n; } }
  // movement
  let mx = inp.mx, mz = inp.mz; if (keys.KeyA) mx -= 1; if (keys.KeyD) mx += 1; if (keys.KeyW) mz -= 1; if (keys.KeyS) mz += 1; const ml = Math.hypot(mx, mz); if (ml > 1) { mx /= ml; mz /= ml; }
  if (G.dead) { mx = mz = 0; }
  const run = (keys.ShiftLeft || inp.sprint) && !wantAim; const maxS = (run ? 6.2 : ml > 0.55 ? 3.6 : 1.8) * (wantAim ? 0.6 : 1) * (G.reloadT > 0 ? 0.7 : 1);
  const sp = ml > 0.05 ? maxS * Math.min(1, ml / 0.55) * (ml > 0.55 || run ? 1 : ml / 0.55) : 0;
  // camera-relative
  const cy = cam.yaw, fwd = [-Math.sin(cy), -Math.cos(cy)], rgt = [Math.cos(cy), -Math.sin(cy)];
  const dir = [fwd[0] * -mz + rgt[0] * mx, fwd[1] * -mz + rgt[1] * mx]; const dl = Math.hypot(dir[0], dir[1]);
  const tvx = dl > 0.01 ? dir[0] / dl * sp : 0, tvz = dl > 0.01 ? dir[1] / dl * sp : 0;
  P.vel[0] = lerp(P.vel[0], tvx, Math.min(1, dt * 10)); P.vel[2] = lerp(P.vel[2], tvz, Math.min(1, dt * 10));
  const speed = Math.hypot(P.vel[0], P.vel[2]);
  P.pos[0] += P.vel[0] * dt; P.pos[2] += P.vel[2] * dt;
  if (inp.jump && G.onGround && !G.dead) { G.jumpV = 5.2; G.onGround = false; } G.jumpV -= 14 * dt; P.pos[1] += G.jumpV * dt; if (P.pos[1] <= 0) { P.pos[1] = 0; G.jumpV = 0; G.onGround = true; }
  pushOut(P.pos, 0.38);
  // facing
  const aimYaw = cam.yaw + Math.PI; if (wantAim || G.punchT > 0.0 && false) P.yaw = lerpAng(P.yaw, aimYaw, Math.min(1, dt * 14)); else if (speed > 0.3) P.yaw = lerpAng(P.yaw, Math.atan2(P.vel[0], P.vel[2]), Math.min(1, dt * 10));
  // fire / punch
  if (inp.fire && !G.dead) { if (G.hasGun && G.drawn) fire(); else if (G.punchT <= 0) { punch(); } }
  // Lucia pose
  s.speed = speed; s.fwd = 1; s.aim = aimBlend; s.armed = drawBlend > 0.05 ? 1 : 0; s.draw = drawBlend; s.air = G.onGround ? 0 : 1; s.kick = Math.max(0, s.kick - dt * 8);
  s.punch = G.punchT > 0 ? 1 - G.punchT / 0.42 : 0; s.reload = G.reloadT > 0 ? 1 - G.reloadT / 1.3 : 0; s.pitch = -(cam.pitch - 0.1); s.fightStance = false; s.crouch = 0;
  const af = camForward(); const aimDir = wantAim || drawBlend > 0.5 ? v3.norm([af[0], af[1] * 0.9 + 0.0, af[2]]) : [Math.sin(P.yaw), 0, Math.cos(P.yaw)];
  const ad2 = wantAim ? v3.scale(aimDir, -1).map((v, i) => (i === 1 ? -v : v)) : null; // camera forward is -dir convention fix
  L.update(dt, P.pos, P.yaw, wantAim ? af : (drawBlend > 0.5 ? [Math.sin(P.yaw), -0.15, Math.cos(P.yaw)] : [Math.sin(P.yaw), 0, Math.cos(P.yaw)]));
  // wanted decay
  G.crimeT += dt; if (G.crimeT > 25 && G.crime > 0) { G.crime = Math.max(0, G.crime - dt * 0.4); const st = Math.floor(G.crime / 3); if (st < G.stars) { G.stars = st; if (!st) popMsg('Không còn bị truy nã', 2); } }
  // npcs
  for (const n of npcs) { const d = Math.hypot(n.pos[0] - P.pos[0], n.pos[2] - P.pos[2]); n.far = d > 140; if (!n.far) { updateNpc(n, dt); if (!n.dead || n.state === 'dead') {} } }
  for (let i = npcs.length - 1; i >= 0; i--) { const n = npcs[i]; if (n.remove || (n.far && n.kind !== 'cop' && Math.random() < 0.02) || (n.kind === 'cop' && G.stars === 0 && Math.hypot(n.pos[0] - P.pos[0], n.pos[2] - P.pos[2]) > 70)) npcs.splice(i, 1); }
  const civ = npcs.filter((n) => n.kind === 'civ' && !n.dead).length, thug = npcs.filter((n) => n.kind === 'thug' && !n.dead).length, cops = npcs.filter((n) => n.kind === 'cop' && !n.dead).length;
  if (civ < 26) spawnNpc('civ'); if (thug < 3 && Math.random() < 0.02) spawnNpc('thug'); if (G.stars > 0 && cops < 1 + G.stars * 2 && Math.random() < 0.05) spawnNpc('cop', true);
  // pickups
  for (let i = pickups.length - 1; i >= 0; i--) {
    const p = pickups[i]; p.t += dt; p.life -= dt; if (p.fall) { p.fall -= dt * 0; p.p[1] = Math.max(0.5, p.p[1] - dt * 3); if (p.p[1] <= 0.5) p.fall = 0; }
    const d = Math.hypot(p.p[0] - P.pos[0], p.p[2] - P.pos[2]);
    if (p.type !== 'gun' && d < 1.6 && !G.dead) { if (p.type === 'cash') { G.cash += p.val; sfx('cash', 0.6); } else { G.reserve += p.val; sfx('pick'); popMsg('+' + p.val + ' đạn', 1); } p.life = 0; }
    if (p.type === 'gun' && p.dropAmmo === undefined && false) { }
    if (p.life <= 0) { if (p.type === 'gun' && p.taken !== false && d < 2.4 && p.dropAmmo) { G.mag = p.dropAmmo[0]; G.reserve = p.dropAmmo[1]; } pickups.splice(i, 1); }
  }
  // bullets, casings, particles
  for (let i = bullets.length - 1; i >= 0; i--) { const b = bullets[i]; b.t += dt; if (b.t >= b.dur) bullets.splice(i, 1); }
  for (let i = casings.length - 1; i >= 0; i--) { const c = casings[i]; c.t += dt; c.v[1] -= 16 * dt; c.p = v3.add(c.p, v3.scale(c.v, dt)); c.rot += c.spin * dt; if (c.p[1] < 0.03) { c.p[1] = 0.03; if (Math.abs(c.v[1]) > 1.2) sfx('casing', 0.5); c.v = [c.v[0] * 0.4, -c.v[1] * 0.35, c.v[2] * 0.4]; c.spin *= 0.4; } if (c.t > 6) casings.splice(i, 1); }
  for (let i = parts.length - 1; i >= 0; i--) { const p = parts[i]; p.life -= dt; if (p.life <= 0) { parts.splice(i, 1); continue; } p.v[1] += p.grav * dt; p.p[0] += p.v[0] * dt; p.p[1] += p.v[1] * dt; p.p[2] += p.v[2] * dt; p.size += p.grow * dt; }
  flashT = Math.max(0, flashT - dt); hitMark = Math.max(0, hitMark - dt); R.post.hurt = Math.max(G.dead ? 0.8 : 0, R.post.hurt - dt * 0.8); shakeT = Math.max(0, shakeT - dt);
  // regen armor none; camera
  updateCamera(dt, wantAim);
  if (G.hp < 100 && !G.dead && G.t % 1 < dt) G.hp = Math.min(100, G.hp + 0.4);
}
function updateCamera(dt, aiming) {
  const dist = lerp(cam.dist, 1.9, aimBlend), side = lerp(0.35, 0.75, aimBlend), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  const head = [P.pos[0], P.pos[1] + 1.45, P.pos[2]]; const f = [-Math.sin(cam.yaw), -Math.cos(cam.yaw)], r = [Math.cos(cam.yaw), -Math.sin(cam.yaw)];
  const tgt = [head[0] + r[0] * side, head[1] + 0.05, head[2] + r[1] * side];
  let want = [tgt[0] - f[0] * cp * dist * -1 * -1, tgt[1] + sp * dist, tgt[2] - f[1] * cp * dist * -1 * -1];
  // camera sits behind the player: opposite to forward => +sin, +cos
  want = [tgt[0] + Math.sin(cam.yaw) * cp * dist, tgt[1] + sp * dist, tgt[2] + Math.cos(cam.yaw) * cp * dist]; want[1] = Math.max(0.35, want[1]);
  const tw = rayWorld(tgt, want); if (tw < 1) { const k = Math.max(0.12, tw - 0.08); want = v3.lerp(tgt, want, k); }
  cam.pos = v3.lerp(cam.pos, want, Math.min(1, dt * 18)); if (G.t < 0.1) cam.pos = want;
  const sh = shakeT > 0 ? shakeT * 0.3 : 0; cam.pos = [cam.pos[0] + (Math.random() - 0.5) * sh, cam.pos[1] + (Math.random() - 0.5) * sh, cam.pos[2] + (Math.random() - 0.5) * sh];
  const lookAt = [tgt[0] - Math.sin(cam.yaw) * cp * 6, tgt[1] - sp * 6, tgt[2] - Math.cos(cam.yaw) * cp * 6];
  cam.target = tgt.map((v, i) => v) ; cam.target = [tgt[0] - Math.sin(cam.yaw) * cp * 5, tgt[1] - sp * 5, tgt[2] - Math.cos(cam.yaw) * cp * 5];
  cam.fovCur = lerp(0.95, 0.72, aimBlend);
}

/* ================= render ================= */
const tmpM = m4.create(); const I4 = m4.create();
function render(dt) {
  // lights: nearest static + dynamic
  const lights = []; const px = P.pos[0], pz = P.pos[2];
  const cand = []; for (const l of W.lamps) { const d = (l.x - cam.pos[0]) ** 2 + (l.z - cam.pos[2]) ** 2; if (d < 2500) cand.push([d, l]); }
  cand.sort((a, b) => a[0] - b[0]);
  if (flashT > 0) lights.push({ x: flashPos[0], y: flashPos[1], z: flashPos[2], r: 14, cr: 3, cg: 2.2, cb: 1.2 });
  let sirenSide = Math.floor(G.t * 4) % 2;
  for (const n of npcs) if (n.kind === 'cop' && !n.dead && lights.length < 3) { const c = sirenSide ? [2.4, 0.1, 0.1] : [0.1, 0.3, 2.6]; lights.push({ x: n.pos[0], y: 2.5, z: n.pos[2], r: 16, cr: c[0], cg: c[1], cb: c[2] }); }
  for (const p of pickups) if (p.type === 'gun' && lights.length < 4) lights.push({ x: p.p[0], y: 1.6, z: p.p[2], r: 9, cr: 1.4, cg: 1.1, cb: 0.2 });
  for (let i = 0; i < cand.length && lights.length < 12; i++) { const l = cand[i][1]; lights.push({ x: l.x, y: l.y, z: l.z, r: l.r, cr: l.c[0], cg: l.c[1], cb: l.c[2] }); }
  R.lights = lights;
  R.begin({ pos: cam.pos, target: cam.target, fov: cam.fovCur || 0.95, near: 0.1, far: 700 }, dt);
  // ground
  R.drawMesh(groundMesh, I4, {});
  // chunks
  for (const ch of W.chunks) { if (!R.visible(ch.min, ch.max)) continue; const dx = Math.abs((ch.min[0] + ch.max[0]) / 2 - cam.pos[0]), dz = Math.abs((ch.min[2] + ch.max[2]) / 2 - cam.pos[2]); if (dx > 330 || dz > 330) continue; for (const p of ch.prims) R.drawPrim(p, p.mat, I4, {}); }
  for (const pr of W.props) R.drawPrim(pr.prim, pr.mat, pr.model, { inst: pr.inst });
  // japan landmark
  for (const j of W.japan.list) { const m = m4.fromTRS(tmpM, [j.x - 2.5 * j.s, 0.0, j.z - 1.7 * j.s], q.axis([0, 1, 0], j.yaw), [j.s, j.s, j.s]); W.japan.inst.draw(R, m); }
  // characters
  lucia.draw(R); if (G.hasGun) { const gm = lucia.gunWorld(m4.create()); gunInst.draw(R, gm); }
  for (const n of npcs) { if (n.far) continue; const d = Math.hypot(n.pos[0] - cam.pos[0], n.pos[2] - cam.pos[2]); if (d > 120) continue; n.rig.pose(dt, n.pos, n.yaw, n.st); n.rig.draw(R); if (n.gun) drawNpcGun(n); }
  // pickups
  casingSet.count = 0; cashSet.count = 0; ammoSet.count = 0;
  for (const c of casings) R.pushInst(casingSet, m4.fromTRS(tmpM, c.p, q.euler(c.rot, c.rot * 0.7, 0), [1, 1, 1]), [1, 0.8, 0.3, 1]);
  for (const p of pickups) {
    if (p.type === 'gun') { const m = m4.fromTRS(tmpM, [p.p[0], p.p[1] + Math.sin(p.t * 2) * 0.08, p.p[2]], q.axis([0, 1, 0], p.t * 1.5), [GUN_SCALE * 1.6, GUN_SCALE * 1.6, GUN_SCALE * 1.6]); const t2 = m4.create(); t2[12] = -GUN_GRIP[0] + 0; t2[13] = -20; t2[14] = 0; gunInst.draw(R, m4.mul(m4.create(), m, t2)); for (let k = 0; k < 2; k++) addPartFrame([p.p[0] + (Math.random() - 0.5) * 0.4, 0.2 + Math.random() * 1.8, p.p[2] + (Math.random() - 0.5) * 0.4], [1, 0.8, 0.2, 0.7], 0.12); addPartFrame([p.p[0], 0.6, p.p[2]], [1, 0.75, 0.2, 0.5], 1.4); }
    else if (p.type === 'cash') R.pushInst(cashSet, m4.fromTRS(tmpM, [p.p[0], 0.45 + Math.sin(p.t * 3) * 0.08, p.p[2]], q.axis([0, 1, 0], p.t * 2), [1, 1, 1]), [0.3, 1, 0.5, 1]);
    else R.pushInst(ammoSet, m4.fromTRS(tmpM, [p.p[0], 0.4 + Math.sin(p.t * 3) * 0.08, p.p[2]], q.axis([0, 1, 0], p.t * 2), [1, 1, 1]), [1, 0.55, 0.1, 1]);
  }
  R.drawInstSet(casingSet, {}); R.drawInstSet(cashSet, {}); R.drawInstSet(ammoSet, {});
  // glow sprites for lamps (additive) + particles
  let n = 0; const D = R.partData; const gl2 = (x, y, z, s, c, a) => { if (n >= R.partCap - 2) return; const o = n * 8; D[o] = x; D[o + 1] = y; D[o + 2] = z; D[o + 3] = s; D[o + 4] = c[0]; D[o + 5] = c[1]; D[o + 6] = c[2]; D[o + 7] = a; n++; };
  for (const l of W.lamps) { const d2 = (l.x - cam.pos[0]) ** 2 + (l.z - cam.pos[2]) ** 2; if (d2 > 14000) continue; const bl = l.beacon ? (Math.sin(G.t * 3 + l.x) > 0.3 ? 1 : 0.2) : 1; gl2(l.x, l.y, l.z, l.lamp ? 0.55 : 0.9, l.c, 0.32 * bl); }
  for (const b of bullets) { const t = b.t / b.dur, p = v3.lerp(b.a, b.b, t); for (let k = 0; k < 4; k++) { const tp = v3.lerp(b.a, b.b, Math.max(0, t - k * 0.04)); gl2(tp[0], tp[1], tp[2], 0.07 - k * 0.012, b.col, 1.2 - k * 0.2); } }
  if (flashT > 0) gl2(flashPos[0], flashPos[1], flashPos[2], 0.9, [1, 0.8, 0.45], 1.5);
  for (const p of parts) { if (!p.add) continue; const a = p.life / p.max; gl2(p.p[0], p.p[1], p.p[2], p.size, p.col, a); }
  for (const e of frameParts) gl2(e.p[0], e.p[1], e.p[2], e.s, e.c, e.c[3]); frameParts.length = 0;
  R.drawParticles(D, n, true, 2.2);
  R.end(dt);
}
const frameParts = []; function addPartFrame(p, c, s) { frameParts.push({ p, c, s }); }
function drawNpcGun(n) {
  const w = n.rig.world[4 + 1 - 1 + 1 - 1 + 2]; // faR joint index 6
  const m = n.rig.world[6]; const sc = GUN_SCALE; const base = m4.create(); const T = m4.fromTRS(m4.create(), [0, -0.27, 0.03], q.fromMat3([0, 1, 0], [0, 0, 1], [1, 0, 0]), [sc, sc, sc]); const t2 = m4.create(); t2[12] = -GUN_GRIP[0]; t2[13] = -GUN_GRIP[1]; t2[14] = -GUN_GRIP[2];
  m4.mul(base, m, m4.mul(m4.create(), T, t2)); gunInst.draw(R, base);
}

/* ================= boot ================= */
async function boot() {
  setProg(0.02, 'Khởi tạo đồ họa…'); applyGfx();
  const files = [['lucia', 'assets/lucia.glb', O.luciaOverrides, 10.4], ['usp', 'assets/usp.glb', O.uspOverrides, 0.3], ['japan', 'assets/japan_scene.glb', O.japanOverrides, 23.8], ['manhole', 'assets/manhole.glb', O.manholeOverrides, 1.6], ['signs', 'assets/signboards.glb', O.boardOverrides, 2.1]];
  const total = files.reduce((a, f) => a + f[3], 0); let done = 0; assets = {}; const names = { lucia: 'nhân vật Lucia', usp: 'súng USP 9mm', japan: 'khu phố Tokyo cyberpunk', manhole: 'nắp cống', signs: 'biển hiệu neon' };
  for (const [k, url, ov, mb] of files) {
    setProg(done / total * 0.8 + 0.04, 'Đang tải ' + names[k] + '…');
    assets[k] = await loadModel(R, url, (got, tot) => setProg((done + (tot ? got / tot * mb : mb * 0.5)) / total * 0.8 + 0.04), ov); done += mb;
  }
  setProg(0.86, 'Dựng thành phố ban đêm…'); await new Promise((r) => setTimeout(r, 30));
  buildWorld(assets);
  setProg(0.94, 'Tạo nhân vật & NPC…'); await new Promise((r) => setTimeout(r, 30));
  lucia = new Lucia(R, assets.lucia); gunInst = assets.usp.instance(); gunInst.update(m4.create());
  const orng = rng(77); npcMeshes = { civ: [], thug: [], cop: [] }; for (let i = 0; i < 18; i++) npcMeshes.civ.push(buildNpcMesh(R, npcOutfit(orng, 'civ'))); for (let i = 0; i < 3; i++) npcMeshes.thug.push(buildNpcMesh(R, npcOutfit(orng, 'thug'))); for (let i = 0; i < 3; i++) npcMeshes.cop.push(buildNpcMesh(R, npcOutfit(orng, 'cop')));
  const box = (hx, hy, hz) => { const b = new MeshBuilder(); b.box(0, 0, 0, hx, hy, hz, 0, [1, 1, 1, 1]); return b.build(R, { ...R.defaultMat, glow: 0.9, spec: 0.6, shin: 30, tint: [1, 1, 1] }); };
  casingSet = R.makeInstSet(box(0.012, 0.012, 0.03), 64); cashSet = R.makeInstSet(box(0.22, 0.04, 0.12), 64); ammoSet = R.makeInstSet(box(0.16, 0.1, 0.1), 32);
  for (let i = 0; i < 20; i++) spawnNpc('civ'); for (let i = 0; i < 2; i++) spawnNpc('thug');
  spawnPickup('gun', [10, 0, 43], 0); pickups[0].life = 1e9;
  setupInput(); setProg(1, 'Sẵn sàng'); $('pct').textContent = '100%';
  $('start').style.display = 'block';
  const go = () => { $('loading').style.display = 'none'; $('hud').style.display = 'block'; G.state = 'play'; audioInit(); if (document.documentElement.requestFullscreen && isTouch) document.documentElement.requestFullscreen().catch(() => { }); if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => { }); popMsg('Tìm vật phát sáng vàng để nhặt súng!', 4); };
  $('start').onclick = go; window.__go = go; window.__G = () => ({ G, P, npcs, pickups, cam, lucia, inp, keys });
  let last = performance.now();
  const loop = (now) => { const dt = Math.min(0.05, (now - last) / 1000); last = now; if (G.state === 'play') { update(dt); updateHud(dt); } else { cam.pos = [P.pos[0] + 3, 2, P.pos[2] + 6]; updateCamera(0.016, false); lucia.update(dt, P.pos, P.yaw, [0, 0, 1]); } render(dt); requestAnimationFrame(loop); };
  requestAnimationFrame(loop); window.__ready = true;
}
boot().catch((e) => { console.error(e); setProg(0, 'Lỗi: ' + e.message); document.title = 'ERR ' + e.message; });
