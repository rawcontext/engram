"use client";

import { AreaChart } from "@tremor/react";
import {
	Activity,
	ArrowDown,
	ArrowUp,
	ChevronDown,
	Clock,
	Cpu,
	Database,
	HardDrive,
	Network,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useApiClient } from "@/lib/api-client";

// ============================================
// Types
// ============================================

type TimeRange = "1h" | "6h" | "24h" | "7d";

interface MetricDataPoint {
	timestamp: number;
	cpu: number;
	memory: number;
	diskRead: number;
	diskWrite: number;
	networkIn: number;
	networkOut: number;
}

interface CurrentMetrics {
	cpu: { usage: number; cores: number };
	memory: { used: number; total: number; percentage: number };
	disk: { read: number; write: number };
	network: { in: number; out: number };
}

interface Thresholds {
	cpu: { warning: number; critical: number };
	memory: { warning: number; critical: number };
}

interface ServerMetricsChartProps {
	serverId?: string;
	pollInterval?: number;
	height?: number;
}

// ============================================
// Constants
// ============================================

const TIME_RANGES: { value: TimeRange; label: string; resolution: string }[] = [
	{ value: "1h", label: "1 Hour", resolution: "1min" },
	{ value: "6h", label: "6 Hours", resolution: "5min" },
	{ value: "24h", label: "24 Hours", resolution: "15min" },
	{ value: "7d", label: "7 Days", resolution: "1hr" },
];

const METRIC_CATEGORIES = [
	{ id: "cpu", label: "CPU", color: "--console-cyan", icon: Cpu },
	{ id: "memory", label: "Memory", color: "--console-purple", icon: Database },
	{ id: "diskRead", label: "Disk Read", color: "--console-green", icon: HardDrive },
	{ id: "diskWrite", label: "Disk Write", color: "--console-amber", icon: HardDrive },
	{ id: "networkIn", label: "Net In", color: "--console-blue", icon: ArrowDown },
	{ id: "networkOut", label: "Net Out", color: "--console-red", icon: ArrowUp },
];

// ============================================
// Time Range Selector
// ============================================

function TimeRangeSelector({
	value,
	onChange,
}: {
	value: TimeRange;
	onChange: (value: TimeRange) => void;
}) {
	const [isOpen, setIsOpen] = useState(false);
	const selected = TIME_RANGES.find((r) => r.value === value);

	return (
		<div className="relative">
			<button
				type="button"
				onClick={() => setIsOpen(!isOpen)}
				className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[rgb(var(--console-surface))] border border-[rgba(var(--console-cyan),0.15)] hover:border-[rgba(var(--console-cyan),0.3)] transition-colors font-mono text-xs text-[rgb(var(--text-secondary))]"
			>
				<Clock className="w-3.5 h-3.5 text-[rgb(var(--console-cyan))]" />
				<span>{selected?.label}</span>
				<span className="text-[rgb(var(--text-dim))]">({selected?.resolution})</span>
				<ChevronDown className={`w-3.5 h-3.5 transition-transform ${isOpen ? "rotate-180" : ""}`} />
			</button>

			{isOpen && (
				<>
					{/* biome-ignore lint/a11y/useKeyWithClickEvents: overlay dismissal */}
					<div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} />
					<div className="absolute right-0 top-full mt-1 z-20 min-w-[160px] py-1 rounded-lg bg-[rgb(var(--console-panel))] border border-[rgba(var(--console-cyan),0.2)] shadow-xl shadow-black/30">
						{TIME_RANGES.map((range) => (
							<button
								type="button"
								key={range.value}
								onClick={() => {
									onChange(range.value);
									setIsOpen(false);
								}}
								className={`w-full px-3 py-2 text-left text-xs font-mono transition-colors flex items-center justify-between ${
									range.value === value
										? "text-[rgb(var(--console-cyan))] bg-[rgba(var(--console-cyan),0.1)]"
										: "text-[rgb(var(--text-secondary))] hover:text-[rgb(var(--text-primary))] hover:bg-[rgb(var(--console-surface))]"
								}`}
							>
								<span>{range.label}</span>
								<span className="text-[rgb(var(--text-dim))]">{range.resolution}</span>
							</button>
						))}
					</div>
				</>
			)}
		</div>
	);
}

// ============================================
// Metric Toggle Chip
// ============================================

function MetricToggle({
	label,
	color,
	enabled,
	onChange,
}: {
	label: string;
	color: string;
	enabled: boolean;
	onChange: (enabled: boolean) => void;
}) {
	return (
		<button
			type="button"
			onClick={() => onChange(!enabled)}
			className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono transition-all ${
				enabled
					? "border border-transparent"
					: "border border-[rgba(var(--console-cyan),0.1)] opacity-50 hover:opacity-70"
			}`}
			style={{
				background: enabled ? `rgba(var(${color}), 0.15)` : "transparent",
				color: enabled ? `rgb(var(${color}))` : "rgb(var(--text-muted))",
			}}
		>
			<div
				className="w-2 h-2 rounded-full"
				style={{ background: enabled ? `rgb(var(${color}))` : "rgb(var(--text-dim))" }}
			/>
			{label}
		</button>
	);
}

// ============================================
// Current Value Card
// ============================================

function CurrentValueCard({
	icon: Icon,
	label,
	value,
	unit,
	subValue,
	color,
	warningThreshold,
	criticalThreshold,
}: {
	icon: typeof Cpu;
	label: string;
	value: number;
	unit: string;
	subValue?: string;
	color: string;
	warningThreshold?: number;
	criticalThreshold?: number;
}) {
	const isWarning = warningThreshold && value >= warningThreshold;
	const isCritical = criticalThreshold && value >= criticalThreshold;
	const statusColor = isCritical ? "--console-red" : isWarning ? "--console-amber" : color;

	return (
		<div className="flex items-center gap-3 p-3 rounded-lg bg-[rgb(var(--console-surface))] border border-[rgba(var(--console-cyan),0.05)]">
			<div
				className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
				style={{ background: `rgba(var(${color}), 0.12)` }}
			>
				<Icon className="w-5 h-5" style={{ color: `rgb(var(${color}))` }} />
			</div>
			<div className="flex-1 min-w-0">
				<div className="metric-label">{label}</div>
				<div className="flex items-baseline gap-1">
					<span
						className={`font-mono text-xl font-semibold ${isCritical || isWarning ? "animate-pulse" : ""}`}
						style={{ color: `rgb(var(${statusColor}))` }}
					>
						{value.toFixed(1)}
					</span>
					<span className="text-xs text-[rgb(var(--text-muted))]">{unit}</span>
				</div>
				{subValue && (
					<div className="text-xs text-[rgb(var(--text-dim))] font-mono">{subValue}</div>
				)}
			</div>
			{(isWarning || isCritical) && (
				<div className="w-2 h-8 rounded-full" style={{ background: `rgb(var(${statusColor}))` }} />
			)}
		</div>
	);
}

// ============================================
// Main Component
// ============================================

export function ServerMetricsChart({
	serverId,
	pollInterval = 15000,
	height = 300,
}: ServerMetricsChartProps) {
	const apiClient = useApiClient();
	const [timeRange, setTimeRange] = useState<TimeRange>("1h");
	const [enabledMetrics, setEnabledMetrics] = useState<Record<string, boolean>>({
		cpu: true,
		memory: true,
		diskRead: false,
		diskWrite: false,
		networkIn: false,
		networkOut: false,
	});
	const [current, setCurrent] = useState<CurrentMetrics | null>(null);
	const [history, setHistory] = useState<MetricDataPoint[]>([]);
	const [thresholds, setThresholds] = useState<Thresholds | null>(null);
	const [isLoading, setIsLoading] = useState(true);

	const fetchMetrics = useCallback(
		async (isInitial = false) => {
			if (isInitial) setIsLoading(true);

			try {
				const data = await apiClient.getServerMetrics(serverId, timeRange);
				setCurrent(data.current);
				setHistory(data.history);
				if (data.thresholds) setThresholds(data.thresholds);
			} catch (err) {
				console.error("Failed to fetch server metrics:", err);
				// Keep empty state - no mock data
			} finally {
				setIsLoading(false);
			}
		},
		[apiClient, serverId, timeRange],
	);

	useEffect(() => {
		fetchMetrics(true);
	}, [fetchMetrics]);

	useEffect(() => {
		const interval = setInterval(() => fetchMetrics(false), pollInterval);
		return () => clearInterval(interval);
	}, [fetchMetrics, pollInterval]);

	const toggleMetric = (id: string, enabled: boolean) => {
		setEnabledMetrics((prev) => ({ ...prev, [id]: enabled }));
	};

	// Format chart data
	const chartData = history.map((point) => ({
		time: new Date(point.timestamp).toLocaleTimeString("en-US", {
			hour: "2-digit",
			minute: "2-digit",
			...(timeRange === "7d" && { hour12: false }),
		}),
		...(enabledMetrics.cpu && { CPU: point.cpu }),
		...(enabledMetrics.memory && { Memory: point.memory }),
		...(enabledMetrics.diskRead && { "Disk Read": point.diskRead }),
		...(enabledMetrics.diskWrite && { "Disk Write": point.diskWrite }),
		...(enabledMetrics.networkIn && { "Net In": point.networkIn }),
		...(enabledMetrics.networkOut && { "Net Out": point.networkOut }),
	}));

	// Get enabled categories for chart
	const enabledCategories = [
		enabledMetrics.cpu && "CPU",
		enabledMetrics.memory && "Memory",
		enabledMetrics.diskRead && "Disk Read",
		enabledMetrics.diskWrite && "Disk Write",
		enabledMetrics.networkIn && "Net In",
		enabledMetrics.networkOut && "Net Out",
	].filter(Boolean) as string[];

	const categoryColors = enabledCategories.map((cat) => {
		switch (cat) {
			case "CPU":
				return "cyan";
			case "Memory":
				return "violet";
			case "Disk Read":
				return "emerald";
			case "Disk Write":
				return "amber";
			case "Net In":
				return "blue";
			case "Net Out":
				return "rose";
			default:
				return "gray";
		}
	});

	if (isLoading) {
		return (
			<div className="panel p-6">
				<div className="flex items-center justify-between mb-6">
					<div className="h-6 w-40 rounded bg-[rgb(var(--console-surface))] animate-pulse" />
					<div className="h-8 w-32 rounded bg-[rgb(var(--console-surface))] animate-pulse" />
				</div>
				<div
					className="rounded-lg bg-[rgb(var(--console-surface))] animate-pulse"
					style={{ height }}
				/>
				<div className="grid grid-cols-4 gap-4 mt-6">
					{[1, 2, 3, 4].map((i) => (
						<div
							key={i}
							className="h-20 rounded-lg bg-[rgb(var(--console-surface))] animate-pulse"
						/>
					))}
				</div>
			</div>
		);
	}

	return (
		<div className="panel p-6 relative overflow-hidden">
			{/* Background accent */}
			<div
				className="absolute top-0 right-0 w-64 h-64 pointer-events-none"
				style={{
					background:
						"radial-gradient(circle at top right, rgba(var(--console-cyan), 0.04) 0%, transparent 60%)",
				}}
			/>

			{/* Header */}
			<div className="flex items-center justify-between mb-4 relative">
				<div className="flex items-center gap-3">
					<div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[rgba(var(--console-cyan),0.2)] to-[rgba(var(--console-purple),0.2)] flex items-center justify-center">
						<Activity className="w-5 h-5 text-[rgb(var(--console-cyan))]" />
					</div>
					<div>
						<h3 className="font-display text-base text-[rgb(var(--text-primary))]">
							Server Metrics
						</h3>
						<p className="text-xs text-[rgb(var(--text-muted))] font-mono">
							{serverId || "All Servers"} • Real-time resource monitoring
						</p>
					</div>
				</div>
				<TimeRangeSelector value={timeRange} onChange={setTimeRange} />
			</div>

			{/* Metric Toggles */}
			<div className="flex flex-wrap gap-2 mb-4">
				{METRIC_CATEGORIES.map((cat) => (
					<MetricToggle
						key={cat.id}
						label={cat.label}
						color={cat.color}
						enabled={enabledMetrics[cat.id]}
						onChange={(enabled) => toggleMetric(cat.id, enabled)}
					/>
				))}
			</div>

			{/* Chart */}
			<div className="relative" style={{ height }}>
				{enabledCategories.length > 0 ? (
					<AreaChart
						className="h-full"
						data={chartData}
						index="time"
						categories={enabledCategories}
						colors={categoryColors}
						valueFormatter={(v) => `${v.toFixed(1)}`}
						showLegend={false}
						showGridLines={false}
						curveType="monotone"
						yAxisWidth={45}
					/>
				) : (
					<div className="h-full flex items-center justify-center">
						<div className="text-center">
							<Network className="w-12 h-12 text-[rgb(var(--text-dim))] mx-auto mb-3" />
							<p className="text-sm text-[rgb(var(--text-muted))]">Select metrics to display</p>
						</div>
					</div>
				)}

				{/* Threshold lines overlay */}
				{thresholds && enabledMetrics.cpu && (
					<div className="absolute inset-0 pointer-events-none">
						<div
							className="absolute w-full border-t border-dashed border-[rgba(var(--console-amber),0.4)]"
							style={{ top: `${100 - thresholds.cpu.warning}%` }}
						>
							<span className="absolute right-0 -top-3 text-[10px] font-mono text-[rgb(var(--console-amber))] bg-[rgb(var(--console-panel))] px-1">
								CPU Warning
							</span>
						</div>
						<div
							className="absolute w-full border-t border-dashed border-[rgba(var(--console-red),0.5)]"
							style={{ top: `${100 - thresholds.cpu.critical}%` }}
						>
							<span className="absolute right-0 -top-3 text-[10px] font-mono text-[rgb(var(--console-red))] bg-[rgb(var(--console-panel))] px-1">
								CPU Critical
							</span>
						</div>
					</div>
				)}
			</div>

			{/* Current Values Grid */}
			{current && (
				<div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-6 pt-4 border-t border-[rgba(var(--console-cyan),0.1)]">
					<CurrentValueCard
						icon={Cpu}
						label="CPU Usage"
						value={current.cpu.usage}
						unit="%"
						subValue={`${current.cpu.cores} cores`}
						color="--console-cyan"
						warningThreshold={thresholds?.cpu.warning}
						criticalThreshold={thresholds?.cpu.critical}
					/>
					<CurrentValueCard
						icon={Database}
						label="Memory"
						value={current.memory.percentage}
						unit="%"
						subValue={`${current.memory.used.toFixed(1)}/${current.memory.total}GB`}
						color="--console-purple"
						warningThreshold={thresholds?.memory.warning}
						criticalThreshold={thresholds?.memory.critical}
					/>
					<CurrentValueCard
						icon={HardDrive}
						label="Disk I/O"
						value={current.disk.read + current.disk.write}
						unit="MB/s"
						subValue={`R: ${current.disk.read.toFixed(1)} W: ${current.disk.write.toFixed(1)}`}
						color="--console-green"
					/>
					<CurrentValueCard
						icon={Network}
						label="Network"
						value={(current.network.in + current.network.out) / 1000}
						unit="Gbps"
						subValue={`In: ${current.network.in.toFixed(0)} Out: ${current.network.out.toFixed(0)} Mbps`}
						color="--console-blue"
					/>
				</div>
			)}
		</div>
	);
}
