"use client";

import { useId, useMemo } from "react";
import { colors, fonts, radii, shadows, spacing } from "./design-tokens";

export type LoadingVariant = "spinner" | "neural" | "skeleton" | "dots";

interface LoadingStateProps {
	/**
	 * Visual variant of the loading state
	 * - spinner: Simple spinning loader
	 * - neural: Animated neural/brain loader (default)
	 * - skeleton: Placeholder skeleton cards
	 * - dots: Animated dots
	 */
	variant?: LoadingVariant;
	/**
	 * Loading message to display
	 */
	message?: string;
	/**
	 * Secondary message
	 */
	subMessage?: string;
	/**
	 * Number of skeleton cards (only for skeleton variant)
	 */
	skeletonCount?: number;
	/**
	 * Size of the loader (small, medium, large)
	 */
	size?: "sm" | "md" | "lg";
	/**
	 * Additional CSS class name
	 */
	className?: string;
}

// Size configurations
const sizeConfig = {
	sm: { container: 40, ring: 3 },
	md: { container: 60, ring: 4 },
	lg: { container: 80, ring: 5 },
};

/**
 * Neural-style animated loader
 */
function NeuralLoader({
	size = "md",
	message,
	subMessage,
}: {
	size?: "sm" | "md" | "lg";
	message?: string;
	subMessage?: string;
}) {
	const { container } = sizeConfig[size];

	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				alignItems: "center",
				justifyContent: "center",
				height: "100%",
				gap: spacing[5],
				padding: spacing[10],
			}}
		>
			{/* Animated neural loader */}
			<div style={{ position: "relative", width: `${container}px`, height: `${container}px` }}>
				{[0, 1, 2].map((i) => (
					<div
						key={i}
						style={{
							position: "absolute",
							inset: `${i * 8}px`,
							border: "2px solid transparent",
							borderTopColor: `rgba(251, 191, 36, ${0.8 - i * 0.25})`,
							borderRadius: radii.full,
							animation: `neuralSpin ${1.2 + i * 0.3}s linear infinite ${i % 2 === 0 ? "" : "reverse"}`,
						}}
					/>
				))}
				<div
					style={{
						position: "absolute",
						top: "50%",
						left: "50%",
						transform: "translate(-50%, -50%)",
						width: "8px",
						height: "8px",
						borderRadius: radii.full,
						background: colors.amber.DEFAULT,
						boxShadow: shadows.glow.amber,
						animation: "neuralPulse 1.5s ease-in-out infinite",
					}}
				/>
			</div>

			{(message || subMessage) && (
				<div style={{ textAlign: "center" }}>
					{message && (
						<p
							style={{
								fontFamily: fonts.display,
								fontSize: "12px",
								fontWeight: 600,
								letterSpacing: "0.2em",
								color: colors.amber.DEFAULT,
								marginBottom: subMessage ? spacing[2] : 0,
								margin: 0,
							}}
						>
							{message}
						</p>
					)}
					{subMessage && (
						<p
							style={{
								fontFamily: fonts.mono,
								fontSize: "10px",
								color: colors.slate[500],
								margin: 0,
							}}
						>
							{subMessage}
						</p>
					)}
				</div>
			)}

			<style>{`
				@keyframes neuralSpin {
					from { transform: rotate(0deg); }
					to { transform: rotate(360deg); }
				}
				@keyframes neuralPulse {
					0%, 100% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
					50% { opacity: 0.5; transform: translate(-50%, -50%) scale(1.3); }
				}
			`}</style>
		</div>
	);
}

/**
 * Simple spinning loader
 */
function SpinnerLoader({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
	const sizes = { sm: 16, md: 24, lg: 32 };
	const s = sizes[size];

	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				height: "100%",
			}}
		>
			<div
				style={{
					width: `${s}px`,
					height: `${s}px`,
					border: `2px solid ${colors.cyan.subtle}`,
					borderTopColor: colors.cyan.DEFAULT,
					borderRadius: radii.full,
					animation: "spinnerSpin 0.8s linear infinite",
				}}
			/>
			<style>{`
				@keyframes spinnerSpin {
					from { transform: rotate(0deg); }
					to { transform: rotate(360deg); }
				}
			`}</style>
		</div>
	);
}

/**
 * Animated dots loader
 */
function DotsLoader({ message }: { message?: string }) {
	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				alignItems: "center",
				justifyContent: "center",
				gap: spacing[3],
			}}
		>
			<div style={{ display: "flex", gap: spacing[2] }}>
				{[0, 1, 2].map((i) => (
					<div
						key={i}
						style={{
							width: "8px",
							height: "8px",
							borderRadius: radii.full,
							background: colors.amber.DEFAULT,
							animation: `dotsBounce 1.4s ease-in-out ${i * 0.16}s infinite both`,
						}}
					/>
				))}
			</div>
			{message && (
				<span
					style={{
						fontFamily: fonts.mono,
						fontSize: "11px",
						color: colors.slate[400],
						letterSpacing: "0.05em",
					}}
				>
					{message}
				</span>
			)}
			<style>{`
				@keyframes dotsBounce {
					0%, 80%, 100% { transform: scale(0.6); opacity: 0.5; }
					40% { transform: scale(1); opacity: 1; }
				}
			`}</style>
		</div>
	);
}

/**
 * Skeleton card for loading placeholders
 */
export function SkeletonCard({ index = 0, className }: { index?: number; className?: string }) {
	return (
		<div
			className={className}
			style={{
				display: "flex",
				flexDirection: "column",
				padding: `${spacing[4]} ${spacing[4]}`,
				background: colors.bg.glass,
				border: `1px solid ${colors.slate[600]}33`,
				borderRadius: radii.xl,
				minHeight: "120px",
				animation: `skeletonReveal 0.4s cubic-bezier(0.4, 0, 0.2, 1) ${index * 0.05}s both`,
			}}
		>
			{/* Type badge skeleton */}
			<div
				style={{
					width: "70px",
					height: "20px",
					backgroundColor: `${colors.slate[500]}1a`,
					borderRadius: radii.sm,
					marginBottom: spacing[3],
					animation: "skeletonPulse 1.5s ease-in-out infinite",
				}}
			/>

			{/* Content skeleton */}
			<div style={{ flex: 1 }}>
				<div
					style={{
						width: "100%",
						height: "12px",
						backgroundColor: `${colors.slate[500]}1a`,
						borderRadius: "2px",
						marginBottom: spacing[2],
						animation: "skeletonPulse 1.5s ease-in-out infinite",
						animationDelay: "0.1s",
					}}
				/>
				<div
					style={{
						width: "70%",
						height: "12px",
						backgroundColor: `${colors.slate[500]}1a`,
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
					backgroundColor: `${colors.slate[500]}1a`,
					borderRadius: "2px",
					animation: "skeletonPulse 1.5s ease-in-out infinite",
					animationDelay: "0.3s",
				}}
			/>

			<style>{`
				@keyframes skeletonPulse {
					0%, 100% { opacity: 0.3; }
					50% { opacity: 0.6; }
				}
				@keyframes skeletonReveal {
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

/**
 * Skeleton grid for loading multiple items
 */
function SkeletonLoader({ count = 6 }: { count?: number }) {
	const baseId = useId();
	const skeletonKeys = useMemo(
		() => Array.from({ length: count }, (_, idx) => `${baseId}-skeleton-${idx}`),
		[baseId, count],
	);
	return (
		<div
			style={{
				display: "grid",
				gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
				gap: spacing[3],
				padding: spacing[4],
			}}
		>
			{skeletonKeys.map((key, index) => (
				<SkeletonCard key={key} index={index} />
			))}
		</div>
	);
}

export function LoadingState({
	variant = "neural",
	message,
	subMessage,
	skeletonCount = 6,
	size = "md",
	className,
}: LoadingStateProps) {
	const defaultMessages = {
		spinner: undefined,
		neural: { message: "SYNCHRONIZING", subMessage: "Establishing neural link..." },
		skeleton: undefined,
		dots: { message: "Loading..." },
	};

	const displayMessage = message ?? defaultMessages[variant]?.message;
	const displaySubMessage = subMessage ?? defaultMessages[variant]?.subMessage;

	return (
		<div className={className} style={{ height: "100%", width: "100%" }}>
			{variant === "neural" && (
				<NeuralLoader size={size} message={displayMessage} subMessage={displaySubMessage} />
			)}
			{variant === "spinner" && <SpinnerLoader size={size} />}
			{variant === "dots" && <DotsLoader message={displayMessage} />}
			{variant === "skeleton" && <SkeletonLoader count={skeletonCount} />}
		</div>
	);
}

export default LoadingState;
