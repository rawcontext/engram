"use client";

import { useEffect, useState } from "react";
import { colors } from "./design-tokens";

interface Particle {
	id: number;
	x: number;
	y: number;
	size: number;
	duration: number;
	delay: number;
	opacity: number;
}

interface ParticlesProps {
	/**
	 * Number of particles to render
	 */
	count?: number;
	/**
	 * Use pre-computed positions (avoids hydration mismatch for SSR)
	 */
	precomputed?: boolean;
	/**
	 * Custom particle color (CSS color value)
	 */
	color?: string;
	/**
	 * Additional CSS class name
	 */
	className?: string;
}

// Pre-computed particle positions to avoid hydration mismatch
const PRECOMPUTED_PARTICLES: Particle[] = [
	{ id: 0, x: 12, y: 85, size: 1.5, duration: 22, delay: 3, opacity: 0.25 },
	{ id: 1, x: 45, y: 15, size: 2.2, duration: 28, delay: 7, opacity: 0.32 },
	{ id: 2, x: 78, y: 42, size: 1.8, duration: 19, delay: 1, opacity: 0.28 },
	{ id: 3, x: 23, y: 67, size: 2.5, duration: 31, delay: 5, opacity: 0.35 },
	{ id: 4, x: 91, y: 23, size: 1.2, duration: 25, delay: 9, opacity: 0.22 },
	{ id: 5, x: 56, y: 89, size: 2.0, duration: 17, delay: 2, opacity: 0.3 },
	{ id: 6, x: 34, y: 34, size: 1.6, duration: 33, delay: 6, opacity: 0.27 },
	{ id: 7, x: 67, y: 56, size: 2.8, duration: 21, delay: 4, opacity: 0.38 },
	{ id: 8, x: 8, y: 12, size: 1.3, duration: 29, delay: 8, opacity: 0.24 },
	{ id: 9, x: 89, y: 78, size: 2.3, duration: 16, delay: 0, opacity: 0.33 },
	{ id: 10, x: 41, y: 91, size: 1.9, duration: 27, delay: 3, opacity: 0.29 },
	{ id: 11, x: 72, y: 8, size: 2.6, duration: 23, delay: 7, opacity: 0.36 },
	{ id: 12, x: 15, y: 45, size: 1.4, duration: 32, delay: 1, opacity: 0.26 },
	{ id: 13, x: 58, y: 62, size: 2.1, duration: 18, delay: 5, opacity: 0.31 },
	{ id: 14, x: 95, y: 95, size: 1.7, duration: 26, delay: 9, opacity: 0.23 },
	{ id: 15, x: 28, y: 73, size: 1.8, duration: 24, delay: 2, opacity: 0.28 },
	{ id: 16, x: 83, y: 31, size: 2.4, duration: 20, delay: 6, opacity: 0.34 },
	{ id: 17, x: 47, y: 48, size: 1.5, duration: 30, delay: 4, opacity: 0.25 },
	{ id: 18, x: 6, y: 58, size: 2.0, duration: 22, delay: 8, opacity: 0.3 },
	{ id: 19, x: 62, y: 19, size: 1.6, duration: 28, delay: 0, opacity: 0.27 },
];

/**
 * Generate random particles (client-side only)
 */
function generateParticles(count: number): Particle[] {
	return Array.from({ length: count }, (_, i) => ({
		id: i,
		x: Math.random() * 100,
		y: Math.random() * 100,
		size: Math.random() * 2 + 1,
		duration: Math.random() * 20 + 15,
		delay: Math.random() * 10,
		opacity: 0.2 + Math.random() * 0.2,
	}));
}

export function Particles({ count = 20, precomputed = false, color, className }: ParticlesProps) {
	const [particles, setParticles] = useState<Particle[]>(
		precomputed ? PRECOMPUTED_PARTICLES.slice(0, count) : [],
	);

	// Generate random particles on client side only (to avoid hydration mismatch)
	useEffect(() => {
		if (!precomputed) {
			setParticles(generateParticles(count));
		}
	}, [count, precomputed]);

	const particleColor = color ?? colors.cyan.DEFAULT;

	return (
		<div
			className={`particles ${className ?? ""}`}
			style={{
				position: "absolute",
				inset: 0,
				overflow: "hidden",
				pointerEvents: "none",
			}}
		>
			{particles.map((p) => (
				<div
					key={p.id}
					className="particle"
					style={{
						position: "absolute",
						left: `${p.x}%`,
						top: `${p.y}%`,
						width: `${p.size}px`,
						height: `${p.size}px`,
						borderRadius: "50%",
						backgroundColor: particleColor,
						opacity: p.opacity,
						animation: `particleFloat ${p.duration}s ease-in-out infinite`,
						animationDelay: `${p.delay}s`,
						boxShadow: `0 0 ${p.size * 2}px ${particleColor}40`,
					}}
				/>
			))}

			<style>{`
				@keyframes particleFloat {
					0%, 100% {
						transform: translateY(0) translateX(0);
						opacity: var(--particle-base-opacity, 0.3);
					}
					25% {
						transform: translateY(-20px) translateX(10px);
						opacity: calc(var(--particle-base-opacity, 0.3) + 0.2);
					}
					50% {
						transform: translateY(-10px) translateX(-5px);
						opacity: var(--particle-base-opacity, 0.3);
					}
					75% {
						transform: translateY(-30px) translateX(15px);
						opacity: calc(var(--particle-base-opacity, 0.3) + 0.1);
					}
				}
			`}</style>
		</div>
	);
}

export default Particles;
