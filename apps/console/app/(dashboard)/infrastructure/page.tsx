"use client";

import {
	Activity,
	Box,
	Clock,
	Cpu,
	Database,
	HardDrive,
	Layers,
	Network,
	Play,
	Radio,
	Search,
	Server,
} from "lucide-react";
import { DatabaseStatusPanels } from "@/components/dashboard/database-status-panels";
import { Badge } from "@/components/ui/badge";
import { VersionMatrix } from "../../components/VersionMatrix";

interface ResourceGauge {
	label: string;
	value: number;
	icon: typeof Cpu;
	colorFrom: string;
	colorTo: string;
}

const RESOURCES: ResourceGauge[] = [
	{ label: "CPU", value: 34, icon: Cpu, colorFrom: "--console-cyan", colorTo: "--console-blue" },
	{
		label: "Memory",
		value: 67,
		icon: Database,
		colorFrom: "--console-purple",
		colorTo: "--console-blue",
	},
	{
		label: "Disk",
		value: 45,
		icon: HardDrive,
		colorFrom: "--console-green",
		colorTo: "--console-cyan",
	},
	{
		label: "Network",
		value: 23,
		icon: Activity,
		colorFrom: "--console-amber",
		colorTo: "--console-green",
	},
];

interface Container {
	name: string;
	image: string;
	status: "running" | "stopped" | "restarting";
	uptime: string;
	icon: typeof Server;
	colorVar: string;
}

const CONTAINERS: Container[] = [
	{
		name: "engram-api",
		image: "engram/api:1.2.3",
		status: "running",
		uptime: "2d 4h",
		icon: Server,
		colorVar: "--console-cyan",
	},
	{
		name: "engram-search",
		image: "engram/search:2.1.0",
		status: "running",
		uptime: "2d 4h",
		icon: Search,
		colorVar: "--console-purple",
	},
	{
		name: "falkordb",
		image: "falkordb/falkordb:4.0.1",
		status: "running",
		uptime: "5d 12h",
		icon: Network,
		colorVar: "--console-cyan",
	},
	{
		name: "qdrant",
		image: "qdrant/qdrant:1.7.4",
		status: "running",
		uptime: "5d 12h",
		icon: Layers,
		colorVar: "--console-purple",
	},
	{
		name: "nats",
		image: "nats:2.10.5",
		status: "running",
		uptime: "5d 12h",
		icon: Radio,
		colorVar: "--console-green",
	},
	{
		name: "postgres",
		image: "postgres:15.4",
		status: "running",
		uptime: "5d 12h",
		icon: Database,
		colorVar: "--console-blue",
	},
];

function ResourceBar({ resource }: { resource: ResourceGauge }) {
	const Icon = resource.icon;
	const getStatusColor = (value: number) => {
		if (value > 80) return "--console-red";
		if (value > 60) return "--console-amber";
		return resource.colorFrom;
	};

	return (
		<div className="flex items-center justify-between group">
			<div className="flex items-center gap-3">
				<Icon
					className="w-4 h-4 transition-colors"
					style={{ color: `rgb(var(${resource.colorFrom}))` }}
				/>
				<span className="text-sm text-[rgb(var(--text-secondary))]">{resource.label}</span>
			</div>
			<div className="flex items-center gap-2">
				<div className="w-24 h-2 rounded-full bg-[rgb(var(--console-surface))] overflow-hidden">
					<div
						className="h-full rounded-full transition-all duration-500"
						style={{
							width: `${resource.value}%`,
							background: `linear-gradient(90deg, rgb(var(${getStatusColor(resource.value)})), rgb(var(${resource.colorTo})))`,
						}}
					/>
				</div>
				<span className="font-mono text-xs text-[rgb(var(--text-muted))] w-8 text-right tabular-nums">
					{resource.value}%
				</span>
			</div>
		</div>
	);
}

function ContainerRow({ container }: { container: Container }) {
	const Icon = container.icon;
	const isRunning = container.status === "running";

	return (
		<div className="flex items-center justify-between py-2.5 px-3 -mx-3 rounded-md hover:bg-[rgb(var(--console-surface))] transition-colors group">
			<div className="flex items-center gap-3">
				<div
					className="w-8 h-8 rounded-md flex items-center justify-center"
					style={{ background: `rgba(var(${container.colorVar}), 0.1)` }}
				>
					<Icon className="w-4 h-4" style={{ color: `rgb(var(${container.colorVar}))` }} />
				</div>
				<div>
					<div className="text-sm text-[rgb(var(--text-primary))] group-hover:text-[rgb(var(--console-cyan))] transition-colors">
						{container.name}
					</div>
					<div className="text-[10px] font-mono text-[rgb(var(--text-dim))]">{container.image}</div>
				</div>
			</div>
			<div className="flex items-center gap-4">
				<div className="flex items-center gap-1.5">
					<Clock className="w-3 h-3 text-[rgb(var(--text-dim))]" />
					<span className="text-xs font-mono text-[rgb(var(--text-muted))]">
						{container.uptime}
					</span>
				</div>
				<div className="flex items-center gap-1.5">
					{isRunning ? (
						<>
							<span className="relative flex h-2 w-2">
								<span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
								<span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
							</span>
							<span className="text-xs font-mono text-[rgb(var(--console-green))]">Running</span>
						</>
					) : (
						<>
							<span className="h-2 w-2 rounded-full bg-[rgb(var(--console-red))]" />
							<span className="text-xs font-mono text-[rgb(var(--console-red))]">
								{container.status}
							</span>
						</>
					)}
				</div>
			</div>
		</div>
	);
}

export default function InfrastructurePage() {
	const runningContainers = CONTAINERS.filter((c) => c.status === "running").length;

	return (
		<div className="space-y-6 animate-fade-in">
			{/* Page Header */}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="font-display text-2xl text-[rgb(var(--text-primary))]">Infrastructure</h1>
					<p className="text-sm text-[rgb(var(--text-muted))] mt-1">
						System resources, containers, and database health
					</p>
				</div>
				<Badge
					variant="default"
					className="bg-green-500/10 text-green-500 hover:bg-green-500/20 font-mono"
				>
					<Play className="mr-1 h-3 w-3" />
					{runningContainers}/{CONTAINERS.length} Containers
				</Badge>
			</div>

			{/* Resource & Containers Grid */}
			<div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
				{/* Resource Gauges */}
				<div className="panel p-5">
					<div className="flex items-center gap-2 mb-5">
						<Cpu className="w-4 h-4 text-[rgb(var(--console-cyan))]" />
						<h3 className="text-[rgb(var(--text-primary))] font-display text-base">
							System Resources
						</h3>
					</div>
					<div className="space-y-4">
						{RESOURCES.map((resource) => (
							<ResourceBar key={resource.label} resource={resource} />
						))}
					</div>
				</div>

				{/* Containers List */}
				<div className="lg:col-span-2 panel p-5">
					<div className="flex items-center justify-between mb-4">
						<div className="flex items-center gap-2">
							<Box className="w-4 h-4 text-[rgb(var(--console-purple))]" />
							<h3 className="text-[rgb(var(--text-primary))] font-display text-base">
								Docker Containers
							</h3>
						</div>
						<span className="text-xs font-mono text-[rgb(var(--console-green))]">
							{runningContainers} running
						</span>
					</div>
					<div className="divide-y divide-[rgba(var(--console-surface),0.5)]">
						{CONTAINERS.map((container) => (
							<ContainerRow key={container.name} container={container} />
						))}
					</div>
				</div>
			</div>

			{/* Database Status Panels */}
			<DatabaseStatusPanels pollInterval={10000} showHeader={true} />

			{/* Version Matrix */}
			<VersionMatrix showHeader={true} filterType="all" />
		</div>
	);
}
