"use client";

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { StreamingStatus } from "@/hooks/useStreamingData";
import { cn } from "@/lib/utils";

interface StreamingIndicatorProps {
	status: StreamingStatus;
	lastUpdate: Date | null;
	staleness?: number;
	reconnectAttempts?: number;
	showTimestamp?: boolean;
	showLabel?: boolean;
	size?: "sm" | "md" | "lg";
	className?: string;
}

const STATUS_CONFIG = {
	connecting: {
		label: "Connecting",
		dotClass: "streaming-dot-connecting",
		textClass: "text-muted-foreground",
	},
	live: {
		label: "Live",
		dotClass: "streaming-dot-live",
		textClass: "text-green-500",
	},
	degraded: {
		label: "Degraded",
		dotClass: "streaming-dot-degraded",
		textClass: "text-amber-500",
	},
	stale: {
		label: "Stale",
		dotClass: "streaming-dot-stale",
		textClass: "text-amber-600",
	},
	offline: {
		label: "Offline",
		dotClass: "streaming-dot-offline",
		textClass: "text-destructive",
	},
};

const SIZE_CONFIG = {
	sm: {
		dot: "h-1.5 w-1.5",
		text: "text-[10px]",
		gap: "gap-1",
	},
	md: {
		dot: "h-2 w-2",
		text: "text-xs",
		gap: "gap-1.5",
	},
	lg: {
		dot: "h-2.5 w-2.5",
		text: "text-sm",
		gap: "gap-2",
	},
};

function formatTimestamp(date: Date): string {
	return date.toLocaleTimeString(undefined, {
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	});
}

function formatStaleness(seconds: number): string {
	if (seconds < 60) return `${seconds}s ago`;
	if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
	return `${Math.floor(seconds / 3600)}h ago`;
}

/**
 * Visual indicator for streaming/live data status.
 * Shows a pulsing dot with optional label and timestamp.
 */
export function StreamingIndicator({
	status,
	lastUpdate,
	staleness = 0,
	reconnectAttempts = 0,
	showTimestamp = false,
	showLabel = true,
	size = "md",
	className,
}: StreamingIndicatorProps) {
	const config = STATUS_CONFIG[status];
	const sizeConfig = SIZE_CONFIG[size];

	const tooltipContent = (
		<div className="space-y-1 text-xs">
			<div className="font-medium">Status: {config.label}</div>
			{lastUpdate && (
				<div className="text-muted-foreground">
					Last update: {formatTimestamp(lastUpdate)}
					{staleness > 0 && ` (${formatStaleness(staleness)})`}
				</div>
			)}
			{reconnectAttempts > 0 && (
				<div className="text-amber-500">Reconnect attempts: {reconnectAttempts}</div>
			)}
		</div>
	);

	return (
		<TooltipProvider delayDuration={300}>
			<Tooltip>
				<TooltipTrigger asChild>
					<div className={cn("flex items-center", sizeConfig.gap, className)}>
						{/* Streaming dot with pulse animation */}
						<div className="relative flex items-center justify-center">
							<span className={cn("rounded-full", sizeConfig.dot, config.dotClass)} />
						</div>

						{/* Label */}
						{showLabel && (
							<span
								className={cn(
									"font-mono font-medium uppercase tracking-wider",
									sizeConfig.text,
									config.textClass,
								)}
							>
								{config.label}
							</span>
						)}

						{/* Timestamp */}
						{showTimestamp && lastUpdate && (
							<span className={cn("font-mono text-muted-foreground", sizeConfig.text)}>
								{formatTimestamp(lastUpdate)}
							</span>
						)}
					</div>
				</TooltipTrigger>
				<TooltipContent side="bottom" className="font-mono">
					{tooltipContent}
				</TooltipContent>
			</Tooltip>
		</TooltipProvider>
	);
}

/**
 * Compact streaming indicator for inline use in cards/headers.
 * Just shows the pulsing dot without label.
 */
export function StreamingDot({
	status,
	size = "sm",
	className,
}: {
	status: StreamingStatus;
	size?: "sm" | "md" | "lg";
	className?: string;
}) {
	const config = STATUS_CONFIG[status];
	const sizeConfig = SIZE_CONFIG[size];

	return (
		<span
			className={cn("rounded-full", sizeConfig.dot, config.dotClass, className)}
			title={config.label}
		/>
	);
}

/**
 * Signal strength indicator showing connection quality.
 * Uses 3 bars like a wifi/cellular indicator.
 */
export function SignalStrength({
	status,
	className,
}: {
	status: StreamingStatus;
	className?: string;
}) {
	const bars = status === "live" ? 3 : status === "degraded" ? 2 : status === "stale" ? 1 : 0;
	const color =
		status === "live"
			? "bg-green-500"
			: status === "degraded" || status === "stale"
				? "bg-amber-500"
				: "bg-muted";

	return (
		<div className={cn("flex items-end gap-0.5 h-3", className)}>
			{[1, 2, 3].map((bar) => (
				<div
					key={bar}
					className={cn(
						"w-1 rounded-sm transition-all duration-300",
						bar <= bars ? color : "bg-muted/30",
						bar === 1 ? "h-1" : bar === 2 ? "h-2" : "h-3",
					)}
				/>
			))}
		</div>
	);
}
