// Characters: Lucia (GLB skinned, procedural animation) + procedural NPCs (cheap skinned humanoids) + weapon attach
import { m4, q, v3, clamp, lerp, smooth, DEG, rng } from './math.js';
import { MeshBuilder } from './gl.js';

export const LUCIA_SCALE = 1.72 / 8.9;      // model units -> metres
export const GUN_SCALE = 0.205 / 73.7;      // USP model units -> metres
export const GUN_GRIP = [23, 22, -1.5];     // grip pivot inside USP model space
export const GUN_MUZZLE = [-37, 38, -2];    // muzzle position inside USP model space (muzzle points -X)

const B = {
  hips: 'root hips_239', pelvis: 'pelvis_33', spL: 'spine lower_238', spU: 'spine upper_237', chL: 'chest lower_236', chU: 'chest upper_233',
  neck: 'head neck lower_232', head: 'head neck upper_230',
  clavL: 'arm left shoulder 1_60', uaL: 'arm left shoulder 2_57', elL: 'arm left elbow_55', wrL: 'arm left wrist_53',
  clavR: 'arm right shoulder 1_94', uaR: 'arm right shoulder 2_91', elR: 'arm right elbow_89', wrR: 'arm right wrist_87',
  thL: 'leg left thigh_16', knL: 'leg left knee_14', anL: 'leg left ankle_13',
  thR: 'leg right thigh_32', knR: 'leg right knee_30', anR: 'leg right ankle_29',
};
const rx = (a) => q.axis([1, 0, 0], a), ry = (a) => q.axis([0, 1, 0], a), rz = (a) => q.axis([0, 0, 1], a);
const qm = q.mul;

/* ------------------------------------------------------------------ Lucia */
export class Lucia {
  constructor(R, model) {
    this.R = R; this.model = model; this.inst = model.instance();
    this.idx = {}; for (const k in B) { const i = model.byName.get(B[k]); if (i === undefined) throw new Error('bone ' + B[k]); this.idx[k] = i; }
    const bw = model.bindWorld; this.W0 = {}; this.P0 = {}; this.L0 = {};
    for (const k in this.idx) { const m = bw[this.idx[k]]; this.W0[k] = m4.toQuat(m); this.P0[k] = [m[12], m[13], m[14]]; }
    // arm segment lengths in model units
    this.armLen = { L: [v3.dist(this.P0.uaL, this.P0.elL), v3.dist(this.P0.elL, this.P0.wrL)], R: [v3.dist(this.P0.uaR, this.P0.elR), v3.dist(this.P0.elR, this.P0.wrR)] };
    this.bindDir = {
      uaL: v3.norm(v3.sub(this.P0.elL, this.P0.uaL)), elL: v3.norm(v3.sub(this.P0.wrL, this.P0.elL)),
      uaR: v3.norm(v3.sub(this.P0.elR, this.P0.uaR)), elR: v3.norm(v3.sub(this.P0.wrR, this.P0.elR)),
    };
    this.parentOf = {}; for (const k in this.idx) this.parentOf[k] = model.parent[this.idx[k]];
    this.root = m4.create(); this.I = m4.create(); this.rootS = [LUCIA_SCALE, LUCIA_SCALE, LUCIA_SCALE];
    // hide embedded weapon meshes / eyelash alpha etc. handled in material overrides
    this.phase = 0; this.ik = { L: [0, 0, 0], R: [0, 0, 0] }; this.handR = [0, 0, 0]; this.aimDirLocal = [0, 0, 1];
    this.s = { speed: 0, side: 0, fwd: 1, aim: 0, armed: 0, draw: 0, punch: 0, punchSide: 0, kick: 0, jump: 0, dead: 0, crouch: 0, reload: 0, pitch: 0, handsUp: 0, air: 0 };
    this.t = 0;
  }
  // character-space delta on a bone (see derivation in notes): local = L0 * (W0^-1 * d * W0)
  delta(k, d) { const i = this.idx[k], inst = this.inst; inst.r[i] = qm(inst.bind.r[i], qm(q.inv(this.W0[k]), qm(d, this.W0[k]))); }
  moveBone(k, dm) { const i = this.idx[k], p = this.model.parent[i]; const pq = p >= 0 ? m4.toQuat(this.model.bindWorld[p]) : [0, 0, 0, 1]; const l = q.rot(q.inv(pq), dm); const b = this.inst.bind.t[i]; this.inst.t[i] = [b[0] + l[0], b[1] + l[1], b[2] + l[2]]; }
  worldPos(i) { const m = this.inst.world[i]; return [m[12], m[13], m[14]]; }

  // two-bone IK, in model space. side 'L'|'R'
  solveArm(side, target, pole) {
    const inst = this.inst, I = this.idx, [l1, l2] = this.armLen[side];
    const ua = I['ua' + side], el = I['el' + side];
    const S = this.worldPos(ua);
    let dir = v3.sub(target, S), d = v3.len(dir); const maxd = (l1 + l2) * 0.998; if (d > maxd) { dir = v3.scale(dir, maxd / d); d = maxd; }
    d = Math.max(d, Math.abs(l1 - l2) + 0.05);
    const u = v3.norm(dir); const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(l1 * l1 - a * a, 0));
    let pv = v3.sub(pole, v3.scale(u, v3.dot(pole, u))); pv = v3.norm(pv);
    const E = v3.add(v3.add(S, v3.scale(u, a)), v3.scale(pv, h)); const T = v3.add(S, v3.scale(u, d));
    this.aimBone('ua' + side, v3.norm(v3.sub(E, S)), this.bindDir['ua' + side]);
    // refresh world for the chain below ua
    this.updateChain(ua);
    this.aimBone('el' + side, v3.norm(v3.sub(T, E)), this.bindDir['el' + side], true);
    this.ik[side] = T;
  }
  worldQ(i) { return m4.toQuat(this.inst.world[i]); }
  aimBone(k, desired, bindDir, usedCurrent) {
    const inst = this.inst, i = this.idx[k], p = this.model.parent[i];
    const Wcur = this.worldQ(i), W0 = this.W0[k];
    // current direction of the bone = (Wcur * W0^-1) * bindDir
    const curDir = q.rot(qm(Wcur, q.inv(W0)), bindDir);
    const dq = q.fromTo(curDir, desired); const Wnew = qm(dq, Wcur);
    const Wp = this.worldQ(p);
    inst.r[i] = q.norm(qm(q.inv(Wp), Wnew));
  }
  updateChain(i) { // recompute worlds for subtree of i (arm chain is small)
    const inst = this.inst, M = this.model, g = M.gltf.nodes; const stack = [i];
    while (stack.length) { const n = stack.pop(); m4.fromTRS(inst.local[n], inst.t[n], inst.r[n], inst.s[n]); m4.mul(inst.world[n], inst.world[M.parent[n]], inst.local[n]); (g[n].children || []).forEach((c) => stack.push(c)); }
  }

  // position/orientation of the gun in model space for the given aim state
  gunMatrixModel(out) {
    const s = this.s, W = this.inst.world, I = this.idx;
    // in-hand pose
    let handPos = this.ik.R, dir = this.aimDirLocal, up = [0, 1, 0];
    // holster pose (on right hip, muzzle down)
    const pw = this.inst.world[I.pelvis];
    const hp = m4.point(pw, [-1.05, -0.35, 0.35]); const hdir = v3.norm([0.05, -1, 0.25]);
    let t = smooth(clamp(s.draw, 0, 1));
    const pos = v3.lerp(hp, handPos, t); const d = v3.norm(v3.lerp(hdir, dir, t));
    const rot = q.look(d, up);   // +Z = muzzle direction
    // gun-space: muzzle along -X, up +Y.  build gun->model: map gunX(-1)->d  => gun +X -> -d ; gun +Y -> up'; gun +Z -> right
    const fx = v3.scale(d, -1); let uy = v3.sub(up, v3.scale(d, v3.dot(up, d))); uy = v3.norm(uy); const zz = v3.cross(fx, uy);
    const G = q.fromMat3(fx, uy, zz);
    const sc = GUN_SCALE / this.rootS[0];
    const gp = GUN_GRIP; const off = q.rot(G, [-gp[0] * sc, -gp[1] * sc, -gp[2] * sc]);
    m4.fromTRS(out, v3.add(pos, off), G, [sc, sc, sc]);
    return out;
  }

  // main update. st: {pos:[x,y,z], yaw, ...}; params in this.s; aimDir in WORLD space
  update(dt, pos, yaw, aimDirWorld) {
    const inst = this.inst, s = this.s, I = this.idx; this.t += dt;
    inst.resetPose();
    const aim = s.aim, armed = s.armed;
    // stride
    const spd = s.speed; const stride = clamp(spd / 1.9, 0, 1.6); this.phase += dt * (spd * 2.7 + 0.0); const ph = this.phase;
    const mv = clamp(spd / 1.4, 0, 1), run = clamp((spd - 2.0) / 4.0, 0, 1);
    const fwd = s.fwd, side = s.side; // movement direction in character space (z fwd, x left)
    const swing = Math.sin(ph) * (0.42 + 0.5 * run) * mv, swing2 = Math.sin(ph + Math.PI) * (0.42 + 0.5 * run) * mv;
    const kneeL = Math.max(0, Math.sin(ph + 1.6)) * (0.5 + 0.8 * run) * mv, kneeR = Math.max(0, Math.sin(ph + 1.6 + Math.PI)) * (0.5 + 0.8 * run) * mv;
    const breathe = Math.sin(this.t * 1.9) * 0.012;
    // body
    const crouch = s.crouch; const air = s.air;
    const bob = (Math.abs(Math.cos(ph)) * 0.10 * mv * (0.6 + run)) - 0.16 * crouch + breathe * 3;
    this.moveBone('hips', [0, (bob - 0.1 * air) * 1.0, 0]);
    const lean = (0.06 + 0.16 * run) * mv * fwd; const twist = Math.sin(ph) * 0.14 * mv * (1 - aim);
    const legSplay = side * 0.0;
    this.delta('hips', qm(rx(lean * 0.6 + 0.35 * crouch), ry(-twist * 0.5)));
    this.delta('spL', qm(rx(lean * 0.4 - s.pitch * 0.18), ry(twist * 0.5 + aim * 0.18)));
    this.delta('spU', qm(rx(-s.pitch * 0.2), ry(twist * 0.6 + aim * 0.2)));
    this.delta('chU', qm(rx(-s.pitch * 0.2 - 0.04), ry(aim * 0.12)));
    this.delta('neck', rx(-lean * 0.3 + s.pitch * 0.05)); this.delta('head', qm(rx(-s.pitch * 0.35), ry(-twist * 0.6 - aim * 0.3)));
    // legs (swing forward = rotation about -X). left leg = +X side
    const air2 = air;
    const thL = swing * 1.0 + 0.55 * air2 * 0.6 + 0.5 * crouch, thR = swing2 * 1.0 - 0.2 * air2 + 0.5 * crouch;
    const sideL = clamp(side * 0.0, -1, 1);
    this.delta('thL', qm(rx(-thL), rz(-0.04 - 0.1 * crouch))); this.delta('thR', qm(rx(-thR), rz(0.04 + 0.1 * crouch)));
    const kL = kneeL + 0.9 * air2 * 0.7 + 0.9 * crouch, kR = kneeR + 0.2 * air2 + 0.9 * crouch;
    this.delta('knL', rx(kL)); this.delta('knR', rx(kR));
    this.delta('anL', rx(thL - kL + 0.1)); this.delta('anR', rx(thR - kR + 0.1));
    // dead / fall handled by root pitch (see below)
    this._rootMat(pos, yaw); inst.update(this.I);
    // arms
    const hu = s.handsUp;
    const SL = this.P0.uaL, SR = this.P0.uaR; // use animated shoulder positions through solveArm
    const aWL = this.worldPos(I.uaL), aWR = this.worldPos(I.uaR);
    // aim direction in model space
    const rinv = q.inv(q.axis([0, 1, 0], yaw)); const ad = q.rot(rinv, aimDirWorld); this.aimDirLocal = v3.norm(ad);
    const chest = this.worldPos(I.chU);
    const lenA = 2.6;
    // relaxed
    const armSwingR = swing * 1.6, armSwingL = swing2 * 1.6; // opposite to legs: left arm with right leg
    const relaxL = v3.add(aWL, [0.45, -2.45, -armSwingL * 0.9 + 0.1]), relaxR = v3.add(aWR, [-0.45, -2.45, -armSwingR * 0.9 + 0.1]);
    // guard (fists) used when punching / no gun
    // aim pose (two hands)
    const hr = v3.add(v3.add(chest, [-0.22, 0.12, 0]), v3.scale(this.aimDirLocal, 3.05 - s.kick * 0.5));
    const hl = v3.add(v3.add(hr, v3.scale(this.aimDirLocal, -0.15)), [0.55, -0.12, -0.05]);
    // holstered/drawing blend: while drawing the right hand goes to the hip
    const hipHand = v3.add(this.worldPos(I.pelvis), [-1.1, -0.2, 0.45]);
    const draw = smooth(clamp(s.draw, 0, 1));
    const drawArc = v3.add(v3.lerp(hipHand, hr, draw), [0, Math.sin(draw * Math.PI) * 0.9, Math.sin(draw * Math.PI) * 0.4]);
    let tR = armed > 0.5 || s.draw > 0 ? v3.lerp(relaxR, drawArc, clamp(s.draw * 1.3, 0, 1)) : relaxR;
    let tL = relaxL;
    const aimW = clamp(aim * clamp(s.draw * 1.4 - 0.2, 0, 1), 0, 1);
    tL = v3.lerp(tL, hl, aimW);
    // low-ready when gun drawn but not aiming: gun pointing down-forward
    if (armed > 0.5 && aim < 0.5 && s.draw > 0.8) { const lr = v3.add(chest, [-0.5, -1.6, 1.4]); tR = v3.lerp(tR, lr, 1 - aim * 2); }
    // reload: left hand comes to the gun
    if (s.reload > 0) { const rl = Math.sin(clamp(s.reload, 0, 1) * Math.PI); tL = v3.lerp(tL, v3.add(hr, [0.2, -0.9, 0.2]), rl); tR = v3.lerp(tR, v3.add(chest, [-0.5, -0.4, 1.7]), rl * 0.7); }
    // punch
    if (s.punch > 0) {
      const p = s.punch, ext = Math.sin(clamp(p, 0, 1) * Math.PI), dirL = [0, 0.05, 1];
      const guardL = v3.add(chest, [0.55, 0.0, 1.5]), guardR = v3.add(chest, [-0.55, 0.0, 1.5]);
      const fistR = v3.add(chest, [-0.3, 0.1, 3.1]), fistL = v3.add(chest, [0.3, 0.1, 3.1]);
      if (s.punchSide === 0) { tR = v3.lerp(guardR, fistR, ext); tL = guardL; } else { tL = v3.lerp(guardL, fistL, ext); tR = guardR; }
      this.delta('spL', qm(rx(0.1), ry((s.punchSide === 0 ? 1 : -1) * ext * 0.35)));
    } else if (armed < 0.5 && s.fightStance) { tR = v3.add(chest, [-0.55, 0.0, 1.5]); tL = v3.add(chest, [0.55, 0.0, 1.5]); }
    if (hu > 0) { const upL = v3.add(aWL, [0.9, 1.3, 0.5]), upR = v3.add(aWR, [-0.9, 1.3, 0.5]); tL = v3.lerp(tL, upL, hu); tR = v3.lerp(tR, upR, hu); }
    this.solveArm('L', tL, [0.7, -1, -0.5]); this.solveArm('R', tR, [-0.7, -1, -0.5]);
    // hand orientation tweaks on wrist for gun (point along aim) not needed; finger curl skipped
    inst.update(this.I);
    return inst;
  }
  _rootMat(pos, yaw) {
    const s = this.s; let r = q.axis([0, 1, 0], yaw);
    let off = [0, 0, 0];
    if (s.dead > 0) { // fall backwards and lie down
      const k = smooth(clamp(s.dead, 0, 1)); r = qm(r, rx(-k * 1.45)); off = q.rot(q.axis([0, 1, 0], yaw), [0, 0.2 * k, -0.25 * k]);
    }
    return m4.fromTRS(this.root, [pos[0] + off[0], pos[1] + off[1], pos[2] + off[2]], r, this.rootS);
  }
  gunWorld(out) { const g = this.gunMatrixModel(this._gm || (this._gm = m4.create())); return m4.mul(out, this.root, g); }
  muzzleWorld() {
    const gm = this.gunWorld(this._gw || (this._gw = m4.create()));
    return m4.point(gm, GUN_MUZZLE);
  }
  handWorld() { return m4.point(this.root, this.ik.R); }
  draw(R) { this.inst.draw(R, this.root); }
}

/* ------------------------------------------------------------------ Procedural NPC humanoid */
// joint order
const J = { hips: 0, chest: 1, head: 2, uaL: 3, faL: 4, uaR: 5, faR: 6, thL: 7, shL: 8, thR: 9, shR: 10 };
const JPAR = [-1, 0, 1, 1, 3, 1, 5, 0, 7, 0, 9];

export function buildNpcMesh(R, o) {
  // o: {h, shirt, pants, skin, hair, shoes, female, hat, jacket, mask}
  const b = new MeshBuilder(); const H = o.h; const u = H / 1.75;
  const hipY = 0.95 * u, chestY = 1.27 * u, neckY = 1.52 * u;
  const sx = o.female ? 0.19 : 0.23, wx = o.female ? 0.17 : 0.2;
  const jp = [[0, hipY, 0], [0, chestY, 0], [0, neckY, 0], [sx, 1.45 * u, 0], [sx + 0.03, 1.17 * u, 0], [-sx, 1.45 * u, 0], [-sx - 0.03, 1.17 * u, 0], [0.095, hipY, 0], [0.095, 0.5 * u, 0], [-0.095, hipY, 0], [-0.095, 0.5 * u, 0]];
  const dark = (c, k) => [c[0] * k, c[1] * k, c[2] * k, 1];
  const limb = (j, x, y0, y1, r0, r1, col, z = 0) => { b.cj = j; b.cyl(x, y1, z, r1, r0, y0 - y1, 7, col, true); };
  // legs
  for (const s of [1, -1]) {
    const tj = s > 0 ? J.thL : J.thR, sj = s > 0 ? J.shL : J.shR, x = 0.095 * s;
    limb(tj, x, 0.5 * u, hipY, 0.065 * u, o.female ? 0.085 * u : 0.08 * u, o.pants);
    limb(sj, x, 0.1 * u, 0.5 * u, 0.05 * u, 0.062 * u, o.pants);
    b.cj = sj; b.box(x, 0.045 * u, 0.04 * u, 0.055, 0.045 * u, 0.115, 0, o.shoes);
  }
  // hips + torso
  b.cj = J.hips; b.box(0, hipY + 0.02 * u, 0, wx + 0.01, 0.1 * u, 0.115, 0, o.pants);
  b.cj = J.chest;
  b.box(0, (hipY + chestY) / 2 + 0.07 * u, 0, wx, (chestY - hipY) / 2 + 0.07 * u, 0.12, 0, o.shirt);
  b.box(0, chestY + 0.14 * u, 0, sx + 0.015, 0.14 * u, 0.125, 0, o.jacket || o.shirt);
  if (o.female) { b.sphere(0.075, chestY + 0.12 * u, 0.1, 0.075, 0.065, 0.06, 5, o.shirt); b.sphere(-0.075, chestY + 0.12 * u, 0.1, 0.075, 0.065, 0.06, 5, o.shirt); }
  if (o.jacket) b.box(0, hipY + 0.14 * u, 0, wx + 0.015, 0.14 * u, 0.125, 0, o.jacket);
  // neck/head
  b.cj = J.head; b.cyl(0, neckY - 0.06 * u, 0, 0.045, 0.045, 0.1 * u, 6, o.skin);
  b.sphere(0, neckY + 0.12 * u, 0.0, 0.1, 0.125, 0.115, 6, o.skin);
  if (o.mask) b.box(0, neckY + 0.09 * u, 0.085, 0.09, 0.06, 0.04, 0, o.mask);
  if (o.hat === 'cap') { b.sphere(0, neckY + 0.17 * u, -0.005, 0.108, 0.1, 0.12, 6, o.hatCol); b.box(0, neckY + 0.15 * u, 0.12, 0.09, 0.012, 0.07, 0, o.hatCol); }
  else if (o.hat === 'beanie') b.sphere(0, neckY + 0.17 * u, 0, 0.11, 0.105, 0.12, 6, o.hatCol);
  else {
    b.sphere(0, neckY + 0.17 * u, -0.01, 0.108, 0.1, 0.12, 6, o.hair);
    if (o.female) { b.box(0, neckY + 0.0, -0.095, 0.1, 0.17 * u, 0.03, 0, o.hair); }
  }
  b.sphere(0.035, neckY + 0.12 * u, 0.105, 0.012, 0.012, 0.01, 3, [0.02, 0.02, 0.03, 1]); b.sphere(-0.035, neckY + 0.12 * u, 0.105, 0.012, 0.012, 0.01, 3, [0.02, 0.02, 0.03, 1]);
  // arms
  for (const s of [1, -1]) {
    const uj = s > 0 ? J.uaL : J.uaR, fj = s > 0 ? J.faL : J.faR, x = (sx + 0.0) * s, x2 = (sx + 0.03) * s;
    limb(uj, x, 1.17 * u, 1.46 * u, 0.045 * u, 0.055 * u, o.jacket || o.shirt, 0);
    limb(fj, x2, 0.92 * u, 1.17 * u, 0.04 * u, 0.047 * u, o.jacket ? o.jacket : o.skin, 0);
    b.sphere(x2, 0.9 * u, 0, 0.042, 0.05, 0.04, 4, o.skin);
  }
  b.cj = -1;
  const mesh = b.build(R); mesh.prims[0].skinned = true;
  mesh.joints = jp;
  return mesh;
}

// rig that animates joints procedurally and produces skin matrices
export class NpcRig {
  constructor(R, mesh) {
    this.R = R; this.mesh = mesh; this.jp = mesh.joints; const n = 11;
    this.mats = new Float32Array(n * 16); this.world = Array.from({ length: n }, () => m4.create()); this.rot = Array.from({ length: n }, () => [0, 0, 0, 1]);
    this.off = this.jp.map((p, i) => (JPAR[i] < 0 ? p : v3.sub(p, this.jp[JPAR[i]])));
    this.ibm = this.jp.map((p) => { const m = m4.create(); m[12] = -p[0]; m[13] = -p[1]; m[14] = -p[2]; return m; });
    const gl = R.gl; this.tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, n * 4, 1, 0, gl.RGBA, gl.FLOAT, this.mats);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.root = m4.create(); this.tmp = m4.create(); this.tmp2 = m4.create(); this.phase = Math.random() * 6; this.t = Math.random() * 10;
    this.handR = [0, 0, 0];
  }
  // st: {speed, handsUp, punch, punchSide, aim(0/1 gun), dead, stagger, phone}
  pose(dt, pos, yaw, st) {
    const r = this.rot, spd = st.speed || 0; this.t += dt; this.phase += dt * spd * 2.6; const ph = this.phase;
    const mv = clamp(spd / 1.3, 0, 1), run = clamp((spd - 2.0) / 3.5, 0, 1);
    const sw = Math.sin(ph) * (0.5 + 0.55 * run) * mv, kn = Math.max(0, Math.sin(ph + 1.5)) * (0.7 + 0.8 * run) * mv, kn2 = Math.max(0, Math.sin(ph + 1.5 + Math.PI)) * (0.7 + 0.8 * run) * mv;
    const hu = st.handsUp || 0, aim = st.aim || 0, pn = st.punch || 0, br = Math.sin(this.t * 1.7) * 0.02;
    r[J.hips] = qm(rx((0.05 + 0.2 * run) * mv), ry(-Math.sin(ph) * 0.12 * mv));
    r[J.chest] = qm(rx(0.04 + br + (aim ? -0.05 : 0) + (st.stagger || 0) * 0.5), ry(Math.sin(ph) * 0.18 * mv + (pn ? (st.punchSide ? -1 : 1) * Math.sin(pn * Math.PI) * 0.4 : 0)));
    r[J.head] = rx(-0.05 + (hu ? -0.15 * hu : 0));
    r[J.thL] = rx(-sw * 1.0); r[J.thR] = rx(sw * 1.0); r[J.shL] = rx(kn * 1.0); r[J.shR] = rx(kn2 * 1.0);
    const armR = -sw * 1.0, armL = sw * 1.0;
    // arms: swing around X, raise with handsUp (rotate about Z outward & up)
    let uaL = qm(rz(0.08), rx(-armL * 0.8)), uaR = qm(rz(-0.08), rx(-armR * 0.8)), faL = rx(-0.15 - Math.max(0, armL) * 0.5), faR = rx(-0.15 - Math.max(0, armR) * 0.5);
    if (hu > 0) { uaL = q.slerp(uaL, qm(rz(2.7), rx(-0.2)), hu); uaR = q.slerp(uaR, qm(rz(-2.7), rx(-0.2)), hu); faL = q.slerp(faL, rx(-0.5), hu); faR = q.slerp(faR, rx(-0.5), hu); }
    if (aim) { uaR = rx(-1.5); faR = rx(-0.1); uaL = qm(rz(0.0), rx(-1.35)); faL = rx(-0.5); }
    if (pn > 0) { const e = Math.sin(clamp(pn, 0, 1) * Math.PI); if (st.punchSide) { uaL = rx(-1.45 * e - 0.4); faL = rx(-0.3 * (1 - e) - 0.5 * (1 - e)); } else { uaR = rx(-1.45 * e - 0.4); faR = rx(-0.3 * (1 - e)); } }
    if (st.phone) { uaR = rx(-1.25); faR = rx(-1.9); }
    r[J.uaL] = uaL; r[J.uaR] = uaR; r[J.faL] = faL; r[J.faR] = faR;
    // root: dead -> lie down
    let rootR = ry(yaw), rp = [pos[0], pos[1], pos[2]];
    const dd = st.dead || 0; if (dd > 0) { const k = smooth(clamp(dd, 0, 1)); rootR = qm(rootR, rx(-1.5 * k)); const o = q.rot(ry(yaw), [0, 0.15 * k, -0.2 * k]); rp = [pos[0] + o[0], pos[1] + o[1], pos[2] + o[2]]; }
    m4.fromTRS(this.root, rp, rootR, [1, 1, 1]);
    const bob = Math.abs(Math.cos(ph)) * 0.025 * mv;
    for (let i = 0; i < 11; i++) {
      const o = this.off[i]; const T = this.tmp; m4.fromTRS(T, [o[0], o[1] + (i === 0 ? bob : 0), o[2]], r[i], [1, 1, 1]);
      if (JPAR[i] < 0) m4.mul(this.world[i], this.root, T); else m4.mul(this.world[i], this.world[JPAR[i]], T);
      m4.mul(this.tmp2, this.world[i], this.ibm[i]); this.mats.set(this.tmp2, i * 16);
    }
    const gl = this.R.gl; gl.bindTexture(gl.TEXTURE_2D, this.tex); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 44, 1, gl.RGBA, gl.FLOAT, this.mats);
    // right hand world (for gun)
    const wm = this.world[J.faR]; this.handR = m4.point(wm, v3.add(v3.sub(this.jp[J.faR], this.jp[J.faR]), [0, -0.27 * (this.mesh.joints[J.hips][1] / 0.95), 0.0]));
    return this;
  }
  draw(R) { R.drawPrim(this.mesh.prims[0], this.mesh.prims[0].mat, m4.identity(this._i || (this._i = m4.create())), { skinTex: this.tex }); }
}

const SKINS = [[0.93, 0.74, 0.62], [0.82, 0.6, 0.45], [0.62, 0.43, 0.3], [0.42, 0.28, 0.2], [0.96, 0.82, 0.7], [0.72, 0.52, 0.38]];
const SHIRTS = [[0.9, 0.1, 0.4], [0.1, 0.8, 0.9], [0.95, 0.85, 0.15], [0.12, 0.12, 0.16], [0.9, 0.9, 0.95], [0.5, 0.15, 0.85], [0.1, 0.55, 0.3], [0.9, 0.4, 0.1], [0.15, 0.25, 0.7], [0.8, 0.2, 0.2]];
const PANTS = [[0.1, 0.12, 0.2], [0.05, 0.05, 0.07], [0.25, 0.28, 0.4], [0.35, 0.3, 0.22], [0.6, 0.6, 0.65], [0.18, 0.1, 0.25]];
const HAIRS = [[0.04, 0.03, 0.03], [0.25, 0.14, 0.07], [0.7, 0.5, 0.2], [0.8, 0.1, 0.5], [0.1, 0.7, 0.9], [0.5, 0.5, 0.55]];
export function npcOutfit(r, kind) {
  const pick = (a) => a[Math.floor(r() * a.length)];
  const female = r() < 0.5;
  const o = { h: 1.58 + r() * 0.3 - (female ? 0.08 : 0), female, skin: pick(SKINS).concat(1), shirt: pick(SHIRTS).concat(1), pants: pick(PANTS).concat(1), hair: pick(HAIRS).concat(1), shoes: [0.9 * r() + 0.05, 0.08, 0.1 + r() * 0.5, 1] };
  if (r() < 0.25) { o.hat = r() < 0.5 ? 'cap' : 'beanie'; o.hatCol = pick(SHIRTS).concat(1); }
  if (r() < 0.35) o.jacket = pick(SHIRTS).map((c) => c * 0.55).concat(1);
  if (kind === 'cop') { o.female = r() < 0.2; o.h = 1.75 + r() * 0.1; o.shirt = [0.1, 0.18, 0.45, 1]; o.pants = [0.05, 0.07, 0.15, 1]; o.jacket = [0.08, 0.14, 0.38, 1]; o.hat = 'cap'; o.hatCol = [0.05, 0.08, 0.2, 1]; o.shoes = [0.02, 0.02, 0.02, 1]; o.hair = [0.1, 0.07, 0.05, 1]; }
  if (kind === 'thug') { o.female = false; o.h = 1.75 + r() * 0.1; o.jacket = [0.06, 0.06, 0.08, 1]; o.pants = [0.05, 0.05, 0.08, 1]; o.mask = [0.05, 0.05, 0.05, 1]; o.hat = 'beanie'; o.hatCol = [0.8, 0.1, 0.4, 1]; }
  return o;
}
