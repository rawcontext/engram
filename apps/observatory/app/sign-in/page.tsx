"use client";

import { signIn } from "@lib/auth-client";
import { useEffect, useRef } from "react";

export default function SignInPage() {
	const canvasRef = useRef<HTMLCanvasElement>(null);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;

		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		let animationId: number;
		let nodes: Array<{
			x: number;
			y: number;
			vx: number;
			vy: number;
			radius: number;
			pulse: number;
		}> = [];

		const resize = () => {
			canvas.width = window.innerWidth;
			canvas.height = window.innerHeight;
			initNodes();
		};

		const initNodes = () => {
			const nodeCount = Math.floor((canvas.width * canvas.height) / 25000);
			nodes = Array.from({ length: nodeCount }, () => ({
				x: Math.random() * canvas.width,
				y: Math.random() * canvas.height,
				vx: (Math.random() - 0.5) * 0.3,
				vy: (Math.random() - 0.5) * 0.3,
				radius: Math.random() * 1.5 + 0.5,
				pulse: Math.random() * Math.PI * 2,
			}));
		};

		const draw = (_time: number) => {
			ctx.fillStyle = "rgba(8, 10, 15, 0.15)";
			ctx.fillRect(0, 0, canvas.width, canvas.height);

			// Update and draw nodes
			for (const node of nodes) {
				node.x += node.vx;
				node.y += node.vy;
				node.pulse += 0.02;

				// Wrap around edges
				if (node.x < 0) node.x = canvas.width;
				if (node.x > canvas.width) node.x = 0;
				if (node.y < 0) node.y = canvas.height;
				if (node.y > canvas.height) node.y = 0;

				const pulseRadius = node.radius * (1 + Math.sin(node.pulse) * 0.3);
				const alpha = 0.4 + Math.sin(node.pulse) * 0.2;

				ctx.beginPath();
				ctx.arc(node.x, node.y, pulseRadius, 0, Math.PI * 2);
				ctx.fillStyle = `rgba(56, 189, 248, ${alpha})`;
				ctx.fill();
			}

			// Draw connections
			for (let i = 0; i < nodes.length; i++) {
				for (let j = i + 1; j < nodes.length; j++) {
					const dx = nodes[i].x - nodes[j].x;
					const dy = nodes[i].y - nodes[j].y;
					const dist = Math.sqrt(dx * dx + dy * dy);

					if (dist < 150) {
						const alpha = (1 - dist / 150) * 0.15;
						ctx.beginPath();
						ctx.moveTo(nodes[i].x, nodes[i].y);
						ctx.lineTo(nodes[j].x, nodes[j].y);
						ctx.strokeStyle = `rgba(56, 189, 248, ${alpha})`;
						ctx.lineWidth = 0.5;
						ctx.stroke();
					}
				}
			}

			animationId = requestAnimationFrame(draw);
		};

		resize();
		window.addEventListener("resize", resize);
		animationId = requestAnimationFrame(draw);

		return () => {
			window.removeEventListener("resize", resize);
			cancelAnimationFrame(animationId);
		};
	}, []);

	const handleSignIn = async () => {
		await signIn.social({
			provider: "google",
			callbackURL: "/",
		});
	};

	return (
		<div className="sign-in-container">
			<canvas ref={canvasRef} className="neural-canvas" />

			<div className="content-wrapper">
				<div className="logo-section">
					<div className="logo-icon">
						<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
							<circle
								cx="24"
								cy="24"
								r="20"
								stroke="currentColor"
								strokeWidth="1.5"
								opacity="0.3"
							/>
							<circle
								cx="24"
								cy="24"
								r="12"
								stroke="currentColor"
								strokeWidth="1.5"
								opacity="0.5"
							/>
							<circle cx="24" cy="24" r="4" fill="currentColor" />
							<circle cx="24" cy="8" r="2" fill="currentColor" opacity="0.7" />
							<circle cx="24" cy="40" r="2" fill="currentColor" opacity="0.7" />
							<circle cx="8" cy="24" r="2" fill="currentColor" opacity="0.7" />
							<circle cx="40" cy="24" r="2" fill="currentColor" opacity="0.7" />
							<line
								x1="24"
								y1="10"
								x2="24"
								y2="20"
								stroke="currentColor"
								strokeWidth="1"
								opacity="0.5"
							/>
							<line
								x1="24"
								y1="28"
								x2="24"
								y2="38"
								stroke="currentColor"
								strokeWidth="1"
								opacity="0.5"
							/>
							<line
								x1="10"
								y1="24"
								x2="20"
								y2="24"
								stroke="currentColor"
								strokeWidth="1"
								opacity="0.5"
							/>
							<line
								x1="28"
								y1="24"
								x2="38"
								y2="24"
								stroke="currentColor"
								strokeWidth="1"
								opacity="0.5"
							/>
						</svg>
					</div>
					<h1 className="title">Neural Observatory</h1>
					<p className="subtitle">Session visualization & memory analytics</p>
				</div>

				<button onClick={handleSignIn} className="sign-in-button" type="button">
					<svg className="google-icon" viewBox="0 0 24 24">
						<path
							d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
							fill="#4285F4"
						/>
						<path
							d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
							fill="#34A853"
						/>
						<path
							d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
							fill="#FBBC05"
						/>
						<path
							d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
							fill="#EA4335"
						/>
					</svg>
					<span>Continue with Google</span>
				</button>

				<p className="footer-text">Secure authentication powered by Better Auth</p>
			</div>

			<style jsx>{`
				@import url("https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=IBM+Plex+Sans:wght@300;400;500&display=swap");

				.sign-in-container {
					min-height: 100vh;
					min-height: 100dvh;
					display: flex;
					align-items: center;
					justify-content: center;
					background: #080a0f;
					position: relative;
					overflow: hidden;
				}

				.neural-canvas {
					position: absolute;
					inset: 0;
					width: 100%;
					height: 100%;
					pointer-events: none;
				}

				.content-wrapper {
					position: relative;
					z-index: 10;
					display: flex;
					flex-direction: column;
					align-items: center;
					padding: 3rem 2rem;
					max-width: 400px;
					width: 100%;
				}

				.logo-section {
					display: flex;
					flex-direction: column;
					align-items: center;
					margin-bottom: 3rem;
				}

				.logo-icon {
					width: 64px;
					height: 64px;
					color: #38bdf8;
					margin-bottom: 1.5rem;
					animation: pulse-glow 3s ease-in-out infinite;
				}

				@keyframes pulse-glow {
					0%,
					100% {
						filter: drop-shadow(0 0 8px rgba(56, 189, 248, 0.4));
					}
					50% {
						filter: drop-shadow(0 0 20px rgba(56, 189, 248, 0.6));
					}
				}

				.title {
					font-family: "Space Mono", monospace;
					font-size: 1.75rem;
					font-weight: 700;
					color: #f1f5f9;
					letter-spacing: -0.02em;
					margin: 0 0 0.5rem 0;
					text-align: center;
				}

				.subtitle {
					font-family: "IBM Plex Sans", sans-serif;
					font-size: 0.875rem;
					font-weight: 300;
					color: #64748b;
					margin: 0;
					letter-spacing: 0.02em;
				}

				.sign-in-button {
					display: flex;
					align-items: center;
					justify-content: center;
					gap: 0.75rem;
					width: 100%;
					padding: 0.875rem 1.5rem;
					background: rgba(255, 255, 255, 0.03);
					border: 1px solid rgba(255, 255, 255, 0.1);
					border-radius: 8px;
					color: #f1f5f9;
					font-family: "IBM Plex Sans", sans-serif;
					font-size: 0.9375rem;
					font-weight: 500;
					cursor: pointer;
					transition: all 0.2s ease;
					position: relative;
					overflow: hidden;
				}

				.sign-in-button::before {
					content: "";
					position: absolute;
					inset: 0;
					background: linear-gradient(
						135deg,
						rgba(56, 189, 248, 0.1) 0%,
						rgba(56, 189, 248, 0) 50%
					);
					opacity: 0;
					transition: opacity 0.2s ease;
				}

				.sign-in-button:hover {
					border-color: rgba(56, 189, 248, 0.3);
					background: rgba(255, 255, 255, 0.05);
					box-shadow:
						0 0 30px rgba(56, 189, 248, 0.1),
						inset 0 1px 0 rgba(255, 255, 255, 0.05);
				}

				.sign-in-button:hover::before {
					opacity: 1;
				}

				.sign-in-button:active {
					transform: scale(0.98);
				}

				.google-icon {
					width: 20px;
					height: 20px;
					flex-shrink: 0;
				}

				.footer-text {
					font-family: "IBM Plex Sans", sans-serif;
					font-size: 0.75rem;
					color: #475569;
					margin-top: 2rem;
					text-align: center;
				}

				@media (max-width: 480px) {
					.content-wrapper {
						padding: 2rem 1.5rem;
					}

					.title {
						font-size: 1.5rem;
					}

					.logo-icon {
						width: 56px;
						height: 56px;
					}
				}
			`}</style>
		</div>
	);
}
