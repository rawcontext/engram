"use client";

import type { SearchMeta, SearchResult } from "@app/hooks/useSearch";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface SearchResultsProps {
	results: SearchResult[];
	meta?: SearchMeta;
	isLoading: boolean;
	error: string | null;
	query: string;
}

// Type icons and colors
const TYPE_CONFIG = {
	thought: {
		icon: (
			<svg
				width="14"
				height="14"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
			>
				<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
			</svg>
		),
		label: "THOUGHT",
		color: "139, 92, 246", // violet
		bgColor: "rgba(139, 92, 246, 0.1)",
	},
	code: {
		icon: (
			<svg
				width="14"
				height="14"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
			>
				<polyline points="16,18 22,12 16,6" />
				<polyline points="8,6 2,12 8,18" />
			</svg>
		),
		label: "CODE",
		color: "251, 191, 36", // amber
		bgColor: "rgba(251, 191, 36, 0.1)",
	},
	doc: {
		icon: (
			<svg
				width="14"
				height="14"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
			>
				<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
				<polyline points="14,2 14,8 20,8" />
				<line x1="16" y1="13" x2="8" y2="13" />
				<line x1="16" y1="17" x2="8" y2="17" />
			</svg>
		),
		label: "DOC",
		color: "59, 130, 246", // blue
		bgColor: "rgba(59, 130, 246, 0.1)",
	},
};

function truncateContent(content: string, maxLength: number = 120): string {
	if (content.length <= maxLength) return content;
	return `${content.slice(0, maxLength).trim()}...`;
}

function formatTimestamp(timestamp: number): string {
	const date = new Date(timestamp);
	const now = new Date();
	const diff = now.getTime() - date.getTime();

	const minutes = Math.floor(diff / 60000);
	const hours = Math.floor(diff / 3600000);
	const days = Math.floor(diff / 86400000);

	if (minutes < 1) return "just now";
	if (minutes < 60) return `${minutes}m ago`;
	if (hours < 24) return `${hours}h ago`;
	if (days < 7) return `${days}d ago`;

	return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function truncateId(id: string): string {
	if (id.length <= 8) return id;
	return id.slice(0, 8);
}

// Tier-specific color configurations
const TIER_COLORS = {
	fast: {
		color: "0, 245, 212", // cyan
		name: "Fast",
	},
	accurate: {
		color: "139, 92, 246", // violet
		name: "Accurate",
	},
	code: {
		color: "251, 191, 36", // amber
		name: "Code",
	},
	llm: {
		color: "236, 72, 153", // pink/magenta
		name: "LLM",
	},
};

// Reranker tier badge component
function RerankerBadge({ tier, degraded }: { tier: string; degraded?: boolean }) {
	const tierConfig = TIER_COLORS[tier as keyof typeof TIER_COLORS];
	if (!tierConfig) return null;

	const color = tierConfig.color;

	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				gap: "4px",
				padding: "2px 6px",
				background: degraded ? "rgba(239, 68, 68, 0.15)" : `rgba(${color}, 0.15)`,
				border: degraded ? "1px solid rgba(239, 68, 68, 0.3)" : `1px solid rgba(${color}, 0.3)`,
				borderRadius: "3px",
				cursor: "help",
			}}
			title={
				degraded
					? `Reranker degraded - using fallback scoring`
					: `Reranked with ${tierConfig.name} tier`
			}
		>
			{/* Icon */}
			<svg
				width="10"
				height="10"
				viewBox="0 0 24 24"
				fill="none"
				stroke={degraded ? "rgb(239, 68, 68)" : `rgb(${color})`}
				strokeWidth="2.5"
			>
				{degraded ? (
					// Alert triangle for degraded
					<>
						<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
						<line x1="12" y1="9" x2="12" y2="13" />
						<line x1="12" y1="17" x2="12.01" y2="17" />
					</>
				) : (
					// Sparkle/star for reranked
					<path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
				)}
			</svg>
			{/* Label */}
			<span
				style={{
					fontSize: "7px",
					fontFamily: "Orbitron, sans-serif",
					fontWeight: 700,
					letterSpacing: "0.08em",
					color: degraded ? "rgb(239, 68, 68)" : `rgb(${color})`,
					textShadow: degraded ? "none" : `0 0 6px rgba(${color}, 0.4)`,
				}}
			>
				{degraded ? "DEGRADED" : tierConfig.name.toUpperCase()}
			</span>
		</div>
	);
}

// Score bar visualization - shows REL for reranked results, RRF otherwise
function ScoreBar({ result }: { result: SearchResult }) {
	const hasRerank = result.rerankerScore !== undefined;
	const displayScore = hasRerank ? result.rerankerScore : result.score;
	const normalizedScore = Math.min(Math.max(displayScore, 0), 1);
	const percentage = Math.round(normalizedScore * 100);

	// Show both scores if available
	const rrfPercentage = result.rrfScore ? Math.round(result.rrfScore * 100) : null;

	// REL uses tier-specific color if available, otherwise magenta
	const tierColor = result.rerankTier
		? TIER_COLORS[result.rerankTier]?.color || "236, 72, 153"
		: "236, 72, 153";

	// REL uses tier-specific gradient, RRF uses cool cyan-to-amber
	const gradientColors = hasRerank
		? `linear-gradient(90deg, rgb(${tierColor}), rgb(251, 191, 36))` // tier color → gold
		: "linear-gradient(90deg, rgb(0, 245, 212), rgb(251, 191, 36))"; // cyan → amber

	const labelColor = hasRerank ? `rgb(${tierColor})` : "rgb(71, 85, 105)";

	// Build tooltip text
	const tooltipText = hasRerank
		? `Relevance: neural cross-encoder reranking score${rrfPercentage !== null ? ` (RRF: ${rrfPercentage}%)` : ""}`
		: "Reciprocal Rank Fusion: combines semantic similarity and keyword matching";

	return (
		<div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
			<span
				style={{
					fontSize: "8px",
					fontFamily: "Orbitron, sans-serif",
					fontWeight: 600,
					letterSpacing: "0.05em",
					color: labelColor,
					cursor: "help",
					textShadow: hasRerank ? `0 0 8px rgba(${tierColor}, 0.4)` : "none",
					transition: "all 0.3s ease",
				}}
				title={tooltipText}
			>
				{hasRerank ? "REL" : "RRF"}
			</span>
			<div
				style={{
					width: "50px",
					height: "4px",
					backgroundColor: "rgba(100, 116, 139, 0.2)",
					borderRadius: "2px",
					overflow: "hidden",
					position: "relative",
				}}
			>
				{/* Glow effect for reranked results */}
				{hasRerank && (
					<div
						style={{
							position: "absolute",
							inset: "-2px",
							background: `rgba(${tierColor}, 0.15)`,
							borderRadius: "4px",
							filter: "blur(2px)",
						}}
					/>
				)}
				<div
					style={{
						width: `${Math.max(normalizedScore * 100, 10)}%`,
						height: "100%",
						background: gradientColors,
						borderRadius: "2px",
						transition: "width 0.5s cubic-bezier(0.4, 0, 0.2, 1)",
						position: "relative",
					}}
				/>
			</div>
			<span
				style={{
					fontSize: "9px",
					fontFamily: "JetBrains Mono, monospace",
					color: hasRerank ? `rgb(${tierColor})` : "rgb(100, 116, 139)",
					minWidth: "28px",
					transition: "color 0.3s ease",
				}}
			>
				{percentage}%
			</span>
			{/* Show RRF score as secondary if both scores present */}
			{hasRerank && rrfPercentage !== null && (
				<span
					style={{
						fontSize: "8px",
						fontFamily: "JetBrains Mono, monospace",
						color: "rgb(71, 85, 105)",
						opacity: 0.6,
					}}
					title="Original RRF score before reranking"
				>
					({rrfPercentage}%)
				</span>
			)}
		</div>
	);
}

function SearchResultCard({
	result,
	index,
	isHovered,
	onHover,
	onLeave,
	onClick,
}: {
	result: SearchResult;
	index: number;
	isHovered: boolean;
	onHover: () => void;
	onLeave: () => void;
	onClick: () => void;
}) {
	const typeConfig = TYPE_CONFIG[result.payload.type];
	const accentColor = typeConfig.color;

	return (
		<button
			type="button"
			onClick={onClick}
			onMouseEnter={onHover}
			onMouseLeave={onLeave}
			style={{
				display: "flex",
				flexDirection: "column",
				padding: "14px 16px",
				background: isHovered
					? `linear-gradient(135deg, rgba(${accentColor}, 0.08) 0%, rgba(15, 20, 30, 0.8) 100%)`
					: "rgba(15, 20, 30, 0.6)",
				backdropFilter: "blur(8px)",
				border: isHovered
					? `1px solid rgba(${accentColor}, 0.35)`
					: "1px solid rgba(71, 85, 105, 0.2)",
				borderRadius: "10px",
				cursor: "pointer",
				textAlign: "left",
				transition: "all 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
				animation: `searchCardReveal 0.4s cubic-bezier(0.4, 0, 0.2, 1) ${index * 0.05}s both`,
				boxShadow: isHovered
					? `0 4px 24px rgba(${accentColor}, 0.12), inset 0 1px 0 rgba(${accentColor}, 0.1)`
					: "0 2px 8px rgba(0, 0, 0, 0.2)",
				transform: isHovered ? "translateY(-2px)" : "translateY(0)",
				position: "relative",
				overflow: "hidden",
				minHeight: "120px",
			}}
		>
			{/* Top glow line on hover */}
			<div
				style={{
					position: "absolute",
					top: 0,
					left: 0,
					right: 0,
					height: "1px",
					background: isHovered
						? `linear-gradient(90deg, transparent, rgba(${accentColor}, 0.5), transparent)`
						: "transparent",
					transition: "all 0.3s ease",
				}}
			/>

			{/* Row 1: Type badge + Reranker badge + Session ID */}
			<div
				style={{
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					marginBottom: "10px",
				}}
			>
				{/* Left: Type badge + Reranker badge */}
				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: "6px",
					}}
				>
					{/* Type badge */}
					<div
						style={{
							display: "flex",
							alignItems: "center",
							gap: "6px",
							padding: "3px 8px",
							backgroundColor: typeConfig.bgColor,
							border: `1px solid rgba(${accentColor}, 0.3)`,
							borderRadius: "4px",
							color: `rgb(${accentColor})`,
						}}
					>
						{typeConfig.icon}
						<span
							style={{
								fontSize: "8px",
								fontFamily: "Orbitron, sans-serif",
								fontWeight: 600,
								letterSpacing: "0.1em",
							}}
						>
							{typeConfig.label}
						</span>
					</div>

					{/* Reranker tier badge (if reranked) */}
					{result.rerankTier && (
						<RerankerBadge tier={result.rerankTier} degraded={result.degraded} />
					)}
				</div>

				{/* Right: Session link */}
				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: "4px",
					}}
				>
					<div
						style={{
							width: "4px",
							height: "4px",
							borderRadius: "50%",
							backgroundColor: isHovered ? `rgb(${accentColor})` : "rgb(100, 116, 139)",
							transition: "background-color 0.2s ease",
						}}
					/>
					<span
						style={{
							fontSize: "9px",
							fontFamily: "JetBrains Mono, monospace",
							color: "rgb(100, 116, 139)",
						}}
					>
						{truncateId(result.payload.session_id)}
					</span>
				</div>
			</div>

			{/* Row 2: Content preview */}
			<div
				style={{
					flex: 1,
					marginBottom: "10px",
				}}
			>
				<p
					style={{
						margin: 0,
						fontSize: "12px",
						fontFamily: "JetBrains Mono, monospace",
						color: isHovered ? "rgb(226, 232, 240)" : "rgb(148, 163, 184)",
						lineHeight: 1.5,
						transition: "color 0.2s ease",
						// Clamp to 2 lines
						display: "-webkit-box",
						WebkitLineClamp: 2,
						WebkitBoxOrient: "vertical",
						overflow: "hidden",
					}}
				>
					{truncateContent(result.payload.content)}
				</p>

				{/* File path for code results */}
				{result.payload.file_path && (
					<p
						style={{
							margin: "6px 0 0 0",
							fontSize: "10px",
							fontFamily: "JetBrains Mono, monospace",
							color: "rgb(71, 85, 105)",
							fontStyle: "italic",
						}}
					>
						{result.payload.file_path}
					</p>
				)}
			</div>

			{/* Row 3: Score + Timestamp */}
			<div
				style={{
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
				}}
			>
				<ScoreBar result={result} />
				<span
					style={{
						fontSize: "9px",
						fontFamily: "JetBrains Mono, monospace",
						color: "rgb(71, 85, 105)",
					}}
				>
					{formatTimestamp(result.payload.timestamp)}
				</span>
			</div>
		</button>
	);
}

// Loading skeleton
function SkeletonCard({ index }: { index: number }) {
	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				padding: "14px 16px",
				background: "rgba(15, 20, 30, 0.6)",
				border: "1px solid rgba(71, 85, 105, 0.2)",
				borderRadius: "10px",
				minHeight: "120px",
				animation: `searchCardReveal 0.4s cubic-bezier(0.4, 0, 0.2, 1) ${index * 0.05}s both`,
			}}
		>
			{/* Type badge skeleton */}
			<div
				style={{
					width: "70px",
					height: "20px",
					backgroundColor: "rgba(100, 116, 139, 0.1)",
					borderRadius: "4px",
					marginBottom: "10px",
					animation: "skeletonPulse 1.5s ease-in-out infinite",
				}}
			/>

			{/* Content skeleton */}
			<div style={{ flex: 1 }}>
				<div
					style={{
						width: "100%",
						height: "12px",
						backgroundColor: "rgba(100, 116, 139, 0.1)",
						borderRadius: "2px",
						marginBottom: "8px",
						animation: "skeletonPulse 1.5s ease-in-out infinite",
						animationDelay: "0.1s",
					}}
				/>
				<div
					style={{
						width: "70%",
						height: "12px",
						backgroundColor: "rgba(100, 116, 139, 0.1)",
						borderRadius: "2px",
						animation: "skeletonPulse 1.5s ease-in-out infinite",
						animationDelay: "0.2s",
					}}
				/>
			</div>

			{/* Bottom skeleton */}
			<div
				style={{
					width: "80px",
					height: "4px",
					backgroundColor: "rgba(100, 116, 139, 0.1)",
					borderRadius: "2px",
					animation: "skeletonPulse 1.5s ease-in-out infinite",
					animationDelay: "0.3s",
				}}
			/>
		</div>
	);
}

export function SearchResults({ results, meta, isLoading, error, query }: SearchResultsProps) {
	const [hoveredId, setHoveredId] = useState<string | null>(null);
	const router = useRouter();

	const handleResultClick = (result: SearchResult) => {
		// Navigate to session with optional node highlight
		const url = `/session/${result.payload.session_id}?highlight=${result.payload.node_id}`;
		router.push(url);
	};

	// Loading state
	if (isLoading) {
		return (
			<div>
				{/* Header */}
				<div
					style={{
						display: "flex",
						alignItems: "center",
						justifyContent: "space-between",
						marginBottom: "1rem",
						padding: "0 4px",
					}}
				>
					<div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
						<div
							style={{
								width: "6px",
								height: "6px",
								borderRadius: "50%",
								backgroundColor: "rgb(0, 245, 212)",
								boxShadow: "0 0 8px rgba(0, 245, 212, 0.6)",
								animation: "searchPulse 1s ease-in-out infinite",
							}}
						/>
						<span
							style={{
								fontSize: "10px",
								fontFamily: "Orbitron, sans-serif",
								fontWeight: 600,
								letterSpacing: "0.2em",
								color: "rgb(0, 245, 212)",
							}}
						>
							SEARCHING
						</span>
					</div>
				</div>

				{/* Skeleton grid */}
				<div
					style={{
						display: "grid",
						gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
						gap: "12px",
					}}
				>
					{[0, 1, 2, 3, 4, 5].map((i) => (
						<SkeletonCard key={i} index={i} />
					))}
				</div>

				<style jsx>{`
					@keyframes searchPulse {
						0%, 100% { opacity: 1; transform: scale(1); }
						50% { opacity: 0.5; transform: scale(0.9); }
					}
					@keyframes skeletonPulse {
						0%, 100% { opacity: 0.3; }
						50% { opacity: 0.6; }
					}
					@keyframes searchCardReveal {
						from {
							opacity: 0;
							transform: translateY(12px) scale(0.98);
						}
						to {
							opacity: 1;
							transform: translateY(0) scale(1);
						}
					}
				`}</style>
			</div>
		);
	}

	// Error state - silently fail, just don't show results
	// (search index may not exist yet, no need to alarm user)
	if (error) {
		return null;
	}

	// No results state
	if (results.length === 0 && query.trim().length >= 3) {
		return (
			<div
				style={{
					padding: "2rem",
					background: "rgba(15, 20, 30, 0.4)",
					borderRadius: "12px",
					border: "1px solid rgba(100, 116, 139, 0.15)",
					textAlign: "center",
				}}
			>
				<div
					style={{
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						gap: "8px",
						marginBottom: "8px",
					}}
				>
					<svg
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="rgb(100, 116, 139)"
						strokeWidth="2"
					>
						<circle cx="11" cy="11" r="8" />
						<path d="m21 21-4.35-4.35" />
						<path d="M8 11h6" />
					</svg>
					<span
						style={{
							fontSize: "11px",
							fontFamily: "Orbitron, sans-serif",
							fontWeight: 600,
							letterSpacing: "0.1em",
							color: "rgb(100, 116, 139)",
						}}
					>
						NO MATCHES
					</span>
				</div>
				<p
					style={{
						margin: 0,
						fontSize: "12px",
						fontFamily: "JetBrains Mono, monospace",
						color: "rgb(71, 85, 105)",
					}}
				>
					Try different keywords or check spelling
				</p>
			</div>
		);
	}

	// Results
	return (
		<div>
			{/* Header */}
			<div
				style={{
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					marginBottom: "1rem",
					padding: "0 4px",
				}}
			>
				<div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
					<div
						style={{
							width: "6px",
							height: "6px",
							borderRadius: "50%",
							backgroundColor: "rgb(0, 245, 212)",
							boxShadow: "0 0 8px rgba(0, 245, 212, 0.6)",
						}}
					/>
					<span
						style={{
							fontSize: "10px",
							fontFamily: "Orbitron, sans-serif",
							fontWeight: 600,
							letterSpacing: "0.2em",
							color: "rgb(0, 245, 212)",
						}}
					>
						SEARCH RESULTS
					</span>
					{/* RERANKED badge */}
					{meta?.reranker &&
						(() => {
							const tierConfig = TIER_COLORS[meta.reranker.tier];
							const badgeColor = tierConfig?.color || "236, 72, 153";
							const tierName = tierConfig?.name || meta.reranker.tier.toUpperCase();

							return (
								<span
									style={{
										fontSize: "8px",
										fontFamily: "Orbitron, sans-serif",
										fontWeight: 600,
										letterSpacing: "0.1em",
										color: `rgb(${badgeColor})`,
										padding: "2px 8px",
										background: `rgba(${badgeColor}, 0.15)`,
										borderRadius: "3px",
										border: `1px solid rgba(${badgeColor}, 0.3)`,
										textShadow: `0 0 6px rgba(${badgeColor}, 0.4)`,
										cursor: "help",
									}}
									title={`Reranked with ${tierName} tier using ${meta.reranker.model}`}
								>
									{tierName} · {meta.reranker.latencyMs}ms
								</span>
							);
						})()}
				</div>
				<span
					style={{
						fontSize: "10px",
						fontFamily: "JetBrains Mono, monospace",
						color: "rgb(0, 245, 212)",
						padding: "3px 8px",
						background: "rgba(0, 245, 212, 0.1)",
						borderRadius: "4px",
						border: "1px solid rgba(0, 245, 212, 0.3)",
					}}
				>
					{results.length} {results.length === 1 ? "match" : "matches"}
				</span>
			</div>

			{/* Results grid */}
			<div
				style={{
					display: "grid",
					gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
					gap: "12px",
				}}
			>
				{results.map((result, index) => (
					<SearchResultCard
						key={result.id}
						result={result}
						index={index}
						isHovered={hoveredId === result.id}
						onHover={() => setHoveredId(result.id)}
						onLeave={() => setHoveredId(null)}
						onClick={() => handleResultClick(result)}
					/>
				))}
			</div>

			<style jsx>{`
				@keyframes searchCardReveal {
					from {
						opacity: 0;
						transform: translateY(12px) scale(0.98);
					}
					to {
						opacity: 1;
						transform: translateY(0) scale(1);
					}
				}
			`}</style>
		</div>
	);
}
