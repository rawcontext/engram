"use client";

import type React from "react";
import { colors, glass, radii, shadows, spacing, transitions } from "./design-tokens";

export type GlassVariant = "light" | "dark" | "panel" | "card";

interface GlassPanelProps {
	/**
	 * Glass effect variant
	 */
	variant?: GlassVariant;
	/**
	 * Border accent color (optional)
	 */
	accentColor?: "amber" | "cyan" | "violet" | "green" | "none";
	/**
	 * Whether the panel has hover effects
	 */
	interactive?: boolean;
	/**
	 * Click handler (makes the panel a button)
	 */
	onClick?: () => void;
	/**
	 * Children elements
	 */
	children: React.ReactNode;
	/**
	 * Additional CSS class name
	 */
	className?: string;
	/**
	 * Additional inline styles
	 */
	style?: React.CSSProperties;
}

// Accent color configurations
const accentColors = {
	amber: {
		border: colors.amber.border,
		glow: colors.amber.glow,
		topLine: `linear-gradient(90deg, transparent, ${colors.amber.DEFAULT}, transparent)`,
	},
	cyan: {
		border: colors.cyan.border,
		glow: colors.cyan.glow,
		topLine: `linear-gradient(90deg, transparent, ${colors.cyan.DEFAULT}, transparent)`,
	},
	violet: {
		border: colors.violet.border,
		glow: colors.violet.glow,
		topLine: `linear-gradient(90deg, transparent, ${colors.violet.DEFAULT}, transparent)`,
	},
	green: {
		border: colors.green.border,
		glow: colors.green.glow,
		topLine: `linear-gradient(90deg, transparent, ${colors.green.DEFAULT}, transparent)`,
	},
	none: {
		border: `${colors.slate[600]}33`,
		glow: "none",
		topLine: "none",
	},
};

// Variant configurations
const variantConfig = {
	light: {
		background: glass.light.background,
		backdropFilter: glass.light.backdropFilter,
		border: glass.light.border,
	},
	dark: {
		background: glass.dark.background,
		backdropFilter: glass.dark.backdropFilter,
		border: glass.dark.border,
	},
	panel: {
		background: glass.panel.background,
		backdropFilter: glass.panel.backdropFilter,
		border: glass.panel.border,
	},
	card: {
		background: "rgba(15, 20, 30, 0.6)",
		backdropFilter: "blur(8px)",
		border: `1px solid ${colors.slate[600]}33`,
	},
};

export function GlassPanel({
	variant = "light",
	accentColor = "none",
	interactive = false,
	onClick,
	children,
	className,
	style,
}: GlassPanelProps) {
	const config = variantConfig[variant];
	const accent = accentColors[accentColor];

	const Component = onClick ? "button" : "div";

	const baseStyles: React.CSSProperties = {
		position: "relative",
		background: config.background,
		backdropFilter: config.backdropFilter,
		WebkitBackdropFilter: config.backdropFilter,
		border: accentColor !== "none" ? `1px solid ${accent.border}` : config.border,
		borderRadius: radii["2xl"],
		overflow: "hidden",
		transition: transitions.default,
		...(interactive && {
			cursor: "pointer",
		}),
		...(onClick && {
			cursor: "pointer",
			textAlign: "left" as const,
			width: "100%",
		}),
	};

	return (
		<Component
			type={onClick ? "button" : undefined}
			onClick={onClick}
			className={className}
			style={{ ...baseStyles, ...style }}
		>
			{/* Top accent line (optional) */}
			{accentColor !== "none" && (
				<div
					style={{
						position: "absolute",
						top: 0,
						left: "10%",
						right: "10%",
						height: "1px",
						background: accent.topLine,
						opacity: 0.5,
					}}
				/>
			)}

			{/* Inset shadow for depth */}
			<div
				style={{
					position: "absolute",
					inset: 0,
					borderRadius: "inherit",
					boxShadow: shadows.inset,
					pointerEvents: "none",
				}}
			/>

			{children}
		</Component>
	);
}

/**
 * Pre-styled card variant with hover effects
 */
export function Card({
	children,
	accentColor = "none",
	onClick,
	isHovered = false,
	className,
	style,
}: {
	children: React.ReactNode;
	accentColor?: "amber" | "cyan" | "violet" | "green" | "none";
	onClick?: () => void;
	isHovered?: boolean;
	className?: string;
	style?: React.CSSProperties;
}) {
	const accent = accentColors[accentColor];

	// Get subtle color based on accent
	const subtleColor =
		accentColor === "none" ? `${colors.slate[500]}15` : colors[accentColor].subtle;

	const cardStyles: React.CSSProperties = {
		display: "flex",
		flexDirection: "column",
		padding: `${spacing[4]} ${spacing[4]}`,
		background: isHovered
			? `linear-gradient(135deg, ${subtleColor} 0%, ${colors.bg.glass} 100%)`
			: colors.bg.glass,
		backdropFilter: "blur(8px)",
		border: isHovered ? `1px solid ${accent.border}` : `1px solid ${colors.slate[600]}33`,
		borderRadius: radii.xl,
		cursor: onClick ? "pointer" : "default",
		transition: transitions.default,
		boxShadow: isHovered
			? `0 4px 24px ${accentColor !== "none" ? `${accent.glow}20` : "rgba(0,0,0,0.2)"}, ${shadows.inset}`
			: `${shadows.sm}, ${shadows.inset}`,
		transform: isHovered ? "translateY(-2px)" : "translateY(0)",
		position: "relative",
		overflow: "hidden",
		...style,
	};

	const Component = onClick ? "button" : "div";

	return (
		<Component
			type={onClick ? "button" : undefined}
			onClick={onClick}
			className={className}
			style={cardStyles}
		>
			{/* Top glow line on hover */}
			{isHovered && accentColor !== "none" && (
				<div
					style={{
						position: "absolute",
						top: 0,
						left: 0,
						right: 0,
						height: "1px",
						background: accent.topLine,
						opacity: 0.5,
					}}
				/>
			)}
			{children}
		</Component>
	);
}

export default GlassPanel;
