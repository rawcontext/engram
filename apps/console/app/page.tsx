"use client";

import { Card, Metric, Text, Badge, AreaChart, Grid, Title } from "@tremor/react";
import {
	Server,
	Database,
	Search,
	Cpu,
	Activity,
	Zap,
	ArrowUpRight,
	ArrowDownRight,
	Clock,
	CheckCircle2,
	AlertCircle,
	XCircle,
} from "lucide-react";

// Mock data for the skeleton
const services = [
	{ name: "API", port: 6174, status: "online", latency: "12ms", requests: "1.2k/min" },
	{ name: "Ingestion", port: 6175, status: "online", latency: "8ms", requests: "890/min" },
	{ name: "Search", port: 6176, status: "online", latency: "45ms", requests: "340/min" },
	{ name: "Tuner", port: 6177, status: "online", latency: "23ms", requests: "12/min" },
	{ name: "Observatory", port: 3000, status: "online", latency: "156ms", requests: "89/min" },
	{ name: "Memory", port: null, status: "online", latency: "—", requests: "NATS" },
	{ name: "FalkorDB", port: 6179, status: "online", latency: "3ms", requests: "2.1k/min" },
	{ name: "Qdrant", port: 6180, status: "online", latency: "15ms", requests: "450/min" },
	{ name: "NATS", port: 6181, status: "online", latency: "1ms", requests: "5.6k/min" },
	{ name: "PostgreSQL", port: 6183, status: "warning", latency: "8ms", requests: "320/min" },
];

const sparklineData = [
	{ time: "00:00", value: 45 },
	{ time: "04:00", value: 52 },
	{ time: "08:00", value: 78 },
	{ time: "12:00", value: 95 },
	{ time: "16:00", value: 88 },
	{ time: "20:00", value: 62 },
	{ time: "24:00", value: 48 },
];

const metrics = [
	{
		title: "Total Requests",
		value: "1,234,567",
		change: "+12.3%",
		trend: "up",
		icon: Zap,
	},
	{
		title: "Error Rate",
		value: "0.12%",
		change: "-0.08%",
		trend: "down",
		icon: AlertCircle,
	},
	{
		title: "Avg Latency",
		value: "23ms",
		change: "-5ms",
		trend: "down",
		icon: Clock,
	},
	{
		title: "Active Sessions",
		value: "847",
		change: "+23",
		trend: "up",
		icon: Activity,
	},
];

function StatusIcon({ status }: { status: string }) {
	switch (status) {
		case "online":
			return <CheckCircle2 className="w-4 h-4 text-[rgb(var(--console-green))]" />;
		case "warning":
			return <AlertCircle className="w-4 h-4 text-[rgb(var(--console-amber))]" />;
		case "error":
			return <XCircle className="w-4 h-4 text-[rgb(var(--console-red))]" />;
		default:
			return <div className="w-4 h-4 rounded-full bg-[rgb(var(--text-muted))]" />;
	}
}

export default function OverviewPage() {
	return (
		<div className="space-y-6 animate-fade-in">
			{/* Page Header */}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="font-display text-2xl text-[rgb(var(--text-primary))]">System Overview</h1>
					<p className="text-sm text-[rgb(var(--text-muted))] mt-1">
						Real-time infrastructure monitoring
					</p>
				</div>
				<Badge color="emerald" size="lg" className="font-mono">
					All Systems Operational
				</Badge>
			</div>

			{/* Key Metrics */}
			<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 stagger">
				{metrics.map((metric) => {
					const Icon = metric.icon;
					const isPositive =
						metric.trend === "up" ? metric.title !== "Error Rate" : metric.title === "Error Rate";

					return (
						<div key={metric.title} className="panel p-5 hover-lift">
							<div className="flex items-start justify-between mb-3">
								<div className="w-10 h-10 rounded-lg bg-[rgba(var(--console-cyan),0.1)] flex items-center justify-center">
									<Icon className="w-5 h-5 text-[rgb(var(--console-cyan))]" />
								</div>
								<div
									className={`flex items-center gap-1 text-sm font-mono ${isPositive ? "text-[rgb(var(--console-green))]" : "text-[rgb(var(--console-red))]"}`}
								>
									{isPositive ? (
										<ArrowUpRight className="w-4 h-4" />
									) : (
										<ArrowDownRight className="w-4 h-4" />
									)}
									{metric.change}
								</div>
							</div>
							<div className="metric-value">{metric.value}</div>
							<div className="metric-label mt-1">{metric.title}</div>
						</div>
					);
				})}
			</div>

			{/* Charts and Services Grid */}
			<div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
				{/* Request Volume Chart */}
				<div className="lg:col-span-2 panel p-5">
					<div className="flex items-center justify-between mb-4">
						<div>
							<Title className="!text-[rgb(var(--text-primary))] !font-display">
								Request Volume
							</Title>
							<Text className="!text-[rgb(var(--text-muted))]">Last 24 hours</Text>
						</div>
						<Badge color="blue" className="font-mono">
							Live
						</Badge>
					</div>
					<AreaChart
						className="h-48"
						data={sparklineData}
						index="time"
						categories={["value"]}
						colors={["cyan"]}
						showLegend={false}
						showGridLines={false}
						showXAxis={true}
						showYAxis={false}
						curveType="natural"
					/>
				</div>

				{/* Quick Stats */}
				<div className="panel p-5">
					<Title className="!text-[rgb(var(--text-primary))] !font-display mb-4">Resources</Title>
					<div className="space-y-4">
						<div className="flex items-center justify-between">
							<div className="flex items-center gap-3">
								<Cpu className="w-4 h-4 text-[rgb(var(--console-cyan))]" />
								<span className="text-sm text-[rgb(var(--text-secondary))]">CPU</span>
							</div>
							<div className="flex items-center gap-2">
								<div className="w-24 h-2 rounded-full bg-[rgb(var(--console-surface))]">
									<div className="w-[34%] h-full rounded-full bg-gradient-to-r from-[rgb(var(--console-cyan))] to-[rgb(var(--console-blue))]" />
								</div>
								<span className="font-mono text-xs text-[rgb(var(--text-muted))]">34%</span>
							</div>
						</div>
						<div className="flex items-center justify-between">
							<div className="flex items-center gap-3">
								<Database className="w-4 h-4 text-[rgb(var(--console-purple))]" />
								<span className="text-sm text-[rgb(var(--text-secondary))]">Memory</span>
							</div>
							<div className="flex items-center gap-2">
								<div className="w-24 h-2 rounded-full bg-[rgb(var(--console-surface))]">
									<div className="w-[67%] h-full rounded-full bg-gradient-to-r from-[rgb(var(--console-purple))] to-[rgb(var(--console-blue))]" />
								</div>
								<span className="font-mono text-xs text-[rgb(var(--text-muted))]">67%</span>
							</div>
						</div>
						<div className="flex items-center justify-between">
							<div className="flex items-center gap-3">
								<Server className="w-4 h-4 text-[rgb(var(--console-green))]" />
								<span className="text-sm text-[rgb(var(--text-secondary))]">Disk</span>
							</div>
							<div className="flex items-center gap-2">
								<div className="w-24 h-2 rounded-full bg-[rgb(var(--console-surface))]">
									<div className="w-[45%] h-full rounded-full bg-gradient-to-r from-[rgb(var(--console-green))] to-[rgb(var(--console-cyan))]" />
								</div>
								<span className="font-mono text-xs text-[rgb(var(--text-muted))]">45%</span>
							</div>
						</div>
						<div className="flex items-center justify-between">
							<div className="flex items-center gap-3">
								<Activity className="w-4 h-4 text-[rgb(var(--console-amber))]" />
								<span className="text-sm text-[rgb(var(--text-secondary))]">Network</span>
							</div>
							<div className="flex items-center gap-2">
								<div className="w-24 h-2 rounded-full bg-[rgb(var(--console-surface))]">
									<div className="w-[23%] h-full rounded-full bg-gradient-to-r from-[rgb(var(--console-amber))] to-[rgb(var(--console-green))]" />
								</div>
								<span className="font-mono text-xs text-[rgb(var(--text-muted))]">23%</span>
							</div>
						</div>
					</div>
				</div>
			</div>

			{/* Service Health Grid */}
			<div className="panel p-5">
				<div className="flex items-center justify-between mb-4">
					<Title className="!text-[rgb(var(--text-primary))] !font-display">Service Health</Title>
					<Text className="!text-[rgb(var(--text-muted))] !font-mono !text-xs">
						{services.filter((s) => s.status === "online").length}/{services.length} Online
					</Text>
				</div>
				<div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 stagger">
					{services.map((service) => (
						<div
							key={service.name}
							className="panel-elevated p-4 rounded-lg hover-lift cursor-pointer group"
						>
							<div className="flex items-center justify-between mb-3">
								<StatusIcon status={service.status} />
								{service.port && (
									<span className="font-mono text-[10px] text-[rgb(var(--text-dim))]">
										:{service.port}
									</span>
								)}
							</div>
							<div className="font-medium text-sm text-[rgb(var(--text-primary))] group-hover:text-[rgb(var(--console-cyan))] transition-colors">
								{service.name}
							</div>
							<div className="flex items-center justify-between mt-2">
								<span className="font-mono text-[10px] text-[rgb(var(--text-muted))]">
									{service.latency}
								</span>
								<span className="font-mono text-[10px] text-[rgb(var(--text-dim))]">
									{service.requests}
								</span>
							</div>
						</div>
					))}
				</div>
			</div>
		</div>
	);
}
