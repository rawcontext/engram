"use client";

import type React from "react";
import { colors, fonts, radii, spacing } from "./design-tokens";

export type BadgeVariant = "amber" | "cyan" | "violet" | "green" | "red" | "slate";
export type BadgeSize = "sm" | "md" | "lg";

interface BadgeProps {
	/**
	 * Badge color variant
	 */
	variant?: BadgeVariant;
	/**
	 * Badge size
	 */
	size?: BadgeSize;
	/**
	 * Content to display
	 */
	children: React.ReactNode;
	/**
	 * Optional icon to display before the text
	 */
	icon?: React.ReactNode;
	/**
	 * Whether the badge should glow
	 */
	glow?: boolean;
	/**
	 * Use display font (Orbitron) instead of mono
	 */
	displayFont?: boolean;
	/**
	 * Additional CSS class name
	 */
	className?: string;
}

// Variant color configurations
const variantConfig = {
	amber: {
		color: colors.amber.DEFAULT,
		bg: colors.amber.subtle,
		border: colors.amber.border,
		glow: colors.amber.glow,
	},
	cyan: {
		color: colors.cyan.DEFAULT,
		bg: colors.cyan.subtle,
		border: colors.cyan.border,
		glow: colors.cyan.glow,
	},
	violet: {
		color: colors.violet.DEFAULT,
		bg: colors.violet.subtle,
		border: colors.violet.border,
		glow: colors.violet.glow,
	},
	green: {
		color: colors.green.DEFAULT,
		bg: colors.green.subtle,
		border: colors.green.border,
		glow: colors.green.glow,
	},
	red: {
		color: colors.red.DEFAULT,
		bg: colors.red.subtle,
		border: `rgba(239, 68, 68, 0.3)`,
		glow: colors.red.glow,
	},
	slate: {
		color: colors.slate[400],
		bg: `${colors.slate[500]}15`,
		border: `${colors.slate[500]}25`,
		glow: "none",
	},
};

// Size configurations
const sizeConfig = {
	sm: {
		fontSize: "7px",
		padding: `2px ${spacing[2]}`,
		gap: "4px",
		iconSize: "8px",
	},
	md: {
		fontSize: "8px",
		padding: `3px ${spacing[2]}`,
		gap: "6px",
		iconSize: "10px",
	},
	lg: {
		fontSize: "10px",
		padding: `4px ${spacing[3]}`,
		gap: "8px",
		iconSize: "12px",
	},
};

export function Badge({
	variant = "slate",
	size = "md",
	children,
	icon,
	glow = false,
	displayFont = false,
	className,
}: BadgeProps) {
	const vConfig = variantConfig[variant];
	const sConfig = sizeConfig[size];

	return (
		<span
			className={className}
			style={{
				display: "inline-flex",
				alignItems: "center",
				gap: sConfig.gap,
				padding: sConfig.padding,
				fontFamily: displayFont ? fonts.display : fonts.mono,
				fontSize: sConfig.fontSize,
				fontWeight: 600,
				letterSpacing: displayFont ? "0.1em" : "0.05em",
				color: vConfig.color,
				backgroundColor: vConfig.bg,
				border: `1px solid ${vConfig.border}`,
				borderRadius: radii.sm,
				textTransform: "uppercase",
				whiteSpace: "nowrap",
				textShadow: glow ? `0 0 8px ${vConfig.glow}` : "none",
			}}
		>
			{icon && (
				<span
					style={{
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						width: sConfig.iconSize,
						height: sConfig.iconSize,
					}}
				>
					{icon}
				</span>
			)}
			{children}
		</span>
	);
}

/**
 * Type badge commonly used to indicate content type (thought, code, doc, etc.)
 */
export function TypeBadge({
	type,
	className,
}: {
	type: "thought" | "code" | "doc" | "tool" | "turn" | "reasoning";
	className?: string;
}) {
	const typeConfig = {
		thought: { variant: "violet" as const, label: "THOUGHT", icon: null },
		code: { variant: "amber" as const, label: "CODE", icon: null },
		doc: { variant: "cyan" as const, label: "DOC", icon: null },
		tool: { variant: "violet" as const, label: "TOOL", icon: null },
		turn: { variant: "amber" as const, label: "TURN", icon: null },
		reasoning: { variant: "cyan" as const, label: "TRACE", icon: null },
	};

	const config = typeConfig[type];

	return (
		<Badge variant={config.variant} size="md" displayFont className={className}>
			{config.label}
		</Badge>
	);
}

/**
 * Count badge - shows a numeric count (e.g., "5 items")
 */
export function CountBadge({
	count,
	label,
	variant = "slate",
	className,
}: {
	count: number;
	label?: string;
	variant?: BadgeVariant;
	className?: string;
}) {
	return (
		<Badge variant={variant} size="md" className={className}>
			{count}
			{label && ` ${label}`}
		</Badge>
	);
}

export default Badge;
