import { Filter, GlProgram, GpuProgram, UniformGroup } from 'pixi.js';

// Halftone shader. Coordinates are in design units, matching the commit:
// designPos = local / outputSize * designSize.
const WGSL = /* wgsl */ `
diagnostic(off, derivative_uniformity);

struct GlobalFilterUniforms {
  uInputSize: vec4<f32>,
  uInputPixel: vec4<f32>,
  uInputClamp: vec4<f32>,
  uOutputFrame: vec4<f32>,
  uGlobalFrame: vec4<f32>,
  uOutputTexture: vec4<f32>,
};

struct HalftoneUniforms {
  p0: vec4<f32>, // dotSize, dotScale, softness, rotation
  p1: vec4<f32>, // center x, center y, colorMode, reveal
  p2: vec4<f32>, // halftoneType, clipToAlpha, negative, unused
  p3: vec4<f32>, // design width, design height, unused, unused
  p4: vec4<f32>, // reserved
  colors: array<vec4<f32>, 8>,
  positions: array<f32, 8>,
  gmeta: vec4<f32>,  // count, mixSpace, repeat, scatter
  gmeta2: vec4<f32>, // frequency, offset, unused, enabled
};

@group(0) @binding(0) var<uniform> gfu: GlobalFilterUniforms;
@group(1) @binding(0) var<uniform> halftoneUniforms: HalftoneUniforms;
@group(1) @binding(1) var uBlur: texture_2d<f32>;
@group(1) @binding(2) var uBlurSampler: sampler;
@group(1) @binding(3) var uInput: texture_2d<f32>;
@group(1) @binding(4) var uInputSampler: sampler;

const INV_PI: f32 = 0.31830988618;
const TAU: f32 = 6.28318530718;

struct VSOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) local: vec2<f32>,
};

fn filterVertexPosition(aPosition: vec2<f32>) -> vec4<f32> {
  var position = aPosition * gfu.uOutputFrame.zw + gfu.uOutputFrame.xy;
  position.x = position.x * (2.0 / gfu.uOutputTexture.x) - 1.0;
  position.y = position.y * (2.0 * gfu.uOutputTexture.z / gfu.uOutputTexture.y) - gfu.uOutputTexture.z;
  return vec4<f32>(position, 0.0, 1.0);
}

@vertex
fn mainVertex(@location(0) aPosition: vec2<f32>) -> VSOutput {
  var out: VSOutput;
  out.position = filterVertexPosition(aPosition);
  out.local = aPosition * gfu.uOutputFrame.zw;
  return out;
}

fn s2l(c: f32) -> f32 {
  return select(c / 12.92, pow((c + 0.055) / 1.055, 2.4), c > 0.04045);
}
fn l2s(c: f32) -> f32 {
  return select(c * 12.92, 1.055 * pow(c, 0.41666) - 0.055, c > 0.0031308);
}
fn s2l3(c: vec3<f32>) -> vec3<f32> { return vec3<f32>(s2l(c.r), s2l(c.g), s2l(c.b)); }
fn l2s3(c: vec3<f32>) -> vec3<f32> { return vec3<f32>(l2s(c.r), l2s(c.g), l2s(c.b)); }

fn rot2(t: f32) -> mat2x2<f32> {
  let c = cos(t);
  let s = sin(t);
  return mat2x2<f32>(c, -s, s, c);
}

fn localPosToGrid(p: vec2<f32>, theta: f32, center: vec2<f32>, dotSize: f32) -> vec2<f32> {
  return rot2(theta) * (p - center) * (1.0 / dotSize);
}

fn gridToLocalPos(p: vec2<f32>, theta: f32, center: vec2<f32>, dotSize: f32) -> vec2<f32> {
  return rot2(-theta) * (p * dotSize) + center;
}

fn dotRadius(luma: f32) -> f32 {
  if (luma <= 0.0) { return 0.0; }
  var rad = sqrt(luma * INV_PI);
  if (rad >= 0.5) {
    rad = (1.414 - pow(max(0.001, 1.0 - luma) / 1.673, 1.0 / 2.33)) * 0.5;
  }
  return rad;
}

fn rgbToCmyk(c: vec3<f32>) -> vec4<f32> {
  let k = 1.0 - max(c.r, max(c.g, c.b));
  if (k >= 1.0) { return vec4<f32>(0.0, 0.0, 0.0, 1.0); }
  let inv = 1.0 / (1.0 - k);
  return vec4<f32>((1.0 - c.r - k) * inv, (1.0 - c.g - k) * inv, (1.0 - c.b - k) * inv, k);
}

fn cmykToRgb(k: vec4<f32>) -> vec3<f32> {
  return (vec3<f32>(1.0) - k.xyz) * (1.0 - k.w);
}

fn edgeMask(hi: f32, lo: f32, x: f32) -> f32 {
  return 1.0 - smoothstep(lo, hi, x);
}

fn sampleBlur(p: vec2<f32>, dims: vec2<f32>) -> vec4<f32> {
  let uv = clamp(p / dims, vec2<f32>(0.0), vec2<f32>(1.0));
  var c = textureSampleLevel(uBlur, uBlurSampler, uv, 0.0);
  if (halftoneUniforms.p2.z > 0.5) {
    c = vec4<f32>(vec3<f32>(1.0) - c.rgb, c.a);
  }
  return c;
}

// One ink amount per dot centre; the dot screen samples all nine neighbours.
fn cellInk(cell: vec2<f32>, theta: f32, center: vec2<f32>, dotSize: f32, dims: vec2<f32>) -> vec4<f32> {
  let c = sampleBlur(gridToLocalPos(cell, theta, center, dotSize), dims);
  let mode = i32(halftoneUniforms.p1.z + 0.5);
  if (mode < 1) {
    return mix(vec4<f32>(0.0), rgbToCmyk(s2l3(c.rgb)), c.a);
  }
  if (mode < 2) {
    return vec4<f32>(s2l3(c.rgb * c.a), 0.0);
  }
  var l = s2l(dot(c.rgb, vec3<f32>(0.299, 0.587, 0.114)));
  if (mode < 3) { l = 1.0 - l; }
  return vec4<f32>(l * c.a);
}

fn dotScreen(lp: vec2<f32>, theta: f32, mask: vec4<f32>, center: vec2<f32>, dotSize: f32, dims: vec2<f32>, softness: f32, dotScale: f32) -> f32 {
  let g = localPosToGrid(lp, theta, center, dotSize);
  let base = floor(g + vec2<f32>(0.5));
  var sum = 0.0;
  for (var oy = -1; oy <= 1; oy = oy + 1) {
    for (var ox = -1; ox <= 1; ox = ox + 1) {
      let cc = base + vec2<f32>(f32(ox), f32(oy));
      let r = dotRadius(dot(cellInk(cc, theta, center, dotSize, dims), mask)) * dotScale;
      sum = sum + edgeMask(r * (1.0 + softness), r * (1.0 - softness) - 0.001, length(g - cc));
    }
  }
  return min(sum, 1.0);
}

fn euclid(v: f32, lp: vec2<f32>, theta: f32, center: vec2<f32>, dotSize: f32, softness: f32) -> f32 {
  let g = localPosToGrid(lp, theta, center, dotSize);
  let field = 0.5 - 0.25 * (cos(g.x * TAU) + cos(g.y * TAU));
  return edgeMask(v * (1.0 + softness), v * (1.0 - softness) - 0.001, field);
}

fn toOklab(c: vec3<f32>) -> vec3<f32> {
  let lin = s2l3(c);
  let l = 0.4121656120 * lin.r + 0.5362752080 * lin.g + 0.0514575653 * lin.b;
  let m = 0.2118591070 * lin.r + 0.6807189584 * lin.g + 0.1074065790 * lin.b;
  let s = 0.0883097947 * lin.r + 0.2818474174 * lin.g + 0.6302613616 * lin.b;
  let lp = pow(max(l, 0.0), 1.0 / 3.0);
  let mp = pow(max(m, 0.0), 1.0 / 3.0);
  let sp = pow(max(s, 0.0), 1.0 / 3.0);
  return vec3<f32>(
    0.2104542553 * lp + 0.7936177850 * mp - 0.0040720468 * sp,
    1.9779984951 * lp - 2.4285922050 * mp + 0.4505937099 * sp,
    0.0259040371 * lp + 0.7827717662 * mp - 0.8086757660 * sp
  );
}

fn fromOklab(lab: vec3<f32>) -> vec3<f32> {
  let lp = lab.r + 0.3963377774 * lab.g + 0.2158037573 * lab.b;
  let mp = lab.r - 0.1055613458 * lab.g - 0.0638541728 * lab.b;
  let sp = lab.r - 0.0894841775 * lab.g - 1.2914855480 * lab.b;
  let l = lp * lp * lp;
  let m = mp * mp * mp;
  let s = sp * sp * sp;
  let lin = vec3<f32>(
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
  );
  return l2s3(clamp(lin, vec3<f32>(0.0), vec3<f32>(1.0)));
}

fn toSpace(c: vec4<f32>, space: i32) -> vec4<f32> {
  if (space == 1) { return vec4<f32>(s2l3(c.rgb), c.a); }
  if (space == 2) { return vec4<f32>(toOklab(c.rgb), c.a); }
  return c;
}

fn fromSpace(c: vec4<f32>, space: i32) -> vec4<f32> {
  if (space == 1) { return vec4<f32>(l2s3(c.rgb), c.a); }
  if (space == 2) { return vec4<f32>(fromOklab(c.rgb), c.a); }
  return c;
}

fn stopPosition(i: u32) -> f32 { return halftoneUniforms.positions[i]; }

fn ramp(t: f32, space: i32) -> vec4<f32> {
  let count = u32(max(0.0, halftoneUniforms.gmeta.x + 0.5));
  if (count == 0u) { return vec4<f32>(0.0); }
  if (count == 1u || t <= stopPosition(0u)) { return halftoneUniforms.colors[0]; }
  let last = count - 1u;
  if (t >= stopPosition(last)) { return halftoneUniforms.colors[last]; }
  for (var i = 0u; i < last; i = i + 1u) {
    let p1 = stopPosition(i + 1u);
    if (t <= p1) {
      let p0 = stopPosition(i);
      let f = (t - p0) / max(p1 - p0, 1e-5);
      return fromSpace(mix(toSpace(halftoneUniforms.colors[i], space), toSpace(halftoneUniforms.colors[i + 1u], space), f), space);
    }
  }
  return halftoneUniforms.colors[last];
}

fn rand3(p: vec3<f32>) -> f32 {
  var p3 = fract(p * 0.1031);
  p3 = p3 + dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

@fragment
fn mainFragment(@location(0) local: vec2<f32>) -> @location(0) vec4<f32> {
  let outDims = gfu.uOutputFrame.zw;
  let dims = halftoneUniforms.p3.xy;
  let designPos = local / outDims * dims;
  let screenUv = local / outDims;
  let clip = halftoneUniforms.p4;
  if (screenUv.x < clip.x || screenUv.y < clip.y ||
      screenUv.x > clip.x + clip.z || screenUv.y > clip.y + clip.w) {
    return vec4<f32>(0.0);
  }
  let dotSize = max(halftoneUniforms.p0.x, 0.0001);
  let dotScale = max(halftoneUniforms.p0.y, 0.0);
  let softness = clamp(halftoneUniforms.p0.z, 0.0, 1.0);
  let rotation = halftoneUniforms.p0.w;
  let center = vec2<f32>(
    clamp(halftoneUniforms.p1.x, 0.0, 1.0),
    clamp(halftoneUniforms.p1.y, 0.0, 1.0)
  ) * dims;
  let colorMode = i32(halftoneUniforms.p1.z + 0.5);
  let reveal = clamp(halftoneUniforms.p1.w, 0.0, 1.0);
  let inAlpha = textureSampleLevel(uInput, uInputSampler, clamp(local / outDims, vec2<f32>(0.0), vec2<f32>(1.0)), 0.0).a;

  let a15 = 0.2617993878;
  let a45 = 0.7853981634;
  let a75 = 1.3089969390;

  var color = vec3<f32>(0.0);

  if (halftoneUniforms.p2.x < 0.5) {
    if (colorMode == 0) {
      let cover = vec4<f32>(
        dotScreen(designPos, rotation + a15, vec4<f32>(1, 0, 0, 0), center, dotSize, dims, softness, dotScale),
        dotScreen(designPos, rotation + a75, vec4<f32>(0, 1, 0, 0), center, dotSize, dims, softness, dotScale),
        dotScreen(designPos, rotation,       vec4<f32>(0, 0, 1, 0), center, dotSize, dims, softness, dotScale),
        dotScreen(designPos, rotation + a45, vec4<f32>(0, 0, 0, 1), center, dotSize, dims, softness, dotScale)
      );
      color = cmykToRgb(cover);
    } else if (colorMode == 1) {
      color = vec3<f32>(
        dotScreen(designPos, rotation + a15, vec4<f32>(1, 0, 0, 0), center, dotSize, dims, softness, dotScale),
        dotScreen(designPos, rotation + a75, vec4<f32>(0, 1, 0, 0), center, dotSize, dims, softness, dotScale),
        dotScreen(designPos, rotation,       vec4<f32>(0, 0, 1, 0), center, dotSize, dims, softness, dotScale)
      );
    } else if (colorMode == 2) {
      color = vec3<f32>(1.0 - dotScreen(designPos, rotation + a45, vec4<f32>(1, 0, 0, 0), center, dotSize, dims, softness, dotScale));
    } else {
      color = vec3<f32>(dotScreen(designPos, rotation + a45, vec4<f32>(1, 0, 0, 0), center, dotSize, dims, softness, dotScale));
    }
  } else {
    let b = sampleBlur(designPos, dims);
    let avg = s2l3(b.rgb);
    if (colorMode == 0) {
      let k = rgbToCmyk(mix(vec3<f32>(1.0), avg, inAlpha)) * dotScale;
      color = cmykToRgb(vec4<f32>(
        euclid(k.x, designPos, rotation + a15, center, dotSize, softness),
        euclid(k.y, designPos, rotation + a75, center, dotSize, softness),
        euclid(k.z, designPos, rotation,       center, dotSize, softness),
        euclid(k.w, designPos, rotation + a45, center, dotSize, softness)
      ));
    } else if (colorMode == 1) {
      let v = avg * inAlpha * dotScale;
      color = vec3<f32>(
        euclid(v.x, designPos, rotation + a15, center, dotSize, softness),
        euclid(v.y, designPos, rotation + a75, center, dotSize, softness),
        euclid(v.z, designPos, rotation,       center, dotSize, softness)
      );
    } else {
      let l = clamp(s2l(dot(b.rgb, vec3<f32>(0.299, 0.587, 0.114))) * inAlpha * dotScale, 0.0, 1.0);
      if (colorMode == 2) {
        color = vec3<f32>(1.0 - euclid(1.0 - l, designPos, rotation + a45, center, dotSize, softness));
      } else {
        color = vec3<f32>(euclid(l, designPos, rotation + a45, center, dotSize, softness));
      }
    }
  }

  var outAlpha = reveal;
  if (halftoneUniforms.p2.y > 0.5) { outAlpha = outAlpha * inAlpha; }

  if (halftoneUniforms.gmeta2.w > 0.5 && halftoneUniforms.gmeta.x > 0.5) {
    let luma = clamp(dot(l2s3(color), vec3<f32>(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
    let scatter = halftoneUniforms.gmeta.w;
    let sc = select(0.0, (rand3(vec3<f32>(designPos, 1.0)) - 0.5) * scatter, scatter > 0.0);
    let repeat = i32(halftoneUniforms.gmeta.z + 0.5);
    let freq = max(halftoneUniforms.gmeta2.x, 1.0);
    let offset = halftoneUniforms.gmeta2.y;
    var t = clamp(luma + sc - offset, 0.0, 1.0);
    if (repeat == 1) {
      t = fract((luma - offset) * freq + sc);
    } else if (repeat == 2) {
      t = 1.0 - abs(fract((luma - offset) * freq * 0.5 + sc) - 0.5) * 2.0;
    }
    let mapped = ramp(t, i32(halftoneUniforms.gmeta.y + 0.5));
    color = mapped.rgb * mapped.a;
    outAlpha = outAlpha * mapped.a;
  }

  return vec4<f32>(color * outAlpha, outAlpha);
}
`;

// Shared filter vertex for both the halftone and blur filters.
const GLSL_VERT = /* glsl */ `#version 300 es
precision highp float;

in vec2 aPosition;
out vec2 vLocal;
out vec2 vInputCoord;

uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;
uniform vec4 uInputSize;

void main() {
  vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
  position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
  position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
  gl_Position = vec4(position, 0.0, 1.0);
  vLocal = aPosition * uOutputFrame.zw;
  vInputCoord = aPosition * (uOutputFrame.zw * uInputSize.zw);
}
`;

const GLSL_FRAG = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 vLocal;
out vec4 finalColor;

uniform sampler2D uBlur;
uniform sampler2D uInput;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;
uniform vec4 p0;
uniform vec4 p1;
uniform vec4 p2;
uniform vec4 p3;
uniform vec4 p4;
uniform vec4 colors[8];
uniform float positions[8];
uniform vec4 gmeta;
uniform vec4 gmeta2;

const float INV_PI = 0.31830988618;
const float TAU = 6.28318530718;

mat2 rot2(float t) {
  float c = cos(t);
  float s = sin(t);
  return mat2(c, -s, s, c);
}
vec2 localPosToGrid(vec2 p, float theta, vec2 center, float dotSize) {
  return rot2(theta) * (p - center) * (1.0 / dotSize);
}
vec2 gridToLocalPos(vec2 p, float theta, vec2 center, float dotSize) {
  return rot2(-theta) * (p * dotSize) + center;
}

float s2l(float c) { return c > 0.04045 ? pow((c + 0.055) / 1.055, 2.4) : c / 12.92; }
float l2s(float c) { return c > 0.0031308 ? 1.055 * pow(c, 0.41666) - 0.055 : c * 12.92; }
vec3 s2l3(vec3 c) { return vec3(s2l(c.r), s2l(c.g), s2l(c.b)); }
vec3 l2s3(vec3 c) { return vec3(l2s(c.r), l2s(c.g), l2s(c.b)); }

float dotRadius(float luma) {
  if (luma <= 0.0) return 0.0;
  float rad = sqrt(luma * INV_PI);
  if (rad >= 0.5) {
    rad = (1.414 - pow(max(0.001, 1.0 - luma) / 1.673, 1.0 / 2.33)) * 0.5;
  }
  return rad;
}

vec4 rgbToCmyk(vec3 c) {
  float k = 1.0 - max(c.r, max(c.g, c.b));
  if (k >= 1.0) return vec4(0.0, 0.0, 0.0, 1.0);
  float inv = 1.0 / (1.0 - k);
  return vec4((1.0 - c.r - k) * inv, (1.0 - c.g - k) * inv, (1.0 - c.b - k) * inv, k);
}
vec3 cmykToRgb(vec4 k) { return (vec3(1.0) - k.xyz) * (1.0 - k.w); }

float edgeMask(float hi, float lo, float x) { return 1.0 - smoothstep(lo, hi, x); }

vec4 sampleBlur(vec2 p, vec2 dims) {
  vec2 uv = clamp(p / dims, vec2(0.0), vec2(1.0));
  vec4 c = texture(uBlur, uv);
  if (p2.z > 0.5) c.rgb = vec3(1.0) - c.rgb;
  return c;
}

vec4 cellInk(vec2 cell, float theta, vec2 center, float dotSize, vec2 dims) {
  vec4 c = sampleBlur(gridToLocalPos(cell, theta, center, dotSize), dims);
  int mode = int(p1.z + 0.5);
  if (mode < 1) return mix(vec4(0.0), rgbToCmyk(s2l3(c.rgb)), c.a);
  if (mode < 2) return vec4(s2l3(c.rgb * c.a), 0.0);
  float l = s2l(dot(c.rgb, vec3(0.299, 0.587, 0.114)));
  if (mode < 3) l = 1.0 - l;
  return vec4(l * c.a);
}

float dotScreen(vec2 lp, float theta, vec4 mask, vec2 center, float dotSize, vec2 dims, float softness, float dotScale) {
  vec2 g = localPosToGrid(lp, theta, center, dotSize);
  vec2 base = floor(g + vec2(0.5));
  float sum = 0.0;
  for (int oy = -1; oy <= 1; oy++) {
    for (int ox = -1; ox <= 1; ox++) {
      vec2 cc = base + vec2(float(ox), float(oy));
      float r = dotRadius(dot(cellInk(cc, theta, center, dotSize, dims), mask)) * dotScale;
      sum += edgeMask(r * (1.0 + softness), r * (1.0 - softness) - 0.001, length(g - cc));
    }
  }
  return min(sum, 1.0);
}

float euclid(float v, vec2 lp, float theta, vec2 center, float dotSize, float softness) {
  vec2 g = localPosToGrid(lp, theta, center, dotSize);
  float field = 0.5 - 0.25 * (cos(g.x * TAU) + cos(g.y * TAU));
  return edgeMask(v * (1.0 + softness), v * (1.0 - softness) - 0.001, field);
}

vec3 toOklab(vec3 c) {
  vec3 lin = s2l3(c);
  float l = 0.4121656120 * lin.r + 0.5362752080 * lin.g + 0.0514575653 * lin.b;
  float m = 0.2118591070 * lin.r + 0.6807189584 * lin.g + 0.1074065790 * lin.b;
  float s = 0.0883097947 * lin.r + 0.2818474174 * lin.g + 0.6302613616 * lin.b;
  float lp = pow(max(l, 0.0), 1.0 / 3.0);
  float mp = pow(max(m, 0.0), 1.0 / 3.0);
  float sp = pow(max(s, 0.0), 1.0 / 3.0);
  return vec3(
    0.2104542553 * lp + 0.7936177850 * mp - 0.0040720468 * sp,
    1.9779984951 * lp - 2.4285922050 * mp + 0.4505937099 * sp,
    0.0259040371 * lp + 0.7827717662 * mp - 0.8086757660 * sp
  );
}
vec3 fromOklab(vec3 lab) {
  float lp = lab.r + 0.3963377774 * lab.g + 0.2158037573 * lab.b;
  float mp = lab.r - 0.1055613458 * lab.g - 0.0638541728 * lab.b;
  float sp = lab.r - 0.0894841775 * lab.g - 1.2914855480 * lab.b;
  float l = lp * lp * lp;
  float m = mp * mp * mp;
  float s = sp * sp * sp;
  vec3 lin = vec3(
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
  );
  return l2s3(clamp(lin, vec3(0.0), vec3(1.0)));
}
vec4 toSpace(vec4 c, int space) {
  if (space == 1) return vec4(s2l3(c.rgb), c.a);
  if (space == 2) return vec4(toOklab(c.rgb), c.a);
  return c;
}
vec4 fromSpace(vec4 c, int space) {
  if (space == 1) return vec4(l2s3(c.rgb), c.a);
  if (space == 2) return vec4(fromOklab(c.rgb), c.a);
  return c;
}
float stopPosition(int i) { return positions[i]; }

vec4 ramp(float t, int space) {
  int count = int(max(0.0, gmeta.x + 0.5));
  if (count == 0) return vec4(0.0);
  if (count == 1 || t <= stopPosition(0)) return colors[0];
  int last = count - 1;
  if (t >= stopPosition(last)) return colors[last];
  for (int i = 0; i < last; i++) {
    float p1 = stopPosition(i + 1);
    if (t <= p1) {
      float p0 = stopPosition(i);
      float f = (t - p0) / max(p1 - p0, 1e-5);
      return fromSpace(mix(toSpace(colors[i], space), toSpace(colors[i + 1], space), f), space);
    }
  }
  return colors[last];
}

float rand3(vec3 p) {
  vec3 p3 = fract(p * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec2 outDims = uOutputFrame.zw;
  vec2 dims = p3.xy;
  vec2 designPos = vLocal / outDims * dims;
  vec2 screenUv = vLocal / outDims;
  if (screenUv.x < p4.x || screenUv.y < p4.y ||
      screenUv.x > p4.x + p4.z || screenUv.y > p4.y + p4.w) {
    finalColor = vec4(0.0);
    return;
  }
  float dotSize = max(p0.x, 0.0001);
  float dotScale = max(p0.y, 0.0);
  float softness = clamp(p0.z, 0.0, 1.0);
  float rotation = p0.w;
  vec2 center = clamp(p1.xy, vec2(0.0), vec2(1.0)) * dims;
  int colorMode = int(p1.z + 0.5);
  float reveal = clamp(p1.w, 0.0, 1.0);
  float inAlpha = texture(uInput, clamp(vLocal / outDims, vec2(0.0), vec2(1.0))).a;

  const float a15 = 0.2617993878;
  const float a45 = 0.7853981634;
  const float a75 = 1.3089969390;

  vec3 color = vec3(0.0);

  if (p2.x < 0.5) {
    if (colorMode == 0) {
      vec4 cover = vec4(
        dotScreen(designPos, rotation + a15, vec4(1, 0, 0, 0), center, dotSize, dims, softness, dotScale),
        dotScreen(designPos, rotation + a75, vec4(0, 1, 0, 0), center, dotSize, dims, softness, dotScale),
        dotScreen(designPos, rotation,       vec4(0, 0, 1, 0), center, dotSize, dims, softness, dotScale),
        dotScreen(designPos, rotation + a45, vec4(0, 0, 0, 1), center, dotSize, dims, softness, dotScale)
      );
      color = cmykToRgb(cover);
    } else if (colorMode == 1) {
      color = vec3(
        dotScreen(designPos, rotation + a15, vec4(1, 0, 0, 0), center, dotSize, dims, softness, dotScale),
        dotScreen(designPos, rotation + a75, vec4(0, 1, 0, 0), center, dotSize, dims, softness, dotScale),
        dotScreen(designPos, rotation,       vec4(0, 0, 1, 0), center, dotSize, dims, softness, dotScale)
      );
    } else if (colorMode == 2) {
      color = vec3(1.0 - dotScreen(designPos, rotation + a45, vec4(1, 0, 0, 0), center, dotSize, dims, softness, dotScale));
    } else {
      color = vec3(dotScreen(designPos, rotation + a45, vec4(1, 0, 0, 0), center, dotSize, dims, softness, dotScale));
    }
  } else {
    vec4 b = sampleBlur(designPos, dims);
    vec3 avg = s2l3(b.rgb);
    if (colorMode == 0) {
      vec4 k = rgbToCmyk(mix(vec3(1.0), avg, inAlpha)) * dotScale;
      color = cmykToRgb(vec4(
        euclid(k.x, designPos, rotation + a15, center, dotSize, softness),
        euclid(k.y, designPos, rotation + a75, center, dotSize, softness),
        euclid(k.z, designPos, rotation,       center, dotSize, softness),
        euclid(k.w, designPos, rotation + a45, center, dotSize, softness)
      ));
    } else if (colorMode == 1) {
      vec3 v = avg * inAlpha * dotScale;
      color = vec3(
        euclid(v.x, designPos, rotation + a15, center, dotSize, softness),
        euclid(v.y, designPos, rotation + a75, center, dotSize, softness),
        euclid(v.z, designPos, rotation,       center, dotSize, softness)
      );
    } else {
      float l = clamp(s2l(dot(b.rgb, vec3(0.299, 0.587, 0.114))) * inAlpha * dotScale, 0.0, 1.0);
      if (colorMode == 2) color = vec3(1.0 - euclid(1.0 - l, designPos, rotation + a45, center, dotSize, softness));
      else color = vec3(euclid(l, designPos, rotation + a45, center, dotSize, softness));
    }
  }

  float outAlpha = reveal;
  if (p2.y > 0.5) outAlpha *= inAlpha;

  if (gmeta2.w > 0.5 && gmeta.x > 0.5) {
    float luma = clamp(dot(l2s3(color), vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
    float scatter = gmeta.w;
    float sc = scatter > 0.0 ? (rand3(vec3(designPos, 1.0)) - 0.5) * scatter : 0.0;
    int repeat = int(gmeta.z + 0.5);
    float freq = max(gmeta2.x, 1.0);
    float offset = gmeta2.y;
    float t = clamp(luma + sc - offset, 0.0, 1.0);
    if (repeat == 1) t = fract((luma - offset) * freq + sc);
    else if (repeat == 2) t = 1.0 - abs(fract((luma - offset) * freq * 0.5 + sc) - 0.5) * 2.0;
    vec4 mapped = ramp(t, int(gmeta.y + 0.5));
    color = mapped.rgb * mapped.a;
    outAlpha *= mapped.a;
  }

  finalColor = vec4(color * outAlpha, outAlpha);
}
`;


// 65-tap separable Gaussian. The filter samples its input at Pixi's filter
// input coordinates so the full surface is covered.
const BLUR_WGSL = /* wgsl */ `
diagnostic(off, derivative_uniformity);
struct GlobalFilterUniforms {
  uInputSize: vec4<f32>,
  uInputPixel: vec4<f32>,
  uInputClamp: vec4<f32>,
  uOutputFrame: vec4<f32>,
  uGlobalFrame: vec4<f32>,
  uOutputTexture: vec4<f32>,
};
struct BlurUniforms {
  dir: vec4<f32>,
  weights: array<f32, 65>,
};
@group(0) @binding(0) var<uniform> gfu: GlobalFilterUniforms;
@group(0) @binding(1) var uTexture: texture_2d<f32>;
@group(0) @binding(2) var uSampler: sampler;
@group(1) @binding(0) var<uniform> blurUniforms: BlurUniforms;
struct VSOutput { @builtin(position) position: vec4<f32>, @location(0) local: vec2<f32>, @location(1) inputCoord: vec2<f32> };
fn filterVertexPosition(aPosition: vec2<f32>) -> vec4<f32> {
  var position = aPosition * gfu.uOutputFrame.zw + gfu.uOutputFrame.xy;
  position.x = position.x * (2.0 / gfu.uOutputTexture.x) - 1.0;
  position.y = position.y * (2.0 * gfu.uOutputTexture.z / gfu.uOutputTexture.y) - gfu.uOutputTexture.z;
  return vec4<f32>(position, 0.0, 1.0);
}
@vertex
fn mainVertex(@location(0) aPosition: vec2<f32>) -> VSOutput {
  var out: VSOutput;
  out.position = filterVertexPosition(aPosition);
  out.local = aPosition * gfu.uOutputFrame.zw;
  out.inputCoord = aPosition * (gfu.uOutputFrame.zw * gfu.uInputSize.zw);
  return out;
}
fn s2l(c: f32) -> f32 { return select(c / 12.92, pow((c + 0.055) / 1.055, 2.4), c > 0.04045); }
fn l2s(c: f32) -> f32 { return select(c * 12.92, 1.055 * pow(c, 0.41666) - 0.055, c > 0.0031308); }
@fragment
fn mainFragment(@location(0) local: vec2<f32>, @location(1) inputCoord: vec2<f32>) -> @location(0) vec4<f32> {
  let dims = vec2<f32>(textureDimensions(uTexture, 0));
  let texel = vec2<f32>(1.0) / dims;
  let uv = inputCoord;
  let radius = blurUniforms.dir.z;
  var sum = vec4<f32>(0.0);
  for (var i = -32; i <= 32; i = i + 1) {
    let fi = f32(i);
    let w = blurUniforms.weights[u32(i + 32)];
    let sampleUv = clamp(uv + blurUniforms.dir.xy * texel * fi * (radius / 32.0), vec2<f32>(0.0), vec2<f32>(1.0));
    let c = textureSampleLevel(uTexture, uSampler, sampleUv, 0.0);
    sum += vec4<f32>(s2l(c.r), s2l(c.g), s2l(c.b), c.a) * w;
  }
  let norm = max(blurUniforms.dir.w, 0.0001);
  let c = sum / norm;
  return vec4<f32>(l2s(c.r), l2s(c.g), l2s(c.b), c.a);
}
`;
const BLUR_GLSL = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 vLocal;
in vec2 vInputCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;
uniform vec4 uInputSize;
uniform vec4 uInputClamp;
uniform vec4 dir;
uniform float weights[65];
float s2l(float c) { return c > 0.04045 ? pow((c + 0.055) / 1.055, 2.4) : c / 12.92; }
float l2s(float c) { return c > 0.0031308 ? 1.055 * pow(c, 0.41666) - 0.055 : c * 12.92; }
void main() {
  vec2 dims = vec2(textureSize(uTexture, 0));
  vec2 texel = vec2(1.0) / dims;
  vec2 uv = vInputCoord;
  float radius = dir.z;
  vec4 sum = vec4(0.0);
  for (int i = -32; i <= 32; i++) {
    float fi = float(i);
    float w = weights[i + 32];
    vec2 sampleUv = clamp(uv + dir.xy * texel * fi * (radius / 32.0), vec2(0.0), vec2(1.0));
    vec4 c = texture(uTexture, sampleUv);
    sum += vec4(s2l(c.r), s2l(c.g), s2l(c.b), c.a) * w;
  }
  vec4 c = sum / max(dir.w, 0.0001);
  finalColor = vec4(l2s(c.r), l2s(c.g), l2s(c.b), c.a);
}
`;

let gpuProgram = null;
let glProgram = null;
let blurGpuProgram = null;
let blurGlProgram = null;

function ensurePrograms() {
  if (gpuProgram) return;
  gpuProgram = GpuProgram.from({
    vertex: { source: WGSL, entryPoint: 'mainVertex' },
    fragment: { source: WGSL, entryPoint: 'mainFragment' },
  });
  glProgram = GlProgram.from({
    vertex: GLSL_VERT,
    fragment: GLSL_FRAG,
    name: 'halftone-filter',
  });
  blurGpuProgram = GpuProgram.from({
    vertex: { source: BLUR_WGSL, entryPoint: 'mainVertex' },
    fragment: { source: BLUR_WGSL, entryPoint: 'mainFragment' },
  });
  blurGlProgram = GlProgram.from({
    vertex: GLSL_VERT,
    fragment: BLUR_GLSL,
    name: 'blur-filter',
  });
}

export function createUniformGroup() {
  return new UniformGroup({
    p0: { value: new Float32Array([4, 1.05, 0, 0]), type: 'vec4<f32>' },
    p1: { value: new Float32Array([0.1, 0.1, 0, 1]), type: 'vec4<f32>' },
    p2: { value: new Float32Array([0, 0, 0, 0]), type: 'vec4<f32>' },
    p3: { value: new Float32Array([399, 399, 0, 0]), type: 'vec4<f32>' },
    p4: { value: new Float32Array([0, 0, 1, 1]), type: 'vec4<f32>' },
    colors: { value: new Float32Array(32), type: 'vec4<f32>', size: 8 },
    positions: { value: new Float32Array(8), type: 'f32', size: 8 },
    gmeta: { value: new Float32Array([0, 0, 0, 0]), type: 'vec4<f32>' },
    gmeta2: { value: new Float32Array([2, 0, 0, 0]), type: 'vec4<f32>' },
  });
}

export function createBlurFilter({ resolution, direction, radius, weights, norm }) {
  ensurePrograms();
  const uniforms = new UniformGroup({
    dir: { value: new Float32Array([direction[0], direction[1], radius, norm]), type: 'vec4<f32>' },
    weights: { value: weights, type: 'f32', size: 65 },
  });
  return new Filter({
    gpuProgram: blurGpuProgram,
    glProgram: blurGlProgram,
    resources: { blurUniforms: uniforms },
    resolution,
    padding: 0,
    antialias: 'off',
    clipToViewport: false,
  });
}

export function createHalftoneFilter({ resolution, blurTexture, inputTexture, uniforms }) {
  ensurePrograms();
  return new Filter({
    gpuProgram,
    glProgram,
    resources: {
      halftoneUniforms: uniforms,
      uBlur: blurTexture.source,
      uBlurSampler: blurTexture.source.style,
      uInput: inputTexture.source,
      uInputSampler: inputTexture.source.style,
    },
    resolution,
    padding: 0,
    antialias: 'off',
    clipToViewport: false,
  });
}
