"use client";

import { useCallback, useEffect, useState } from "react";
import { EngramLogo } from "./components/EngramLogo";
import { OrgSelector } from "./components/OrgSelector";
import { SearchInput } from "./components/SearchInput";
import { SearchResults } from "./components/SearchResults";
import { SearchSettings, type SearchSettingsState } from "./components/SearchSettings";
import { SessionBrowser } from "./components/SessionBrowser";
import { SystemFooter } from "./components/shared/SystemFooter";
import { UserMenu } from "./components/UserMenu";
import { useSearch } from "./hooks/useSearch";

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

	return (
		<div className="min-h-screen overflow-hidden flex flex-col items-center pt-[120px] pb-[72px] md:pt-[164px] md:pb-[72px]">
			{/* Fixed Header - Safe Area */}
			<header className="fixed top-0 left-0 right-0 h-[90px] md:h-[140px] z-50 flex items-center justify-center bg-gradient-to-b from-[rgba(8,10,15,0.35)] to-[rgba(15,20,30,0.3)] backdrop-blur-md border-b border-[rgba(0,245,212,0.15)] shadow-[inset_0_1px_0_rgba(255,255,255,0.05),inset_0_-1px_0_rgba(0,0,0,0.1),0_4px_30px_rgba(0,0,0,0.3)]">
				{/* Inner container matching body width */}
				<div className="w-full max-w-[1600px] px-4 md:px-8 flex items-center justify-between">
					{/* Gradient accent line at bottom */}
					<div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[1600px] px-4 md:px-8 pointer-events-none">
						<div className="w-[150px] md:w-[300px] h-px bg-gradient-to-r from-[rgba(251,191,36,0.4)] to-transparent" />
					</div>

					{/* Left side: Logo and branding */}
					<div className="flex items-center gap-2 md:gap-6">
						{/* Logo */}
						<EngramLogo />

						{/* Name & Tagline */}
						<div className="flex flex-col justify-center">
							<h1 className="font-display text-glow text-lg md:text-[2rem] font-bold tracking-[0.1em] mb-0.5 md:mb-1 leading-none">
								ENGRAM
							</h1>
							<p className="text-[rgb(148,163,184)] text-[0.5rem] md:text-[0.65rem] tracking-[0.2em] md:tracking-[0.3em] uppercase leading-none">
								Neural Observatory
							</p>
						</div>
					</div>

					{/* Right side: Org Selector + User Menu */}
					<div className="flex items-center gap-2 md:gap-4">
						<OrgSelector />
						<UserMenu />
					</div>
				</div>
			</header>

			{/* Full-width content container */}
			<div className="relative z-10 w-full max-w-[1600px] px-4 md:px-8">
				<div
					className={`w-full transition-all duration-1000 ${mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}
				>
					{/* Search Input + Settings - constrained to same width */}
					<div className="w-full max-w-[600px] mx-auto mb-6 md:mb-8">
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
						<div className="flex justify-end mt-3">
							<SearchSettings settings={searchSettings} onChange={handleSettingsChange} />
						</div>
					</div>

					{/* Search Results (shown above sessions when searching) */}
					{showSearchResults && (
						<div className="mb-6 md:mb-8">
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
