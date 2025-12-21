"use client";

import dynamic from "next/dynamic";
import { Suspense, useCallback, useEffect, useState } from "react";
import { EngramLogo } from "./components/EngramLogo";
import { SearchInput } from "./components/SearchInput";
import { SearchResults } from "./components/SearchResults";
import { SearchSettings, type SearchSettingsState } from "./components/SearchSettings";
import { SessionBrowser } from "./components/SessionBrowser";
import { Particles } from "./components/shared";
import { SystemFooter } from "./components/shared/SystemFooter";
import { useSearch } from "./hooks/useSearch";

// Dynamically import Three.js background to avoid SSR issues
const NeuralBackground = dynamic(
	() => import("./components/NeuralBackground").then((mod) => mod.NeuralBackground),
	{ ssr: false },
);

// Default search settings
const DEFAULT_SETTINGS: SearchSettingsState = {
	rerank: true,
	forceTier: undefined, // auto
	rerankDepth: 30,
	latencyBudgetMs: undefined,
};

// Load settings from localStorage
const loadSettings = (): SearchSettingsState => {
	if (typeof window === "undefined") return DEFAULT_SETTINGS;
	try {
		const saved = localStorage.getItem("engram-search-settings");
		return saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SETTINGS;
	} catch {
		return DEFAULT_SETTINGS;
	}
};

// Save settings to localStorage
const saveSettings = (settings: SearchSettingsState) => {
	if (typeof window === "undefined") return;
	try {
		localStorage.setItem("engram-search-settings", JSON.stringify(settings));
	} catch {
		// Ignore storage errors
	}
};

export default function HomePage() {
	const [searchQuery, setSearchQuery] = useState("");
	const [mounted, setMounted] = useState(false);
	const [searchSettings, setSearchSettings] = useState<SearchSettingsState>(DEFAULT_SETTINGS);

	// Load settings on mount
	useEffect(() => {
		setSearchSettings(loadSettings());
	}, []);

	// Handle settings change
	const handleSettingsChange = useCallback((newSettings: SearchSettingsState) => {
		setSearchSettings(newSettings);
		saveSettings(newSettings);
	}, []);

	// Convert UI settings to API settings format
	const apiSettings = {
		rerank: searchSettings.rerank,
		rerankTier: searchSettings.forceTier === "auto" ? undefined : searchSettings.forceTier,
		rerankDepth: searchSettings.rerankDepth,
		latencyBudgetMs: searchSettings.latencyBudgetMs,
	};

	// Use the search hook with settings
	const { results, meta, isLoading, error, mode, detectedUUID, isDebouncing } = useSearch(
		searchQuery,
		{
			settings: apiSettings,
		},
	);

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
				<Particles count={30} />
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
					{/* Search Input + Settings - constrained to same width */}
					<div
						style={{
							width: "100%",
							maxWidth: "600px",
							margin: "0 auto",
							marginBottom: "2rem",
						}}
					>
						<SearchInput
							value={searchQuery}
							onChange={setSearchQuery}
							mode={mode}
							detectedUUID={detectedUUID}
							isLoading={isLoading}
							isDebouncing={isDebouncing}
							resultCount={results.length}
						/>

						{/* Settings Row - Below search, aligned right */}
						<div
							style={{
								display: "flex",
								justifyContent: "flex-end",
								marginTop: "12px",
							}}
						>
							<SearchSettings settings={searchSettings} onChange={handleSettingsChange} />
						</div>
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

			{/* Fixed Footer - System Status with Consumer Readiness */}
			<SystemFooter />

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
