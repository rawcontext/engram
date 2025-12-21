"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

// Vertex shader for the neural particles
const vertexShader = `
  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uSize;

  attribute float aScale;
  attribute vec3 aRandomness;

  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vec4 modelPosition = modelMatrix * vec4(position, 1.0);

    // Add flowing movement
    float angle = uTime * 0.2;
    float distanceToCenter = length(modelPosition.xz);
    float angleOffset = (1.0 / distanceToCenter) * uTime * 0.3;

    modelPosition.x += sin(angle + aRandomness.x * 10.0) * aRandomness.y * 0.5;
    modelPosition.y += cos(uTime * 0.5 + aRandomness.z * 5.0) * 0.3;
    modelPosition.z += cos(angle + aRandomness.z * 10.0) * aRandomness.x * 0.5;

    vec4 viewPosition = viewMatrix * modelPosition;
    vec4 projectedPosition = projectionMatrix * viewPosition;

    gl_Position = projectedPosition;
    gl_PointSize = uSize * aScale * uPixelRatio;
    gl_PointSize *= (1.0 / -viewPosition.z);

    // Color based on position - cyan to purple gradient
    float mixValue = (modelPosition.y + 3.0) / 6.0;
    vec3 cyan = vec3(0.0, 0.96, 0.83);
    vec3 purple = vec3(0.545, 0.36, 0.965);
    vColor = mix(cyan, purple, mixValue + sin(uTime + aRandomness.x * 6.28) * 0.2);

    // Alpha based on distance and randomness
    vAlpha = 0.4 + aRandomness.y * 0.4;
  }
`;

// Fragment shader for the neural particles
const fragmentShader = `
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    // Create circular particle with soft glow
    float distanceToCenter = distance(gl_PointCoord, vec2(0.5));

    if (distanceToCenter > 0.5) {
      discard;
    }

    // Soft glow effect
    float strength = 1.0 - (distanceToCenter * 2.0);
    strength = pow(strength, 1.5);

    // Add core brightness
    float core = 1.0 - smoothstep(0.0, 0.15, distanceToCenter);
    strength += core * 0.5;

    gl_FragColor = vec4(vColor, strength * vAlpha);
  }
`;

// Line vertex shader for connections
const lineVertexShader = `
  uniform float uTime;

  attribute vec3 aStart;
  attribute vec3 aEnd;
  attribute float aProgress;

  varying float vProgress;
  varying float vAlpha;

  void main() {
    vProgress = aProgress;

    // Interpolate between start and end
    vec3 pos = mix(aStart, aEnd, aProgress);

    // Add subtle wave
    pos.y += sin(uTime * 2.0 + aProgress * 6.28) * 0.05;

    vec4 modelPosition = modelMatrix * vec4(pos, 1.0);
    vec4 viewPosition = viewMatrix * modelPosition;

    gl_Position = projectionMatrix * viewPosition;

    // Fade at ends
    vAlpha = sin(aProgress * 3.14159) * 0.3;
  }
`;

const lineFragmentShader = `
  varying float vProgress;
  varying float vAlpha;

  void main() {
    vec3 cyan = vec3(0.0, 0.96, 0.83);
    vec3 purple = vec3(0.545, 0.36, 0.965);
    vec3 color = mix(cyan, purple, vProgress);

    gl_FragColor = vec4(color, vAlpha);
  }
`;

function NeuralParticles({ count = 500 }: { count?: number }) {
	const points = useRef<THREE.Points>(null);
	useThree(); // Context subscription for rendering

	const particlesPosition = useMemo(() => {
		const positions = new Float32Array(count * 3);
		const scales = new Float32Array(count);
		const randomness = new Float32Array(count * 3);

		for (let i = 0; i < count; i++) {
			// Distribute in a sphere/cloud shape
			const radius = 4 + Math.random() * 6;
			const theta = Math.random() * Math.PI * 2;
			const phi = Math.acos(2 * Math.random() - 1);

			positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
			positions[i * 3 + 1] = (Math.random() - 0.5) * 6;
			positions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);

			scales[i] = 0.5 + Math.random() * 1.5;

			randomness[i * 3] = Math.random();
			randomness[i * 3 + 1] = Math.random();
			randomness[i * 3 + 2] = Math.random();
		}

		return { positions, scales, randomness };
	}, [count]);

	const uniforms = useMemo(
		() => ({
			uTime: { value: 0 },
			uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
			uSize: { value: 30 },
		}),
		[],
	);

	useFrame((state) => {
		if (points.current) {
			const material = points.current.material as THREE.ShaderMaterial;
			material.uniforms.uTime.value = state.clock.elapsedTime;
		}
	});

	return (
		<points ref={points}>
			<bufferGeometry>
				<bufferAttribute
					attach="attributes-position"
					count={particlesPosition.positions.length / 3}
					array={particlesPosition.positions}
					itemSize={3}
				/>
				<bufferAttribute
					attach="attributes-aScale"
					count={particlesPosition.scales.length}
					array={particlesPosition.scales}
					itemSize={1}
				/>
				<bufferAttribute
					attach="attributes-aRandomness"
					count={particlesPosition.randomness.length / 3}
					array={particlesPosition.randomness}
					itemSize={3}
				/>
			</bufferGeometry>
			<shaderMaterial
				vertexShader={vertexShader}
				fragmentShader={fragmentShader}
				uniforms={uniforms}
				transparent
				depthWrite={false}
				blending={THREE.AdditiveBlending}
			/>
		</points>
	);
}

function NeuralConnections({ count = 50 }: { count?: number }) {
	const lines = useRef<THREE.LineSegments>(null);

	const connectionData = useMemo(() => {
		const positions: number[] = [];
		const starts: number[] = [];
		const ends: number[] = [];
		const progresses: number[] = [];

		for (let i = 0; i < count; i++) {
			// Random start point
			const startRadius = 2 + Math.random() * 4;
			const startTheta = Math.random() * Math.PI * 2;
			const startX = startRadius * Math.cos(startTheta);
			const startY = (Math.random() - 0.5) * 4;
			const startZ = startRadius * Math.sin(startTheta);

			// Random end point
			const endRadius = 2 + Math.random() * 4;
			const endTheta = Math.random() * Math.PI * 2;
			const endX = endRadius * Math.cos(endTheta);
			const endY = (Math.random() - 0.5) * 4;
			const endZ = endRadius * Math.sin(endTheta);

			// Create line segments
			const segments = 10;
			for (let j = 0; j < segments; j++) {
				const t1 = j / segments;
				const t2 = (j + 1) / segments;

				positions.push(
					startX + (endX - startX) * t1,
					startY + (endY - startY) * t1,
					startZ + (endZ - startZ) * t1,
					startX + (endX - startX) * t2,
					startY + (endY - startY) * t2,
					startZ + (endZ - startZ) * t2,
				);

				starts.push(startX, startY, startZ, startX, startY, startZ);
				ends.push(endX, endY, endZ, endX, endY, endZ);
				progresses.push(t1, t2);
			}
		}

		return {
			positions: new Float32Array(positions),
			starts: new Float32Array(starts),
			ends: new Float32Array(ends),
			progresses: new Float32Array(progresses),
		};
	}, [count]);

	const uniforms = useMemo(
		() => ({
			uTime: { value: 0 },
		}),
		[],
	);

	useFrame((state) => {
		if (lines.current) {
			const material = lines.current.material as THREE.ShaderMaterial;
			material.uniforms.uTime.value = state.clock.elapsedTime;
		}
	});

	return (
		<lineSegments ref={lines}>
			<bufferGeometry>
				<bufferAttribute
					attach="attributes-position"
					count={connectionData.positions.length / 3}
					array={connectionData.positions}
					itemSize={3}
				/>
				<bufferAttribute
					attach="attributes-aStart"
					count={connectionData.starts.length / 3}
					array={connectionData.starts}
					itemSize={3}
				/>
				<bufferAttribute
					attach="attributes-aEnd"
					count={connectionData.ends.length / 3}
					array={connectionData.ends}
					itemSize={3}
				/>
				<bufferAttribute
					attach="attributes-aProgress"
					count={connectionData.progresses.length}
					array={connectionData.progresses}
					itemSize={1}
				/>
			</bufferGeometry>
			<shaderMaterial
				vertexShader={lineVertexShader}
				fragmentShader={lineFragmentShader}
				uniforms={uniforms}
				transparent
				depthWrite={false}
				blending={THREE.AdditiveBlending}
			/>
		</lineSegments>
	);
}

function Scene() {
	const groupRef = useRef<THREE.Group>(null);

	useFrame((state) => {
		if (groupRef.current) {
			// Slow rotation
			groupRef.current.rotation.y = state.clock.elapsedTime * 0.05;
		}
	});

	return (
		<group ref={groupRef}>
			<NeuralParticles count={400} />
			<NeuralConnections count={30} />
		</group>
	);
}

export function NeuralBackground() {
	return (
		<div
			style={{
				position: "absolute",
				top: 0,
				left: 0,
				width: "100%",
				height: "100%",
				pointerEvents: "none",
				zIndex: 0,
			}}
		>
			<Canvas
				camera={{ position: [0, 0, 8], fov: 60 }}
				style={{ background: "transparent" }}
				gl={{ alpha: true, antialias: true }}
			>
				<Scene />
			</Canvas>
		</div>
	);
}
