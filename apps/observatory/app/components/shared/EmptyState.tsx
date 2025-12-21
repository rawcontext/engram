"use client";

import type React from "react";
import { colors, fonts, radii, shadows, spacing } from "./design-tokens";

export type EmptyStateVariant = "neural" | "stream" | "search" | "default";

interface EmptyStateProps {
	/**
	 * Visual variant of the empty state
	 * - neural: Graph/network visualization (default)
	 * - stream: Thought stream/timeline
	 * - search: Search results
	 * - default: Generic empty state
	 */
	variant?: EmptyStateVariant;
	/**
	 * Primary heading text
	 */
	title?: string;
	/**
	 * Secondary description text
	 */
	description?: string;
	/**
	 * Custom icon element (overrides variant icon)
	 */
	icon?: React.ReactNode;
	/**
	 * Additional CSS class name
	 */
	className?: string;
}

// Variant-specific configurations
const variantConfig = {
	neural: {
		title: "No Neural Pathways",
		description: "Awaiting session activity...",
		icon: (
			<svg
				width="28"
				height="28"
				viewBox="0 0 24 24"
				fill="none"
				stroke={`rgba(251, 191, 36, 0.5)`}
				strokeWidth="1.5"
				strokeLinecap="round"
				strokeLinejoin="round"
			>
				<circle cx="12" cy="5" r="2" />
				<circle cx="5" cy="12" r="2" />
				<circle cx="19" cy="12" r="2" />
				<circle cx="12" cy="19" r="2" />
				<path d="M12 7v10M7 12h10M9 7l-2 3M15 7l2 3M9 17l-2-3M15 17l2-3" opacity="0.5" />
			</svg>
		),
	},
	stream: {
		title: "No Cognitive Events",
		description: "Awaiting thought stream...",
		icon: (
			<svg
				width="28"
				height="28"
				viewBox="0 0 24 24"
				fill="none"
				stroke={`rgba(251, 191, 36, 0.5)`}
				strokeWidth="1.5"
				strokeLinecap="round"
				strokeLinejoin="round"
			>
				<path d="M2 12h4l3-9 4 18 3-9h4" opacity="0.7" />
				<circle cx="12" cy="12" r="2" fill="rgba(251, 191, 36, 0.3)" />
			</svg>
		),
	},
	search: {
		title: "No Matches",
		description: "Try different keywords or check spelling",
		icon: (
			<svg
				width="28"
				height="28"
				viewBox="0 0 24 24"
				fill="none"
				stroke={`rgba(100, 116, 139, 0.6)`}
				strokeWidth="1.5"
				strokeLinecap="round"
				strokeLinejoin="round"
			>
				<circle cx="11" cy="11" r="8" />
				<path d="m21 21-4.35-4.35" />
				<path d="M8 11h6" />
			</svg>
		),
	},
	default: {
		title: "No Data",
		description: "Nothing to display yet",
		icon: (
			<svg
				width="28"
				height="28"
				viewBox="0 0 24 24"
				fill="none"
				stroke={`rgba(148, 163, 184, 0.5)`}
				strokeWidth="1.5"
				strokeLinecap="round"
				strokeLinejoin="round"
			>
				<circle cx="12" cy="12" r="10" />
				<path d="M12 8v4M12 16h.01" />
			</svg>
		),
	},
};

export function EmptyState({
	variant = "default",
	title,
	description,
	icon,
	className,
}: EmptyStateProps) {
	const config = variantConfig[variant];
	const displayTitle = title ?? config.title;
	const displayDescription = description ?? config.description;
	const displayIcon = icon ?? config.icon;

	return (
		<div
			className={className}
			style={{
				display: "flex",
				flexDirection: "column",
				alignItems: "center",
				justifyContent: "center",
				height: "100%",
				gap: spacing[5],
				padding: spacing[10],
				textAlign: "center",
			}}
		>
			{/* Animated icon container */}
			<div style={{ position: "relative", width: "64px", height: "64px" }}>
				{/* Outer pulsing ring */}
				<div
					style={{
						position: "absolute",
						inset: "-4px",
						borderRadius: radii.full,
						border: `1px solid ${colors.amber.border}`,
						animation: "emptyPulse 3s ease-in-out infinite",
					}}
				/>
				{/* Main icon container */}
				<div
					style={{
						width: "64px",
						height: "64px",
						borderRadius: radii.full,
						background: `linear-gradient(135deg, ${colors.amber.subtle} 0%, ${colors.slate[400]}10 100%)`,
						border: `1px solid ${colors.slate[400]}25`,
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						boxShadow: `${shadows.md}, ${shadows.inset}`,
					}}
				>
					{displayIcon}
				</div>
				{/* Center glow */}
				<div
					style={{
						position: "absolute",
						top: "50%",
						left: "50%",
						transform: "translate(-50%, -50%)",
						width: "8px",
						height: "8px",
						borderRadius: radii.full,
						background: colors.amber.glow,
						boxShadow: shadows.glow.amber,
						animation: "emptyGlow 2s ease-in-out infinite",
					}}
				/>
			</div>

			{/* Text content */}
			<div>
				<p
					style={{
						fontFamily: fonts.display,
						fontSize: "12px",
						fontWeight: 600,
						letterSpacing: "0.15em",
						color: `${colors.slate[200]}b3`, // 70% opacity
						marginBottom: spacing[2],
						textTransform: "uppercase",
					}}
				>
					{displayTitle}
				</p>
				<p
					style={{
						fontFamily: fonts.mono,
						fontSize: "11px",
						color: `${colors.slate[500]}99`, // 60% opacity
						letterSpacing: "0.02em",
						margin: 0,
					}}
				>
					{displayDescription}
				</p>
			</div>

			{/* Keyframe animations */}
			<style>{`
				@keyframes emptyPulse {
					0%, 100% { transform: scale(1); opacity: 0.4; }
					50% { transform: scale(1.1); opacity: 0.2; }
				}
				@keyframes emptyGlow {
					0%, 100% { opacity: 0.4; transform: translate(-50%, -50%) scale(1); }
					50% { opacity: 0.8; transform: translate(-50%, -50%) scale(1.2); }
				}
			`}</style>
		</div>
	);
}

export default EmptyState;
