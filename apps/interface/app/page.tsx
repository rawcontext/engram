"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { SessionBrowser } from "./components/SessionBrowser";

// Dynamically import Three.js background to avoid SSR issues
const NeuralBackground = dynamic(
	() => import("./components/NeuralBackground").then((mod) => mod.NeuralBackground),
	{ ssr: false },
);

// Floating particle component (fallback/additional particles)
function Particles() {
	const [particles, setParticles] = useState<
		Array<{
			id: number;
			x: number;
			y: number;
			size: number;
			duration: number;
			delay: number;
		}>
	>([]);

	useEffect(() => {
		const newParticles = Array.from({ length: 30 }, (_, i) => ({
			id: i,
			x: Math.random() * 100,
			y: Math.random() * 100,
			size: Math.random() * 3 + 1,
			duration: Math.random() * 20 + 15,
			delay: Math.random() * 10,
		}));
		setParticles(newParticles);
	}, []);

	return (
		<div className="particles">
			{particles.map((p) => (
				<div
					key={p.id}
					className="particle"
					style={{
						left: `${p.x}%`,
						top: `${p.y}%`,
						width: `${p.size}px`,
						height: `${p.size}px`,
						animation: `float ${p.duration}s ease-in-out infinite`,
						animationDelay: `${p.delay}s`,
						opacity: 0.3 + Math.random() * 0.4,
					}}
				/>
			))}
		</div>
	);
}

// Animated neural network decoration
function NeuralDecoration() {
	return (
		<svg
			style={{
				position: "absolute",
				top: 0,
				left: 0,
				width: "100%",
				height: "100%",
				pointerEvents: "none",
				opacity: 0.2,
			}}
			viewBox="0 0 800 600"
			preserveAspectRatio="xMidYMid slice"
		>
			<defs>
				<linearGradient id="lineGradient" x1="0%" y1="0%" x2="100%" y2="100%">
					<stop offset="0%" stopColor="rgb(251, 191, 36)" stopOpacity="0.6" />
					<stop offset="100%" stopColor="rgb(226, 232, 240)" stopOpacity="0.4" />
				</linearGradient>
				<filter id="glow">
					<feGaussianBlur stdDeviation="2" result="coloredBlur" />
					<feMerge>
						<feMergeNode in="coloredBlur" />
						<feMergeNode in="SourceGraphic" />
					</feMerge>
				</filter>
			</defs>

			{/* Neural connection lines */}
			<g stroke="url(#lineGradient)" strokeWidth="1" fill="none" filter="url(#glow)">
				<path d="M 100,100 Q 200,50 300,150" className="animate-pulse" />
				<path
					d="M 300,150 Q 400,200 500,100"
					style={{ animationDelay: "0.5s" }}
					className="animate-pulse"
				/>
				<path
					d="M 500,100 Q 600,50 700,150"
					style={{ animationDelay: "1s" }}
					className="animate-pulse"
				/>
				<path
					d="M 150,400 Q 250,350 350,450"
					style={{ animationDelay: "0.3s" }}
					className="animate-pulse"
				/>
				<path
					d="M 450,350 Q 550,300 650,400"
					style={{ animationDelay: "0.7s" }}
					className="animate-pulse"
				/>
			</g>

			{/* Neural nodes */}
			<g fill="rgb(251, 191, 36)" filter="url(#glow)">
				<circle cx="100" cy="100" r="4" className="animate-pulse" />
				<circle
					cx="300"
					cy="150"
					r="5"
					style={{ animationDelay: "0.2s" }}
					className="animate-pulse"
				/>
				<circle
					cx="500"
					cy="100"
					r="4"
					style={{ animationDelay: "0.4s" }}
					className="animate-pulse"
				/>
				<circle
					cx="700"
					cy="150"
					r="5"
					style={{ animationDelay: "0.6s" }}
					className="animate-pulse"
				/>
				<circle
					cx="150"
					cy="400"
					r="4"
					style={{ animationDelay: "0.1s" }}
					className="animate-pulse"
				/>
				<circle
					cx="350"
					cy="450"
					r="5"
					style={{ animationDelay: "0.3s" }}
					className="animate-pulse"
				/>
				<circle
					cx="450"
					cy="350"
					r="4"
					style={{ animationDelay: "0.5s" }}
					className="animate-pulse"
				/>
				<circle
					cx="650"
					cy="400"
					r="5"
					style={{ animationDelay: "0.7s" }}
					className="animate-pulse"
				/>
			</g>
		</svg>
	);
}

export default function HomePage() {
	const [sessionId, setSessionId] = useState("");
	const [isFocused, setIsFocused] = useState(false);
	const [mounted, setMounted] = useState(false);
	const router = useRouter();

	useEffect(() => {
		setMounted(true);
	}, []);

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		if (sessionId) {
			router.push(`/session/${sessionId}`);
		}
	};

	// Footer height for safe area calculation
	const FOOTER_HEIGHT = 48;

	return (
		<div
			style={{
				position: "relative",
				minHeight: "100vh",
				overflow: "hidden",
				display: "flex",
				flexDirection: "column",
				alignItems: "center",
				paddingTop: "3rem",
				paddingBottom: `${FOOTER_HEIGHT + 24}px`, // Safe area: footer height + extra padding
			}}
		>
			{/* Background decorations - absolute positioned */}
			<div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
				<Suspense fallback={null}>
					<NeuralBackground />
				</Suspense>
				<Particles />
			</div>

			{/* Full-width content container */}
			<div
				className="relative z-10"
				style={{
					position: "relative",
					zIndex: 10,
					width: "100%",
					maxWidth: "1600px",
					padding: "0 2rem",
				}}
			>
				<div
					className={`w-full transition-all duration-1000 ${mounted ? "opacity-100" : "opacity-0"}`}
					style={{
						width: "100%",
						transform: mounted ? "translateY(0)" : "translateY(2rem)",
					}}
				>
					{/* Logo/Brand area */}
					<div style={{ textAlign: "center", marginBottom: "3rem" }}>
						{/* Animated orbital rings */}
						<div
							style={{
								position: "relative",
								width: "120px",
								height: "120px",
								margin: "0 auto 2rem auto",
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
							}}
						>
							{/* Outer ring */}
							<div
								style={{
									position: "absolute",
									width: "120px",
									height: "120px",
									borderRadius: "50%",
									border: "1px solid rgba(251,191,36,0.2)",
									animation: "spin 30s linear infinite reverse",
								}}
							/>
							{/* Middle ring */}
							<div
								style={{
									position: "absolute",
									width: "90px",
									height: "90px",
									borderRadius: "50%",
									border: "1px solid rgba(148,163,184,0.3)",
									animation: "spin 20s linear infinite",
								}}
							/>
							{/* Inner ring with glow */}
							<div
								style={{
									position: "absolute",
									width: "60px",
									height: "60px",
									borderRadius: "50%",
									border: "1px solid rgba(251,191,36,0.5)",
									background:
										"radial-gradient(circle at 30% 30%, rgba(251,191,36,0.2), transparent 60%)",
									boxShadow: "0 0 20px rgba(251,191,36,0.2), inset 0 0 20px rgba(251,191,36,0.1)",
								}}
							/>
							{/* Core glow */}
							<div
								style={{
									position: "absolute",
									width: "24px",
									height: "24px",
									borderRadius: "50%",
									background:
										"radial-gradient(circle, rgba(251,191,36,1), rgba(251,191,36,0.5) 40%, transparent 70%)",
									boxShadow: "0 0 30px rgba(251,191,36,0.8), 0 0 60px rgba(251,191,36,0.4)",
								}}
							/>
						</div>

						<h1
							className="font-display text-glow"
							style={{
								fontSize: "2.5rem",
								fontWeight: 700,
								letterSpacing: "0.1em",
								marginBottom: "1rem",
							}}
						>
							ENGRAM
						</h1>
						<p
							style={{
								color: "rgb(148,163,184)",
								fontSize: "0.875rem",
								letterSpacing: "0.3em",
								textTransform: "uppercase",
							}}
						>
							Neural Observatory
						</p>
					</div>

					{/* UUID input - at top */}
					<form onSubmit={handleSubmit} style={{ maxWidth: "480px", margin: "0 auto 2rem auto" }}>
						<div
							style={{
								display: "flex",
								gap: "8px",
							}}
						>
							<input
								id="sessionId"
								type="text"
								value={sessionId}
								onChange={(e) => setSessionId(e.target.value)}
								onFocus={() => setIsFocused(true)}
								onBlur={() => setIsFocused(false)}
								placeholder="Enter session UUID..."
								autoComplete="off"
								spellCheck={false}
								style={{
									flex: 1,
									padding: "12px 16px",
									fontSize: "13px",
									fontFamily: "JetBrains Mono, monospace",
									color: "rgb(203, 213, 225)",
									backgroundColor: "rgba(15, 20, 30, 0.7)",
									border: isFocused
										? "1px solid rgba(251, 191, 36, 0.4)"
										: "1px solid rgba(100, 116, 139, 0.25)",
									borderRadius: "8px",
									outline: "none",
									transition: "all 0.2s ease",
									boxShadow: isFocused ? "0 0 12px rgba(251, 191, 36, 0.15)" : "none",
								}}
							/>
							<button
								type="submit"
								disabled={!sessionId}
								style={{
									padding: "12px 20px",
									fontSize: "11px",
									fontFamily: "JetBrains Mono, monospace",
									fontWeight: 600,
									letterSpacing: "0.05em",
									color: sessionId ? "rgb(251, 191, 36)" : "rgb(71, 85, 105)",
									backgroundColor: sessionId ? "rgba(251, 191, 36, 0.1)" : "rgba(15, 20, 30, 0.6)",
									border: sessionId
										? "1px solid rgba(251, 191, 36, 0.4)"
										: "1px solid rgba(100, 116, 139, 0.15)",
									borderRadius: "8px",
									cursor: sessionId ? "pointer" : "not-allowed",
									transition: "all 0.2s ease",
								}}
							>
								GO
							</button>
						</div>
					</form>

					{/* Session Browser */}
					<SessionBrowser />
				</div>
			</div>

			{/* Fixed Footer - Safe Area */}
			<footer
				style={{
					position: "fixed",
					bottom: 0,
					left: 0,
					right: 0,
					height: `${FOOTER_HEIGHT}px`,
					zIndex: 50,
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					gap: "16px",
					fontSize: "11px",
					fontFamily: "JetBrains Mono, monospace",
					color: "rgb(100, 116, 139)",
					// Solid background to prevent content showing through
					backgroundColor: "rgb(8, 10, 15)",
					// Top border with gradient
					borderTop: "1px solid rgba(100, 116, 139, 0.15)",
					// Subtle inner glow
					boxShadow: "inset 0 1px 0 rgba(255,255,255,0.02), 0 -4px 20px rgba(0,0,0,0.5)",
				}}
			>
				{/* Gradient accent line at top */}
				<div
					style={{
						position: "absolute",
						top: 0,
						left: "50%",
						transform: "translateX(-50%)",
						width: "200px",
						height: "1px",
						background: "linear-gradient(90deg, transparent, rgba(251,191,36,0.4), transparent)",
					}}
				/>

				<span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
					<span
						style={{
							width: "6px",
							height: "6px",
							borderRadius: "50%",
							backgroundColor: "rgb(34, 197, 94)",
							boxShadow: "0 0 8px rgba(34, 197, 94, 0.6)",
							animation: "pulse 2s ease-in-out infinite",
						}}
					/>
					<span style={{ letterSpacing: "0.05em" }}>System Online</span>
				</span>
				<span style={{ color: "rgb(45, 55, 72)" }}>|</span>
				<span style={{ opacity: 0.7 }}>v1.0.0</span>
				<span style={{ color: "rgb(45, 55, 72)" }}>|</span>
				<span style={{ letterSpacing: "0.15em", color: "rgb(251, 191, 36)", fontWeight: 500 }}>
					READY
				</span>
			</footer>

			{/* Keyframes for animations */}
			<style jsx>{`
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
                @keyframes pulse {
                    0%, 100% { opacity: 1; transform: scale(1); }
                    50% { opacity: 0.6; transform: scale(0.9); }
                }
            `}</style>
		</div>
	);
}
