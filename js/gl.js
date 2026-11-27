// Tiny self-contained WebGL2 engine: GLB loader, skinning, night lighting, bloom/tonemap post, particles.
import { m4, q, v3, clamp } from './math.js';

const NL = 12; // max point lights per draw

/* ============================ SHADERS ============================ */
const VS = `#version 300 es
precision highp float; precision highp int;
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNor;
layout(location=2) in vec2 aUV;
layout(location=3) in uvec4 aJoints;
layout(location=4) in vec4 aWeights;
layout(location=5) in vec4 iM0;
layout(location=6) in vec4 iM1;
layout(location=7) in vec4 iM2;
layout(location=8) in vec4 iM3;
layout(location=9) in vec4 iCol;
layout(location=10) in vec4 aCol;
uniform mat4 uVP; uniform mat4 uModel;
#ifdef SKIN
uniform highp sampler2D uJoints;
mat4 jm(uint i){ int b=int(i)*4; return mat4(texelFetch(uJoints,ivec2(b,0),0),texelFetch(uJoints,ivec2(b+1,0),0),texelFetch(uJoints,ivec2(b+2,0),0),texelFetch(uJoints,ivec2(b+3,0),0)); }
#endif
out vec3 vW; out vec3 vN; out vec2 vUV; out vec4 vC;
void main(){
  vec4 p=vec4(aPos,1.0); vec3 n=aNor;
#ifdef SKIN
  mat4 sk=aWeights.x*jm(aJoints.x)+aWeights.y*jm(aJoints.y)+aWeights.z*jm(aJoints.z)+aWeights.w*jm(aJoints.w);
  p=sk*p; n=mat3(sk)*n;
#endif
#ifdef INST
  mat4 M=mat4(iM0,iM1,iM2,iM3)*uModel; vC=aCol*iCol;
#else
  mat4 M=uModel; vC=aCol;
#endif
  vec4 w=M*p; vW=w.xyz; vN=mat3(M)*n; vUV=aUV;
  gl_Position=uVP*w;
}`;

const FS = `#version 300 es
precision highp float;
in vec3 vW; in vec3 vN; in vec2 vUV; in vec4 vC;
uniform sampler2D uBase; uniform sampler2D uEmis;
uniform vec4 uBaseCol; uniform vec3 uEmisCol; uniform float uAlphaCut;
uniform float uSpec; uniform float uShin; uniform float uWet; uniform float uGlow; uniform float uUnlit;
uniform vec3 uTint; uniform vec2 uUVScale; uniform float uGround;
uniform vec3 uCam; uniform vec4 uLP[${NL}]; uniform vec4 uLC[${NL}];
uniform vec3 uAmbSky; uniform vec3 uAmbGnd; uniform vec3 uSunDir; uniform vec3 uSunCol; uniform vec3 uFogCol; uniform float uFogDen; uniform float uTime;
out vec4 oCol;
float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float vnoise(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f); return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y); }
vec3 envCol(vec3 r){
  float h=clamp(r.y,0.,1.); vec3 hor=vec3(0.95,0.22,0.62)*0.75; vec3 zen=vec3(0.02,0.03,0.10);
  vec3 c=mix(hor,zen,pow(h,0.4)); float a=atan(r.z,r.x);
  c+=vec3(0.05,0.55,0.95)*pow(max(sin(a*5.0+2.0),0.),6.)*(1.-h)*0.9+vec3(1.0,0.25,0.5)*pow(max(sin(a*3.0+.5),0.),5.)*(1.-h)*0.7;
  return c;
}
void main(){
  vec2 uv=vUV*uUVScale;
  vec4 b=texture(uBase,uv)*uBaseCol*vC; b.rgb*=uTint;
  if(uAlphaCut>0.0 && b.a<uAlphaCut) discard;
  vec3 N=normalize(vN); if(!gl_FrontFacing) N=-N;
  vec3 V=normalize(uCam-vW); float dist=length(uCam-vW);
  float wet=uWet; float puddle=0.0;
  float spec=uSpec;
  if(uGround>0.5){
    float n1=vnoise(vW.xz*0.22)*0.65+vnoise(vW.xz*0.9)*0.35; puddle=smoothstep(0.38,0.62,n1);
    wet=uWet*(0.35+0.65*puddle)*texture(uBase,uv).a;
    b.rgb*=mix(1.0,0.55,puddle*0.8*texture(uBase,uv).a);
    spec=uSpec*(0.4+puddle);
  }
  vec3 lit=mix(uAmbGnd,uAmbSky,N.y*0.5+0.5);
  lit+=uSunCol*max(dot(N,uSunDir),0.0);
  vec3 sp=vec3(0.0); vec3 R=reflect(-V,N);
  for(int i=0;i<${NL};i++){
    float rad=uLP[i].w; if(rad<=0.0) continue;
    vec3 L=uLP[i].xyz-vW; float d=length(L); if(d>rad) continue; L/=d;
    float x=1.0-d/rad; float att=x*x;
    float nd=dot(N,L); float diff=max(nd*0.85+0.15,0.0);
    lit+=uLC[i].rgb*att*diff;
    float rl=max(dot(R,L),0.0);
    sp+=uLC[i].rgb*att*pow(rl,uShin)*(spec+wet*3.0);
  }
  vec3 col=b.rgb*lit+sp;
  if(wet>0.001){
    float fres=pow(1.0-max(dot(N,V),0.0),3.0);
    col+=envCol(R)*(0.10+0.9*fres)*wet*0.65;
  }
  vec3 em=texture(uEmis,uv).rgb*uEmisCol; col+=em+b.rgb*uGlow;
  if(uUnlit>0.5) col=b.rgb*uGlow+em+b.rgb*0.0;
  float fogF=1.0-exp(-dist*uFogDen*(1.0+0.0)); fogF*=1.0-clamp((vW.y-8.0)*0.01,0.0,0.5);
  col=mix(col,uFogCol,clamp(fogF,0.0,1.0));
  oCol=vec4(col,1.0);
}`;

const FS_SOLID_FOR_SHADOW = null;

const VS_FS = `#version 300 es
precision highp float; out vec2 vP; void main(){ vec2 p=vec2((gl_VertexID<<1)&2, gl_VertexID&2); vP=p; gl_Position=vec4(p*2.0-1.0,0.9999,1.0); }`;

const FS_SKY = `#version 300 es
precision highp float; in vec2 vP; uniform mat4 uInvVP; uniform vec3 uCam; uniform float uTime; uniform vec3 uMoonDir; out vec4 oCol;
float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float noise(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f); return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y); }
float fbm(vec2 p){ float s=0.,a=.5; for(int i=0;i<5;i++){ s+=a*noise(p); p*=2.03; a*=.5; } return s; }
void main(){
  vec4 w=uInvVP*vec4(vP*2.0-1.0,1.0,1.0); vec3 d=normalize(w.xyz/w.w-uCam);
  float h=clamp(d.y,-0.2,1.0);
  vec3 hor=vec3(1.0,0.18,0.55); vec3 mid=vec3(0.28,0.07,0.42); vec3 zen=vec3(0.015,0.02,0.09);
  vec3 c=mix(hor*0.85,mid,smoothstep(0.0,0.22,h)); c=mix(c,zen,smoothstep(0.12,0.75,h));
  c+=vec3(0.05,0.45,0.8)*exp(-abs(h-0.05)*14.0)*0.35;
  // stars
  vec2 sp=d.xz/(d.y+0.4)*60.0; float st=step(0.9965,hash(floor(sp)))*smoothstep(0.1,0.4,h); c+=vec3(0.8,0.85,1.0)*st*(0.5+0.5*sin(uTime*3.+hash(floor(sp))*40.));
  // clouds
  vec2 cp=d.xz/(d.y+0.25)*2.2+vec2(uTime*0.004,0.); float cl=smoothstep(0.45,0.85,fbm(cp)); c=mix(c,mix(vec3(0.5,0.1,0.45),vec3(0.9,0.3,0.6),h*2.),cl*0.45*smoothstep(0.02,0.3,h));
  // moon
  float md=dot(d,uMoonDir); c+=vec3(1.0,0.85,0.95)*smoothstep(0.9988,0.9995,md)*2.2+vec3(0.9,0.3,0.7)*pow(max(md,0.),60.)*0.5;
  if(d.y<0.0) c=mix(c,hor*0.5,0.0);
  oCol=vec4(c,1.0);
}`;

const FS_COPY = `#version 300 es
precision highp float; in vec2 vP; uniform sampler2D uT; uniform vec2 uTexel; uniform float uThr; uniform int uMode; out vec4 oCol;
void main(){
  vec3 c;
  if(uMode==0){ // prefilter + downsample
    c=(texture(uT,vP+uTexel*vec2(-1,-1)).rgb+texture(uT,vP+uTexel*vec2(1,-1)).rgb+texture(uT,vP+uTexel*vec2(-1,1)).rgb+texture(uT,vP+uTexel*vec2(1,1)).rgb)*0.25;
    float br=max(c.r,max(c.g,c.b)); float soft=clamp(br-uThr+0.6,0.,1.2); soft=soft*soft*0.4; c*=max(soft,br-uThr)/max(br,1e-4);
  } else if(uMode==1){ // downsample
    c=(texture(uT,vP+uTexel*vec2(-1,-1)).rgb+texture(uT,vP+uTexel*vec2(1,-1)).rgb+texture(uT,vP+uTexel*vec2(-1,1)).rgb+texture(uT,vP+uTexel*vec2(1,1)).rgb)*0.25;
  } else { // tent upsample
    c=texture(uT,vP).rgb*4.0; c+=texture(uT,vP+uTexel*vec2(-1,0)).rgb*2.0+texture(uT,vP+uTexel*vec2(1,0)).rgb*2.0+texture(uT,vP+uTexel*vec2(0,-1)).rgb*2.0+texture(uT,vP+uTexel*vec2(0,1)).rgb*2.0;
    c+=texture(uT,vP+uTexel*vec2(-1,-1)).rgb+texture(uT,vP+uTexel*vec2(1,-1)).rgb+texture(uT,vP+uTexel*vec2(-1,1)).rgb+texture(uT,vP+uTexel*vec2(1,1)).rgb; c/=16.0;
  }
  oCol=vec4(c,1.0);
}`;

const FS_POST = `#version 300 es
precision highp float; in vec2 vP; uniform sampler2D uScene; uniform sampler2D uBloom; uniform float uBloomK; uniform float uTime; uniform float uAber; uniform float uHurt; uniform float uRain; uniform vec2 uRes; out vec4 oCol;
float hash(vec2 p){ return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453); }
vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14),0.,1.); }
void main(){
  vec2 uv=vP; vec2 cc=uv-0.5; float r2=dot(cc,cc);
  vec2 off=cc*(uAber+r2*0.012);
  vec3 c=vec3(texture(uScene,uv-off).r,texture(uScene,uv).g,texture(uScene,uv+off).b);
  vec3 bl=texture(uBloom,uv).rgb; c+=bl*uBloomK;
  // rain streaks
  if(uRain>0.0){
    vec2 ruv=vec2(uv.x*uRes.x/uRes.y*60.0+uv.y*6.0,uv.y*3.0+uTime*3.5); vec2 id=floor(ruv); float h=hash(id); float f=fract(ruv.x);
    float streak=step(0.985,h)*smoothstep(0.0,0.3,f)*smoothstep(0.6,0.3,f)*smoothstep(0.0,0.5,fract(ruv.y+h*7.0)); c+=vec3(0.5,0.6,0.9)*streak*0.10*uRain;
  }
  c*=1.15;
  c=aces(c);
  // cyberpunk split-toning: teal shadows, magenta highlights
  float l=dot(c,vec3(0.299,0.587,0.114));
  c=mix(c,c*vec3(0.88,0.98,1.14),1.0-smoothstep(0.0,0.5,l));
  c=mix(c,c*vec3(1.10,0.95,1.06),smoothstep(0.4,1.0,l));
  c=mix(vec3(l),c,1.18);
  c*=1.0-smoothstep(0.25,0.95,r2*2.3)*0.62;
  c+=vec3(0.7,0.0,0.05)*uHurt*smoothstep(0.1,0.6,r2*2.0);
  c+= (hash(uv*uRes+uTime)-0.5)*0.014;
  c=pow(clamp(c,0.,1.),vec3(1.0/2.2));
  oCol=vec4(c,1.0);
}`;

const VS_PART = `#version 300 es
precision highp float;
layout(location=0) in vec2 aQ; layout(location=1) in vec4 iPS; layout(location=2) in vec4 iCol;
uniform mat4 uVP; uniform vec3 uRight; uniform vec3 uUp; out vec2 vQ; out vec4 vC;
void main(){ vQ=aQ; vC=iCol; vec3 w=iPS.xyz+(uRight*aQ.x+uUp*aQ.y)*iPS.w; gl_Position=uVP*vec4(w,1.0); }`;
const FS_PART = `#version 300 es
precision highp float; in vec2 vQ; in vec4 vC; uniform float uSoft; out vec4 oCol;
void main(){ float d=dot(vQ,vQ); if(d>1.0) discard; float a=exp(-d*uSoft); oCol=vec4(vC.rgb*vC.a*a,vC.a*a); }`;

/* ============================ RENDERER ============================ */
export class Renderer {
  constructor(canvas, opts = {}) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: !!opts.preserve, stencil: false, depth: false });
    if (!gl) throw new Error('WebGL2 không được hỗ trợ trên thiết bị này.');
    this.gl = gl; this.canvas = canvas;
    this.extF = gl.getExtension('EXT_color_buffer_float');
    gl.getExtension('OES_texture_float_linear');
    this.aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    this.hdr = !!this.extF;
    this.progs = new Map(); this.uc = new Map();
    this.time = 0; this.frame = 0;
    this.lights = []; // per-frame {x,y,z,r,cr,cg,cb}
    this.cam = { pos: [0, 0, 0], vp: m4.create(), view: m4.create(), proj: m4.create(), invVP: m4.create(), right: [1, 0, 0], up: [0, 1, 0] };
    this.env = { ambSky: [0.10, 0.08, 0.22], ambGnd: [0.05, 0.035, 0.09], sunDir: v3.norm([-0.4, 0.55, -0.7]), sunCol: [0.10, 0.12, 0.30], fogCol: [0.11, 0.05, 0.20], fogDen: 0.0065 };
    this.post = { bloom: 0.9, thr: 0.85, aber: 0.0016, hurt: 0, rain: 1 };
    this.settings = { scale: 1, msaa: 0, bloom: true };
    this.white = this.makeTex(new Uint8Array([255, 255, 255, 255]), 1, 1, { srgb: false, mip: false });
    this.black = this.makeTex(new Uint8Array([0, 0, 0, 255]), 1, 1, { srgb: false, mip: false });
    this.fsVAO = gl.createVertexArray();
    this._initPost(); this._initParticles();
    this.defaultMat = { base: null, emis: null, baseCol: [1, 1, 1, 1], emisCol: [0, 0, 0], alphaCut: 0, spec: 0.15, shin: 28, wet: 0, glow: 0, unlit: 0, tint: [1, 1, 1], ds: false, uvScale: [1, 1], ground: 0 };
    this.stats = { draws: 0, tris: 0 };
  }

  /* ---- shader programs ---- */
  prog(key, vs, fs, defs = '') {
    let p = this.progs.get(key); if (p) return p;
    const gl = this.gl;
    const mk = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src.replace('#version 300 es', '#version 300 es\n' + defs));
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.error(gl.getShaderInfoLog(s)); throw new Error('shader: ' + gl.getShaderInfoLog(s)); }
      return s;
    };
    p = gl.createProgram(); gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p));
    p._u = {}; p._stamp = -1; this.progs.set(key, p); return p;
  }
  U(p, n) { let l = p._u[n]; if (l === undefined) { l = this.gl.getUniformLocation(p, n); p._u[n] = l; } return l; }
  meshProg(skin, inst) {
    const d = (skin ? '#define SKIN\n' : '') + (inst ? '#define INST\n' : '');
    return this.prog('m' + (skin ? 1 : 0) + (inst ? 1 : 0), VS, FS, d);
  }
  useMesh(skin, inst) {
    const gl = this.gl, p = this.meshProg(skin, inst);
    if (this.cur !== p) { gl.useProgram(p); this.cur = p; }
    if (p._stamp !== this.frameId) { p._stamp = this.frameId; this._frameUniforms(p); }
    return p;
  }
  _frameUniforms(p) {
    const gl = this.gl, c = this.cam, e = this.env, U = (n) => this.U(p, n);
    gl.uniformMatrix4fv(U('uVP'), false, c.vp); gl.uniform3fv(U('uCam'), c.pos);
    gl.uniform3fv(U('uAmbSky'), e.ambSky); gl.uniform3fv(U('uAmbGnd'), e.ambGnd); gl.uniform3fv(U('uSunDir'), e.sunDir); gl.uniform3fv(U('uSunCol'), e.sunCol);
    gl.uniform3fv(U('uFogCol'), e.fogCol); gl.uniform1f(U('uFogDen'), e.fogDen); gl.uniform1f(U('uTime'), this.time);
    gl.uniform4fv(U('uLP'), this._lp); gl.uniform4fv(U('uLC'), this._lc);
    gl.uniform1i(U('uBase'), 0); gl.uniform1i(U('uEmis'), 1); gl.uniform1i(U('uJoints'), 2);
  }

  /* ---- textures ---- */
  makeTex(data, w, h, o = {}) {
    const gl = this.gl, t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    const ifmt = o.srgb === false ? gl.RGBA8 : gl.SRGB8_ALPHA8;
    if (data && data.width !== undefined) gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, gl.RGBA, gl.UNSIGNED_BYTE, data);
    else gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    const mip = o.mip !== false;
    if (mip) gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const wr = o.clamp ? gl.CLAMP_TO_EDGE : gl.REPEAT;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wr); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wr);
    if (mip && this.aniso) gl.texParameterf(gl.TEXTURE_2D, this.aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(this.aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
    return t;
  }
  texFromCanvas(c, o = {}) { return this.makeTex(c, c.width, c.height, o); }

  /* ---- buffers ---- */
  buf(target, data, usage) { const gl = this.gl, b = gl.createBuffer(); gl.bindBuffer(target, b); gl.bufferData(target, data, usage || gl.STATIC_DRAW); return b; }

  /* ---- render targets / post ---- */
  _initPost() {
    const gl = this.gl;
    this.pCopy = this.prog('copy', VS_FS, FS_COPY); this.pPost = this.prog('post', VS_FS, FS_POST); this.pSky = this.prog('sky', VS_FS, FS_SKY);
    this._lp = new Float32Array(NL * 4); this._lc = new Float32Array(NL * 4);
  }
  _target(w, h, depth, fmtF) {
    const gl = this.gl, t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    if (fmtF && this.hdr) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    let rb = null;
    if (depth) { rb = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, rb); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h); gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb); }
    return { t, fb, rb, w, h };
  }
  resize(cssW, cssH, dpr, scale) {
    const gl = this.gl; this.settings.scale = scale;
    const w = Math.max(64, Math.round(cssW * dpr * scale)), h = Math.max(64, Math.round(cssH * dpr * scale));
    this.canvas.width = w; this.canvas.height = h; this.W = w; this.H = h;
    this._free();
    this.scene = this._target(w, h, true, true);
    this.ms = null;
    if (this.settings.msaa > 0) {
      try {
        const fb = gl.createFramebuffer(), cb = gl.createRenderbuffer(), db = gl.createRenderbuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
        gl.bindRenderbuffer(gl.RENDERBUFFER, cb); gl.renderbufferStorageMultisample(gl.RENDERBUFFER, this.settings.msaa, this.hdr ? gl.RGBA16F : gl.RGBA8, w, h);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, cb);
        gl.bindRenderbuffer(gl.RENDERBUFFER, db); gl.renderbufferStorageMultisample(gl.RENDERBUFFER, this.settings.msaa, gl.DEPTH_COMPONENT24, w, h);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, db);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE) this.ms = { fb, cb, db };
      } catch (e) { this.ms = null; }
    }
    this.bloomT = [];
    let bw = w, bh = h;
    for (let i = 0; i < 5; i++) { bw = Math.max(2, bw >> 1); bh = Math.max(2, bh >> 1); this.bloomT.push(this._target(bw, bh, false, true)); }
  }
  _free() {
    const gl = this.gl;
    const del = (t) => { if (!t) return; gl.deleteTexture(t.t); gl.deleteFramebuffer(t.fb); if (t.rb) gl.deleteRenderbuffer(t.rb); };
    del(this.scene); (this.bloomT || []).forEach(del);
    if (this.ms) { gl.deleteFramebuffer(this.ms.fb); gl.deleteRenderbuffer(this.ms.cb); gl.deleteRenderbuffer(this.ms.db); }
  }

  /* ---- frame ---- */
  begin(camera, dt) {
    const gl = this.gl, c = this.cam;
    this.time += dt; this.frameId = ++this.frame; this.cur = null; this.stats.draws = 0; this.stats.tris = 0;
    c.pos = camera.pos;
    m4.perspective(c.proj, camera.fov, this.W / this.H, camera.near || 0.1, camera.far || 900);
    m4.lookAt(c.view, camera.pos, camera.target, [0, 1, 0]);
    m4.mul(c.vp, c.proj, c.view); m4.invert(c.invVP, c.vp);
    c.right = [c.view[0], c.view[4], c.view[8]]; c.up = [c.view[1], c.view[5], c.view[9]];
    this._frustum();
    // lights -> uniform
    const L = this.lights; this._lp.fill(0); this._lc.fill(0);
    for (let i = 0; i < Math.min(NL, L.length); i++) { const l = L[i]; this._lp.set([l.x, l.y, l.z, l.r], i * 4); this._lc.set([l.cr, l.cg, l.cb, 1], i * 4); }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.ms ? this.ms.fb : this.scene.fb);
    gl.viewport(0, 0, this.W, this.H);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true); gl.disable(gl.BLEND); gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
    gl.clearColor(this.env.fogCol[0], this.env.fogCol[1], this.env.fogCol[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    this._drawSky(camera);
  }
  _frustum() {
    const m = this.cam.vp, P = []; this.planes = P;
    const add = (a, b, c, d) => { const l = Math.hypot(a, b, c); P.push([a / l, b / l, c / l, d / l]); };
    add(m[3] + m[0], m[7] + m[4], m[11] + m[8], m[15] + m[12]); add(m[3] - m[0], m[7] - m[4], m[11] - m[8], m[15] - m[12]);
    add(m[3] + m[1], m[7] + m[5], m[11] + m[9], m[15] + m[13]); add(m[3] - m[1], m[7] - m[5], m[11] - m[9], m[15] - m[13]);
    add(m[3] + m[2], m[7] + m[6], m[11] + m[10], m[15] + m[14]); add(m[3] - m[2], m[7] - m[6], m[11] - m[10], m[15] - m[14]);
  }
  visible(min, max) {
    for (const p of this.planes) {
      const x = p[0] > 0 ? max[0] : min[0], y = p[1] > 0 ? max[1] : min[1], z = p[2] > 0 ? max[2] : min[2];
      if (p[0] * x + p[1] * y + p[2] * z + p[3] < 0) return false;
    }
    return true;
  }
  _drawSky(camera) {
    const gl = this.gl, p = this.pSky; gl.useProgram(p); this.cur = p;
    gl.depthMask(false); gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
    gl.uniformMatrix4fv(this.U(p, 'uInvVP'), false, this.cam.invVP); gl.uniform3fv(this.U(p, 'uCam'), this.cam.pos); gl.uniform1f(this.U(p, 'uTime'), this.time);
    gl.uniform3fv(this.U(p, 'uMoonDir'), v3.norm([0.35, 0.34, -0.87]));
    gl.bindVertexArray(this.fsVAO); gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
  }

  // Draw one primitive. mat: material object, model: Float32Array mat4, opt: {skinTex, inst:{buf,count}, tint}
  drawPrim(prim, mat, model, opt = {}) {
    const gl = this.gl, skin = !!(opt.skinTex && prim.skinned), inst = opt.inst;
    const p = this.useMesh(skin, !!inst), U = (n) => this.U(p, n);
    gl.uniformMatrix4fv(U('uModel'), false, model);
    mat = mat || this.defaultMat;
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, mat.base || this.white);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, mat.emis || this.black);
    gl.uniform4fv(U('uBaseCol'), mat.baseCol); gl.uniform3fv(U('uEmisCol'), mat.emisCol); gl.uniform1f(U('uAlphaCut'), mat.alphaCut);
    gl.uniform1f(U('uSpec'), mat.spec); gl.uniform1f(U('uShin'), mat.shin); gl.uniform1f(U('uWet'), mat.wet); gl.uniform1f(U('uGlow'), mat.glow); gl.uniform1f(U('uUnlit'), mat.unlit);
    const t = opt.tint || mat.tint; gl.uniform3f(U('uTint'), t[0], t[1], t[2]); gl.uniform2fv(U('uUVScale'), mat.uvScale); gl.uniform1f(U('uGround'), mat.ground);
    if (mat.ds) gl.disable(gl.CULL_FACE); else gl.enable(gl.CULL_FACE);
    if (skin) { gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, opt.skinTex); }
    gl.bindVertexArray(prim.vao);
    if (!prim.hasCol) gl.vertexAttrib4f(10, 1, 1, 1, 1);
    if (inst) {
      gl.bindBuffer(gl.ARRAY_BUFFER, inst.buf);
      for (let i = 0; i < 4; i++) { gl.enableVertexAttribArray(5 + i); gl.vertexAttribPointer(5 + i, 4, gl.FLOAT, false, 80, i * 16); gl.vertexAttribDivisor(5 + i, 1); }
      gl.enableVertexAttribArray(9); gl.vertexAttribPointer(9, 4, gl.FLOAT, false, 80, 64); gl.vertexAttribDivisor(9, 1);
      if (prim.indexed) gl.drawElementsInstanced(gl.TRIANGLES, prim.count, prim.itype, 0, inst.count); else gl.drawArraysInstanced(gl.TRIANGLES, 0, prim.count, inst.count);
      for (let i = 5; i <= 9; i++) { gl.vertexAttribDivisor(i, 0); gl.disableVertexAttribArray(i); }
      this.stats.tris += (prim.count / 3) * inst.count;
    } else {
      if (prim.indexed) gl.drawElements(gl.TRIANGLES, prim.count, prim.itype, 0); else gl.drawArrays(gl.TRIANGLES, 0, prim.count);
      this.stats.tris += prim.count / 3;
    }
    this.stats.draws++;
  }

  end(dt) {
    const gl = this.gl;
    gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST); gl.depthMask(false); gl.disable(gl.CULL_FACE);
    if (this.ms) { gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.ms.fb); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.scene.fb); gl.blitFramebuffer(0, 0, this.W, this.H, 0, 0, this.W, this.H, gl.COLOR_BUFFER_BIT, gl.NEAREST); }
    gl.bindVertexArray(this.fsVAO);
    const useBloom = this.settings.bloom;
    if (useBloom) {
      const cp = this.pCopy; gl.useProgram(cp); gl.activeTexture(gl.TEXTURE0); gl.uniform1i(this.U(cp, 'uT'), 0); gl.uniform1f(this.U(cp, 'uThr'), this.post.thr);
      let src = this.scene.t, sw = this.W, sh = this.H;
      for (let i = 0; i < this.bloomT.length; i++) {
        const t = this.bloomT[i]; gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb); gl.viewport(0, 0, t.w, t.h);
        gl.uniform1i(this.U(cp, 'uMode'), i === 0 ? 0 : 1); gl.uniform2f(this.U(cp, 'uTexel'), 1 / sw, 1 / sh);
        gl.bindTexture(gl.TEXTURE_2D, src); gl.drawArrays(gl.TRIANGLES, 0, 3); src = t.t; sw = t.w; sh = t.h;
      }
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
      for (let i = this.bloomT.length - 1; i > 0; i--) {
        const t = this.bloomT[i], d = this.bloomT[i - 1]; gl.bindFramebuffer(gl.FRAMEBUFFER, d.fb); gl.viewport(0, 0, d.w, d.h);
        gl.uniform1i(this.U(cp, 'uMode'), 2); gl.uniform2f(this.U(cp, 'uTexel'), 1 / t.w, 1 / t.h); gl.bindTexture(gl.TEXTURE_2D, t.t); gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      gl.disable(gl.BLEND);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, this.W, this.H);
    const p = this.pPost; gl.useProgram(p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.scene.t); gl.uniform1i(this.U(p, 'uScene'), 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, useBloom ? this.bloomT[0].t : this.black); gl.uniform1i(this.U(p, 'uBloom'), 1);
    gl.uniform1f(this.U(p, 'uBloomK'), useBloom ? this.post.bloom : 0); gl.uniform1f(this.U(p, 'uTime'), this.time % 100); gl.uniform1f(this.U(p, 'uAber'), this.post.aber);
    gl.uniform1f(this.U(p, 'uHurt'), this.post.hurt); gl.uniform1f(this.U(p, 'uRain'), this.post.rain); gl.uniform2f(this.U(p, 'uRes'), this.W, this.H);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.activeTexture(gl.TEXTURE0);
  }

  /* ---- particles (billboards) ---- */
  _initParticles() {
    const gl = this.gl;
    this.pPart = this.prog('part', VS_PART, FS_PART);
    this.partCap = 6000;
    this.partVAO = gl.createVertexArray(); gl.bindVertexArray(this.partVAO);
    this.partQ = this.buf(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]));
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.partBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.partBuf); gl.bufferData(gl.ARRAY_BUFFER, this.partCap * 32, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 0); gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 32, 16); gl.vertexAttribDivisor(2, 1);
    this.partData = new Float32Array(this.partCap * 8);
  }
  // list: flat Float32Array/array of [x,y,z,size,r,g,b,a] * n
  drawParticles(data, n, additive, soft = 3.0) {
    if (!n) return;
    const gl = this.gl, p = this.pPart; gl.useProgram(p); this.cur = p;
    gl.uniformMatrix4fv(this.U(p, 'uVP'), false, this.cam.vp); gl.uniform3fv(this.U(p, 'uRight'), this.cam.right); gl.uniform3fv(this.U(p, 'uUp'), this.cam.up); gl.uniform1f(this.U(p, 'uSoft'), soft);
    gl.enable(gl.BLEND); gl.depthMask(false); gl.disable(gl.CULL_FACE);
    if (additive) gl.blendFunc(gl.ONE, gl.ONE); else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(this.partVAO); gl.bindBuffer(gl.ARRAY_BUFFER, this.partBuf);
    n = Math.min(n, this.partCap);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, n * 8);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
    gl.disable(gl.BLEND); gl.depthMask(true);
  }

  /* ---- dynamic instanced meshes ---- */
  makeInstSet(mesh, cap) {
    const gl = this.gl, buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, cap * 80, gl.DYNAMIC_DRAW);
    return { mesh, buf, cap, count: 0, data: new Float32Array(cap * 20) };
  }
  pushInst(s, mat16, col) {
    if (s.count >= s.cap) return; const o = s.count * 20; s.data.set(mat16, o); s.data[o + 16] = col[0]; s.data[o + 17] = col[1]; s.data[o + 18] = col[2]; s.data[o + 19] = col[3] === undefined ? 1 : col[3]; s.count++;
  }
  flushInst(s) { const gl = this.gl; gl.bindBuffer(gl.ARRAY_BUFFER, s.buf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, s.data, 0, s.count * 20); }
  drawInstSet(s, opt) { if (!s.count) return; this.flushInst(s); this.drawMesh(s.mesh, m4.create(), { ...opt, inst: s }); }
  // static instance buffer from list of mat16 (+ optional colours)
  staticInst(mats, cols) {
    const gl = this.gl, n = mats.length, d = new Float32Array(n * 20);
    for (let i = 0; i < n; i++) { d.set(mats[i], i * 20); const c = cols ? cols[i] : [1, 1, 1, 1]; d[i * 20 + 16] = c[0]; d[i * 20 + 17] = c[1]; d[i * 20 + 18] = c[2]; d[i * 20 + 19] = c[3] === undefined ? 1 : c[3]; }
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, d, gl.STATIC_DRAW);
    return { buf, count: n, cap: n };
  }
  drawMesh(mesh, model, opt) { for (const p of mesh.prims) this.drawPrim(p, p.mat, model, opt); }
}

/* ============================ MESH BUILDER ============================ */
export class MeshBuilder {
  constructor() { this.p = []; this.n = []; this.uv = []; this.c = []; this.i = []; this.j = []; this.cj = -1; }
  get vcount() { return this.p.length / 3; }
  vert(x, y, z, nx, ny, nz, u, v, c) { this.p.push(x, y, z); this.n.push(nx, ny, nz); this.uv.push(u, v); this.c.push(c[0], c[1], c[2], c[3] === undefined ? 1 : c[3]); if (this.cj >= 0) this.j.push(this.cj); return this.p.length / 3 - 1; }
  tri(a, b, c) { this.i.push(a, b, c); }
  quad(a, b, c, d) { this.i.push(a, b, c, a, c, d); }
  // oriented box: center, half sizes, yaw, colour, uv scale (metres per tile) ; skip faces mask
  box(cx, cy, cz, hx, hy, hz, yaw, col, uvm = 0, opts = {}) {
    const s = Math.sin(yaw), co = Math.cos(yaw);
    const T = (x, y, z) => [cx + x * co + z * s, cy + y, cz - x * s + z * co];
    const N = (x, y, z) => [x * co + z * s, y, -x * s + z * co];
    const faces = [
      [[1, 0, 0], [[hx, -hy, hz], [hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz]], hz * 2, hy * 2],
      [[-1, 0, 0], [[-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz]], hz * 2, hy * 2],
      [[0, 1, 0], [[-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz], [-hx, hy, -hz]], hx * 2, hz * 2],
      [[0, -1, 0], [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz]], hx * 2, hz * 2],
      [[0, 0, 1], [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]], hx * 2, hy * 2],
      [[0, 0, -1], [[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz]], hx * 2, hy * 2],
    ];
    faces.forEach((f, fi) => {
      if (opts.skip && opts.skip.includes(fi)) return;
      const nn = N(...f[0]); const k = uvm > 0 ? 1 / uvm : 1; const uo = opts.uo || 0, vo = opts.vo || 0;
      const ids = f[1].map((pt, j) => { const w = T(...pt); const u = [0, 1, 1, 0][j] * f[2] * k + uo, v = [1, 1, 0, 0][j] * f[3] * k + vo; const cc = opts.faceCol && opts.faceCol[fi] ? opts.faceCol[fi] : col; return this.vert(w[0], w[1], w[2], nn[0], nn[1], nn[2], u, v, cc); });
      this.quad(ids[0], ids[1], ids[2], ids[3]);
    });
  }
  // upright cylinder / cone-ish (r0 bottom, r1 top)
  cyl(cx, cy, cz, r0, r1, h, seg, col, caps = true) {
    const base = this.vcount;
    for (let i = 0; i <= seg; i++) {
      const a = i / seg * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a), sl = (r0 - r1) / h, nl = Math.hypot(1, sl), n = [ca / nl, (sl) / nl, sa / nl];
      this.vert(cx + ca * r0, cy, cz + sa * r0, n[0], n[1], n[2], i / seg, 1, col); this.vert(cx + ca * r1, cy + h, cz + sa * r1, n[0], n[1], n[2], i / seg, 0, col);
    }
    for (let i = 0; i < seg; i++) { const a = base + i * 2; this.quad(a, a + 2, a + 3, a + 1); }
    if (caps) { const tc = this.vert(cx, cy + h, cz, 0, 1, 0, .5, .5, col); for (let i = 0; i < seg; i++) { const a0 = i / seg * Math.PI * 2, a1 = (i + 1) / seg * Math.PI * 2; const p0 = this.vert(cx + Math.cos(a0) * r1, cy + h, cz + Math.sin(a0) * r1, 0, 1, 0, 0, 0, col), p1 = this.vert(cx + Math.cos(a1) * r1, cy + h, cz + Math.sin(a1) * r1, 0, 1, 0, 0, 0, col); this.tri(tc, p1, p0); } }
  }
  sphere(cx, cy, cz, rx, ry, rz, seg, col, bone = -1) {
    const base = this.vcount;
    for (let j = 0; j <= seg; j++) for (let i = 0; i <= seg * 2; i++) {
      const th = j / seg * Math.PI, ph = i / (seg * 2) * Math.PI * 2, x = Math.sin(th) * Math.cos(ph), y = Math.cos(th), z = Math.sin(th) * Math.sin(ph);
      this.vert(cx + x * rx, cy + y * ry, cz + z * rz, x, y, z, i / (seg * 2), j / seg, col);
    }
    const w = seg * 2 + 1;
    for (let j = 0; j < seg; j++) for (let i = 0; i < seg * 2; i++) { const a = base + j * w + i; this.quad(a, a + 1, a + w + 1, a + w); }
  }
  // flat quad on XZ (y up) or arbitrary 4 pts
  quadPts(p0, p1, p2, p3, n, col, uvs) { const u = uvs || [[0, 0], [1, 0], [1, 1], [0, 1]]; const a = this.vert(...p0, ...n, ...u[0], col), b = this.vert(...p1, ...n, ...u[1], col), c = this.vert(...p2, ...n, ...u[2], col), d = this.vert(...p3, ...n, ...u[3], col); this.quad(a, b, c, d); }
  build(R, mat) {
    const gl = R.gl, vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    const bind = (loc, data, size) => { const b = R.buf(gl.ARRAY_BUFFER, data); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0); return b; };
    bind(0, new Float32Array(this.p), 3); bind(1, new Float32Array(this.n), 3); bind(2, new Float32Array(this.uv), 2); bind(10, new Float32Array(this.c), 4);
    const skinned = this.j.length > 0;
    if (skinned) {
      const nj = this.j.length, J = new Uint8Array(nj * 4), W = new Float32Array(nj * 4);
      for (let k = 0; k < nj; k++) { J[k * 4] = this.j[k]; W[k * 4] = 1; }
      R.buf(gl.ARRAY_BUFFER, J); gl.enableVertexAttribArray(3); gl.vertexAttribIPointer(3, 4, gl.UNSIGNED_BYTE, 0, 0);
      R.buf(gl.ARRAY_BUFFER, W); gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 4, gl.FLOAT, false, 0, 0);
    }
    const big = this.vcount > 65535;
    R.buf(gl.ELEMENT_ARRAY_BUFFER, big ? new Uint32Array(this.i) : new Uint16Array(this.i));
    gl.bindVertexArray(null);
    // bounds
    const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    for (let i = 0; i < this.p.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], this.p[i + k]); mx[k] = Math.max(mx[k], this.p[i + k]); }
    const prim = { vao, count: this.i.length, indexed: true, itype: big ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, skinned, hasCol: true, mat: mat || R.defaultMat };
    return { prims: [prim], min: mn, max: mx };
  }
}

/* ============================ GLB MODEL ============================ */
const CT = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };

async function fetchProgress(url, onBytes) {
  const res = await fetch(url); if (!res.ok) throw new Error('Không tải được ' + url);
  const total = +res.headers.get('content-length') || 0;
  if (!res.body || !res.body.getReader) { const b = await res.arrayBuffer(); onBytes && onBytes(b.byteLength, b.byteLength); return b; }
  const reader = res.body.getReader(); const chunks = []; let got = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); got += value.length; onBytes && onBytes(got, total); }
  const out = new Uint8Array(got); let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; }
  return out.buffer;
}

export class Model {
  constructor(R, gltf, bin) { this.R = R; this.gltf = gltf; this.bin = bin; }
  accessor(i) {
    const g = this.gltf, a = g.accessors[i], bv = g.bufferViews[a.bufferView], T = CT[a.componentType], nc = NC[a.type];
    const off = (bv.byteOffset || 0) + (a.byteOffset || 0), es = T.BYTES_PER_ELEMENT, stride = bv.byteStride || nc * es;
    const base = this.bin.byteOffset + off;
    if (stride === nc * es && base % es === 0) return { data: new T(this.bin.buffer, base, a.count * nc), nc, count: a.count, a };
    const out = new T(a.count * nc); const dv = new DataView(this.bin.buffer, this.bin.byteOffset);
    for (let n = 0; n < a.count; n++) for (let k = 0; k < nc; k++) {
      const p = off + n * stride + k * es; out[n * nc + k] = T === Float32Array ? dv.getFloat32(p, true) : T === Uint16Array ? dv.getUint16(p, true) : T === Int16Array ? dv.getInt16(p, true) : T === Uint32Array ? dv.getUint32(p, true) : T === Int8Array ? dv.getInt8(p) : dv.getUint8(p);
    }
    return { data: out, nc, count: a.count, a };
  }
  async build(overrides) {
    const R = this.R, gl = R.gl, g = this.gltf;
    // textures
    const imgs = await Promise.all((g.images || []).map(async (im) => {
      const bv = g.bufferViews[im.bufferView]; const blob = new Blob([this.bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength)], { type: im.mimeType });
      try { return await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none', imageOrientation: 'none' }); } catch (e) { return await createImageBitmap(blob); }
    }));
    const texCache = new Map();
    const getTex = (ti) => {
      if (ti === undefined) return null; if (texCache.has(ti)) return texCache.get(ti);
      const im = imgs[g.textures[ti].source]; const t = R.makeTex(im, im.width, im.height, { srgb: true }); if (im.close) im.close(); texCache.set(ti, t); return t;
    };
    this.materials = (g.materials || []).map((m, mi) => {
      const pb = m.pbrMetallicRoughness || {}, e = m.emissiveFactor || [0, 0, 0];
      const mat = { ...R.defaultMat, name: m.name || ('m' + mi), tint: [1, 1, 1], uvScale: [1, 1] };
      mat.base = pb.baseColorTexture ? getTex(pb.baseColorTexture.index) : null; mat.emis = m.emissiveTexture ? getTex(m.emissiveTexture.index) : null;
      mat.baseCol = pb.baseColorFactor ? pb.baseColorFactor.slice() : [1, 1, 1, 1]; mat.emisCol = m.emissiveTexture || e[0] + e[1] + e[2] > 0 ? e.slice() : [0, 0, 0];
      if (m.emissiveTexture && !m.emissiveFactor) mat.emisCol = [1, 1, 1];
      mat.alphaCut = m.alphaMode === 'MASK' ? (m.alphaCutoff ?? 0.5) : 0; mat.ds = !!m.doubleSided; mat.hidden = false;
      if (overrides) overrides(mat, m);
      return mat;
    });
    // meshes
    this.meshes = (g.meshes || []).map((m) => ({
      name: m.name, prims: m.primitives.map((pr) => {
        const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
        const A = pr.attributes; let cnt = 0, mn = null, mx = null;
        const pos = this.accessor(A.POSITION); mn = pos.a.min; mx = pos.a.max; cnt = pos.count;
        const att = (loc, acc, ptype, norm, integer) => {
          const b = R.buf(gl.ARRAY_BUFFER, acc.data); gl.enableVertexAttribArray(loc);
          if (integer) gl.vertexAttribIPointer(loc, acc.nc, ptype, 0, 0); else gl.vertexAttribPointer(loc, acc.nc, ptype, norm, 0, 0);
        };
        att(0, pos, gl.FLOAT, false);
        if (A.NORMAL !== undefined) att(1, this.accessor(A.NORMAL), gl.FLOAT, false); else gl.vertexAttrib3f(1, 0, 1, 0);
        if (A.TEXCOORD_0 !== undefined) { const t = this.accessor(A.TEXCOORD_0); att(2, t, t.a.componentType === 5126 ? gl.FLOAT : (t.a.componentType === 5123 ? gl.UNSIGNED_SHORT : gl.UNSIGNED_BYTE), t.a.componentType !== 5126); }
        let skinned = false;
        if (A.JOINTS_0 !== undefined && A.WEIGHTS_0 !== undefined) {
          const j = this.accessor(A.JOINTS_0), w = this.accessor(A.WEIGHTS_0);
          att(3, j, j.a.componentType === 5121 ? gl.UNSIGNED_BYTE : gl.UNSIGNED_SHORT, false, true);
          att(4, w, w.a.componentType === 5126 ? gl.FLOAT : (w.a.componentType === 5121 ? gl.UNSIGNED_BYTE : gl.UNSIGNED_SHORT), w.a.componentType !== 5126);
          skinned = true;
        }
        let indexed = false, count = cnt, itype = 0;
        if (pr.indices !== undefined) {
          const ix = this.accessor(pr.indices); let d = ix.data; itype = ix.a.componentType === 5125 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
          if (ix.a.componentType === 5121) d = new Uint16Array(d);
          R.buf(gl.ELEMENT_ARRAY_BUFFER, d); indexed = true; count = ix.count;
        }
        gl.bindVertexArray(null);
        return { vao, count, indexed, itype, skinned, hasCol: false, mat: this.materials[pr.material] || R.defaultMat, min: mn, max: mx, mode: pr.mode ?? 4 };
      }),
    }));
    // nodes
    const N = g.nodes; this.N = N.length; this.parent = new Int32Array(N.length).fill(-1);
    N.forEach((n, i) => (n.children || []).forEach((c) => (this.parent[c] = i)));
    this.order = []; const visit = (i) => { this.order.push(i); (N[i].children || []).forEach(visit); };
    (g.scenes[g.scene || 0].nodes || []).forEach(visit);
    this.names = N.map((n) => n.name || ''); this.byName = new Map(); this.names.forEach((n, i) => { if (n) this.byName.set(n, i); });
    this.skins = (g.skins || []).map((s) => {
      const ibm = this.accessor(s.inverseBindMatrices).data; return { joints: s.joints, ibm: new Float32Array(ibm), n: s.joints.length };
    });
    // bind pose globals
    const inst = this.instance(); inst.update(m4.create()); this.bindWorld = inst.world.map((m) => m.slice());
    this.bindInst = inst;
    return this;
  }
  instance() { return new ModelInstance(this); }
  // flatten static model into [{prim, mat(model-space matrix), meshIndex}] using bind pose
  flatten() {
    const out = [];
    for (const i of this.order) { const n = this.gltf.nodes[i]; if (n.mesh !== undefined) for (const p of this.meshes[n.mesh].prims) out.push({ prim: p, matrix: this.bindWorld[i], node: i, name: this.names[i] }); }
    return out;
  }
}

export class ModelInstance {
  constructor(model) {
    this.model = model; const n = model.N, g = model.gltf.nodes;
    this.t = new Array(n); this.r = new Array(n); this.s = new Array(n); this.local = new Array(n); this.world = new Array(n);
    for (let i = 0; i < n; i++) {
      const nd = g[i]; this.local[i] = m4.create(); this.world[i] = m4.create();
      if (nd.matrix) { const m = new Float32Array(nd.matrix); this.t[i] = [m[12], m[13], m[14]]; this.s[i] = [Math.hypot(m[0], m[1], m[2]), Math.hypot(m[4], m[5], m[6]), Math.hypot(m[8], m[9], m[10])]; this.r[i] = m4.toQuat(m); }
      else { this.t[i] = (nd.translation || [0, 0, 0]).slice(); this.r[i] = (nd.rotation || [0, 0, 0, 1]).slice(); this.s[i] = (nd.scale || [1, 1, 1]).slice(); }
    }
    this.bind = { t: this.t.map((x) => x.slice()), r: this.r.map((x) => x.slice()), s: this.s.map((x) => x.slice()) };
    this.skinData = model.skins.map((s) => ({ mats: new Float32Array(s.n * 16), tex: null }));
    this.hidden = new Set(); this.tmp = m4.create();
  }
  resetPose() { const b = this.bind; for (let i = 0; i < this.t.length; i++) { this.t[i] = b.t[i].slice(); this.r[i] = b.r[i].slice(); this.s[i] = b.s[i].slice(); } }
  update(root) {
    const M = this.model, o = M.order, par = M.parent;
    for (let k = 0; k < o.length; k++) {
      const i = o[k]; m4.fromTRS(this.local[i], this.t[i], this.r[i], this.s[i]);
      if (par[i] >= 0) m4.mul(this.world[i], this.world[par[i]], this.local[i]); else m4.mul(this.world[i], root, this.local[i]);
    }
    M.skins.forEach((s, si) => {
      const d = this.skinData[si], tmp = this.tmp;
      for (let j = 0; j < s.n; j++) { m4.mul(tmp, this.world[s.joints[j]], s.ibm.subarray(j * 16, j * 16 + 16)); d.mats.set(tmp, j * 16); }
      this.uploadSkin(si);
    });
  }
  uploadSkin(si) {
    const R = this.model.R, gl = R.gl, d = this.skinData[si], n = this.model.skins[si].n;
    if (!d.tex) {
      d.tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, d.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, n * 4, 1, 0, gl.RGBA, gl.FLOAT, d.mats);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    } else { gl.bindTexture(gl.TEXTURE_2D, d.tex); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, n * 4, 1, gl.RGBA, gl.FLOAT, d.mats); }
  }
  draw(R, model, opt = {}) {
    const M = this.model, g = M.gltf.nodes, I = this.rootI || (this.rootI = m4.create());
    for (const i of M.order) {
      const n = g[i]; if (n.mesh === undefined || this.hidden.has(i)) continue;
      const skinTex = n.skin !== undefined ? this.skinData[n.skin].tex : null;
      for (const p of M.meshes[n.mesh].prims) {
        if (p.mat.hidden) continue;
        if (skinTex && p.skinned) R.drawPrim(p, p.mat, model, { skinTex, tint: p.mat.tintOverride || (opt.tint && p.mat.tintable ? opt.tint : null) });
        else R.drawPrim(p, p.mat, skinTex ? model : this._m(model, this.world[i]), { tint: opt.tint && p.mat.tintable ? opt.tint : null });
      }
    }
  }
  _m(model, w) { const o = this._mm || (this._mm = m4.create()); return m4.mul(o, model, w); }
}

export async function loadModel(R, url, onBytes, overrides) {
  const buf = await fetchProgress(url, onBytes);
  const dv = new DataView(buf); if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('GLB lỗi: ' + url);
  const jl = dv.getUint32(12, true), json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jl)));
  const off = 20 + jl, bl = dv.getUint32(off, true), bin = new Uint8Array(buf, off + 8, bl);
  const m = new Model(R, json, bin); await m.build(overrides); m.bin = null; return m;
}

export function boundsOf(model) { // AABB of all mesh prims in bind pose (via accessor min/max corners)
  const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9]; const g = model.gltf.nodes;
  for (const i of model.order) {
    const n = g[i]; if (n.mesh === undefined) continue; const W = model.bindWorld[i], sk = n.skin !== undefined;
    for (const p of model.meshes[n.mesh].prims) for (let c = 0; c < 8; c++) {
      const pt = [c & 1 ? p.max[0] : p.min[0], c & 2 ? p.max[1] : p.min[1], c & 4 ? p.max[2] : p.min[2]]; const w = sk ? pt : m4.point(W, pt);
      for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], w[k]); mx[k] = Math.max(mx[k], w[k]); }
    }
  }
  return { min: mn, max: mx };
}
