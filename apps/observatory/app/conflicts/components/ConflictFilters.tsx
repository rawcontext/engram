"use client";

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

interface ConflictFiltersProps {
	status: string | null;
	project: string | null;
	onStatusChange: (status: string | null) => void;
	onProjectChange: (project: string | null) => void;
	stats?: {
		pending: number;
		confirmed: number;
		dismissed: number;
		autoResolved: number;
	};
}

const statusOptions = [
	{ value: null, label: "All", key: "all" },
	{ value: "pending_review", label: "Pending", key: "pending" },
	{ value: "confirmed", label: "Confirmed", key: "confirmed" },
	{ value: "dismissed", label: "Dismissed", key: "dismissed" },
	{ value: "auto_resolved", label: "Auto-Resolved", key: "autoResolved" },
];

export function ConflictFilters({
	status,
	project,
	onStatusChange,
	onProjectChange,
	stats,
}: ConflictFiltersProps) {
	const [projectInput, setProjectInput] = useState(project || "");

	const handleProjectSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		onProjectChange(projectInput || null);
	};

	const getCount = (key: string): number => {
		if (!stats) return 0;
		if (key === "all") {
			return stats.pending + stats.confirmed + stats.dismissed + stats.autoResolved;
		}
		return stats[key as keyof typeof stats] || 0;
	};

	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				gap: spacing[4],
				marginBottom: spacing[6],
			}}
		>
			{/* Status Filter */}
			<div>
				<div
					style={{
						fontFamily: fonts.display,
						fontSize: fontSizes.xs,
						color: colors.slate[400],
						letterSpacing: "0.1em",
						marginBottom: spacing[2],
					}}
				>
					STATUS
				</div>
				<div style={{ display: "flex", gap: spacing[2], flexWrap: "wrap" }}>
					{statusOptions.map((option) => (
						<FilterButton
							key={option.key}
							label={option.label}
							count={getCount(option.key)}
							isActive={status === option.value}
							onClick={() => onStatusChange(option.value)}
						/>
					))}
				</div>
			</div>

			{/* Project Filter */}
			<div>
				<div
					style={{
						fontFamily: fonts.display,
						fontSize: fontSizes.xs,
						color: colors.slate[400],
						letterSpacing: "0.1em",
						marginBottom: spacing[2],
					}}
				>
					PROJECT
				</div>
				<form
					onSubmit={handleProjectSubmit}
					style={{ display: "flex", gap: spacing[2], alignItems: "center" }}
				>
					<input
						type="text"
						value={projectInput}
						onChange={(e) => setProjectInput(e.target.value)}
						placeholder="Filter by project..."
						style={{
							flex: 1,
							maxWidth: "300px",
							padding: `${spacing[2]} ${spacing[3]}`,
							fontFamily: fonts.mono,
							fontSize: fontSizes.sm,
							color: colors.slate[300],
							background: colors.bg.glass,
							border: `1px solid ${colors.slate[600]}33`,
							borderRadius: radii.lg,
							outline: "none",
							transition: transitions.default,
						}}
					/>
					{project && (
						<button
							type="button"
							onClick={() => {
								setProjectInput("");
								onProjectChange(null);
							}}
							style={{
								padding: `${spacing[2]} ${spacing[3]}`,
								fontFamily: fonts.mono,
								fontSize: fontSizes.xs,
								color: colors.slate[400],
								background: "transparent",
								border: `1px solid ${colors.slate[600]}33`,
								borderRadius: radii.lg,
								cursor: "pointer",
								transition: transitions.default,
							}}
						>
							Clear
						</button>
					)}
				</form>
			</div>

			{/* Stats Summary */}
			{stats && (
				<div
					style={{
						display: "flex",
						gap: spacing[4],
						padding: spacing[3],
						background: colors.bg.glass,
						borderRadius: radii.lg,
						border: `1px solid ${colors.slate[600]}33`,
					}}
				>
					<StatItem label="Pending Review" value={stats.pending} variant="amber" />
					<StatItem label="Confirmed" value={stats.confirmed} variant="green" />
					<StatItem label="Dismissed" value={stats.dismissed} variant="slate" />
					<StatItem label="Auto-Resolved" value={stats.autoResolved} variant="cyan" />
				</div>
			)}
		</div>
	);
}

interface FilterButtonProps {
	label: string;
	count: number;
	isActive: boolean;
	onClick: () => void;
}

function FilterButton({ label, count, isActive, onClick }: FilterButtonProps) {
	const [isHovered, setIsHovered] = useState(false);

	return (
		<button
			type="button"
			onClick={onClick}
			onMouseEnter={() => setIsHovered(true)}
			onMouseLeave={() => setIsHovered(false)}
			style={{
				display: "flex",
				alignItems: "center",
				gap: spacing[2],
				padding: `${spacing[2]} ${spacing[3]}`,
				fontFamily: fonts.display,
				fontSize: fontSizes.sm,
				letterSpacing: "0.05em",
				color: isActive ? colors.cyan.DEFAULT : colors.slate[400],
				background: isActive
					? colors.cyan.subtle
					: isHovered
						? `${colors.slate[500]}10`
						: "transparent",
				border: `1px solid ${isActive ? colors.cyan.border : colors.slate[600]}33`,
				borderRadius: radii.lg,
				cursor: "pointer",
				transition: transitions.default,
			}}
		>
			{label}
			<Badge variant={isActive ? "cyan" : "slate"} size="sm">
				{count}
			</Badge>
		</button>
	);
}

interface StatItemProps {
	label: string;
	value: number;
	variant: "amber" | "green" | "cyan" | "slate";
}

function StatItem({ label, value, variant }: StatItemProps) {
	const colorMap = {
		amber: colors.amber.DEFAULT,
		green: colors.green.DEFAULT,
		cyan: colors.cyan.DEFAULT,
		slate: colors.slate[400],
	};

	return (
		<div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
			<span
				style={{
					fontFamily: fonts.display,
					fontSize: fontSizes["2xl"],
					color: colorMap[variant],
					fontWeight: 600,
				}}
			>
				{value}
			</span>
			<span
				style={{
					fontFamily: fonts.mono,
					fontSize: fontSizes.xs,
					color: colors.slate[500],
				}}
			>
				{label}
			</span>
		</div>
	);
}

export default ConflictFilters;
