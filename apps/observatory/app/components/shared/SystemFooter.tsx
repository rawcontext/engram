"use client";

import { useState } from "react";
import { useConsumerStatus } from "../../hooks/useConsumerStatus";
import { colors, fonts, spacing } from "./design-tokens";

const FOOTER_HEIGHT = 48;

interface ConsumerGroupTooltipProps {
	groups: Array<{
		groupId: string;
		stateName: string;
		memberCount: number;
		isReady: boolean;
	}>;
	visible: boolean;
}

function ConsumerGroupTooltip({ groups, visible }: ConsumerGroupTooltipProps) {
	if (!visible || groups.length === 0) return null;

	return (
		<div
			style={{
				position: "absolute",
				bottom: "calc(100% + 8px)",
				left: "50%",
				transform: "translateX(-50%)",
				background: "rgba(15, 20, 30, 0.98)",
				border: `1px solid ${colors.slate[700]}`,
				borderRadius: "8px",
				padding: spacing[3],
				minWidth: "240px",
				boxShadow: "0 8px 32px rgba(0, 0, 0, 0.5)",
				zIndex: 100,
				animation: "fadeIn 0.2s ease-out",
			}}
		>
			<div
				style={{
					fontFamily: fonts.display,
					fontSize: "10px",
					fontWeight: 600,
					letterSpacing: "0.1em",
					color: colors.slate[400],
					marginBottom: spacing[2],
					textTransform: "uppercase",
				}}
			>
				Consumer Groups
			</div>

			<div style={{ display: "flex", flexDirection: "column", gap: spacing[2] }}>
				{groups.map((group) => (
					<div
						key={group.groupId}
						style={{
							display: "flex",
							alignItems: "center",
							justifyContent: "space-between",
							gap: spacing[3],
						}}
					>
						<div style={{ display: "flex", alignItems: "center", gap: spacing[2] }}>
							<span
								style={{
									width: "6px",
									height: "6px",
									borderRadius: "50%",
									backgroundColor: group.isReady
										? colors.green.DEFAULT
										: group.stateName === "UNKNOWN"
											? colors.slate[500]
											: colors.amber.DEFAULT,
									boxShadow: group.isReady ? `0 0 6px ${colors.green.glow}` : "none",
									flexShrink: 0,
								}}
							/>
							<span
								style={{
									fontFamily: fonts.mono,
									fontSize: "11px",
									color: colors.slate[300],
								}}
							>
								{group.groupId.replace("-group", "")}
							</span>
						</div>
						<div style={{ display: "flex", alignItems: "center", gap: spacing[2] }}>
							<span
								style={{
									fontFamily: fonts.mono,
									fontSize: "10px",
									color: colors.slate[500],
								}}
							>
								{group.memberCount} member{group.memberCount !== 1 ? "s" : ""}
							</span>
							<span
								style={{
									fontFamily: fonts.mono,
									fontSize: "9px",
									padding: "2px 4px",
									borderRadius: "3px",
									backgroundColor: group.isReady
										? colors.green.subtle
										: group.stateName === "UNKNOWN"
											? colors.slate[800]
											: colors.amber.subtle,
									color: group.isReady
										? colors.green.DEFAULT
										: group.stateName === "UNKNOWN"
											? colors.slate[500]
											: colors.amber.DEFAULT,
									fontWeight: 500,
								}}
							>
								{group.stateName}
							</span>
						</div>
					</div>
				))}
			</div>

			{/* Arrow pointing down */}
			<div
				style={{
					position: "absolute",
					bottom: "-6px",
					left: "50%",
					transform: "translateX(-50%) rotate(45deg)",
					width: "10px",
					height: "10px",
					background: "rgba(15, 20, 30, 0.98)",
					borderRight: `1px solid ${colors.slate[700]}`,
					borderBottom: `1px solid ${colors.slate[700]}`,
				}}
			/>

			<style>{`
				@keyframes fadeIn {
					from { opacity: 0; transform: translateX(-50%) translateY(4px); }
					to { opacity: 1; transform: translateX(-50%) translateY(0); }
				}
			`}</style>
		</div>
	);
}

export function SystemFooter() {
	const { data: consumerStatus, isConnected } = useConsumerStatus();
	const [showTooltip, setShowTooltip] = useState(false);

	// Determine overall system status based on consumer groups
	const allReady = consumerStatus?.allReady ?? false;
	const readyCount = consumerStatus?.readyCount ?? 0;
	const totalCount = consumerStatus?.totalCount ?? 0;

	// Status determination
	const getStatusInfo = () => {
		if (!isConnected) {
			return {
				color: colors.slate[500],
				glow: "none",
				label: "Connecting...",
				ready: "INIT",
				readyColor: colors.slate[500],
			};
		}

		if (!consumerStatus) {
			return {
				color: colors.slate[500],
				glow: "none",
				label: "Checking...",
				ready: "INIT",
				readyColor: colors.slate[500],
			};
		}

		if (allReady) {
			return {
				color: colors.green.DEFAULT,
				glow: `0 0 8px ${colors.green.glow}`,
				label: "System Online",
				ready: "READY",
				readyColor: colors.green.DEFAULT,
			};
		}

		if (readyCount > 0) {
			return {
				color: colors.amber.DEFAULT,
				glow: `0 0 8px ${colors.amber.glow}`,
				label: `${readyCount}/${totalCount} Consumers`,
				ready: "PARTIAL",
				readyColor: colors.amber.DEFAULT,
			};
		}

		return {
			color: colors.red.DEFAULT,
			glow: `0 0 8px ${colors.red.glow}`,
			label: "Consumers Offline",
			ready: "WAIT",
			readyColor: colors.red.DEFAULT,
		};
	};

	const status = getStatusInfo();

	return (
		<footer
			style={{
				position: "fixed",
				bottom: 0,
				left: 0,
				right: 0,
				height: `${FOOTER_HEIGHT}px`,
				zIndex: 50,
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				gap: "16px",
				fontSize: "11px",
				fontFamily: fonts.mono,
				color: colors.slate[500],
				backgroundColor: "rgb(8, 10, 15)",
				borderTop: `1px solid ${colors.slate[800]}`,
				boxShadow: "inset 0 1px 0 rgba(255,255,255,0.02), 0 -4px 20px rgba(0,0,0,0.5)",
			}}
		>
			{/* Gradient accent line at top */}
			<div
				style={{
					position: "absolute",
					top: 0,
					left: "50%",
					transform: "translateX(-50%)",
					width: "200px",
					height: "1px",
					background: "linear-gradient(90deg, transparent, rgba(251,191,36,0.4), transparent)",
				}}
			/>

			{/* Status indicator with tooltip */}
			<span
				style={{
					position: "relative",
					display: "flex",
					alignItems: "center",
					gap: "8px",
					cursor: "pointer",
				}}
				onMouseEnter={() => setShowTooltip(true)}
				onMouseLeave={() => setShowTooltip(false)}
			>
				<ConsumerGroupTooltip groups={consumerStatus?.groups ?? []} visible={showTooltip} />
				<span
					style={{
						width: "6px",
						height: "6px",
						borderRadius: "50%",
						backgroundColor: status.color,
						boxShadow: status.glow,
						animation: allReady ? "pulse 2s ease-in-out infinite" : "none",
					}}
				/>
				<span style={{ letterSpacing: "0.05em" }}>{status.label}</span>
			</span>

			<span style={{ color: colors.slate[700] }}>|</span>
			<span style={{ opacity: 0.7 }}>v1.0.0</span>
			<span style={{ color: colors.slate[700] }}>|</span>

			{/* Ready status */}
			<span
				style={{
					letterSpacing: "0.15em",
					color: status.readyColor,
					fontWeight: 500,
				}}
			>
				{status.ready}
			</span>

			{/* Keyframes for pulse animation */}
			<style>{`
				@keyframes pulse {
					0%, 100% { opacity: 1; transform: scale(1); }
					50% { opacity: 0.6; transform: scale(0.9); }
				}
			`}</style>
		</footer>
	);
}

export default SystemFooter;
