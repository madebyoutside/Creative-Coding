import { defineProperties } from "figma:shaders";
export default function Effect() { }
export function setup(device: any, frame: any) {
    var wgsl = "diagnostic(off,derivative_uniformity);\nstruct Uniforms {\n  frameData: vec4f,\n  inputDimsAndPad: vec4f,\n  gradient_c0: vec4f,\n  gradient_c1: vec4f,\n  gradient_c2: vec4f,\n  gradient_c3: vec4f,\n  gradient_c4: vec4f,\n  gradient_c5: vec4f,\n  gradient_c6: vec4f,\n  gradient_c7: vec4f,\n  gradient_pos0: vec4f,\n  gradient_pos1: vec4f,\n  gradient_count: vec4f,\n  repeatType: vec4f,\n  scatter: vec4f,\n  repeatFrequency: vec4f,\n  offset: vec4f,\n  mixSpace: vec4f,\n};\n@group(0) @binding(0) var<uniform> u: Uniforms;\n@group(0) @binding(1) var samp: sampler;\n@group(0) @binding(2) var inputTex: texture_2d<f32>;\n\nstruct VsIn {\n  @location(0) pos: vec2f,\n  @location(1) uv: vec2f,\n};\nstruct VsOut {\n  @builtin(position) position: vec4f,\n  @location(0) uv: vec2f,\n};\n\nfn sampleInput(p: vec2f) -> vec4f {\n  // p is input-relative (0..1 over the content rect). The bound input texture\n  // is the upstream padded output, with the content inset by inputPad on every\n  // side, so map content UV -> texture UV before sampling. For a stand-alone\n  // effect inputPad is 0 and this reduces to clamp(p).\n  let iDims = max(u.inputDimsAndPad.xy, vec2f(1.0));\n  let iPad = u.inputDimsAndPad.z;\n  let texCoord = (vec2f(iPad) + clamp(p, vec2f(0.0), vec2f(1.0)) * iDims) / (iDims + vec2f(2.0 * iPad));\n  return textureSampleLevel(inputTex, samp, texCoord, 0.0);\n}\n\n// Like sampleInput but returns transparent (premultiplied zero) outside the\n// input rect instead of repeating the edge texel. Use this for any sample that\n// can land in the halo (outputPadding > 0) — clamping there smears the edge\n// row/column into opaque streaks.\nfn sampleInputOrZero(p: vec2f) -> vec4f {\n  let inside = step(vec2f(0.0), p) * step(p, vec2f(1.0));\n  return sampleInput(p) * (inside.x * inside.y);\n}\n\nfn gradientStopPos(i: u32) -> f32 {\n  let lane = i & 3u;\n  if (i < 4u) { return u.gradient_pos0[lane]; }\n  return u.gradient_pos1[lane];\n}\n\nfn srgbToLinearSimple(c: f32) -> f32 {\n  return pow(max(c, 0.0), 2.2);\n}\n\nfn linearToSrgbSimple(c: f32) -> f32 {\n  return pow(max(c, 0.0), 1.0 / 2.2);\n}\n\nfn srgbToLinearSimpleV3(c: vec3f) -> vec3f {\n  return vec3f(srgbToLinearSimple(c.x), srgbToLinearSimple(c.y), srgbToLinearSimple(c.z));\n}\n\nfn linearToSrgbSimpleV3(c: vec3f) -> vec3f {\n  return vec3f(linearToSrgbSimple(c.x), linearToSrgbSimple(c.y), linearToSrgbSimple(c.z));\n}\n\nfn srgbToOklab(c: vec3f) -> vec3f {\n  let lin = srgbToLinearSimpleV3(c);\n  let l = 0.4121656120 * lin.x + 0.5362752080 * lin.y + 0.0514575653 * lin.z;\n  let m = 0.2118591070 * lin.x + 0.6807189584 * lin.y + 0.1074065790 * lin.z;\n  let s = 0.0883097947 * lin.x + 0.2818474174 * lin.y + 0.6302613616 * lin.z;\n  let l_ = pow(max(l, 0.0), 1.0 / 3.0);\n  let m_ = pow(max(m, 0.0), 1.0 / 3.0);\n  let s_ = pow(max(s, 0.0), 1.0 / 3.0);\n  return vec3f(\n    0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,\n    1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,\n    0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,\n  );\n}\n\nfn oklabToSrgb(lab: vec3f) -> vec3f {\n  let l_ = lab.x + 0.3963377774 * lab.y + 0.2158037573 * lab.z;\n  let m_ = lab.x - 0.1055613458 * lab.y - 0.0638541728 * lab.z;\n  let s_ = lab.x - 0.0894841775 * lab.y - 1.2914855480 * lab.z;\n  let l = l_ * l_ * l_;\n  let m = m_ * m_ * m_;\n  let s = s_ * s_ * s_;\n  let lin = vec3f(\n    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,\n    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,\n    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,\n  );\n  return linearToSrgbSimpleV3(clamp(lin, vec3f(0.0), vec3f(1.0)));\n}\n\nfn colorToMixSpace(c: vec4f, space: i32) -> vec4f {\n  if (space == 1) {\n    return vec4f(srgbToLinearSimpleV3(c.rgb), c.a);\n  } else if (space == 2) {\n    return vec4f(srgbToOklab(c.rgb), c.a);\n  }\n  return c;\n}\n\nfn colorFromMixSpace(c: vec4f, space: i32) -> vec4f {\n  if (space == 1) {\n    return vec4f(linearToSrgbSimpleV3(c.rgb), c.a);\n  } else if (space == 2) {\n    return vec4f(oklabToSrgb(c.rgb), c.a);\n  }\n  return c;\n}\n\nfn gradientRamp(t: f32, space: i32) -> vec4f {\n  var colors = array<vec4f, 8>(u.gradient_c0, u.gradient_c1, u.gradient_c2, u.gradient_c3, u.gradient_c4, u.gradient_c5, u.gradient_c6, u.gradient_c7);\n  let n = u32(u.gradient_count.x);\n  if (n == 0u) { return vec4f(0.0); }\n  if (n == 1u || t <= gradientStopPos(0u)) { return colors[0]; }\n  let last = n - 1u;\n  if (t >= gradientStopPos(last)) { return colors[last]; }\n  for (var i = 0u; i < last; i = i + 1u) {\n    let p1 = gradientStopPos(i + 1u);\n    if (t <= p1) {\n      let p0 = gradientStopPos(i);\n      let factor = (t - p0) / max(p1 - p0, 1e-5);\n      let c0 = colorToMixSpace(colors[i], space);\n      let c1 = colorToMixSpace(colors[i + 1u], space);\n      return colorFromMixSpace(mix(c0, c1, factor), space);\n    }\n  }\n  return colors[last];\n}\n\nfn linearToSrgbChannel(c: f32) -> f32 {\n\n  if (c <= 0.0031308) {\n\n    return c * 12.92;\n\n  }\n\n  return 1.055 * pow(c, 1.0 / 2.4) - 0.055;\n\n}\n\nfn linearToSrgb(c: vec3f) -> vec3f {\n\n  return vec3f(linearToSrgbChannel(c.x), linearToSrgbChannel(c.y), linearToSrgbChannel(c.z));\n\n}\n\nfn lumaSrgb(c: vec3f) -> f32 {\n\n  return dot(c, vec3f(0.2126, 0.7152, 0.0722));\n\n}\n\nfn linearstep(edge0: f32, edge1: f32, x: f32) -> f32 {\n\n  return clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);\n\n}\n\nfn rand3(p: vec3f) -> f32 {\n\n  var p3 = fract(p * 0.1031);\n\n  p3 = p3 + dot(p3, p3.yzx + 33.33);\n\n  return fract((p3.x + p3.y) * p3.z);\n\n}\n\nfn getGradientT(luma: f32, scatterOffset: f32, repeatTypeVal: i32, freq: f32, off: f32) -> f32 {\n\n  if (repeatTypeVal == 0) {\n\n    // None\n\n    return clamp(luma + scatterOffset - off, 0.0, 1.0);\n\n  } else if (repeatTypeVal == 1) {\n\n    // Repeat\n\n    return fract((luma - off) * freq + scatterOffset);\n\n  } else {\n\n    // Mirror\n\n    return 1.0 - abs(fract((luma - off) * freq * 0.5 + scatterOffset) - 0.5) * 2.0;\n\n  }\n\n}\n\n@vertex fn vs_main(in: VsIn) -> VsOut {\n  var out: VsOut;\n  out.position = vec4f(in.pos, 0.0, 1.0);\n  out.uv = in.uv;\n  return out;\n}\n\n@fragment fn fs_main(@location(0) outputUv_in: vec2f) -> @location(0) vec4f {\n  let time = u.frameData.x;\n  let outputUv = outputUv_in;\n  let dims = max(u.frameData.yz, vec2f(1.0));\n  let outputPad = u.frameData.w;\n  let inputDims = max(u.inputDimsAndPad.xy, vec2f(1.0));\n  let inputPad = u.inputDimsAndPad.z;\n  let inputTexel = vec2f(1.0) / inputDims;\n  let fragPx = outputUv * dims;\n  let contentOriginPx = vec2f(inputPad + outputPad);\n  let uv = (fragPx - contentOriginPx) / inputDims;\n  // texel and aspect are input-relative to match uv; for unpadded effects and\n  // all fills inputDims === dims so this is unchanged. Zoom fills rescale texel\n  // alongside their uv redefinition below (see zoomLocal).\n  let texel = inputTexel;\n  let aspect = inputDims.x / max(inputDims.y, 1.0);\n  // repeatType: 0=none, 1=repeat, 2=mirror\n  let repeatType = i32(u.repeatType.x + 0.5);\n  let scatter = u.scatter.x;\n  let repeatFrequency = u.repeatFrequency.x;\n  let offset = u.offset.x;\n  let mixSpace = i32(u.mixSpace.x + 0.5);\n  let inputColor = sampleInput(uv);\n  // inputColor is premultiplied; unmultiply for luma computation\n  var linearRgb = inputColor.rgb;\n  if (inputColor.a > 0.0) {\n    linearRgb = inputColor.rgb / inputColor.a;\n  }\n  // Convert linear to srgb for luma\n  let srgbColor = linearToSrgb(clamp(linearRgb, vec3f(0.0), vec3f(1.0)));\n  let luma = lumaSrgb(srgbColor);\n  // Scatter / dithering\n  let localPos = uv * dims;\n  var scatterOffset: f32 = 0.0;\n  if (scatter > 0.0) {\n    scatterOffset = (rand3(vec3f(localPos, 1.0)) - 0.5) * scatter;\n  }\n  // Compute gradient T\n  let t = getGradientT(luma, scatterOffset, repeatType, repeatFrequency, offset);\n  // Sample gradient ramp (with derivative-based AA for repeat mode)\n  let mappedColor = gradientRamp(t, mixSpace);\n  // Output: premultiply by input alpha\n  let outRgb = mappedColor.rgb * mappedColor.a * inputColor.a;\n  let outA = mappedColor.a * inputColor.a;\n  return vec4f(outRgb, outA);\n}\n";
    frame.state.module = device.createShaderModule({ code: wgsl });
    frame.state.pipeline = null;
    frame.state.pipelineFormat = null;
    frame.state.quad = device.createBuffer({
        size: 6 * 4 * 4,
        usage: GPUBufferUsage.VERTEX,
        mappedAtCreation: true,
    });
    new Float32Array(frame.state.quad.getMappedRange()).set([
        -1, -1, 0, 1,
        1, -1, 1, 1,
        -1, 1, 0, 0,
        -1, 1, 0, 0,
        1, -1, 1, 1,
        1, 1, 1, 0,
    ]);
    frame.state.quad.unmap();
    frame.state.uniformBuf = device.createBuffer({
        size: 288,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    frame.state.sampler = device.createSampler({
        magFilter: 'linear',
        minFilter: 'linear',
        addressModeU: 'clamp-to-edge',
        addressModeV: 'clamp-to-edge',
    });
    frame.state.placeholder = device.createTexture({
        size: [1, 1, 1],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    device.queue.writeTexture({ texture: frame.state.placeholder }, new Uint8Array([0, 0, 0, 0]), { bytesPerRow: 4 }, { width: 1, height: 1, depthOrArrayLayers: 1 });
}
export function render(device: any, frame: any) {
    var params = frame.params || {};
    function finiteNumber(value: any, fallback: any) {
        var num = Number(value);
        return Number.isFinite(num) ? num : fallback;
    }
    function numberParam(name: any, fallback: any) {
        return finiteNumber(params[name], fallback);
    }
    function boolParam(name: any, fallback: any) {
        if (typeof params[name] === 'boolean')
            return params[name] ? 1 : 0;
        return fallback ? 1 : 0;
    }
    function selectParam(name: any, values: any, fallbackIndex: any) {
        var raw = params[name];
        var value = raw != null && typeof raw === 'object' ? raw.characters : raw;
        var index = values.indexOf(value);
        return index >= 0 ? index : fallbackIndex;
    }
    function colorParam(name: any, fallback: any) {
        var value = params[name] || {};
        return [
            finiteNumber(value.r, fallback[0]),
            finiteNumber(value.g, fallback[1]),
            finiteNumber(value.b, fallback[2]),
            finiteNumber(value.a, fallback[3]),
        ];
    }
    function pointParam(name: any, fallback: any) {
        var value = params[name] || {};
        return [
            finiteNumber(value.x, fallback[0]),
            finiteNumber(value.y, fallback[1]),
        ];
    }
    function pointRadiusParam(name: any, fallback: any) {
        var value = params[name] || {};
        return [
            finiteNumber(value.x, fallback[0]),
            finiteNumber(value.y, fallback[1]),
            finiteNumber(value.radius, fallback[2]),
        ];
    }
    function pointPointLineParam(name: any, fallback: any) {
        var value = params[name] || {};
        return [
            finiteNumber(value.x, fallback[0]),
            finiteNumber(value.y, fallback[1]),
            finiteNumber(value.x2, fallback[2]),
            finiteNumber(value.y2, fallback[3]),
        ];
    }
    function pointAngleRadiusParam(name: any, fallback: any) {
        var value = params[name] || {};
        return [
            finiteNumber(value.x, fallback[0]),
            finiteNumber(value.y, fallback[1]),
            finiteNumber(value.radius, fallback[2]),
            finiteNumber(value.angle, fallback[3]),
        ];
    }
    function colorPointParam(name: any, fallback: any) {
        var value = params[name] || {};
        var color = value.color || {};
        return [
            finiteNumber(value.x, fallback[0]),
            finiteNumber(value.y, fallback[1]),
            0,
            0,
            finiteNumber(color.r, fallback[2]),
            finiteNumber(color.g, fallback[3]),
            finiteNumber(color.b, fallback[4]),
            finiteNumber(color.a, fallback[5]),
        ];
    }
    function gradientParam(name: any, fallback: any) {
        var value = params[name] || {};
        var stops = Array.isArray(value.stops) && value.stops.length > 0 ? value.stops : fallback;
        // Layout: 8 stop colors (rgba), then 8 positions packed 4-per-vec4, then the live count.
        var out = new Array(44).fill(0);
        var count = Math.min(stops.length, 8);
        for (var i = 0; i < count; i++) {
            var stop = stops[i] || {};
            var color = stop.color || {};
            out[i * 4] = finiteNumber(color.r, 0);
            out[i * 4 + 1] = finiteNumber(color.g, 0);
            out[i * 4 + 2] = finiteNumber(color.b, 0);
            out[i * 4 + 3] = finiteNumber(color.a, 1);
            out[32 + i] = finiteNumber(stop.position, 0);
        }
        out[40] = count;
        return out;
    }
    var output = frame.output || {};
    var width = Math.max(1, finiteNumber(output.width, 1));
    var height = Math.max(1, finiteNumber(output.height, 1));
    var time = 0;
    var outputPad = finiteNumber(frame.outputPadding, 0);
    var inputPad = finiteNumber(frame.inputPadding, 0);
    var inputWidth = Math.max(1, width - 2 * outputPad);
    var inputHeight = Math.max(1, height - 2 * outputPad);
    device.queue.writeBuffer(frame.state.uniformBuf, 0, new Float32Array([
        time, width, height, outputPad,
        inputWidth, inputHeight, inputPad, 0,
        ...gradientParam("gradient", [{ "position": 0, "color": { "r": 1, "g": 1, "b": 1, "a": 1 } }, { "position": 0.5, "color": { "r": 0.10196, "g": 0.73725, "b": 0.99608, "a": 1 } }, { "position": 1, "color": { "r": 0, "g": 0, "b": 0, "a": 1 } }]),
        selectParam("repeatType", ["none", "repeat", "mirror"], 0), 0, 0, 0,
        numberParam("scatter", 0) / 100, 0, 0, 0,
        numberParam("repeatFrequency", 2), 0, 0, 0,
        numberParam("offset", 0) / 100, 0, 0, 0,
        selectParam("mixSpace", ["sRGB", "Linear", "OKLab"], 0), 0, 0, 0,
    ]));
    var inputView = frame.input != null
        ? frame.input.createView()
        : frame.state.placeholder.createView();
    var outputFormat = frame.output.format;
    if (frame.state.pipeline == null || frame.state.pipelineFormat !== outputFormat) {
        frame.state.pipeline = device.createRenderPipeline({
            layout: 'auto',
            vertex: {
                module: frame.state.module,
                entryPoint: 'vs_main',
                buffers: [{
                        arrayStride: 16,
                        attributes: [
                            { shaderLocation: 0, format: 'float32x2', offset: 0 },
                            { shaderLocation: 1, format: 'float32x2', offset: 8 },
                        ],
                    }],
            },
            fragment: {
                module: frame.state.module,
                entryPoint: 'fs_main',
                targets: [{ format: outputFormat }],
            },
            primitive: { topology: 'triangle-list' },
        });
        frame.state.pipelineFormat = outputFormat;
    }
    var bindGroup = device.createBindGroup({
        layout: frame.state.pipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: frame.state.uniformBuf } },
            { binding: 1, resource: frame.state.sampler },
            { binding: 2, resource: inputView },
        ],
    });
    var encoder = device.createCommandEncoder();
    var pass = encoder.beginRenderPass({
        colorAttachments: [{
                view: frame.output.createView(),
                loadOp: 'clear',
                clearValue: { r: 0, g: 0, b: 0, a: 0 },
                storeOp: 'store',
            }],
    });
    pass.setPipeline(frame.state.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.setVertexBuffer(0, frame.state.quad);
    pass.draw(6);
    pass.end();
    device.queue.submit([encoder.finish()]);
}
defineProperties(Effect, {
    "gradient": {
        type: "gradient",
        label: "Gradient",
        defaultValue: { "stops": [{ "position": 0, "color": { "r": 1, "g": 1, "b": 1, "a": 1 } }, { "position": 0.5, "color": { "r": 0.10196, "g": 0.73725, "b": 0.99608, "a": 1 } }, { "position": 1, "color": { "r": 0, "g": 0, "b": 0, "a": 1 } }] },
    },
    "scatter": {
        type: "number",
        label: "Scatter",
        defaultValue: 0,
        control: "slider",
        min: 0,
        max: 100,
        step: 0.1,
        unit: "%",
    },
    "offset": {
        type: "number",
        label: "Offset",
        defaultValue: 0,
        control: "slider",
        min: -100,
        max: 100,
        step: 0.1,
        unit: "%",
    },
    "repeatType": {
        type: "string",
        label: "Repeat type",
        defaultValue: "none",
        control: "select",
        options: [{ "value": "none", "label": "None" }, { "value": "repeat", "label": "Repeat" }, { "value": "mirror", "label": "Mirror" }],
    },
    "repeatFrequency": {
        type: "number",
        label: "Repeat frequency",
        defaultValue: 2,
        control: "slider",
        min: 1,
        max: 10,
        step: 1,
    },
    "mixSpace": {
        type: "string",
        label: "Mix space",
        defaultValue: "sRGB",
        control: "select",
        options: [{ "value": "sRGB", "label": "sRGB" }, { "value": "Linear", "label": "Linear" }, { "value": "OKLab", "label": "OKLab" }],
    },
});
