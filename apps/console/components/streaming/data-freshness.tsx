"use client";

import { useEffect, useRef, useState } from "react";
import type { StreamingStatus } from "@/hooks/useStreamingData";
import { cn } from "@/lib/utils";

interface DataFreshnessProps {
	/** Current streaming status */
	status: StreamingStatus;
	/** Last update timestamp - triggers flash animation when changed */
	lastUpdate: Date | null;
	/** Content to wrap */
	children: React.ReactNode;
	/** Additional classes */
	className?: string;
	/** Flash color variant */
	flashColor?: "cyan" | "green" | "amber";
	/** Show stale overlay when data is stale */
	showStaleOverlay?: boolean;
}

/**
 * Wrapper component that adds visual feedback for data freshness.
 * - Flashes subtly when new data arrives
 * - Shows muted overlay when data is stale
 * - Smooth transitions between states
 */
export function DataFreshness({
	status,
	lastUpdate,
	children,
	className,
	flashColor = "cyan",
	showStaleOverlay = true,
}: DataFreshnessProps) {
	const [isFlashing, setIsFlashing] = useState(false);
	const prevUpdateRef = useRef<Date | null>(null);

	// Trigger flash when lastUpdate changes
	useEffect(() => {
		if (lastUpdate && prevUpdateRef.current !== lastUpdate) {
			// Only flash if this isn't the initial load
			if (prevUpdateRef.current !== null) {
				setIsFlashing(true);
				const timer = setTimeout(() => setIsFlashing(false), 600);
				return () => clearTimeout(timer);
			}
			prevUpdateRef.current = lastUpdate;
		}
	}, [lastUpdate]);

	const isStale = status === "stale" || status === "offline";
	const isDegraded = status === "degraded";

	const flashClass = {
		cyan: "data-flash-cyan",
		green: "data-flash-green",
		amber: "data-flash-amber",
	}[flashColor];

	return (
		<div
			className={cn(
				"relative transition-opacity duration-300",
				isFlashing && flashClass,
				showStaleOverlay && isStale && "data-stale",
				showStaleOverlay && isDegraded && "data-degraded",
				className,
			)}
		>
			{children}

			{/* Stale indicator overlay */}
			{showStaleOverlay && isStale && (
				<div className="absolute inset-0 pointer-events-none flex items-start justify-end p-2">
					<span className="text-[9px] font-mono uppercase tracking-wider text-amber-500/70 bg-background/80 px-1.5 py-0.5 rounded">
						Stale
					</span>
				</div>
			)}
		</div>
	);
}

interface LiveValueProps {
	/** The value to display */
	value: string | number;
	/** Previous value for comparison (enables change animation) */
	previousValue?: string | number;
	/** Additional classes */
	className?: string;
	/** Direction indicator on change */
	showDirection?: boolean;
}

/**
 * Animated value display that smoothly transitions between values.
 * Use for metrics that update frequently.
 */
export function LiveValue({
	value,
	previousValue,
	className,
	showDirection = false,
}: LiveValueProps) {
	const [displayValue, setDisplayValue] = useState(value);
	const [isChanging, setIsChanging] = useState(false);
	const [direction, setDirection] = useState<"up" | "down" | null>(null);

	useEffect(() => {
		if (value !== displayValue) {
			setIsChanging(true);

			// Determine direction
			if (showDirection && typeof value === "number" && typeof previousValue === "number") {
				setDirection(value > previousValue ? "up" : value < previousValue ? "down" : null);
			}

			// Animate to new value
			const timer = setTimeout(() => {
				setDisplayValue(value);
				setIsChanging(false);
				// Clear direction after animation
				setTimeout(() => setDirection(null), 500);
			}, 150);

			return () => clearTimeout(timer);
		}
	}, [value, displayValue, previousValue, showDirection]);

	return (
		<span
			className={cn(
				"inline-flex items-center transition-all duration-300",
				isChanging && "live-value-changing",
				direction === "up" && "live-value-up",
				direction === "down" && "live-value-down",
				className,
			)}
		>
			{displayValue}
			{direction && showDirection && (
				<span
					className={cn(
						"ml-1 text-xs transition-opacity duration-300",
						direction === "up" ? "text-green-500" : "text-destructive",
					)}
				>
					{direction === "up" ? "↑" : "↓"}
				</span>
			)}
		</span>
	);
}

interface PulseRingProps {
	/** Whether the pulse is active */
	active: boolean;
	/** Ring color */
	color?: "cyan" | "green" | "amber" | "red";
	/** Size of the ring */
	size?: "sm" | "md" | "lg";
	className?: string;
}

/**
 * Expanding ring animation for indicating live updates.
 * Place behind content that receives real-time data.
 */
export function PulseRing({ active, color = "cyan", size = "md", className }: PulseRingProps) {
	if (!active) return null;

	const sizeClasses = {
		sm: "h-4 w-4",
		md: "h-8 w-8",
		lg: "h-12 w-12",
	};

	const colorClasses = {
		cyan: "pulse-ring-cyan",
		green: "pulse-ring-green",
		amber: "pulse-ring-amber",
		red: "pulse-ring-red",
	};

	return (
		<span
			className={cn("absolute rounded-full", sizeClasses[size], colorClasses[color], className)}
		/>
	);
}
