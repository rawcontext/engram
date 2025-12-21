"use client";

import { colors, fonts, radii, spacing } from "./design-tokens";

export type StatusType = "online" | "offline" | "live" | "connecting" | "error" | "warning";

interface StatusIndicatorProps {
	/**
	 * Status type determines the color and animation
	 */
	status: StatusType;
	/**
	 * Optional label text to display next to the indicator
	 */
	label?: string;
	/**
	 * Size of the indicator dot
	 */
	size?: "sm" | "md" | "lg";
	/**
	 * Whether to show the pulsing animation
	 */
	pulse?: boolean;
	/**
	 * Additional CSS class name
	 */
	className?: string;
}

// Status configurations
const statusConfig = {
	online: {
		color: colors.green.DEFAULT,
		glow: colors.green.glow,
		label: "Online",
	},
	offline: {
		color: colors.slate[500],
		glow: "none",
		label: "Offline",
	},
	live: {
		color: colors.green.DEFAULT,
		glow: colors.green.glow,
		label: "Live",
	},
	connecting: {
		color: colors.amber.DEFAULT,
		glow: colors.amber.glow,
		label: "Connecting",
	},
	error: {
		color: colors.red.DEFAULT,
		glow: colors.red.glow,
		label: "Error",
	},
	warning: {
		color: colors.amber.DEFAULT,
		glow: colors.amber.glow,
		label: "Warning",
	},
};

const sizeConfig = {
	sm: 4,
	md: 6,
	lg: 8,
};

export function StatusIndicator({
	status,
	label,
	size = "md",
	pulse = true,
	className,
}: StatusIndicatorProps) {
	const config = statusConfig[status];
	const dotSize = sizeConfig[size];
	const shouldPulse =
		pulse && (status === "live" || status === "online" || status === "connecting");

	return (
		<div
			className={className}
			style={{
				display: "flex",
				alignItems: "center",
				gap: spacing[2],
			}}
		>
			<span
				style={{
					width: `${dotSize}px`,
					height: `${dotSize}px`,
					borderRadius: radii.full,
					backgroundColor: config.color,
					boxShadow: config.glow !== "none" ? `0 0 ${dotSize + 2}px ${config.glow}` : "none",
					animation: shouldPulse ? "statusPulse 2s ease-in-out infinite" : "none",
					flexShrink: 0,
				}}
			/>
			{label !== undefined && (
				<span
					style={{
						fontFamily: fonts.mono,
						fontSize: size === "sm" ? "10px" : "11px",
						color: colors.slate[400],
						letterSpacing: "0.03em",
					}}
				>
					{label ?? config.label}
				</span>
			)}

			{shouldPulse && (
				<style>{`
					@keyframes statusPulse {
						0%, 100% {
							opacity: 1;
							transform: scale(1);
						}
						50% {
							opacity: 0.6;
							transform: scale(0.9);
						}
					}
				`}</style>
			)}
		</div>
	);
}

/**
 * Live badge component - styled badge for "LIVE" status
 */
export function LiveBadge({ className }: { className?: string }) {
	return (
		<span
			className={className}
			style={{
				fontFamily: fonts.display,
				fontSize: "8px",
				fontWeight: 700,
				letterSpacing: "0.1em",
				color: colors.green.DEFAULT,
				padding: `${spacing[1]} ${spacing[2]}`,
				background: colors.green.subtle,
				border: `1px solid ${colors.green.border}`,
				borderRadius: "3px",
				animation: "liveBadgePulse 2s ease-in-out infinite",
			}}
		>
			LIVE
			<style>{`
				@keyframes liveBadgePulse {
					0%, 100% {
						opacity: 1;
						background: ${colors.green.subtle};
					}
					50% {
						opacity: 0.8;
						background: rgba(34, 197, 94, 0.25);
					}
				}
			`}</style>
		</span>
	);
}

export default StatusIndicator;
