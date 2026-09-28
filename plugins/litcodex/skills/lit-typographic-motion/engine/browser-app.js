/* LitCodex motion engine, browser half. Node computes every display list from time t; this page
 * rasterizes glyph outlines and furniture on CPU canvases, runs the look-library GLSL passes and
 * the linear-HDR post chain on WebGL2 half-float targets, and reads the finished 8-bit RGBA frame
 * back through a pixel-pack buffer and a fence. Nothing here reads a clock or an unseeded random
 * source for pixels (MO-A-23). GL plumbing, the bloom pyramid and the capsule line batch are
 * adapted in method from the credited engine (NOTICE); the look passes are original. */
(() => {
	"use strict";
	const VERT = `#version 300 es
void main() { vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;

	const COMMON = `#version 300 es
precision highp float;
precision highp int;
uniform vec2 u_res;
uniform float u_scale;
out vec4 o;
vec2 fragTop() { return vec2(gl_FragCoord.x, u_res.y - gl_FragCoord.y); }
vec2 logicalPx() { return fragTop() / u_scale; }
vec2 uvGL(vec2 topPx) { return vec2(topPx.x, u_res.y - topPx.y) / u_res; }
uint mixBits(uint x) { x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; x ^= x >> 16; return x; }
float rand1(uint x) { return float(mixBits(x)) / 4294967296.0; }
float rand2(uvec2 p, uint s) { return rand1(p.x * 1597334677u ^ mixBits(p.y * 3812015801u ^ s)); }
vec3 toLinear(vec3 s) { return mix(s / 12.92, pow((s + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), s)); }
vec3 toDisplay(vec3 l) { l = clamp(l, 0.0, 1.0); return mix(l * 12.92, 1.055 * pow(l, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), l)); }
vec3 displaySlope(vec3 l) { l = max(l, vec3(0.0031308)); return 1.0 / (1.055 / 2.4 * pow(l, vec3(1.0 / 2.4 - 1.0))); }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec2 grad2(uvec2 cell, uint seed) { float a = rand2(cell, seed) * 6.28318530718; return vec2(cos(a), sin(a)); }
float gnoise(vec2 p, uint seed) {
	vec2 i = floor(p); vec2 f = p - i; vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
	uvec2 c = uvec2(ivec2(i) + 4096);
	float a = dot(grad2(c, seed), f), b = dot(grad2(c + uvec2(1, 0), seed), f - vec2(1, 0));
	float d = dot(grad2(c + uvec2(0, 1), seed), f - vec2(0, 1)), e = dot(grad2(c + uvec2(1, 1), seed), f - vec2(1, 1));
	return mix(mix(a, b, u.x), mix(d, e, u.x), u.y) * 1.4142;
}
float fbm(vec2 p, int octaves, uint seed) { float s = 0.0, a = 0.5; for (int i = 0; i < 8; i++) { if (i >= octaves) break; s += a * gnoise(p, seed + uint(i) * 101u); p = mat2(0.8, -0.6, 0.6, 0.8) * p * 2.03 + 11.7; a *= 0.5; } return s; }
`;

	const FS = {
		fill: `uniform vec3 u_color; void main() { o = vec4(u_color, 1.0); }`,
		copy: `uniform sampler2D u_src; uniform float u_weight; void main() { o = vec4(texture(u_src, gl_FragCoord.xy / u_res).rgb * u_weight, 1.0); }`,
		layer: `uniform sampler2D u_layer; void main() { vec4 g = texture(u_layer, fragTop() / u_res); o = vec4(toLinear(g.rgb), g.a); }`,
		tidal: `uniform float u_time; uniform uint u_seed; uniform float u_flowSpeed, u_warpAmount, u_curlStrength, u_surge, u_ditherAmount; uniform int u_octaves, u_bandingSteps; uniform vec2 u_origin; uniform vec3 u_bg, u_stopA, u_stopB;
void main() {
	vec2 q = logicalPx() / 1080.0 * 0.75 + u_origin;
	float t = u_time * u_flowSpeed;
	vec2 warp = vec2(fbm(q + vec2(t, 0.0), u_octaves, u_seed), fbm(q + vec2(5.2, 1.3 - t), u_octaves, u_seed + 17u));
	float e = 0.35; float n0 = fbm(q * 0.7 + vec2(0.0, e) + t, 3, u_seed + 29u) - fbm(q * 0.7 - vec2(0.0, e) + t, 3, u_seed + 29u);
	float n1 = fbm(q * 0.7 + vec2(e, 0.0) + t, 3, u_seed + 29u) - fbm(q * 0.7 - vec2(e, 0.0) + t, 3, u_seed + 29u);
	vec2 curl = vec2(n0, -n1) / (2.0 * e);
	float field = fbm(q + u_warpAmount * warp + u_curlStrength * 0.15 * curl, u_octaves, u_seed + 53u);
	float mixA = smoothstep(-0.9, 0.9, field);
	float mixB = smoothstep(-0.6, 0.8, fbm(q * 0.5 - t * 0.5, max(2, u_octaves - 1), u_seed + 71u));
	if (u_bandingSteps > 0) { mixA = floor(mixA * float(u_bandingSteps)) / float(u_bandingSteps); }
	vec3 stop = mix(u_stopA, u_stopB, mixB);
	vec3 c = mix(u_bg, stop, 0.2 + 0.7 * mixA);
	c *= 1.0 + 0.35 * u_surge;
	c += (rand2(uvec2(gl_FragCoord.xy), u_seed ^ uint(u_time * 60.0 + 0.5)) - 0.5) * u_ditherAmount * displaySlope(c) * 0.25;
	o = vec4(max(c, 0.0), 1.0);
}`,
		crt: `uniform sampler2D u_src; uniform sampler2D u_history; uniform float u_scanlineFreqPerFrame, u_scanlineDepth, u_phosphorPersistence, u_bloomAmount, u_curvature, u_vignette, u_triadMaskAmount, u_flicker; uniform uint u_seed;
void main() {
	vec2 uv = gl_FragCoord.xy / u_res; vec2 d = uv - 0.5; float r2 = dot(d, d);
	vec2 bent = 0.5 + d * (1.0 + u_curvature * r2);
	vec3 c = (bent.x < 0.0 || bent.y < 0.0 || bent.x > 1.0 || bent.y > 1.0) ? vec3(0.0) : texture(u_src, bent).rgb;
	vec3 soft = (texture(u_src, bent + vec2(1.5, 0.0) / u_res).rgb + texture(u_src, bent - vec2(1.5, 0.0) / u_res).rgb) * 0.5;
	c += soft * u_bloomAmount * 0.25;
	float line = 0.5 + 0.5 * cos(3.14159265 * 2.0 * (u_res.y - gl_FragCoord.y) / u_scale * u_scanlineFreqPerFrame / 1080.0);
	c *= 1.0 - u_scanlineDepth * line;
	int triad = int(gl_FragCoord.x / u_scale) % 3;
	vec3 mask = triad == 0 ? vec3(1.0, 0.85, 0.85) : triad == 1 ? vec3(0.85, 1.0, 0.85) : vec3(0.85, 0.85, 1.0);
	c *= mix(vec3(1.0), mask, u_triadMaskAmount * (0.9 + 0.2 * rand2(uvec2(gl_FragCoord.xy / (2.0 * u_scale)), u_seed)));
	c *= mix(1.0, smoothstep(0.75, 0.2, length(d * vec2(1.0, 0.9))), u_vignette);
	c *= 1.0 + u_flicker;
	vec3 h = texture(u_history, uv).rgb;
	o = vec4(max(c, h * u_phosphorPersistence), 1.0);
}`,
		dither: `uniform sampler2D u_src; uniform int u_ditherMode, u_paletteSize, u_pixelScale; uniform float u_ditherStrength; uniform uint u_seed;
float bayer(ivec2 p, int n) {
	if (n == 2) { int m[4] = int[4](0, 2, 3, 1); return float(m[(p.y % 2) * 2 + p.x % 2]) / 4.0; }
	if (n == 4) { int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5); return float(m[(p.y % 4) * 4 + p.x % 4]) / 16.0; }
	int v = 0; for (int bit = 0; bit < 3; bit++) { int x = (p.x >> bit) & 1; int y = (p.y >> bit) & 1; v = v * 4 + ((x ^ y) * 2 + y); }
	return float(v) / 64.0;
}
void main() {
	vec2 top = logicalPx(); float cell = float(max(u_pixelScale, 1));
	vec2 centre = (floor(top / cell) + 0.5) * cell;
	vec3 c = texture(u_src, uvGL(centre * u_scale)).rgb;
	ivec2 k = ivec2(floor(top / cell));
	float threshold = u_ditherMode == 3 ? rand2(uvec2(k & 63) + uvec2(u_seed & 63u, (u_seed >> 6) & 63u), u_seed) : bayer(k, u_ditherMode == 0 ? 2 : u_ditherMode == 1 ? 4 : 8);
	vec3 s = toDisplay(c) + (threshold - 0.5) * u_ditherStrength / 24.0;
	if (u_paletteSize > 1) { float n = float(u_paletteSize - 1); s = floor(s * n + threshold) / n; }
	o = vec4(toLinear(clamp(s, 0.0, 1.0)) + max(c - 1.0, 0.0), 1.0);
}`,
		glitch: `uniform sampler2D u_src; uniform int u_hit, u_sliceCount; uniform uint u_hitSeed; uniform float u_intensity, u_maxOffsetPx, u_rgbSplitPx, u_areaCapPct; uniform vec2 u_blockCorruptSize;
void main() {
	vec2 uv = gl_FragCoord.xy / u_res;
	if (u_hit == 0) { o = vec4(texture(u_src, uv).rgb, 1.0); return; }
	vec2 top = logicalPx();
	float bandH = 1080.0 * u_areaCapPct / 100.0;
	float bandY = 54.0 + rand1(u_hitSeed) * (1080.0 - 108.0 - bandH);
	if (top.y < bandY || top.y >= bandY + bandH) { o = vec4(texture(u_src, uv).rgb, 1.0); return; }
	int slice = int(float(u_sliceCount) * (top.y - bandY) / bandH);
	float shift = (rand1(u_hitSeed ^ uint(slice * 7919 + 1)) - 0.5) * 2.0 * u_maxOffsetPx * u_intensity;
	uvec2 block = uvec2(top / u_blockCorruptSize);
	if (rand2(block, u_hitSeed) < 0.18 * u_intensity) shift += (rand2(block, u_hitSeed + 7u) - 0.5) * u_blockCorruptSize.x;
	vec2 src = top + vec2(shift, 0.0);
	float split = u_rgbSplitPx * u_intensity;
	vec3 c = vec3(texture(u_src, uvGL((src + vec2(split, 0.0)) * u_scale)).r, texture(u_src, uvGL(src * u_scale)).g, texture(u_src, uvGL((src - vec2(split, 0.0)) * u_scale)).b);
	o = vec4(c, 1.0);
}`,
		prefilter: `uniform sampler2D u_src; uniform vec2 u_texel; uniform float u_threshold, u_knee;
void main() {
	vec2 uv = gl_FragCoord.xy / u_res;
	vec3 c = 0.25 * (texture(u_src, uv + u_texel * vec2(-1, -1)).rgb + texture(u_src, uv + u_texel * vec2(1, -1)).rgb + texture(u_src, uv + u_texel * vec2(-1, 1)).rgb + texture(u_src, uv + u_texel * vec2(1, 1)).rgb);
	c = min(c, vec3(32.0));
	float l = max(c.r, max(c.g, c.b)); float knee = max(u_knee, 1e-4);
	float soft = clamp(l - u_threshold + knee, 0.0, 2.0 * knee); soft = soft * soft / (4.0 * knee);
	o = vec4(c * max(soft, l - u_threshold) / max(l, 1e-4), 1.0);
}`,
		down: `uniform sampler2D u_src; uniform vec2 u_texel;
void main() {
	vec2 uv = gl_FragCoord.xy / u_res; vec3 s = texture(u_src, uv).rgb * 0.25;
	s += 0.125 * (texture(u_src, uv + u_texel * vec2(-1, -1)).rgb + texture(u_src, uv + u_texel * vec2(1, -1)).rgb + texture(u_src, uv + u_texel * vec2(-1, 1)).rgb + texture(u_src, uv + u_texel * vec2(1, 1)).rgb);
	s += 0.0625 * (texture(u_src, uv + u_texel * vec2(-2, 0)).rgb + texture(u_src, uv + u_texel * vec2(2, 0)).rgb + texture(u_src, uv + u_texel * vec2(0, -2)).rgb + texture(u_src, uv + u_texel * vec2(0, 2)).rgb);
	o = vec4(s, 1.0);
}`,
		up: `uniform sampler2D u_src; uniform sampler2D u_base; uniform vec2 u_texel; uniform float u_radius;
void main() {
	vec2 uv = gl_FragCoord.xy / u_res; vec2 r = u_texel * u_radius;
	vec3 s = 4.0 * texture(u_src, uv).rgb + 2.0 * (texture(u_src, uv + vec2(r.x, 0)).rgb + texture(u_src, uv - vec2(r.x, 0)).rgb + texture(u_src, uv + vec2(0, r.y)).rgb + texture(u_src, uv - vec2(0, r.y)).rgb)
		+ texture(u_src, uv + r).rgb + texture(u_src, uv - r).rgb + texture(u_src, uv + vec2(r.x, -r.y)).rgb + texture(u_src, uv + vec2(-r.x, r.y)).rgb;
	o = vec4(texture(u_base, uv).rgb + s / 16.0, 1.0);
}`,
		post: `uniform sampler2D u_src; uniform sampler2D u_bloom; uniform sampler2D u_halo; uniform float u_exposure, u_bloomMix, u_halation, u_ca, u_grain, u_vignette, u_flash; uniform uint u_grainKey;
vec3 shoulder(vec3 x) { const float k = 0.72; vec3 y = mix(x, k + (1.0 - k) * (1.0 - exp(-(x - k) / (1.0 - k))), step(k, x)); return mix(y, vec3(1.0), smoothstep(2.0, 12.0, max(x.r, max(x.g, x.b))) * 0.85); }
void main() {
	vec2 uv = gl_FragCoord.xy / u_res; vec2 d = uv - 0.5;
	vec2 off = d * dot(d * vec2(1.7778, 1.0), d * vec2(1.7778, 1.0)) * u_ca * u_scale / u_res.x * 4.0;
	vec3 c = vec3(texture(u_src, uv + off).r, texture(u_src, uv).g, texture(u_src, uv - off).b);
	c += texture(u_bloom, uv).rgb * u_bloomMix;
	c += vec3(1.0, 0.3, 0.12) * luma(texture(u_halo, uv).rgb) * u_halation;
	c = shoulder(c * u_exposure);
	float g = (rand2(uvec2(gl_FragCoord.xy), u_grainKey) - 0.5) * 0.6 + (rand2(uvec2(gl_FragCoord.xy / (2.0 * u_scale)), u_grainKey ^ 0x9e3779b9u) - 0.5) * 0.4;
	float lm = luma(toDisplay(c));
	c += g * u_grain * (0.55 + 1.2 * lm * (1.0 - lm)) * displaySlope(c);
	c *= mix(1.0, smoothstep(0.95, 0.25, length(d * vec2(1.0, 0.8))), u_vignette);
	c += vec3(0.8, 0.82, 0.78) * u_flash;
	o = vec4(max(c, 0.0), 1.0);
}`,
		output: `uniform sampler2D u_src; uniform float u_zoom, u_fade, u_maskCurvature; uniform vec2 u_shake; uniform int u_invert, u_maskMode;
void main() {
	vec2 c = vec2(960.0, 540.0);
	vec2 srcTop = (vec2(gl_FragCoord.x, gl_FragCoord.y) / u_scale - c) / u_zoom + c - u_shake;
	vec2 uv = srcTop * u_scale / u_res;
	if (u_maskMode == 1) {
		vec2 d = uv - 0.5;
		vec2 bent = 0.5 + d * (1.0 + u_maskCurvature * dot(d, d));
		float a = (bent.x < 0.0 || bent.y < 0.0 || bent.x > 1.0 || bent.y > 1.0) ? 0.0 : texture(u_src, bent).a;
		o = vec4(a, a, a, 1.0);
		return;
	}
	vec3 col = texture(u_src, vec2(uv.x, 1.0 - uv.y)).rgb * u_fade;
	vec3 s = toDisplay(col);
	if (u_invert == 1) s = 1.0 - s;
	o = vec4(s, 1.0);
}`,
	};

	const LINE_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 a_corner; layout(location = 1) in vec4 a_seg; layout(location = 2) in float a_width; layout(location = 3) in vec4 a_color;
uniform vec2 u_res; uniform float u_scale;
out vec2 v_local; out float v_len; out float v_half; out vec4 v_color;
void main() {
	vec2 a = a_seg.xy * u_scale, b = a_seg.zw * u_scale; float w = max(a_width * u_scale, 0.7); float hw = w * 0.5 + 1.0;
	vec2 d = b - a; float len = length(d); vec2 dir = len > 1e-4 ? d / len : vec2(1.0, 0.0); vec2 nrm = vec2(-dir.y, dir.x);
	float along = mix(-hw, len + hw, a_corner.x);
	vec2 p = a + dir * along + nrm * a_corner.y * hw;
	gl_Position = vec4(p.x / u_res.x * 2.0 - 1.0, 1.0 - p.y / u_res.y * 2.0, 0.0, 1.0);
	v_local = vec2(along, a_corner.y * hw); v_len = len; v_half = w * 0.5; v_color = a_color;
}`;
	const LINE_FS = `#version 300 es
precision highp float;
in vec2 v_local; in float v_len; in float v_half; in vec4 v_color; out vec4 o;
void main() { float x = clamp(v_local.x, 0.0, v_len); float d = length(vec2(v_local.x - x, v_local.y)) - v_half; float a = clamp(0.5 - d, 0.0, 1.0) * v_color.a; if (a <= 0.0) discard; o = vec4(v_color.rgb, a); }`;

	const srgbToLinear = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
	const hexLinear = (hex) => {
		const n = Number.parseInt(hex.slice(1), 16);
		return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => srgbToLinear(v / 255));
	};
	const rgba = (hex, alpha) => {
		const n = Number.parseInt(hex.slice(1), 16);
		return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
	};
	const yieldTask = () =>
		new Promise((resolve) => {
			const channel = new MessageChannel();
			channel.port1.onmessage = resolve;
			channel.port2.postMessage(0);
		});

	let S = null;

	function compile(gl, type, source) {
		const shader = gl.createShader(type);
		gl.shaderSource(shader, source);
		gl.compileShader(shader);
		if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(`shader compile: ${gl.getShaderInfoLog(shader)}`);
		return shader;
	}
	function link(gl, vs, fs) {
		const program = gl.createProgram();
		gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vs));
		gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fs));
		gl.linkProgram(program);
		if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`program link: ${gl.getProgramInfoLog(program)}`);
		return program;
	}

	/** The one uniform-setter wrapper every pass routes through, so draws and uniforms are logged (MO-SH-00a). */
	class Pass {
		constructor(gl, name, program) {
			this.gl = gl;
			this.name = name;
			this.program = program;
			this.locations = new Map();
			this.draws = 0;
			this.uniforms = {};
			this.samplers = 0;
		}
		use() {
			this.gl.useProgram(this.program);
			this.samplers = 0;
			return this;
		}
		loc(name) {
			if (!this.locations.has(name)) this.locations.set(name, this.gl.getUniformLocation(this.program, name));
			return this.locations.get(name);
		}
		set(name, value, kind = "f", log = true) {
			const gl = this.gl;
			const at = this.loc(name);
			if (log) this.uniforms[name] = value;
			if (at === null) return this;
			if (kind === "u") gl.uniform1ui(at, value >>> 0);
			else if (kind === "i") gl.uniform1i(at, value | 0);
			else if (Array.isArray(value) && value.length === 2) gl.uniform2f(at, value[0], value[1]);
			else if (Array.isArray(value) && value.length === 3) gl.uniform3f(at, value[0], value[1], value[2]);
			else gl.uniform1f(at, value);
			return this;
		}
		texture(name, tex) {
			const gl = this.gl;
			gl.activeTexture(gl.TEXTURE0 + this.samplers);
			gl.bindTexture(gl.TEXTURE_2D, tex);
			gl.uniform1i(this.loc(name), this.samplers);
			this.samplers++;
			return this;
		}
		frame(target, width, height) {
			const gl = this.gl;
			gl.bindFramebuffer(gl.FRAMEBUFFER, target);
			gl.viewport(0, 0, width, height);
			gl.uniform2f(this.loc("u_res"), width, height);
			gl.uniform1f(this.loc("u_scale"), S.scale);
			return this;
		}
		draw() {
			this.gl.drawArrays(this.gl.TRIANGLES, 0, 3);
			this.draws++;
			return this;
		}
	}

	function target(gl, width, height, format) {
		const tex = gl.createTexture();
		gl.bindTexture(gl.TEXTURE_2D, tex);
		gl.texStorage2D(gl.TEXTURE_2D, 1, format, width, height);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		const fb = gl.createFramebuffer();
		gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
		if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error("render target incomplete");
		return { tex, fb, width, height };
	}

	function probe() {
		const canvas = document.createElement("canvas");
		const gl = canvas.getContext("webgl2");
		if (!gl) return { webgl2: false, renderer: null, halfFloat: false };
		const info = gl.getExtension("WEBGL_debug_renderer_info");
		const renderer = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : "unknown (debug-info extension unavailable)";
		return { webgl2: true, renderer, halfFloat: Boolean(gl.getExtension("EXT_color_buffer_float")) };
	}

	function init(config) {
		const width = 1920 * config.scale;
		const height = 1080 * config.scale;
		const canvas = document.createElement("canvas");
		canvas.width = width;
		canvas.height = height;
		const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, depth: false, preserveDrawingBuffer: false, powerPreference: "high-performance" });
		if (!gl) throw new Error("NO_WEBGL2");
		if (!gl.getExtension("EXT_color_buffer_float")) throw new Error("NO_HALF_FLOAT_TARGET");
		const info = gl.getExtension("WEBGL_debug_renderer_info");
		const glyphCanvas = document.createElement("canvas");
		glyphCanvas.width = width;
		glyphCanvas.height = height;
		const terminalCanvas = document.createElement("canvas");
		terminalCanvas.width = width;
		terminalCanvas.height = height;
		const programs = {};
		for (const [name, body] of Object.entries(FS)) programs[name] = link(gl, VERT, COMMON + body);
		const lineProgram = link(gl, LINE_VS, LINE_FS);
		const passes = {};
		for (const name of ["swiss-grid", "terminal-ui", "tidal-gradient", "crt", "dither", "glitch"]) {
			const program = { "swiss-grid": lineProgram, "terminal-ui": programs.layer, "tidal-gradient": programs.tidal, crt: programs.crt, dither: programs.dither, glitch: programs.glitch }[name];
			passes[name] = new Pass(gl, name, program);
		}
		const tools = Object.fromEntries(Object.entries(programs).map(([name, program]) => [name, new Pass(gl, name, program)]));
		const layerTex = (canvasEl) => {
			const tex = gl.createTexture();
			gl.bindTexture(gl.TEXTURE_2D, tex);
			gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, width, height);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
			return { tex, canvas: canvasEl, ctx: canvasEl.getContext("2d", { willReadFrequently: true, alpha: true }) };
		};
		const H16 = gl.RGBA16F;
		const mips = [];
		let mw = 960;
		let mh = 540;
		for (let i = 0; i < 6; i++) {
			mips.push({ down: target(gl, Math.max(2, mw), Math.max(2, mh), H16), up: target(gl, Math.max(2, mw), Math.max(2, mh), H16) });
			mw >>= 1;
			mh >>= 1;
		}
		const lineVao = gl.createVertexArray();
		gl.bindVertexArray(lineVao);
		const corner = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, corner);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, -1, 1, -1, 1, 1, 0, -1, 1, 1, 0, 1]), gl.STATIC_DRAW);
		gl.enableVertexAttribArray(0);
		gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
		const instances = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, instances);
		const stride = 9 * 4;
		gl.enableVertexAttribArray(1);
		gl.vertexAttribPointer(1, 4, gl.FLOAT, false, stride, 0);
		gl.vertexAttribDivisor(1, 1);
		gl.enableVertexAttribArray(2);
		gl.vertexAttribPointer(2, 1, gl.FLOAT, false, stride, 16);
		gl.vertexAttribDivisor(2, 1);
		gl.enableVertexAttribArray(3);
		gl.vertexAttribPointer(3, 4, gl.FLOAT, false, stride, 20);
		gl.vertexAttribDivisor(3, 1);
		gl.bindVertexArray(null);
		const emptyVao = gl.createVertexArray();
		const pbo = gl.createBuffer();
		gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
		gl.bufferData(gl.PIXEL_PACK_BUFFER, width * height * 4, gl.STREAM_READ);
		gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
		S = {
			gl,
			canvas,
			width,
			height,
			scale: config.scale,
			renderer: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : "unknown (debug-info extension unavailable)",
			glyph: layerTex(glyphCanvas),
			terminal: layerTex(terminalCanvas),
			scene: [target(gl, width, height, H16), target(gl, width, height, H16)],
			accum: target(gl, width, height, H16),
			history: target(gl, width, height, H16),
			post: target(gl, width, height, H16),
			out: target(gl, width, height, gl.RGBA8),
			mips,
			passes,
			tools,
			lineProgram,
			lineVao,
			instances,
			emptyVao,
			pbo,
			bytes: new Uint8Array(width * height * 4),
			paths: new Map(),
			socket: null,
			pending: 0,
			acks: [],
			order: config.order,
		};
		gl.bindVertexArray(emptyVao);
		return { renderer: S.renderer, width, height };
	}

	function defineGlyphs(defs) {
		for (const [handle, d] of defs) S.paths.set(handle, d ? new Path2D(d) : null);
	}

	/** Draw one sample's glyph layer; return the glyph-ink pixel count when asked (R8 mask, alpha >= 0.5). */
	function drawGlyphs(sample, countInk) {
		const { ctx } = S.glyph;
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, S.width, S.height);
		for (const group of sample.glyphs) {
			ctx.fillStyle = rgba(group.fill, group.alpha);
			const d = group.draws;
			for (let i = 0; i < d.length; i += 4) {
				const path = S.paths.get(d[i]);
				if (!path) continue;
				const k = d[i + 3] * S.scale;
				ctx.setTransform(k, 0, 0, k, d[i + 1] * S.scale, d[i + 2] * S.scale);
				ctx.fill(path);
			}
		}
		ctx.setTransform(S.scale, 0, 0, S.scale, 0, 0);
		ctx.lineCap = "round";
		ctx.lineJoin = "round";
		for (const stroke of sample.strokes) {
			ctx.strokeStyle = rgba(stroke.fill, stroke.alpha);
			ctx.lineWidth = stroke.widthPx;
			ctx.beginPath();
			for (const line of stroke.polylines) {
				ctx.moveTo(line[0], line[1]);
				for (let i = 2; i < line.length; i += 2) ctx.lineTo(line[i], line[i + 1]);
				if (line.length === 2) ctx.lineTo(line[0] + 0.01, line[1]);
			}
			ctx.stroke();
		}
		let ink = null;
		if (countInk) {
			const data = new Uint32Array(ctx.getImageData(0, 0, S.width, S.height).data.buffer);
			ink = 0;
			for (let i = 0; i < data.length; i++) if (data[i] >>> 24 >= 128) ink++;
		}
		const gl = S.gl;
		gl.bindTexture(gl.TEXTURE_2D, S.glyph.tex);
		gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, S.glyph.canvas);
		return ink;
	}

	function drawTerminal(terminal) {
		const { ctx } = S.terminal;
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, S.width, S.height);
		ctx.setTransform(S.scale, 0, 0, S.scale, 0, 0);
		for (const item of terminal) {
			if (item.type === "terminal") {
				const [x0, y0, x1, y1] = item.box;
				ctx.fillStyle = item.fill;
				ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
				ctx.strokeStyle = item.stroke;
				ctx.lineWidth = item.chromePx;
				ctx.strokeRect(x0 + item.chromePx / 2, y0 + item.chromePx / 2, x1 - x0 - item.chromePx, y1 - y0 - item.chromePx);
				ctx.beginPath();
				ctx.moveTo(x0, y0 + item.titleBarPx);
				ctx.lineTo(x1, y0 + item.titleBarPx);
				ctx.stroke();
				item.meters.forEach((level, k) => {
					const mx = x1 - 260;
					const my = y1 - 44 - k * 22;
					ctx.fillStyle = item.stroke;
					ctx.fillRect(mx, my, 220, 8);
					ctx.fillStyle = item.meterColor;
					ctx.fillRect(mx, my, Math.round(220 * level), 8);
				});
			} else if (item.type === "caret" && item.alpha > 0) {
				ctx.fillStyle = rgba(item.fill, item.alpha);
				ctx.fillRect(item.x, item.y, item.w, item.h);
			}
		}
		const gl = S.gl;
		gl.bindTexture(gl.TEXTURE_2D, S.terminal.tex);
		gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, S.terminal.canvas);
	}

	function composite(pass, layerTex, dest) {
		const gl = S.gl;
		gl.enable(gl.BLEND);
		gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
		pass.use().frame(dest.fb, S.width, S.height).texture("u_layer", layerTex).draw();
		gl.disable(gl.BLEND);
	}

	function drawLines(pass, lines, dest, log) {
		const gl = S.gl;
		const data = [];
		for (const line of lines) {
			const c = hexLinear(line.fill);
			data.push(line.x0, line.y0, line.x1, line.y1, line.widthPx, c[0], c[1], c[2], line.alpha);
		}
		if (data.length === 0) return;
		gl.useProgram(S.lineProgram);
		gl.bindFramebuffer(gl.FRAMEBUFFER, dest.fb);
		gl.viewport(0, 0, S.width, S.height);
		gl.uniform2f(gl.getUniformLocation(S.lineProgram, "u_res"), S.width, S.height);
		gl.uniform1f(gl.getUniformLocation(S.lineProgram, "u_scale"), S.scale);
		gl.bindVertexArray(S.lineVao);
		gl.bindBuffer(gl.ARRAY_BUFFER, S.instances);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STREAM_DRAW);
		gl.enable(gl.BLEND);
		gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
		gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, data.length / 9);
		gl.disable(gl.BLEND);
		gl.bindVertexArray(S.emptyVao);
		pass.draws++;
		if (log) pass.uniforms.u_segments = data.length / 9;
	}

	/** Render one sub-frame sample into a half-float scene target and return that target. */
	function renderSample(sample, countInk, log) {
		const gl = S.gl;
		let current = S.scene[0];
		let spare = S.scene[1];
		S.tools.fill.use().frame(current.fb, S.width, S.height).set("u_color", hexLinear(sample.background), "f", false).draw();
		const ink = drawGlyphs(sample, countInk);
		let typeDrawn = false;
		const drawType = () => {
			if (typeDrawn) return;
			composite(S.tools.layer, S.glyph.tex, current);
			typeDrawn = true;
		};
		for (const step of sample.passes) {
			const pass = S.passes[step.pass];
			const u = step.uniforms;
			const setAll = (p) => {
				for (const [name, value] of Object.entries(u)) {
					const kind = name === "u_seed" || name === "u_hitSeed" ? "u" : ["u_octaves", "u_bandingSteps", "u_ditherMode", "u_paletteSize", "u_pixelScale", "u_hit", "u_sliceCount", "u_showGuides", "u_meterCount", "u_columns"].includes(name) ? "i" : "f";
					if (value === null || value === undefined) continue;
					p.set(name, value, kind, log);
				}
			};
			if (step.pass === "tidal-gradient") {
				const p = pass.use().frame(current.fb, S.width, S.height);
				setAll(p);
				p.set("u_bg", hexLinear(step.colors.bg), "f", false).set("u_stopA", hexLinear(step.colors.stopA), "f", false).set("u_stopB", hexLinear(step.colors.stopB), "f", false).draw();
			} else if (step.pass === "swiss-grid") {
				if (log) pass.uniforms = { ...u };
				drawLines(pass, step.lines, current, log);
			} else if (step.pass === "terminal-ui") {
				drawTerminal(step.terminal);
				if (log) pass.uniforms = { ...u };
				composite(pass, S.terminal.tex, current);
			} else {
				drawType();
				const p = pass.use().frame(spare.fb, S.width, S.height).texture("u_src", current.tex);
				if (step.pass === "crt") p.texture("u_history", S.history.tex);
				setAll(p);
				p.draw();
				[current, spare] = [spare, current];
				if (step.pass === "crt") {
					S.tools.copy.use().frame(S.history.fb, S.width, S.height).texture("u_src", current.tex).set("u_weight", 1, "f", false).draw();
				}
			}
		}
		drawType();
		return { result: current, ink };
	}

	function bloom(src, post) {
		const gl = S.gl;
		const first = S.mips[0].down;
		S.tools.prefilter.use().frame(first.fb, first.width, first.height).texture("u_src", src.tex).set("u_texel", [1 / S.width, 1 / S.height], "f", false).set("u_threshold", post.bloomThreshold, "f", false).set("u_knee", post.bloomKnee, "f", false).draw();
		for (let i = 1; i < S.mips.length; i++) {
			const from = S.mips[i - 1].down;
			const to = S.mips[i].down;
			S.tools.down.use().frame(to.fb, to.width, to.height).texture("u_src", from.tex).set("u_texel", [1 / from.width, 1 / from.height], "f", false).draw();
		}
		let previous = S.mips[S.mips.length - 1].down;
		for (let i = S.mips.length - 2; i >= 0; i--) {
			const to = S.mips[i].up;
			S.tools.up.use().frame(to.fb, to.width, to.height).texture("u_src", previous.tex).texture("u_base", S.mips[i].down.tex).set("u_texel", [1 / previous.width, 1 / previous.height], "f", false).set("u_radius", 0.5 + post.bloomRadius, "f", false).draw();
			previous = to;
		}
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		return { bloom: S.mips[0].up.tex, halo: S.mips[3].up.tex };
	}

	async function readOut() {
		const gl = S.gl;
		gl.bindFramebuffer(gl.FRAMEBUFFER, S.out.fb);
		gl.bindBuffer(gl.PIXEL_PACK_BUFFER, S.pbo);
		gl.readPixels(0, 0, S.width, S.height, gl.RGBA, gl.UNSIGNED_BYTE, 0);
		const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
		gl.flush();
		for (;;) {
			const status = gl.clientWaitSync(sync, 0, 0);
			if (status === gl.ALREADY_SIGNALED || status === gl.CONDITION_SATISFIED) break;
			if (status === gl.WAIT_FAILED) throw new Error("GPU fence wait failed");
			await yieldTask();
		}
		gl.deleteSync(sync);
		gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, S.bytes);
		gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
		return S.bytes;
	}

	/** Render one output frame: N samples averaged in linear HDR, the post chain once, 8-bit readback. */
	async function renderFrame(cmd) {
		const gl = S.gl;
		for (const pass of Object.values(S.passes)) {
			pass.draws = 0;
			pass.uniforms = {};
		}
		const n = cmd.samples.length;
		const rep = Math.floor(n / 2);
		gl.bindFramebuffer(gl.FRAMEBUFFER, S.accum.fb);
		gl.viewport(0, 0, S.width, S.height);
		gl.clearColor(0, 0, 0, 1);
		gl.clear(gl.COLOR_BUFFER_BIT);
		let ink = null;
		for (let i = 0; i < n; i++) {
			const { result, ink: count } = renderSample(cmd.samples[i], i === rep && cmd.countInk, i === rep);
			if (i === rep) ink = count;
			gl.enable(gl.BLEND);
			gl.blendFunc(gl.ONE, gl.ONE);
			S.tools.copy.use().frame(S.accum.fb, S.width, S.height).texture("u_src", result.tex).set("u_weight", 1 / n, "f", false).draw();
			gl.disable(gl.BLEND);
		}
		const post = cmd.post;
		const { bloom: bloomTex, halo } = bloom(S.accum, post);
		S.tools.post
			.use()
			.frame(S.post.fb, S.width, S.height)
			.texture("u_src", S.accum.tex)
			.texture("u_bloom", bloomTex)
			.texture("u_halo", halo)
			.set("u_exposure", post.exposure, "f", false)
			.set("u_bloomMix", post.bloom / 2.5, "f", false)
			.set("u_halation", post.halation, "f", false)
			.set("u_ca", post.ca, "f", false)
			.set("u_grain", post.grain, "f", false)
			.set("u_vignette", post.vignette, "f", false)
			.set("u_flash", post.flash, "f", false)
			.set("u_grainKey", cmd.grainKey, "u", false)
			.draw();
		S.tools.output
			.use()
			.frame(S.out.fb, S.width, S.height)
			.texture("u_src", S.post.tex)
			.set("u_zoom", post.zoom, "f", false)
			.set("u_fade", post.fade, "f", false)
			.set("u_shake", post.shake, "f", false)
			.set("u_invert", post.invert ? 1 : 0, "i", false)
			.set("u_maskMode", 0, "i", false)
			.draw();
		const log = cmd.order.map((name) => ({ pass: name, draws: S.passes[name].draws, uniforms: S.passes[name].uniforms }));
		if (cmd.discard) {
			gl.finish();
			return { log, ink };
		}
		const bytes = await readOut();
		let mask = null;
		if (cmd.mask) {
			drawGlyphs(cmd.samples[rep], false);
			S.tools.output
				.use()
				.frame(S.out.fb, S.width, S.height)
				.texture("u_src", S.glyph.tex)
				.set("u_zoom", post.zoom, "f", false)
				.set("u_fade", 1, "f", false)
				.set("u_shake", post.shake, "f", false)
				.set("u_invert", 0, "i", false)
				.set("u_maskMode", 1, "i", false)
				.set("u_maskCurvature", cmd.maskCurvature ?? 0, "f", false)
				.draw();
			const frameCopy = bytes.slice();
			const maskBytes = await readOut();
			mask = new Uint8Array(S.width * S.height);
			for (let i = 0; i < mask.length; i++) mask[i] = maskBytes[i * 4];
			S.bytes.set(frameCopy);
		}
		return { log, ink, bytes: S.bytes, mask };
	}

	const toBase64 = (bytes) => {
		let text = "";
		for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
		return btoa(text);
	};

	async function connect(url) {
		const socket = new WebSocket(url);
		socket.binaryType = "arraybuffer";
		await new Promise((resolve, reject) => {
			socket.onopen = resolve;
			socket.onerror = () => reject(new Error("frame socket failed to open"));
		});
		socket.onmessage = () => {
			S.pending--;
			S.acks.shift()?.();
		};
		S.pending = 0;
		S.acks = [];
		S.socket = socket;
		return true;
	}

	/** Frame entry point used by the Node driver; ships bytes over the socket or returns base64. */
	async function frame(cmd) {
		if (cmd.defs?.length) defineGlyphs(cmd.defs);
		const result = await renderFrame(cmd);
		const out = { log: result.log, ink: result.ink };
		if (cmd.discard) return out;
		if (result.mask) out.mask = toBase64(result.mask);
		if (S.socket && !cmd.pull) {
			while (S.pending >= 3) await new Promise((resolve) => S.acks.push(resolve));
			S.pending++;
			S.socket.send(result.bytes);
			if (cmd.wait) while (S.pending > 0) await new Promise((resolve) => S.acks.push(resolve));
			out.egress = "websocket";
		} else {
			out.rgba = toBase64(result.bytes);
			out.egress = "cdp-pull";
		}
		return out;
	}

	/** Frame time for MO-D-02: from the call to readback complete, one sample, no egress. */
	async function perfFrame(cmd) {
		if (cmd.defs?.length) defineGlyphs(cmd.defs);
		const started = performance.now();
		await renderFrame({ ...cmd, discard: false, mask: false });
		return performance.now() - started;
	}

	window.__litMotion = { probe, init, frame, perfFrame, connect };
})();
