"use client";

import { Title } from "@tremor/react";
import {
	AlertTriangle,
	ArrowUp,
	CheckCircle2,
	Database,
	Gauge,
	Layers,
	Network,
	Radio,
	Search,
	Server,
	Workflow,
} from "lucide-react";
import Link from "next/link";

interface VersionInfo {
	service: string;
	icon: typeof Server;
	current: string;
	latest: string;
	status: "current" | "update" | "outdated";
	type: "app" | "infra";
}

// Simulated version data
const VERSION_DATA: VersionInfo[] = [
	{
		service: "API",
		icon: Server,
		current: "v1.2.3",
		latest: "v1.2.3",
		status: "current",
		type: "app",
	},
	{
		service: "Ingestion",
		icon: Workflow,
		current: "v1.1.0",
		latest: "v1.1.2",
		status: "update",
		type: "app",
	},
	{
		service: "Search",
		icon: Search,
		current: "v2.1.0",
		latest: "v2.2.1",
		status: "update",
		type: "app",
	},
	{
		service: "Tuner",
		icon: Gauge,
		current: "v0.9.5",
		latest: "v0.9.5",
		status: "current",
		type: "app",
	},
	{
		service: "Observatory",
		icon: Radio,
		current: "v1.0.0",
		latest: "v1.0.0",
		status: "current",
		type: "app",
	},
	{
		service: "FalkorDB",
		icon: Network,
		current: "v4.0.1",
		latest: "v4.0.1",
		status: "current",
		type: "infra",
	},
	{
		service: "Qdrant",
		icon: Layers,
		current: "v1.7.4",
		latest: "v1.8.0",
		status: "update",
		type: "infra",
	},
	{
		service: "NATS",
		icon: Radio,
		current: "v2.10.5",
		latest: "v2.10.5",
		status: "current",
		type: "infra",
	},
	{
		service: "PostgreSQL",
		icon: Database,
		current: "v15.4",
		latest: "v16.1",
		status: "outdated",
		type: "infra",
	},
];

function StatusBadge({ status }: { status: VersionInfo["status"] }) {
	switch (status) {
		case "current":
			return (
				<div className="flex items-center gap-1.5">
					<CheckCircle2 className="w-3.5 h-3.5 text-[rgb(var(--console-green))]" />
					<span className="text-xs font-mono text-[rgb(var(--console-green))]">Current</span>
				</div>
			);
		case "update":
			return (
				<div className="flex items-center gap-1.5">
					<ArrowUp className="w-3.5 h-3.5 text-[rgb(var(--console-amber))]" />
					<span className="text-xs font-mono text-[rgb(var(--console-amber))]">Update</span>
				</div>
			);
		case "outdated":
			return (
				<div className="flex items-center gap-1.5">
					<AlertTriangle className="w-3.5 h-3.5 text-[rgb(var(--console-red))]" />
					<span className="text-xs font-mono text-[rgb(var(--console-red))]">Outdated</span>
				</div>
			);
	}
}

function VersionRow({ info }: { info: VersionInfo }) {
	const Icon = info.icon;
	const needsUpdate = info.status !== "current";

	return (
		<Link
			href={`/services/${info.service.toLowerCase()}`}
			className="grid grid-cols-[1fr_100px_100px_90px] items-center py-2.5 px-3 -mx-3 rounded-md hover:bg-[rgb(var(--console-surface))] transition-colors group"
		>
			{/* Service Name */}
			<div className="flex items-center gap-2.5">
				<Icon className="w-4 h-4 text-[rgb(var(--text-dim))] group-hover:text-[rgb(var(--console-cyan))] transition-colors" />
				<span className="text-sm text-[rgb(var(--text-primary))] group-hover:text-[rgb(var(--console-cyan))] transition-colors">
					{info.service}
				</span>
				<span className="text-[10px] uppercase tracking-wider text-[rgb(var(--text-dim))]">
					{info.type}
				</span>
			</div>

			{/* Current Version */}
			<div className="font-mono text-xs text-[rgb(var(--text-secondary))] tabular-nums">
				{info.current}
			</div>

			{/* Latest Version */}
			<div
				className={`font-mono text-xs tabular-nums ${needsUpdate ? "text-[rgb(var(--console-cyan))]" : "text-[rgb(var(--text-dim))]"}`}
			>
				{info.latest}
			</div>

			{/* Status */}
			<div className="flex justify-end">
				<StatusBadge status={info.status} />
			</div>
		</Link>
	);
}

export interface VersionMatrixProps {
	/** Show title header */
	showHeader?: boolean;
	/** Filter by service type */
	filterType?: "all" | "app" | "infra";
}

export function VersionMatrix({ showHeader = true, filterType = "all" }: VersionMatrixProps) {
	const filteredData =
		filterType === "all" ? VERSION_DATA : VERSION_DATA.filter((v) => v.type === filterType);

	const stats = {
		current: filteredData.filter((v) => v.status === "current").length,
		update: filteredData.filter((v) => v.status === "update").length,
		outdated: filteredData.filter((v) => v.status === "outdated").length,
	};

	return (
		<div className="panel p-5">
			{showHeader && (
				<div className="flex items-center justify-between mb-4">
					<Title className="!text-[rgb(var(--text-primary))] !font-display">Version Matrix</Title>
					<div className="flex items-center gap-4 text-xs font-mono">
						<span className="text-[rgb(var(--console-green))]">{stats.current} current</span>
						{stats.update > 0 && (
							<span className="text-[rgb(var(--console-amber))]">{stats.update} updates</span>
						)}
						{stats.outdated > 0 && (
							<span className="text-[rgb(var(--console-red))]">{stats.outdated} outdated</span>
						)}
					</div>
				</div>
			)}

			{/* Table Header */}
			<div className="grid grid-cols-[1fr_100px_100px_90px] items-center py-2 px-3 -mx-3 border-b border-[rgb(var(--console-surface))] mb-1">
				<span className="text-[10px] uppercase tracking-wider text-[rgb(var(--text-dim))]">
					Service
				</span>
				<span className="text-[10px] uppercase tracking-wider text-[rgb(var(--text-dim))]">
					Current
				</span>
				<span className="text-[10px] uppercase tracking-wider text-[rgb(var(--text-dim))]">
					Latest
				</span>
				<span className="text-[10px] uppercase tracking-wider text-[rgb(var(--text-dim))] text-right">
					Status
				</span>
			</div>

			{/* Table Body */}
			<div className="divide-y divide-[rgba(var(--console-surface),0.5)]">
				{filteredData.map((info) => (
					<VersionRow key={info.service} info={info} />
				))}
			</div>
		</div>
	);
}
