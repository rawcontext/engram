"use client";

import type { ConflictWithMemories } from "@lib/conflict-queries";
import { useState } from "react";
import { Badge } from "../../components/shared/Badge";
import {
	colors,
	fontSizes,
	fonts,
	radii,
	spacing,
	transitions,
} from "../../components/shared/design-tokens";
import { Card } from "../../components/shared/GlassPanel";

interface ConflictCardProps {
	conflict: ConflictWithMemories;
	onResolve: (id: string, action: string) => void;
	onDismiss: (id: string) => void;
	isLoading?: boolean;
}

type BadgeVariant = "red" | "amber" | "violet" | "cyan" | "slate";
type CardAccent = "amber" | "cyan" | "green" | "violet" | "none";

const relationLabels: Record<
	string,
	{ label: string; badgeVariant: BadgeVariant; cardAccent: CardAccent }
> = {
	contradiction: { label: "CONTRADICTION", badgeVariant: "red", cardAccent: "none" },
	supersedes: { label: "SUPERSEDES", badgeVariant: "amber", cardAccent: "amber" },
	augments: { label: "AUGMENTS", badgeVariant: "cyan", cardAccent: "cyan" },
	duplicate: { label: "DUPLICATE", badgeVariant: "violet", cardAccent: "violet" },
	independent: { label: "INDEPENDENT", badgeVariant: "slate", cardAccent: "none" },
};

const actionLabels: Record<string, string> = {
	invalidate_a: "Invalidate Memory A",
	invalidate_b: "Invalidate Memory B",
	keep_both: "Keep Both",
	merge: "Merge",
};

export function ConflictCard({ conflict, onResolve, onDismiss, isLoading }: ConflictCardProps) {
	const [isHovered, setIsHovered] = useState(false);
	const [showActions, setShowActions] = useState(false);

	const relationInfo = relationLabels[conflict.relation] || {
		label: conflict.relation.toUpperCase(),
		badgeVariant: "slate" as const,
		cardAccent: "none" as const,
	};
	const formattedDate = new Date(conflict.scannedAt).toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});

	const confidencePercent = Math.round(conflict.confidence * 100);

	return (
		<div
			onMouseEnter={() => setIsHovered(true)}
			onMouseLeave={() => setIsHovered(false)}
			style={{ marginBottom: spacing[4] }}
		>
			<Card accentColor={relationInfo.cardAccent} isHovered={isHovered}>
				{/* Header */}
				<div
					style={{
						display: "flex",
						justifyContent: "space-between",
						alignItems: "flex-start",
						marginBottom: spacing[4],
					}}
				>
					<div style={{ display: "flex", alignItems: "center", gap: spacing[3] }}>
						<Badge variant={relationInfo.badgeVariant} size="md" displayFont>
							{relationInfo.label}
						</Badge>
						<span
							style={{
								fontFamily: fonts.mono,
								fontSize: fontSizes.sm,
								color: colors.slate[400],
							}}
						>
							{confidencePercent}% confidence
						</span>
					</div>
					<span
						style={{
							fontFamily: fonts.mono,
							fontSize: fontSizes.xs,
							color: colors.slate[500],
						}}
					>
						{formattedDate}
					</span>
				</div>

				{/* Memory Comparison */}
				<div
					style={{
						display: "grid",
						gridTemplateColumns: "1fr 1fr",
						gap: spacing[4],
						marginBottom: spacing[4],
					}}
				>
					<MemoryPanel
						label="Memory A"
						memory={conflict.memoryA}
						memoryId={conflict.memoryIdA}
						variant="amber"
					/>
					<MemoryPanel
						label="Memory B"
						memory={conflict.memoryB}
						memoryId={conflict.memoryIdB}
						variant="cyan"
					/>
				</div>

				{/* Reasoning */}
				<div
					style={{
						background: colors.bg.glass,
						borderRadius: radii.lg,
						padding: spacing[3],
						marginBottom: spacing[4],
					}}
				>
					<div
						style={{
							fontFamily: fonts.display,
							fontSize: fontSizes.xs,
							color: colors.slate[400],
							letterSpacing: "0.1em",
							marginBottom: spacing[2],
						}}
					>
						AI REASONING
					</div>
					<p
						style={{
							fontFamily: fonts.mono,
							fontSize: fontSizes.sm,
							color: colors.slate[300],
							lineHeight: 1.6,
							margin: 0,
						}}
					>
						{conflict.reasoning}
					</p>
				</div>

				{/* Suggested Action */}
				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: spacing[2],
						marginBottom: spacing[4],
					}}
				>
					<span
						style={{
							fontFamily: fonts.mono,
							fontSize: fontSizes.xs,
							color: colors.slate[500],
						}}
					>
						Suggested:
					</span>
					<Badge variant="violet" size="sm">
						{actionLabels[conflict.suggestedAction] || conflict.suggestedAction}
					</Badge>
				</div>

				{/* Actions */}
				{!showActions ? (
					<button
						type="button"
						onClick={() => setShowActions(true)}
						disabled={isLoading}
						style={{
							width: "100%",
							padding: `${spacing[3]} ${spacing[4]}`,
							fontFamily: fonts.display,
							fontSize: fontSizes.sm,
							letterSpacing: "0.05em",
							color: colors.cyan.DEFAULT,
							background: colors.cyan.subtle,
							border: `1px solid ${colors.cyan.border}`,
							borderRadius: radii.lg,
							cursor: isLoading ? "wait" : "pointer",
							transition: transitions.default,
							opacity: isLoading ? 0.6 : 1,
						}}
					>
						{isLoading ? "PROCESSING..." : "REVIEW & RESOLVE"}
					</button>
				) : (
					<div style={{ display: "flex", flexDirection: "column", gap: spacing[2] }}>
						<div
							style={{
								fontFamily: fonts.display,
								fontSize: fontSizes.xs,
								color: colors.slate[400],
								letterSpacing: "0.1em",
								marginBottom: spacing[1],
							}}
						>
							CHOOSE ACTION
						</div>
						<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: spacing[2] }}>
							<ActionButton
								label="Invalidate A"
								description="Keep Memory B"
								variant="amber"
								onClick={() => onResolve(conflict.id, "invalidate_a")}
								disabled={isLoading}
							/>
							<ActionButton
								label="Invalidate B"
								description="Keep Memory A"
								variant="cyan"
								onClick={() => onResolve(conflict.id, "invalidate_b")}
								disabled={isLoading}
							/>
							<ActionButton
								label="Keep Both"
								description="No changes"
								variant="green"
								onClick={() => onResolve(conflict.id, "keep_both")}
								disabled={isLoading}
							/>
							<ActionButton
								label="Dismiss"
								description="False positive"
								variant="slate"
								onClick={() => onDismiss(conflict.id)}
								disabled={isLoading}
							/>
						</div>
						<button
							type="button"
							onClick={() => setShowActions(false)}
							style={{
								marginTop: spacing[2],
								padding: spacing[2],
								fontFamily: fonts.mono,
								fontSize: fontSizes.xs,
								color: colors.slate[500],
								background: "transparent",
								border: "none",
								cursor: "pointer",
							}}
						>
							Cancel
						</button>
					</div>
				)}
			</Card>
		</div>
	);
}

interface MemoryPanelProps {
	label: string;
	memory?: { id: string; content: string; type: string; tags: string[] };
	memoryId: string;
	variant: "amber" | "cyan";
}

function MemoryPanel({ label, memory, memoryId, variant }: MemoryPanelProps) {
	const accentColor = variant === "amber" ? colors.amber : colors.cyan;

	return (
		<div
			style={{
				background: `linear-gradient(135deg, ${accentColor.subtle} 0%, ${colors.bg.glass} 100%)`,
				borderRadius: radii.lg,
				padding: spacing[3],
				border: `1px solid ${accentColor.border}`,
			}}
		>
			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "center",
					marginBottom: spacing[2],
				}}
			>
				<span
					style={{
						fontFamily: fonts.display,
						fontSize: fontSizes.xs,
						color: accentColor.DEFAULT,
						letterSpacing: "0.1em",
					}}
				>
					{label}
				</span>
				{memory && (
					<Badge variant={variant} size="sm">
						{memory.type}
					</Badge>
				)}
			</div>
			{memory ? (
				<>
					<p
						style={{
							fontFamily: fonts.mono,
							fontSize: fontSizes.sm,
							color: colors.slate[300],
							lineHeight: 1.6,
							margin: 0,
							maxHeight: "120px",
							overflow: "auto",
						}}
					>
						{memory.content}
					</p>
					{memory.tags.length > 0 && (
						<div
							style={{ display: "flex", gap: spacing[1], marginTop: spacing[2], flexWrap: "wrap" }}
						>
							{memory.tags.slice(0, 5).map((tag) => (
								<Badge key={tag} variant="slate" size="sm">
									{tag}
								</Badge>
							))}
						</div>
					)}
				</>
			) : (
				<p
					style={{
						fontFamily: fonts.mono,
						fontSize: fontSizes.sm,
						color: colors.slate[500],
						fontStyle: "italic",
						margin: 0,
					}}
				>
					Memory not found (ID: {memoryId.slice(0, 8)}...)
				</p>
			)}
		</div>
	);
}

interface ActionButtonProps {
	label: string;
	description: string;
	variant: "amber" | "cyan" | "green" | "violet" | "slate";
	onClick: () => void;
	disabled?: boolean;
}

function ActionButton({ label, description, variant, onClick, disabled }: ActionButtonProps) {
	const [isHovered, setIsHovered] = useState(false);

	const colorConfig = {
		amber: colors.amber,
		cyan: colors.cyan,
		green: colors.green,
		violet: colors.violet,
		slate: {
			DEFAULT: colors.slate[400],
			subtle: `${colors.slate[500]}15`,
			border: `${colors.slate[500]}25`,
			glow: "none",
		},
	};

	const color = colorConfig[variant];

	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			onMouseEnter={() => setIsHovered(true)}
			onMouseLeave={() => setIsHovered(false)}
			style={{
				display: "flex",
				flexDirection: "column",
				alignItems: "center",
				padding: spacing[3],
				fontFamily: fonts.display,
				fontSize: fontSizes.sm,
				color: color.DEFAULT,
				background: isHovered ? color.subtle : "transparent",
				border: `1px solid ${isHovered ? color.border : `${colors.slate[600]}33`}`,
				borderRadius: radii.lg,
				cursor: disabled ? "wait" : "pointer",
				transition: transitions.default,
				opacity: disabled ? 0.5 : 1,
			}}
		>
			<span style={{ letterSpacing: "0.05em" }}>{label}</span>
			<span
				style={{
					fontFamily: fonts.mono,
					fontSize: fontSizes.xs,
					color: colors.slate[500],
					marginTop: spacing[1],
				}}
			>
				{description}
			</span>
		</button>
	);
}

export default ConflictCard;
