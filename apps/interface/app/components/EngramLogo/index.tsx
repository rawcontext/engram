"use client";

import { useEffect, useRef } from "react";

const vertexShader = `
  attribute vec2 position;
  void main() {
    gl_Position = vec4(position, 0.0, 1.0);
  }
`;

const fragmentShader = `
  precision highp float;

  uniform vec2 resolution;
  uniform float time;

  #define PI 3.14159265359

  // Draw glowing point
  float drawPoint(vec2 uv, vec2 pos, float radius, float glowSize) {
    float d = length(uv - pos);
    float core = smoothstep(radius, radius * 0.2, d);
    float halo = smoothstep(glowSize, 0.0, d) * 0.5;
    return core + halo;
  }

  // Draw soft line with better visibility
  float drawLine(vec2 uv, vec2 a, vec2 b, float width) {
    vec2 pa = uv - a;
    vec2 ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    float d = length(pa - ba * h);
    // Wider falloff for more visible lines
    return smoothstep(width, width * 0.3, d);
  }

  // Flowing particle - returns position t along path
  float flowParticle(vec2 uv, vec2 a, vec2 b, float t, float size) {
    vec2 pos = mix(a, b, t);
    float d = length(uv - pos);
    return smoothstep(size, 0.0, d);
  }

  // Impact ripple when particle reaches neuron (t near 1.0)
  // Smooth fade out instead of abrupt disappearance
  float impactRipple(vec2 uv, vec2 pos, float t, float maxRadius) {
    // Only show ripple when t is close to 1.0 (particle arriving)
    float impactPhase = smoothstep(0.8, 0.95, t);
    // Continue ripple after impact for smooth fade
    float postImpact = smoothstep(0.0, 0.3, fract(t + 0.05));
    float rippleT = fract((t - 0.8) * 2.5); // slower ripple expansion
    float rippleRadius = rippleT * maxRadius;
    float d = length(uv - pos);
    // Softer ring with gradual edges
    float ring = smoothstep(rippleRadius + 0.025, rippleRadius + 0.005, d) *
                 smoothstep(rippleRadius - 0.025, rippleRadius, d);
    // Smooth cubic fade out
    float fade = 1.0 - rippleT;
    fade = fade * fade * (3.0 - 2.0 * fade); // smoothstep curve
    return ring * impactPhase * fade * 0.8;
  }

  void main() {
    vec2 uv = (gl_FragCoord.xy - resolution * 0.5) / min(resolution.x, resolution.y);
    uv *= 2.0;

    // Neuron positions - organic asymmetric layout
    vec2 n0 = vec2(0.0, 0.02);
    vec2 n1 = vec2(-0.22, -0.08);
    vec2 n2 = vec2(0.19, -0.14);
    vec2 n3 = vec2(-0.08, 0.22);
    vec2 n4 = vec2(0.15, 0.18);
    vec2 n5 = vec2(-0.45, -0.22);
    vec2 n6 = vec2(0.42, -0.35);
    vec2 n7 = vec2(-0.38, 0.32);
    vec2 n8 = vec2(0.44, 0.28);
    vec2 n9 = vec2(-0.15, -0.42);
    vec2 n10 = vec2(0.08, 0.48);
    vec2 n11 = vec2(-0.68, 0.05);
    vec2 n12 = vec2(0.65, -0.12);
    vec2 n13 = vec2(-0.52, -0.48);
    vec2 n14 = vec2(0.58, 0.52);
    vec2 n15 = vec2(-0.25, 0.62);

    // Colors - amber/slate base, cyan/purple for impacts
    vec3 amberCol = vec3(0.984, 0.749, 0.141);  // rgb(251, 191, 36)
    vec3 slateCol = vec3(0.58, 0.64, 0.72);     // slate gray
    vec3 slateDim = vec3(0.39, 0.45, 0.55);     // dimmer slate
    vec3 cyanCol = vec3(0.0, 0.96, 0.83);
    vec3 purpleCol = vec3(0.545, 0.361, 0.965);

    float totalAlpha = 0.0;
    vec3 color = vec3(0.0);

    // Subtle wave for gentle pulsing
    float wave = sin(time * 1.5) * 0.15 + 0.85;

    // Draw synapses (slate colored lines along all particle paths)
    // Use a lighter slate for better visibility
    vec3 lineCol = vec3(0.45, 0.52, 0.62);
    float lineAlpha = 0.0;
    // Core connections from n0
    lineAlpha += drawLine(uv, n0, n1, 0.018) * 0.7;
    lineAlpha += drawLine(uv, n0, n2, 0.018) * 0.7;
    lineAlpha += drawLine(uv, n0, n3, 0.018) * 0.7;
    lineAlpha += drawLine(uv, n0, n4, 0.018) * 0.7;
    // Inner ring connections
    lineAlpha += drawLine(uv, n1, n5, 0.014) * 0.6;
    lineAlpha += drawLine(uv, n2, n6, 0.014) * 0.6;
    lineAlpha += drawLine(uv, n3, n7, 0.014) * 0.6;
    lineAlpha += drawLine(uv, n4, n8, 0.014) * 0.6;
    lineAlpha += drawLine(uv, n1, n9, 0.014) * 0.6;
    lineAlpha += drawLine(uv, n3, n10, 0.014) * 0.6;
    lineAlpha += drawLine(uv, n4, n10, 0.012) * 0.55;
    // Outer ring connections
    lineAlpha += drawLine(uv, n5, n11, 0.012) * 0.5;
    lineAlpha += drawLine(uv, n6, n12, 0.012) * 0.5;
    lineAlpha += drawLine(uv, n5, n13, 0.012) * 0.5;
    lineAlpha += drawLine(uv, n9, n13, 0.012) * 0.5;
    lineAlpha += drawLine(uv, n8, n14, 0.012) * 0.5;
    lineAlpha += drawLine(uv, n7, n15, 0.012) * 0.5;
    lineAlpha += drawLine(uv, n10, n15, 0.012) * 0.5;
    // Cross connections
    lineAlpha += drawLine(uv, n7, n11, 0.010) * 0.45;
    lineAlpha += drawLine(uv, n6, n9, 0.010) * 0.45;

    color += lineCol * lineAlpha;
    totalAlpha += lineAlpha;

    // Flowing particles (amber colored, traveling along paths)
    // Use different speeds and prime-based offsets for organic feel
    float baseTime = time;

    // Different flow speeds (varied rates create desync)
    float slow = baseTime * 0.32;
    float med = baseTime * 0.4;
    float fast = baseTime * 0.48;

    // Prime-based offsets to avoid synchronization
    float ft1 = fract(med);
    float ft2 = fract(slow + 0.17);
    float ft3 = fract(fast + 0.41);
    float ft4 = fract(med + 0.73);
    float ft5 = fract(slow + 0.29);
    float ft6 = fract(fast + 0.61);
    float ft7 = fract(med + 0.13);
    float ft8 = fract(slow + 0.53);
    float ft9 = fract(fast + 0.07);
    float ft10 = fract(med + 0.89);
    float ft11 = fract(slow + 0.37);
    float ft12 = fract(fast + 0.79);

    float particleAlpha = 0.0;
    // Core neurons (from n0) - staggered dispatch
    particleAlpha += flowParticle(uv, n0, n1, ft1, 0.022) * 0.7;
    particleAlpha += flowParticle(uv, n0, n2, ft4, 0.022) * 0.7;
    particleAlpha += flowParticle(uv, n0, n3, ft7, 0.022) * 0.7;
    particleAlpha += flowParticle(uv, n0, n4, ft10, 0.022) * 0.7;
    // Inner ring to outer - different timings
    particleAlpha += flowParticle(uv, n1, n5, ft2, 0.018) * 0.6;
    particleAlpha += flowParticle(uv, n2, n6, ft5, 0.018) * 0.6;
    particleAlpha += flowParticle(uv, n3, n7, ft8, 0.018) * 0.6;
    particleAlpha += flowParticle(uv, n4, n8, ft11, 0.018) * 0.6;
    particleAlpha += flowParticle(uv, n1, n9, ft3, 0.018) * 0.6;
    particleAlpha += flowParticle(uv, n3, n10, ft6, 0.018) * 0.6;
    particleAlpha += flowParticle(uv, n4, n10, ft9, 0.016) * 0.55;
    // Outer ring - varied speeds
    particleAlpha += flowParticle(uv, n5, n11, ft12, 0.014) * 0.5;
    particleAlpha += flowParticle(uv, n6, n12, ft3, 0.014) * 0.5;
    particleAlpha += flowParticle(uv, n5, n13, ft6, 0.014) * 0.5;
    particleAlpha += flowParticle(uv, n9, n13, ft9, 0.014) * 0.5;
    particleAlpha += flowParticle(uv, n8, n14, ft2, 0.014) * 0.5;
    particleAlpha += flowParticle(uv, n7, n15, ft5, 0.014) * 0.5;
    particleAlpha += flowParticle(uv, n10, n15, ft8, 0.014) * 0.5;
    // Cross connections
    particleAlpha += flowParticle(uv, n7, n11, ft11, 0.012) * 0.45;
    particleAlpha += flowParticle(uv, n6, n9, ft4, 0.012) * 0.45;

    color += amberCol * particleAlpha;
    totalAlpha += particleAlpha;

    // Impact ripples - cyan/purple/amber blend when particles hit neurons
    float rippleAlpha = 0.0;
    vec3 rippleCol = vec3(0.0);

    // Ripples at ALL destination neurons - matched to particle timings
    // Core neurons receiving from n0 (ft1, ft4, ft7, ft10)
    float r1 = impactRipple(uv, n1, ft1, 0.12);
    float r2 = impactRipple(uv, n2, ft4, 0.12);
    float r3 = impactRipple(uv, n3, ft7, 0.12);
    float r4 = impactRipple(uv, n4, ft10, 0.12);
    // Middle layer (ft2, ft5, ft8, ft11, ft3, ft6, ft9)
    float r5 = impactRipple(uv, n5, ft2, 0.10);
    float r6 = impactRipple(uv, n6, ft5, 0.10);
    float r7 = impactRipple(uv, n7, ft8, 0.10);
    float r8 = impactRipple(uv, n8, ft11, 0.10);
    float r9 = impactRipple(uv, n9, ft3, 0.10);
    float r10 = impactRipple(uv, n10, ft6, 0.10);
    float r10b = impactRipple(uv, n10, ft9, 0.09); // second path
    // Outer layer (ft12, ft3, ft6, ft9, ft2, ft5, ft8, ft11, ft4)
    float r11 = impactRipple(uv, n11, ft12, 0.08);
    float r11b = impactRipple(uv, n11, ft11, 0.07);
    float r12 = impactRipple(uv, n12, ft3, 0.08);
    float r13 = impactRipple(uv, n13, ft6, 0.08);
    float r13b = impactRipple(uv, n13, ft9, 0.07);
    float r14 = impactRipple(uv, n14, ft2, 0.08);
    float r15 = impactRipple(uv, n15, ft5, 0.08);
    float r15b = impactRipple(uv, n15, ft8, 0.07);

    // Blend cyan, purple, amber for ripple colors - varied per neuron
    rippleCol += mix(cyanCol, amberCol, 0.3) * r1;
    rippleCol += mix(purpleCol, amberCol, 0.4) * r2;
    rippleCol += mix(cyanCol, purpleCol, 0.5) * r3;
    rippleCol += mix(amberCol, cyanCol, 0.4) * r4;
    rippleCol += cyanCol * r5;
    rippleCol += purpleCol * r6;
    rippleCol += mix(cyanCol, amberCol, 0.5) * r7;
    rippleCol += mix(purpleCol, cyanCol, 0.6) * r8;
    rippleCol += mix(cyanCol, purpleCol, 0.3) * r9;
    rippleCol += mix(amberCol, purpleCol, 0.5) * (r10 + r10b);
    rippleCol += cyanCol * (r11 + r11b) * 0.8;
    rippleCol += purpleCol * r12 * 0.8;
    rippleCol += mix(cyanCol, amberCol, 0.6) * (r13 + r13b) * 0.8;
    rippleCol += mix(purpleCol, amberCol, 0.4) * r14 * 0.8;
    rippleCol += mix(cyanCol, purpleCol, 0.5) * (r15 + r15b) * 0.8;

    rippleAlpha = r1 + r2 + r3 + r4 + r5 + r6 + r7 + r8 + r9 + r10 + r10b +
                  r11 + r11b + r12 + r13 + r13b + r14 + r15 + r15b;
    color += rippleCol * 1.2;
    totalAlpha += rippleAlpha * 0.7;

    // Draw neurons (amber core, slate outer)
    float nAlpha;

    // Core neurons - amber with white center
    nAlpha = drawPoint(uv, n0, 0.05, 0.11) * wave;
    color += amberCol * nAlpha * 1.1 + vec3(1.0) * nAlpha * 0.25;
    totalAlpha += nAlpha;

    nAlpha = drawPoint(uv, n1, 0.038, 0.085) * wave;
    color += amberCol * nAlpha + vec3(1.0) * nAlpha * 0.15;
    totalAlpha += nAlpha;

    nAlpha = drawPoint(uv, n2, 0.038, 0.085) * wave;
    color += amberCol * nAlpha + vec3(1.0) * nAlpha * 0.15;
    totalAlpha += nAlpha;

    nAlpha = drawPoint(uv, n3, 0.038, 0.085) * wave;
    color += amberCol * nAlpha + vec3(1.0) * nAlpha * 0.15;
    totalAlpha += nAlpha;

    nAlpha = drawPoint(uv, n4, 0.038, 0.085) * wave;
    color += amberCol * nAlpha + vec3(1.0) * nAlpha * 0.15;
    totalAlpha += nAlpha;

    // Secondary neurons - amber/slate blend
    vec3 secCol = mix(amberCol, slateCol, 0.5);
    nAlpha = drawPoint(uv, n5, 0.026, 0.06) * wave;
    color += secCol * nAlpha;
    totalAlpha += nAlpha;

    nAlpha = drawPoint(uv, n6, 0.026, 0.06) * wave;
    color += secCol * nAlpha;
    totalAlpha += nAlpha;

    nAlpha = drawPoint(uv, n7, 0.026, 0.06) * wave;
    color += secCol * nAlpha;
    totalAlpha += nAlpha;

    nAlpha = drawPoint(uv, n8, 0.026, 0.06) * wave;
    color += secCol * nAlpha;
    totalAlpha += nAlpha;

    nAlpha = drawPoint(uv, n9, 0.022, 0.05) * wave;
    color += secCol * nAlpha;
    totalAlpha += nAlpha;

    nAlpha = drawPoint(uv, n10, 0.022, 0.05) * wave;
    color += secCol * nAlpha;
    totalAlpha += nAlpha;

    // Peripheral neurons - slate
    nAlpha = drawPoint(uv, n11, 0.018, 0.042) * wave;
    color += slateCol * nAlpha;
    totalAlpha += nAlpha;

    nAlpha = drawPoint(uv, n12, 0.018, 0.042) * wave;
    color += slateCol * nAlpha;
    totalAlpha += nAlpha;

    nAlpha = drawPoint(uv, n13, 0.016, 0.038) * wave;
    color += slateCol * nAlpha;
    totalAlpha += nAlpha;

    nAlpha = drawPoint(uv, n14, 0.016, 0.038) * wave;
    color += slateCol * nAlpha;
    totalAlpha += nAlpha;

    nAlpha = drawPoint(uv, n15, 0.016, 0.038) * wave;
    color += slateCol * nAlpha;
    totalAlpha += nAlpha;

    // Subtle central glow (amber)
    float centerDist = length(uv);
    float memGlow = smoothstep(0.45, 0.0, centerDist) * 0.12 * wave;
    color += amberCol * memGlow * 0.6;
    totalAlpha += memGlow * 0.5;

    totalAlpha = clamp(totalAlpha, 0.0, 1.0);
    gl_FragColor = vec4(color * totalAlpha, totalAlpha);
  }
`;

export function EngramLogo() {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const glRef = useRef<WebGLRenderingContext | null>(null);
	const programRef = useRef<WebGLProgram | null>(null);
	const startTimeRef = useRef<number>(Date.now());
	const animationRef = useRef<number>(0);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;

		const gl = canvas.getContext("webgl", {
			alpha: true,
			premultipliedAlpha: true,
			antialias: true,
		});
		if (!gl) {
			console.error("WebGL not supported");
			return;
		}
		glRef.current = gl;

		// Enable blending for transparency
		gl.enable(gl.BLEND);
		gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

		// Create shaders
		const vs = gl.createShader(gl.VERTEX_SHADER)!;
		gl.shaderSource(vs, vertexShader);
		gl.compileShader(vs);

		const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
		gl.shaderSource(fs, fragmentShader);
		gl.compileShader(fs);

		if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
			console.error("Fragment shader error:", gl.getShaderInfoLog(fs));
			return;
		}

		// Create program
		const program = gl.createProgram()!;
		gl.attachShader(program, vs);
		gl.attachShader(program, fs);
		gl.linkProgram(program);
		programRef.current = program;

		// Create buffer
		const buffer = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
		gl.bufferData(
			gl.ARRAY_BUFFER,
			new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
			gl.STATIC_DRAW
		);

		const position = gl.getAttribLocation(program, "position");
		gl.enableVertexAttribArray(position);
		gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

		gl.useProgram(program);

		const resolutionLoc = gl.getUniformLocation(program, "resolution");
		const timeLoc = gl.getUniformLocation(program, "time");

		const render = () => {
			if (!glRef.current || !programRef.current) return;

			const time = (Date.now() - startTimeRef.current) / 1000;

			gl.viewport(0, 0, canvas.width, canvas.height);
			gl.clearColor(0, 0, 0, 0);
			gl.clear(gl.COLOR_BUFFER_BIT);

			gl.uniform2f(resolutionLoc, canvas.width, canvas.height);
			gl.uniform1f(timeLoc, time);

			gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

			animationRef.current = requestAnimationFrame(render);
		};

		render();

		return () => {
			cancelAnimationFrame(animationRef.current);
			gl.deleteProgram(program);
			gl.deleteShader(vs);
			gl.deleteShader(fs);
		};
	}, []);

	return (
		<canvas
			ref={canvasRef}
			width={400}
			height={400}
			style={{
				width: "200px",
				height: "200px",
				display: "block",
				margin: "0 auto 1rem auto",
			}}
		/>
	);
}
