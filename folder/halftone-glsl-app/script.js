// Halftone Overprint — plain JavaScript + WebGL, no libraries.
// Layer 1: <img id="base"> shows the photo.
// Layer 2: <canvas id="pattern"> draws the halftone; CSS mix-blend-mode multiplies it onto the photo.
//
// The pattern is rendered in 3 GPU passes:
//   1. horizontal Gaussian blur (linear light)  -> texture A
//   2. vertical Gaussian blur                   -> texture B
//   3. halftone: rotated dot grid per ink, dot size from the blurred tone -> canvas

/* ------------------------------------------------------------------ */
/* Shaders                                                             */
/* ------------------------------------------------------------------ */

const VERT = `
attribute vec2 aPos;
varying vec2 vUV;
void main() {
  vUV = aPos * 0.5 + 0.5;          // 0..1, origin bottom-left (GL convention)
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const COLOR_FNS = `
float s2l(float v) { return v > 0.04045 ? pow((v + 0.055) / 1.055, 2.4) : v / 12.92; }
float l2s(float v) { return v > 0.0031308 ? 1.055 * pow(v, 0.41666) - 0.055 : v * 12.92; }
vec3 s2l3(vec3 c) { return vec3(s2l(c.r), s2l(c.g), s2l(c.b)); }
vec3 l2s3(vec3 c) { return vec3(l2s(c.r), l2s(c.g), l2s(c.b)); }
`;

const BLUR_FRAG = `
precision highp float;
varying vec2 vUV;
uniform sampler2D uTex;
uniform vec2 uDir;            // (1,0) horizontal, (0,1) vertical
uniform float uRadius;        // pixels
uniform vec2 uTexSize;
uniform float uWeights[65];
uniform float uNorm;
${COLOR_FNS}
void main() {
  vec2 texel = 1.0 / uTexSize;
  vec4 sum = vec4(0.0);
  for (int i = 0; i < 65; i++) {
    float fi = float(i - 32);
    vec2 uv = clamp(vUV + uDir * texel * fi * (uRadius / 32.0), 0.0, 1.0);
    vec4 c = texture2D(uTex, uv);
    sum += vec4(s2l3(c.rgb), c.a) * uWeights[i];   // average in linear light
  }
  sum /= max(uNorm, 0.0001);
  gl_FragColor = vec4(l2s3(sum.rgb), sum.a);
}`;

const HALFTONE_FRAG = `
precision highp float;
varying vec2 vUV;
uniform sampler2D uInput;      // original image (for alpha)
uniform sampler2D uBlurred;    // blurred image (tone per dot)
uniform float uDotSize, uDotScale, uSoftness, uRotation;
uniform vec2 uCenter, uDims;   // pixels, y-down
uniform float uClip, uType, uMode;
const float TAU = 6.28318530718;
const float INV_PI = 0.3183098862;
${COLOR_FNS}

mat2 rot(float t) { float c = cos(t), s = sin(t); return mat2(c, -s, s, c); }
vec2 toGrid(vec2 p, float th)  { return (rot(th) * (p - uCenter)) / uDotSize; }
vec2 toLocal(vec2 g, float th) { return rot(-th) * (g * uDotSize) + uCenter; }

vec4 rgbToCmyk(vec3 c) {
  float k = 1.0 - max(c.r, max(c.g, c.b));
  if (k >= 1.0) return vec4(0.0, 0.0, 0.0, 1.0);
  float inv = 1.0 / (1.0 - k);
  return vec4((1.0 - c.r - k) * inv, (1.0 - c.g - k) * inv, (1.0 - c.b - k) * inv, k);
}
vec3 cmykToRgb(vec4 k) { return (1.0 - k.xyz) * (1.0 - k.w); }

// Ink coverage -> dot radius in grid cells.
// pi * r^2 = coverage, then a fitted curve once dots touch (r >= 0.5).
float radiusFor(float v) {
  if (v <= 0.0) return 0.0;
  float r = sqrt(v * INV_PI);
  if (r >= 0.5) r = (1.414 - pow(max(0.001, 1.0 - v) / 1.673, 1.0 / 2.33)) * 0.5;
  return r;
}

// 1 inside, 0 outside, soft edge between lo and hi.
float edgeMask(float hi, float lo, float x) { return 1.0 - smoothstep(lo, hi, x); }

// Sample the blurred texture with a y-down pixel position.
vec4 sampleBlur(vec2 p) {
  vec2 uv = clamp(p / uDims, 0.0, 1.0);
  return texture2D(uBlurred, vec2(uv.x, 1.0 - uv.y));
}

// Ink amount per channel at one dot centre.
vec4 cellInk(vec2 cell, float th) {
  vec4 c = sampleBlur(toLocal(cell, th));
  if (uMode < 0.5) return mix(vec4(0.0), rgbToCmyk(s2l3(c.rgb)), c.a);  // CMYK
  if (uMode < 1.5) return vec4(s2l3(c.rgb * c.a), 0.0);                  // RGB
  float l = s2l(dot(c.rgb, vec3(0.299, 0.587, 0.114)));
  if (uMode < 2.5) l = 1.0 - l;                                          // BW light
  return vec4(l * c.a);
}

// Dot screen for one channel: own cell + 8 neighbours (big dots spill over).
float dotScreen(vec2 lp, float th, vec4 mask) {
  vec2 g = toGrid(lp, th);
  vec2 base = floor(g + 0.5);
  float sum = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 cc = base + vec2(float(x), float(y));
      float r = radiusFor(dot(cellInk(cc, th), mask)) * uDotScale;
      sum += edgeMask(r * (1.0 + uSoftness), r * (1.0 - uSoftness) - 0.001, length(g - cc));
    }
  }
  return min(1.0, sum);
}

// "Blended": threshold a smooth cosine field per pixel (Euclidean dot).
float euclid(float v, vec2 lp, float th) {
  vec2 g = toGrid(lp, th);
  float field = 0.5 - 0.25 * (cos(g.x * TAU) + cos(g.y * TAU));
  return edgeMask(v * (1.0 + uSoftness), v * (1.0 - uSoftness) - 0.001, field);
}

void main() {
  vec2 lp = vec2(vUV.x, 1.0 - vUV.y) * uDims;   // pixel position, y-down
  float inA = texture2D(uInput, vUV).a;
  float r = uRotation;
  float a15 = radians(15.0), a75 = radians(75.0), a45 = radians(45.0);
  vec3 color = vec3(0.0);

  if (uType < 0.5) {
    if (uMode < 0.5) {
      vec4 k = vec4(dotScreen(lp, r + a15, vec4(1, 0, 0, 0)),   // C 15
                    dotScreen(lp, r + a75, vec4(0, 1, 0, 0)),   // M 75
                    dotScreen(lp, r,       vec4(0, 0, 1, 0)),   // Y 0
                    dotScreen(lp, r + a45, vec4(0, 0, 0, 1)));  // K 45
      color = cmykToRgb(k);
    } else if (uMode < 1.5) {
      color = vec3(dotScreen(lp, r + a15, vec4(1, 0, 0, 0)),
                   dotScreen(lp, r + a75, vec4(0, 1, 0, 0)),
                   dotScreen(lp, r,       vec4(0, 0, 1, 0)));
    } else if (uMode < 2.5) {
      color = vec3(1.0 - dotScreen(lp, r + a45, vec4(1, 0, 0, 0)));
    } else {
      color = vec3(dotScreen(lp, r + a45, vec4(1, 0, 0, 0)));
    }
  } else {
    vec4 b = sampleBlur(lp);
    vec3 avg = s2l3(b.rgb);
    if (uMode < 0.5) {
      vec4 k = rgbToCmyk(mix(vec3(1.0), avg, inA)) * uDotScale;
      color = cmykToRgb(vec4(euclid(k.x, lp, r + a15), euclid(k.y, lp, r + a75),
                             euclid(k.z, lp, r),       euclid(k.w, lp, r + a45)));
    } else if (uMode < 1.5) {
      vec3 v = avg * inA * uDotScale;
      color = vec3(euclid(v.x, lp, r + a15), euclid(v.y, lp, r + a75), euclid(v.z, lp, r));
    } else {
      float l = clamp(s2l(dot(b.rgb, vec3(0.299, 0.587, 0.114))) * inA * uDotScale, 0.0, 1.0);
      color = uMode < 2.5 ? vec3(1.0 - euclid(1.0 - l, lp, r + a45)) : vec3(euclid(l, lp, r + a45));
    }
  }

  float a = uClip > 0.5 ? inA : 1.0;
  gl_FragColor = vec4(color * a, a);   // premultiplied alpha
}`;

// Gradient map (port of Figma's "Gradient map" effect).
// Each pixel's brightness (Rec.709 luma of the sRGB colour) picks a colour on the gradient.
const GRADMAP_FRAG = `
precision highp float;
varying vec2 vUV;
uniform sampler2D uTex;
uniform vec4 uColors[8];      // sRGB 0..1
uniform float uPos[8];        // 0..1, sorted
uniform float uCount, uRepeat, uScatter, uFreq, uOffset, uMix;
uniform float uPremul;        // input texture is premultiplied
uniform float uInputLinear;   // input colours are linear (halftone output) -> convert to sRGB first
uniform vec2 uDims;           // design units (for scatter noise)

vec3 toLinS(vec3 c)  { return pow(max(c, 0.0), vec3(2.2)); }
vec3 toSrgbS(vec3 c) { return pow(max(c, 0.0), vec3(1.0 / 2.2)); }
float l2s(float c) { return c <= 0.0031308 ? c * 12.92 : 1.055 * pow(c, 1.0 / 2.4) - 0.055; }

vec3 srgbToOklab(vec3 c) {
  vec3 lin = toLinS(c);
  float l = pow(max(0.4121656120 * lin.x + 0.5362752080 * lin.y + 0.0514575653 * lin.z, 0.0), 1.0 / 3.0);
  float m = pow(max(0.2118591070 * lin.x + 0.6807189584 * lin.y + 0.1074065790 * lin.z, 0.0), 1.0 / 3.0);
  float s = pow(max(0.0883097947 * lin.x + 0.2818474174 * lin.y + 0.6302613616 * lin.z, 0.0), 1.0 / 3.0);
  return vec3(0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
              1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
              0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s);
}
vec3 oklabToSrgb(vec3 lab) {
  float l = lab.x + 0.3963377774 * lab.y + 0.2158037573 * lab.z;
  float m = lab.x - 0.1055613458 * lab.y - 0.0638541728 * lab.z;
  float s = lab.x - 0.0894841775 * lab.y - 1.2914855480 * lab.z;
  l = l * l * l; m = m * m * m; s = s * s * s;
  vec3 lin = vec3( 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
                  -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
                  -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s);
  return toSrgbS(clamp(lin, 0.0, 1.0));
}
vec4 toMix(vec4 c)   { if (uMix > 1.5) return vec4(srgbToOklab(c.rgb), c.a); if (uMix > 0.5) return vec4(toLinS(c.rgb), c.a); return c; }
vec4 fromMix(vec4 c) { if (uMix > 1.5) return vec4(oklabToSrgb(c.rgb), c.a); if (uMix > 0.5) return vec4(toSrgbS(c.rgb), c.a); return c; }

vec4 ramp(float t) {
  int n = int(uCount + 0.5);
  if (n <= 1 || t <= uPos[0]) return uColors[0];
  vec4 lastC = uColors[0]; float lastP = uPos[0];
  for (int i = 0; i < 8; i++) { if (i == n - 1) { lastC = uColors[i]; lastP = uPos[i]; } }
  if (t >= lastP) return lastC;
  for (int i = 0; i < 7; i++) {
    if (i >= n - 1) break;
    float p1 = uPos[i + 1];
    if (t <= p1) {
      float p0 = uPos[i];
      float f = (t - p0) / max(p1 - p0, 1e-5);
      return fromMix(mix(toMix(uColors[i]), toMix(uColors[i + 1]), f));
    }
  }
  return lastC;
}

float rand3(vec3 p) {
  vec3 p3 = fract(p * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec4 c = texture2D(uTex, vUV);
  vec3 rgb = (uPremul > 0.5 && c.a > 0.0) ? c.rgb / c.a : c.rgb;
  rgb = clamp(rgb, 0.0, 1.0);
  if (uInputLinear > 0.5) rgb = vec3(l2s(rgb.r), l2s(rgb.g), l2s(rgb.b));
  float luma = dot(rgb, vec3(0.2126, 0.7152, 0.0722));

  vec2 localPos = vec2(vUV.x, 1.0 - vUV.y) * uDims;
  float sc = uScatter > 0.0 ? (rand3(vec3(localPos, 1.0)) - 0.5) * uScatter : 0.0;

  float t;
  if (uRepeat < 0.5)      t = clamp(luma + sc - uOffset, 0.0, 1.0);                                  // none
  else if (uRepeat < 1.5) t = fract((luma - uOffset) * uFreq + sc);                                    // repeat
  else                    t = 1.0 - abs(fract((luma - uOffset) * uFreq * 0.5 + sc) - 0.5) * 2.0;       // mirror

  vec4 m = ramp(t);
  gl_FragColor = vec4(m.rgb * m.a * c.a, m.a * c.a);
}`;

/* ------------------------------------------------------------------ */
/* WebGL renderer                                                      */
/* ------------------------------------------------------------------ */

class HalftoneRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl', { premultipliedAlpha: true, preserveDrawingBuffer: true, antialias: false });
    if (!gl) throw new Error('WebGL is not available in this browser.');
    this.gl = gl;
    this.blur = this.program(VERT, BLUR_FRAG);
    this.half = this.program(VERT, HALFTONE_FRAG);
    this.gmap = this.program(VERT, GRADMAP_FRAG);

    // Full-screen quad (two triangles)
    this.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);

    this.srcTex = this.texture();
    this.texA = this.texture(); this.fbA = gl.createFramebuffer();
    this.texB = this.texture(); this.fbB = gl.createFramebuffer();
    this.texC = this.texture(); this.fbC = gl.createFramebuffer();   // gradient map in/out
    this.w = this.h = 0;
  }

  program(vs, fs) {
    const gl = this.gl;
    const compile = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const loc = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const name = gl.getActiveUniform(p, i).name.replace('[0]', '');
      loc[name] = gl.getUniformLocation(p, name);
    }
    return { p, loc, aPos: gl.getAttribLocation(p, 'aPos') };
  }

  texture() {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  // source: an <img> or <canvas> at render resolution.
  // designW/H: the layer size in design units (Figma's frame size). Dot size and center use these units.
  setImage(source, designW, designH) {
    const gl = this.gl;
    this.w = this.canvas.width = source.width;
    this.h = this.canvas.height = source.height;
    this.dw = designW || this.w;
    this.dh = designH || this.h;

    gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);          // image top row -> texture top
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

    for (const [tex, fb] of [[this.texA, this.fbA], [this.texB, this.fbB], [this.texC, this.fbC]]) {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.w, this.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // Gaussian weights. sigma is radius/2 in tap units; taps are radius/32 px apart.
  static weights(radius) {
    const w = new Float32Array(65);
    const sigma = Math.max(radius / 2, 0.5);
    let sum = 0;
    for (let i = 0; i < 65; i++) {
      const t = i - 32;
      w[i] = Math.exp(-(t * t) / (2 * sigma * sigma));
      sum += w[i];
    }
    return { w, sum };
  }

  draw(prog, target) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target);
    gl.viewport(0, 0, this.w, this.h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(prog.aPos);
    gl.vertexAttribPointer(prog.aPos, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  bindTex(unit, tex, loc) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(loc, unit);
  }

  // g = gradient map settings ({ enabled, order: 'after'|'before', stops, ... }) or null
  render(p, g) {
    if (!this.w) return;
    const gl = this.gl;
    const gmOn = g && g.enabled && g.stops.length > 0;
    let src = this.srcTex;
    if (gmOn && g.order === 'before') {          // gradient map the photo, then halftone it
      this.gradientMap(this.srcTex, false, false, g, this.fbC);
      src = this.texC;
    }
    // Same as Figma: blur radius in texture pixels = dotSize * texW / designW
    const radius = p.dotSize * this.w / this.dw;
    const { w: weights, sum } = HalftoneRenderer.weights(radius);

    // Pass 1 + 2: separable blur
    const B = this.blur;
    gl.useProgram(B.p);
    gl.uniform1f(B.loc.uRadius, radius);
    gl.uniform2f(B.loc.uTexSize, this.w, this.h);
    gl.uniform1fv(B.loc.uWeights, weights);
    gl.uniform1f(B.loc.uNorm, sum);

    this.bindTex(0, src, B.loc.uTex);
    gl.uniform2f(B.loc.uDir, 1, 0);
    this.draw(B, this.fbA);

    this.bindTex(0, this.texA, B.loc.uTex);
    gl.uniform2f(B.loc.uDir, 0, 1);
    this.draw(B, this.fbB);

    // Pass 3: halftone to the canvas
    const H = this.half;
    gl.useProgram(H.p);
    this.bindTex(0, src, H.loc.uInput);
    this.bindTex(1, this.texB, H.loc.uBlurred);
    gl.uniform1f(H.loc.uDotSize, p.dotSize);
    gl.uniform1f(H.loc.uDotScale, p.dotScale);
    gl.uniform1f(H.loc.uSoftness, p.softness);
    gl.uniform1f(H.loc.uRotation, p.rotation * Math.PI / 180);
    gl.uniform2f(H.loc.uCenter, p.centerX / 100 * this.dw, p.centerY / 100 * this.dh);
    gl.uniform2f(H.loc.uDims, this.dw, this.dh);   // grid lives in design units
    gl.uniform1f(H.loc.uClip, p.clipToAlpha ? 1 : 0);
    gl.uniform1f(H.loc.uType, p.halftoneType);
    gl.uniform1f(H.loc.uMode, p.colorMode);
    const after = gmOn && g.order !== 'before';
    this.draw(H, after ? this.fbC : null);

    // Pass 4 (optional): gradient map the halftone, like Figma's effect stack
    if (after) this.gradientMap(this.texC, true, true, g, null);
  }

  gradientMap(tex, premul, inputLinear, g, target) {
    const gl = this.gl, G = this.gmap;
    const stops = [...g.stops].sort((a, b) => a.pos - b.pos).slice(0, 8);
    const colors = new Float32Array(32), pos = new Float32Array(8);
    stops.forEach((st, i) => {
      const [r, gg, b] = hexToRgb(st.color);
      colors.set([r, gg, b, 1], i * 4);
      pos[i] = st.pos;
    });
    gl.useProgram(G.p);
    this.bindTex(0, tex, G.loc.uTex);
    gl.uniform4fv(G.loc.uColors, colors);
    gl.uniform1fv(G.loc.uPos, pos);
    gl.uniform1f(G.loc.uCount, stops.length);
    gl.uniform1f(G.loc.uRepeat, { none: 0, repeat: 1, mirror: 2 }[g.repeat] || 0);
    gl.uniform1f(G.loc.uScatter, g.scatter / 100);
    gl.uniform1f(G.loc.uFreq, g.frequency);
    gl.uniform1f(G.loc.uOffset, g.offset / 100);
    gl.uniform1f(G.loc.uMix, { sRGB: 0, Linear: 1, OKLab: 2 }[g.mix] || 0);
    gl.uniform1f(G.loc.uPremul, premul ? 1 : 0);
    gl.uniform1f(G.loc.uInputLinear, inputLinear ? 1 : 0);
    gl.uniform2f(G.loc.uDims, this.dw, this.dh);
    this.draw(G, target);
  }
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}

/* ------------------------------------------------------------------ */
/* App                                                                 */
/* ------------------------------------------------------------------ */

const RENDER_SCALE = 2;      // pattern resolution relative to the layer size (like a 2x screen)
const MAX_TEX = 4096;
const DEFAULTS = {
  halftoneType: 0,   // 0 Dot, 1 Blended
  colorMode: 0,      // 0 CMYK, 1 RGB, 2 BW light, 3 BW dark
  dotSize: 12, dotScale: 1, softness: 0, rotation: 0,
  centerX: 50, centerY: 50, clipToAlpha: false
};
let layerW = 399;            // design width of the layer, like the Figma frame
let sourceImg = null, sourceLabel = '', displayUrl = null;
const PRESETS = {
  'p-default': { ...DEFAULTS, dotSize: 20 },
  'p-shot':    { halftoneType: 0, colorMode: 0, dotSize: 4, dotScale: 1.05, softness: 0, rotation: -180, centerX: 10, centerY: 10, clipToAlpha: false, _layerW: 399, _paper: '#ccd391', _on: 'v-color', _gm: true },
  'p-comic':   { halftoneType: 0, colorMode: 3, dotSize: 14, dotScale: 1.1, softness: 0.15, rotation: 0, centerX: 50, centerY: 50, clipToAlpha: false }
};
const FMT = {
  dotSize: v => v + ' px', dotScale: v => (+v).toFixed(2), softness: v => (+v).toFixed(2),
  rotation: v => v + '°', centerX: v => v + '%', centerY: v => v + '%'
};

const $ = id => document.getElementById(id);
const base = $('base'), patternCanvas = $('pattern'), art = $('art');
let params = { ...DEFAULTS };

// Gradient map settings. Defaults match your Figma panel: teal -> white, applied after the halftone.
const GM_FIGMA = {
  enabled: true, order: 'after', scatter: 0, offset: 0, repeat: 'none', frequency: 2, mix: 'sRGB',
  stops: [{ pos: 0, color: '#8ebfbf' }, { pos: 1, color: '#ffffff' }]
};
let gm = structuredClone(GM_FIGMA);
let renderer, workCanvas, pending = false;

function toast(msg) { $('toast').textContent = msg; }

// What the pattern multiplies onto: the colour, the image, or show the original only.
function setOn(id) {
  art.classList.remove('on-color', 'on-orig');
  if (id === 'v-color') art.classList.add('on-color');
  if (id === 'v-orig') art.classList.add('on-orig');
  document.querySelectorAll('.seg button').forEach(b => b.setAttribute('aria-pressed', String(b.id === id)));
}

function schedule() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => { pending = false; renderer.render(params, gm); });
}

function useSource(source, label, displaySrc) {
  sourceImg = source; sourceLabel = label;
  base.src = displaySrc || source.toDataURL('image/png');
  rebuild();
}

// Layer is layerW design units wide; the pattern renders at RENDER_SCALE x that.
function rebuild() {
  if (!sourceImg) return;
  const designW = layerW;
  const designH = Math.round(layerW * sourceImg.height / sourceImg.width);
  const s = Math.min(RENDER_SCALE, MAX_TEX / Math.max(designW, designH));
  const w = Math.round(designW * s), h = Math.round(designH * s);
  workCanvas = document.createElement('canvas');
  workCanvas.width = w; workCanvas.height = h;
  const ctx = workCanvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(sourceImg, 0, 0, w, h);

  art.style.width = designW + 'px';            // shown at 100% zoom, like Figma
  renderer.setImage(workCanvas, designW, designH);
  $('dims').textContent = `${sourceLabel} · layer ${designW} × ${designH}`;
  schedule();
}

function loadFile(file) {
  if (!file || !file.type.startsWith('image/')) { toast('That file is not an image. Choose a JPG, PNG or WebP.'); return; }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => { useSource(img, file.name, url); toast(''); };
  img.onerror = () => toast('Could not read that image. Try another file.');
  img.src = url;
}

function syncUI() {
  for (const k of Object.keys(FMT)) { $(k).value = params[k]; $(k + '-v').textContent = FMT[k](params[k]); }
  $('layerW').value = layerW;
  $('halftoneType').value = params.halftoneType;
  $('colorMode').value = params.colorMode;
  $('clipToAlpha').checked = !!params.clipToAlpha;
}

function bindUI() {
  for (const k of Object.keys(FMT)) {
    $(k).addEventListener('input', e => { params[k] = +e.target.value; $(k + '-v').textContent = FMT[k](params[k]); schedule(); });
  }
  ['halftoneType', 'colorMode'].forEach(k => $(k).addEventListener('change', e => { params[k] = +e.target.value; schedule(); }));
  $('clipToAlpha').addEventListener('change', e => { params.clipToAlpha = e.target.checked; schedule(); });

  // Layer controls are pure CSS
  $('blend').addEventListener('change', e => { patternCanvas.style.mixBlendMode = e.target.value; });
  $('opacity').addEventListener('input', e => {
    patternCanvas.style.opacity = e.target.value;
    $('opacity-v').textContent = Math.round(e.target.value * 100) + '%';
  });
  ['v-color', 'v-img', 'v-orig'].forEach(id => $(id).addEventListener('click', () => setOn(id)));
  $('paper').addEventListener('input', e => { art.style.background = e.target.value; });
  $('layerW').addEventListener('change', e => {
    layerW = Math.max(50, Math.min(2000, Math.round(+e.target.value) || 399));
    e.target.value = layerW;
    rebuild();
  });

  Object.keys(PRESETS).forEach(id => $(id).addEventListener('click', () => {
    const { _layerW, _paper, _on, _gm, ...p } = PRESETS[id];
    params = { ...DEFAULTS, ...p };
    if (_gm) gm = structuredClone(GM_FIGMA); else gm.enabled = false;
    syncGradientUI();
    if (_paper) { $('paper').value = _paper; art.style.background = _paper; }
    if (_on) setOn(_on);
    if (_layerW && _layerW !== layerW) { layerW = _layerW; rebuild(); }
    syncUI(); schedule();
  }));

  $('pick').addEventListener('click', () => $('file').click());
  $('file').addEventListener('change', e => loadFile(e.target.files[0]));
  $('sample').addEventListener('click', () => useSource(makeSample(1400, 940), 'sample image'));

  const stage = $('stage');
  stage.addEventListener('dragover', e => { e.preventDefault(); stage.classList.add('drag'); });
  stage.addEventListener('dragleave', () => stage.classList.remove('drag'));
  stage.addEventListener('drop', e => { e.preventDefault(); stage.classList.remove('drag'); loadFile(e.dataTransfer.files[0]); });
  window.addEventListener('paste', e => { const f = [...(e.clipboardData?.files || [])][0]; if (f) loadFile(f); });

  bindGradientUI();

  const dl = $('download');
  if (dl) dl.addEventListener('click', downloadPNG);
}

/* ---------- Gradient map UI ---------- */

function gradientCss(stops) {
  return 'linear-gradient(90deg, ' + [...stops].sort((a, b) => a.pos - b.pos)
    .map(s => `${s.color} ${Math.round(s.pos * 100)}%`).join(', ') + ')';
}

function renderStops() {
  const box = $('gm-stops');
  box.innerHTML = '';
  gm.stops.forEach((st, i) => {
    const row = document.createElement('div');
    row.className = 'stop';
    row.innerHTML = `
      <input type="color" id="gm-c${i}" value="${st.color}" aria-label="Stop ${i + 1} colour">
      <input type="range" id="gm-p${i}" min="0" max="100" step="1" value="${Math.round(st.pos * 100)}" aria-label="Stop ${i + 1} position">
      <span class="val" id="gm-pv${i}">${Math.round(st.pos * 100)}%</span>
      <button class="x" id="gm-x${i}" aria-label="Remove stop ${i + 1}" ${gm.stops.length <= 1 ? 'disabled' : ''}>×</button>`;
    box.appendChild(row);
    row.querySelector('[type=color]').addEventListener('input', e => { st.color = e.target.value; gradientChanged(); });
    row.querySelector('[type=range]').addEventListener('input', e => {
      st.pos = e.target.value / 100;
      row.querySelector('.val').textContent = e.target.value + '%';
      gradientChanged();
    });
    row.querySelector('.x').addEventListener('click', () => { gm.stops.splice(i, 1); renderStops(); gradientChanged(); });
  });
  $('gm-add').disabled = gm.stops.length >= 8;
}

function gradientChanged() {
  $('gm-bar').style.background = gradientCss(gm.stops);
  schedule();
}

function syncGradientUI() {
  $('gm-on').checked = gm.enabled;
  $('gm-order').value = gm.order;
  $('gm-scatter').value = gm.scatter; $('gm-scatter-v').textContent = gm.scatter + '%';
  $('gm-offset').value = gm.offset;   $('gm-offset-v').textContent = gm.offset + '%';
  $('gm-repeat').value = gm.repeat;
  $('gm-freq').value = gm.frequency;  $('gm-freq-v').textContent = gm.frequency;
  $('gm-mix').value = gm.mix;
  renderStops();
  gradientChanged();
}

function bindGradientUI() {
  $('gm-on').addEventListener('change', e => { gm.enabled = e.target.checked; schedule(); });
  $('gm-order').addEventListener('change', e => { gm.order = e.target.value; schedule(); });
  $('gm-repeat').addEventListener('change', e => { gm.repeat = e.target.value; schedule(); });
  $('gm-mix').addEventListener('change', e => { gm.mix = e.target.value; schedule(); });
  [['gm-scatter', 'scatter', '%'], ['gm-offset', 'offset', '%'], ['gm-freq', 'frequency', '']].forEach(([id, key, unit]) =>
    $(id).addEventListener('input', e => { gm[key] = +e.target.value; $(id + '-v').textContent = e.target.value + unit; schedule(); }));
  $('gm-add').addEventListener('click', () => {
    if (gm.stops.length >= 8) return;
    const sorted = [...gm.stops].sort((a, b) => a.pos - b.pos);
    const last = sorted[sorted.length - 1], prev = sorted[sorted.length - 2] || { pos: 0 };
    gm.stops.push({ pos: (last.pos + prev.pos) / 2, color: last.color });
    renderStops(); gradientChanged();
  });
  $('gm-flip').addEventListener('click', () => { gm.stops.forEach(st => st.pos = 1 - st.pos); renderStops(); gradientChanged(); });
  $('gm-css').addEventListener('click', () => {
    const text = gradientMapSvg(gm);
    const out = $('gm-css-out');
    out.value = text; out.hidden = false;
    navigator.clipboard.writeText(text)
      .then(() => toast('Copied. Paste the <svg> once in your page, then add class="gradient-map" to any element.'))
      .catch(() => { out.select(); toast('Select the text in the box and copy it.'); });
  });
  syncGradientUI();
}

/* ---------- CSS-only version: SVG filter usable from any stylesheet ---------- */
// Samples the same ramp as the shader into an feComponentTransfer table.
// Scatter (random noise) cannot be expressed in a table, so it is left out.

function rampJS(t, g) {
  const stops = [...g.stops].sort((a, b) => a.pos - b.pos);
  const col = s => hexToRgb(s.color);
  if (stops.length === 1 || t <= stops[0].pos) return col(stops[0]);
  const last = stops[stops.length - 1];
  if (t >= last.pos) return col(last);
  const lin = c => c.map(v => Math.pow(Math.max(v, 0), 2.2));
  const srgb = c => c.map(v => Math.pow(Math.max(v, 0), 1 / 2.2));
  const toLab = c => {
    const [r, g2, b] = lin(c);
    const l = Math.cbrt(0.4121656120 * r + 0.5362752080 * g2 + 0.0514575653 * b);
    const m = Math.cbrt(0.2118591070 * r + 0.6807189584 * g2 + 0.1074065790 * b);
    const s2 = Math.cbrt(0.0883097947 * r + 0.2818474174 * g2 + 0.6302613616 * b);
    return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s2,
            1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s2,
            0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s2];
  };
  const fromLab = ([L, A, B]) => {
    const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
    const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
    const s2 = (L - 0.0894841775 * A - 1.2914855480 * B) ** 3;
    const c = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s2,
              -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s2,
              -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s2].map(v => Math.min(1, Math.max(0, v)));
    return srgb(c);
  };
  const to = g.mix === 'OKLab' ? toLab : g.mix === 'Linear' ? lin : c => c;
  const from = g.mix === 'OKLab' ? fromLab : g.mix === 'Linear' ? srgb : c => c;
  for (let i = 0; i < stops.length - 1; i++) {
    const p0 = stops[i].pos, p1 = stops[i + 1].pos;
    if (t <= p1) {
      const f = (t - p0) / Math.max(p1 - p0, 1e-5);
      const a = to(col(stops[i])), b = to(col(stops[i + 1]));
      return from(a.map((v, k) => v + (b[k] - v) * f));
    }
  }
  return col(last);
}

function gradientMapSvg(g) {
  const N = g.repeat === 'none' ? 33 : 129;
  const fract = x => x - Math.floor(x);
  const off = g.offset / 100;
  const ch = [[], [], []];
  for (let i = 0; i < N; i++) {
    const luma = i / (N - 1);
    let t;
    if (g.repeat === 'repeat') t = fract((luma - off) * g.frequency);
    else if (g.repeat === 'mirror') t = 1 - Math.abs(fract((luma - off) * g.frequency * 0.5) - 0.5) * 2;
    else t = Math.min(1, Math.max(0, luma - off));
    rampJS(t, g).forEach((v, k) => ch[k].push(+v.toFixed(4)));
  }
  return `<!-- Gradient map as an SVG filter. Paste once anywhere in <body>. -->
<svg width="0" height="0" style="position:absolute" aria-hidden="true">
  <filter id="gradient-map" color-interpolation-filters="sRGB">
    <!-- 1. brightness (Rec.709 luma) into R, G and B -->
    <feColorMatrix type="matrix" values="0.2126 0.7152 0.0722 0 0  0.2126 0.7152 0.0722 0 0  0.2126 0.7152 0.0722 0 0  0 0 0 1 0"/>
    <!-- 2. brightness -> gradient colour -->
    <feComponentTransfer>
      <feFuncR type="table" tableValues="${ch[0].join(' ')}"/>
      <feFuncG type="table" tableValues="${ch[1].join(' ')}"/>
      <feFuncB type="table" tableValues="${ch[2].join(' ')}"/>
    </feComponentTransfer>
  </filter>
</svg>

<style>
  .gradient-map { filter: url(#gradient-map); }
</style>`;
}

// Flatten both layers with the same blend mode the CSS uses.
function downloadPNG() {
  renderer.render(params, gm);
  const out = document.createElement('canvas');
  out.width = workCanvas.width; out.height = workCanvas.height;
  const ctx = out.getContext('2d');
  ctx.fillStyle = $('paper').value;
  ctx.fillRect(0, 0, out.width, out.height);
  if (!art.classList.contains('on-color')) ctx.drawImage(workCanvas, 0, 0);
  if (!art.classList.contains('on-orig')) {
    const mode = $('blend').value;
    ctx.globalCompositeOperation = mode === 'normal' ? 'source-over' : mode;
    ctx.globalAlpha = +$('opacity').value;
    ctx.drawImage(patternCanvas, 0, 0);
  }
  out.toBlob(blob => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'halftone.png';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }, 'image/png');
}

// Sample: sunset scene, grey ramp and hue sweep so every ink channel shows.
function makeSample(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const sky = ctx.createLinearGradient(0, 0, 0, h * 0.62);
  sky.addColorStop(0, '#1d4f91'); sky.addColorStop(0.55, '#e7739a'); sky.addColorStop(1, '#ffc46b');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h * 0.62);
  ctx.fillStyle = '#fff3c4'; ctx.beginPath(); ctx.arc(w * 0.7, h * 0.45, h * 0.17, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#2d6a4f'; ctx.beginPath(); ctx.moveTo(0, h * 0.62);
  for (let x = 0; x <= w; x += 20) ctx.lineTo(x, h * 0.55 + Math.sin(x / 140) * 30 + Math.sin(x / 47) * 10);
  ctx.lineTo(w, h * 0.62); ctx.fill();
  const sea = ctx.createLinearGradient(0, h * 0.62, 0, h * 0.82);
  sea.addColorStop(0, '#0f6e8c'); sea.addColorStop(1, '#06283d');
  ctx.fillStyle = sea; ctx.fillRect(0, h * 0.62, w, h * 0.2);
  for (let x = 0; x < w; x++) { const v = Math.round(255 * x / w); ctx.fillStyle = `rgb(${v},${v},${v})`; ctx.fillRect(x, h * 0.82, 1, h * 0.09); }
  for (let x = 0; x < w; x++) { ctx.fillStyle = `hsl(${360 * x / w},90%,50%)`; ctx.fillRect(x, h * 0.91, 1, h * 0.09); }
  return c;
}

try {
  renderer = new HalftoneRenderer(patternCanvas);
  bindUI();
  syncUI();
  setOn('v-color');
  art.style.background = $('paper').value;
  useSource(makeSample(1400, 940), 'sample image');
  $('p-shot').click();                       // start with the settings from your Figma panel
} catch (err) {
  toast(err.message);
  console.error(err);
}
