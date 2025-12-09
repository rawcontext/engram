"use client";

import dynamic from "next/dynamic";
import { Suspense, useEffect, useState } from "react";
import { EngramLogo } from "./components/EngramLogo";
import { SearchInput } from "./components/SearchInput";
import { SearchResults } from "./components/SearchResults";
import { SessionBrowser } from "./components/SessionBrowser";
import { useSearch } from "./hooks/useSearch";

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

export default function HomePage() {
	const [searchQuery, setSearchQuery] = useState("");
	const [mounted, setMounted] = useState(false);

	// Use the search hook
	const { results, meta, isLoading, error, mode, detectedUUID, isDebouncing } = useSearch(searchQuery);

	useEffect(() => {
		setMounted(true);
	}, []);

	// Show search results above session browser when actively searching (3+ chars)
	const showSearchResults = mode === "search" && searchQuery.trim().length >= 3;

	// Header/Footer heights for safe area calculation
	const HEADER_HEIGHT = 140;
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
				paddingTop: `${HEADER_HEIGHT + 24}px`,
				paddingBottom: `${FOOTER_HEIGHT + 24}px`,
			}}
		>
			{/* Background decorations - fixed to cover viewport including header */}
			<div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 1 }}>
				<Suspense fallback={null}>
					<NeuralBackground />
				</Suspense>
				<Particles />
			</div>

			{/* Fixed Header - Safe Area */}
			<header
				style={{
					position: "fixed",
					top: 0,
					left: 0,
					right: 0,
					height: `${HEADER_HEIGHT}px`,
					zIndex: 50,
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					background: `linear-gradient(
						180deg,
						rgba(8, 10, 15, 0.35) 0%,
						rgba(15, 20, 30, 0.3) 100%
					)`,
					backdropFilter: "blur(8px) saturate(150%)",
					WebkitBackdropFilter: "blur(8px) saturate(150%)",
					borderBottom: "1px solid rgba(0, 245, 212, 0.15)",
					boxShadow:
						"inset 0 1px 0 rgba(255,255,255,0.05), inset 0 -1px 0 rgba(0,0,0,0.1), 0 4px 30px rgba(0,0,0,0.3)",
				}}
			>
				{/* Inner container matching body width */}
				<div
					style={{
						width: "100%",
						maxWidth: "1600px",
						padding: "0 2rem",
						display: "flex",
						alignItems: "center",
						gap: "1.5rem",
					}}
				>
					{/* Gradient accent line at bottom */}
					<div
						style={{
							position: "absolute",
							bottom: 0,
							left: "50%",
							transform: "translateX(-50%)",
							width: "100%",
							maxWidth: "1600px",
							padding: "0 2rem",
							pointerEvents: "none",
						}}
					>
						<div
							style={{
								width: "300px",
								height: "1px",
								background: "linear-gradient(90deg, rgba(251,191,36,0.4), transparent)",
							}}
						/>
					</div>

					{/* Logo */}
					<EngramLogo />

					{/* Name & Tagline */}
					<div style={{ display: "flex", flexDirection: "column", justifyContent: "center" }}>
						<h1
							className="font-display text-glow"
							style={{
								fontSize: "2rem",
								fontWeight: 700,
								letterSpacing: "0.1em",
								marginBottom: "0.25rem",
								lineHeight: 1,
							}}
						>
							ENGRAM
						</h1>
						<p
							style={{
								color: "rgb(148,163,184)",
								fontSize: "0.65rem",
								letterSpacing: "0.3em",
								textTransform: "uppercase",
								lineHeight: 1,
							}}
						>
							Neural Observatory
						</p>
					</div>
				</div>
			</header>

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
					{/* Unified Search Input */}
					<div style={{ marginBottom: "2rem" }}>
						<SearchInput
							value={searchQuery}
							onChange={setSearchQuery}
							mode={mode}
							detectedUUID={detectedUUID}
							isLoading={isLoading}
							isDebouncing={isDebouncing}
							resultCount={results.length}
						/>
					</div>

					{/* Search Results (shown above sessions when searching) */}
					{showSearchResults && (
						<div style={{ marginBottom: "2rem" }}>
							<SearchResults
								results={results}
								meta={meta}
								isLoading={isLoading}
								error={error}
								query={searchQuery}
							/>
						</div>
					)}

					{/* Session Browser (always visible) */}
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
					backgroundColor: "rgb(8, 10, 15)",
					borderTop: "1px solid rgba(100, 116, 139, 0.15)",
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
