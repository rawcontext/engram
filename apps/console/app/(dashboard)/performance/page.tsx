"use client";

import { AreaChart, BarChart, SparkAreaChart } from "@tremor/react";
import {
	ArrowDownRight,
	ArrowUpRight,
	ChevronDown,
	Clock,
	Gauge,
	Search,
	Timer,
	Zap,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useApiClient } from "@/lib/api-client";

// ============================================
// Types
// ============================================

interface PercentileData {
	id: string;
	label: string;
	value: number;
	change: number;
	sparkline: { index: number; value: number }[];
	threshold?: number;
}

interface LatencyBucket {
	range: string;
	count: number;
	percentage: number;
}

interface StrategyDataPoint {
	timestamp: string;
	dense: number;
	sparse: number;
	hybrid: number;
}

interface PerformanceMetrics {
	percentiles: PercentileData[];
	latencyDistribution: LatencyBucket[];
	strategyComparison: StrategyDataPoint[];
	lastUpdated: number;
}

// ============================================
// Time Range Selector
// ============================================

const TIME_RANGES = [
	{ id: "1h", label: "1 hour" },
	{ id: "6h", label: "6 hours" },
	{ id: "24h", label: "24 hours" },
	{ id: "7d", label: "7 days" },
];

function TimeRangeSelector({
	value,
	onChange,
}: {
	value: string;
	onChange: (value: string) => void;
}) {
	const [isOpen, setIsOpen] = useState(false);
	const selected = TIME_RANGES.find((r) => r.id === value) || TIME_RANGES[2];

	return (
		<div className="relative">
			<button
				type="button"
				onClick={() => setIsOpen(!isOpen)}
				className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[rgb(var(--console-surface))] border border-[rgba(var(--console-cyan),0.15)] hover:border-[rgba(var(--console-cyan),0.3)] transition-colors font-mono text-sm text-[rgb(var(--text-secondary))]"
			>
				<Clock className="w-4 h-4 text-[rgb(var(--console-cyan))]" />
				<span>{selected.label}</span>
				<ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? "rotate-180" : ""}`} />
			</button>

			{isOpen && (
				<>
					{/* biome-ignore lint/a11y/useKeyWithClickEvents: overlay dismissal */}
					<div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} />
					<div className="absolute right-0 top-full mt-2 z-20 min-w-[140px] py-1 rounded-lg bg-[rgb(var(--console-panel))] border border-[rgba(var(--console-cyan),0.2)] shadow-xl shadow-black/30">
						{TIME_RANGES.map((range) => (
							<button
								type="button"
								key={range.id}
								onClick={() => {
									onChange(range.id);
									setIsOpen(false);
								}}
								className={`w-full px-4 py-2 text-left text-sm font-mono transition-colors ${
									range.id === value
										? "text-[rgb(var(--console-cyan))] bg-[rgba(var(--console-cyan),0.1)]"
										: "text-[rgb(var(--text-secondary))] hover:text-[rgb(var(--text-primary))] hover:bg-[rgb(var(--console-surface))]"
								}`}
							>
								{range.label}
							</button>
						))}
					</div>
				</>
			)}
		</div>
	);
}

// ============================================
// Percentile Cards
// ============================================

const PERCENTILE_ICONS: Record<string, typeof Timer> = {
	p50: Timer,
	p95: Gauge,
	p99: Zap,
};

const PERCENTILE_COLORS: Record<string, string> = {
	p50: "--console-green",
	p95: "--console-amber",
	p99: "--console-red",
};

function PercentileCard({ data, isLoading }: { data: PercentileData; isLoading: boolean }) {
	const Icon = PERCENTILE_ICONS[data.id] || Timer;
	const colorVar = PERCENTILE_COLORS[data.id] || "--console-cyan";
	const isPositive = data.change <= 0; // Lower latency is better
	const isAboveThreshold = data.threshold && data.value > data.threshold;

	return (
		<div className="panel p-5 hover-lift group relative overflow-hidden">
			{/* Background glow */}
			<div
				className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
				style={{
					background: `radial-gradient(ellipse at bottom right, rgba(var(${colorVar}), 0.06) 0%, transparent 70%)`,
				}}
			/>

			{/* Threshold warning indicator */}
			{isAboveThreshold && (
				<div className="absolute top-0 right-0 w-12 h-12 overflow-hidden">
					<div
						className="absolute rotate-45 translate-x-4 -translate-y-2 w-16 h-6 flex items-center justify-center"
						style={{ background: `rgb(var(--console-amber))` }}
					>
						<span className="text-[8px] font-bold text-[rgb(var(--console-void))]">SLO</span>
					</div>
				</div>
			)}

			{/* Header */}
			<div className="flex items-start justify-between mb-4 relative">
				<div
					className="w-11 h-11 rounded-lg flex items-center justify-center transition-transform group-hover:scale-105"
					style={{ background: `rgba(var(${colorVar}), 0.12)` }}
				>
					<Icon className="w-5 h-5" style={{ color: `rgb(var(${colorVar}))` }} />
				</div>

				<div
					className={`flex items-center gap-1 text-sm font-mono ${
						isPositive ? "text-[rgb(var(--console-green))]" : "text-[rgb(var(--console-red))]"
					}`}
				>
					{isPositive ? (
						<ArrowDownRight className="w-4 h-4" />
					) : (
						<ArrowUpRight className="w-4 h-4" />
					)}
					<span>{Math.abs(data.change).toFixed(1)}ms</span>
				</div>
			</div>

			{/* Value */}
			<div className="relative mb-1">
				{isLoading ? (
					<div className="h-10 w-28 rounded bg-[rgb(var(--console-surface))] animate-pulse" />
				) : (
					<span
						className="font-mono text-4xl font-semibold tracking-tight"
						style={{
							background: `linear-gradient(180deg, rgb(var(--text-primary)) 0%, rgb(var(--text-secondary)) 100%)`,
							WebkitBackgroundClip: "text",
							WebkitTextFillColor: "transparent",
							backgroundClip: "text",
						}}
					>
						{data.value.toFixed(0)}
						<span className="text-lg ml-1 opacity-60">ms</span>
					</span>
				)}
			</div>

			{/* Label */}
			<div className="metric-label">{data.label}</div>

			{/* Sparkline */}
			<div className="absolute bottom-3 right-3 w-24 h-10 opacity-30 group-hover:opacity-60 transition-opacity">
				<SparkAreaChart
					data={data.sparkline}
					categories={["value"]}
					index="index"
					colors={[data.id === "p99" ? "red" : data.id === "p95" ? "amber" : "green"]}
					className="h-10 w-full"
					curveType="monotone"
				/>
			</div>
		</div>
	);
}

// ============================================
// Latency Histogram
// ============================================

function LatencyHistogram({ data, isLoading }: { data: LatencyBucket[]; isLoading: boolean }) {
	const chartData = data.map((bucket) => ({
		range: bucket.range,
		Requests: bucket.count,
		percentage: bucket.percentage,
	}));

	return (
		<div className="panel p-6 relative overflow-hidden">
			{/* Corner accent */}
			<div
				className="absolute top-0 left-0 w-24 h-24 pointer-events-none"
				style={{
					background:
						"radial-gradient(circle at top left, rgba(var(--console-purple), 0.08) 0%, transparent 70%)",
				}}
			/>

			{/* Header */}
			<div className="flex items-center justify-between mb-6 relative">
				<div>
					<h3 className="font-display text-lg text-[rgb(var(--text-primary))] flex items-center gap-2">
						<div className="w-2 h-2 rounded-full bg-[rgb(var(--console-purple))]" />
						Latency Distribution
					</h3>
					<p className="text-sm text-[rgb(var(--text-muted))] mt-1 font-mono">
						Response time histogram by bucket
					</p>
				</div>

				{/* Legend */}
				<div className="flex items-center gap-4 text-xs font-mono text-[rgb(var(--text-muted))]">
					<div className="flex items-center gap-2">
						<div className="w-3 h-3 rounded-sm bg-[rgb(var(--console-purple))]" />
						<span>Request Count</span>
					</div>
				</div>
			</div>

			{/* Chart */}
			{isLoading ? (
				<div className="h-72 flex items-end gap-2 px-4">
					{["b1", "b2", "b3", "b4", "b5", "b6", "b7"].map((key, i) => (
						<div
							key={key}
							className="flex-1 bg-[rgb(var(--console-surface))] animate-pulse rounded-t"
							style={{ height: `${30 + ((i * 17) % 60)}%` }}
						/>
					))}
				</div>
			) : (
				<div className="h-72">
					<BarChart
						data={chartData}
						index="range"
						categories={["Requests"]}
						colors={["violet"]}
						valueFormatter={(v) => `${v.toLocaleString()} req`}
						showLegend={false}
						showGridLines={false}
						className="h-full [&_.tremor-BarChart-bar]:!rounded-t"
						yAxisWidth={60}
					/>
				</div>
			)}

			{/* Bottom stats */}
			<div className="grid grid-cols-3 gap-4 mt-6 pt-4 border-t border-[rgba(var(--console-cyan),0.1)]">
				<div>
					<div className="metric-label mb-1">Fastest Bucket</div>
					<div className="font-mono text-sm text-[rgb(var(--console-green))]">0-10ms</div>
				</div>
				<div>
					<div className="metric-label mb-1">Mode</div>
					<div className="font-mono text-sm text-[rgb(var(--text-primary))]">
						{data.length > 0 ? data.reduce((a, b) => (a.count > b.count ? a : b)).range : "-"}
					</div>
				</div>
				<div>
					<div className="metric-label mb-1">Total Requests</div>
					<div className="font-mono text-sm text-[rgb(var(--text-primary))]">
						{data.reduce((sum, b) => sum + b.count, 0).toLocaleString()}
					</div>
				</div>
			</div>
		</div>
	);
}

// ============================================
// Strategy Comparison Chart
// ============================================

function StrategyComparisonChart({
	data,
	isLoading,
}: {
	data: StrategyDataPoint[];
	isLoading: boolean;
}) {
	const chartData = data.map((point) => ({
		timestamp: point.timestamp,
		Dense: point.dense,
		Sparse: point.sparse,
		Hybrid: point.hybrid,
	}));

	return (
		<div className="panel p-6 relative overflow-hidden">
			{/* Corner accent */}
			<div
				className="absolute top-0 right-0 w-32 h-32 pointer-events-none"
				style={{
					background:
						"radial-gradient(circle at top right, rgba(var(--console-cyan), 0.06) 0%, transparent 70%)",
				}}
			/>

			{/* Header */}
			<div className="flex items-center justify-between mb-6 relative">
				<div>
					<h3 className="font-display text-lg text-[rgb(var(--text-primary))] flex items-center gap-2">
						<Search className="w-4 h-4 text-[rgb(var(--console-cyan))]" />
						Search Strategy Performance
					</h3>
					<p className="text-sm text-[rgb(var(--text-muted))] mt-1 font-mono">
						Avg latency by retrieval strategy over time
					</p>
				</div>

				{/* Strategy legend with badges */}
				<div className="flex items-center gap-3">
					{[
						{ name: "Dense", color: "--console-cyan", desc: "Vector" },
						{ name: "Sparse", color: "--console-amber", desc: "BM25" },
						{ name: "Hybrid", color: "--console-purple", desc: "RRF" },
					].map((strategy) => (
						<div
							key={strategy.name}
							className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[rgb(var(--console-surface))] border border-[rgba(var(--console-cyan),0.1)]"
						>
							<div
								className="w-2 h-2 rounded-full"
								style={{ background: `rgb(var(${strategy.color}))` }}
							/>
							<span className="text-xs font-mono text-[rgb(var(--text-secondary))]">
								{strategy.name}
							</span>
						</div>
					))}
				</div>
			</div>

			{/* Chart */}
			{isLoading ? (
				<div className="h-72 flex items-center justify-center">
					<div className="w-full h-48 bg-[rgb(var(--console-surface))] animate-pulse rounded" />
				</div>
			) : (
				<div className="h-72">
					<AreaChart
						data={chartData}
						index="timestamp"
						categories={["Dense", "Sparse", "Hybrid"]}
						colors={["cyan", "amber", "violet"]}
						valueFormatter={(v) => `${v.toFixed(0)}ms`}
						showLegend={false}
						showGridLines={false}
						className="h-full"
						curveType="monotone"
						yAxisWidth={50}
					/>
				</div>
			)}

			{/* Bottom comparison stats */}
			<div className="grid grid-cols-3 gap-4 mt-6 pt-4 border-t border-[rgba(var(--console-cyan),0.1)]">
				{[
					{
						name: "Dense",
						color: "--console-cyan",
						value: data.length ? data.reduce((s, d) => s + d.dense, 0) / data.length : 0,
					},
					{
						name: "Sparse",
						color: "--console-amber",
						value: data.length ? data.reduce((s, d) => s + d.sparse, 0) / data.length : 0,
					},
					{
						name: "Hybrid",
						color: "--console-purple",
						value: data.length ? data.reduce((s, d) => s + d.hybrid, 0) / data.length : 0,
					},
				].map((strategy) => (
					<div key={strategy.name}>
						<div className="metric-label mb-1">{strategy.name} Avg</div>
						<div
							className="font-mono text-lg font-medium"
							style={{ color: `rgb(var(${strategy.color}))` }}
						>
							{strategy.value.toFixed(1)}ms
						</div>
					</div>
				))}
			</div>
		</div>
	);
}

// ============================================
// Skeleton Components
// ============================================

function PercentileSkeleton() {
	return (
		<div className="panel p-5 animate-pulse">
			<div className="flex items-start justify-between mb-4">
				<div className="w-11 h-11 rounded-lg bg-[rgb(var(--console-surface))]" />
				<div className="h-5 w-16 rounded bg-[rgb(var(--console-surface))]" />
			</div>
			<div className="h-10 w-28 rounded bg-[rgb(var(--console-surface))] mb-2" />
			<div className="h-4 w-20 rounded bg-[rgb(var(--console-surface))]" />
		</div>
	);
}

// ============================================
// Main Component
// ============================================

export default function PerformancePage() {
	const apiClient = useApiClient();
	const [timeRange, setTimeRange] = useState("24h");
	const [metrics, setMetrics] = useState<PerformanceMetrics | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [isRefreshing, setIsRefreshing] = useState(false);

	const fetchMetrics = useCallback(
		async (isInitial = false) => {
			if (isInitial) {
				setIsLoading(true);
			} else {
				setIsRefreshing(true);
			}

			try {
				const data = await apiClient.getPerformanceMetrics(timeRange);
				setMetrics(data);
			} catch (err) {
				console.error("Failed to fetch performance metrics:", err);
				// Keep empty state - no mock data
			} finally {
				setIsLoading(false);
				setIsRefreshing(false);
			}
		},
		[apiClient, timeRange],
	);

	// Initial fetch
	useEffect(() => {
		fetchMetrics(true);
	}, [fetchMetrics]);

	// Polling every 15 seconds
	useEffect(() => {
		const interval = setInterval(() => fetchMetrics(false), 15000);
		return () => clearInterval(interval);
	}, [fetchMetrics]);

	return (
		<div className="space-y-6">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="font-display text-2xl text-[rgb(var(--text-primary))] flex items-center gap-3">
						<div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[rgb(var(--console-cyan))] to-[rgb(var(--console-purple))] flex items-center justify-center">
							<Gauge className="w-4 h-4 text-[rgb(var(--console-void))]" />
						</div>
						Performance Analytics
					</h1>
					<p className="text-sm text-[rgb(var(--text-muted))] mt-1 ml-11">
						Latency metrics, percentiles, and search strategy performance
					</p>
				</div>

				<div className="flex items-center gap-4">
					{/* Refresh indicator */}
					{isRefreshing && (
						<div className="flex items-center gap-2 text-xs font-mono text-[rgb(var(--text-muted))]">
							<div className="w-2 h-2 rounded-full bg-[rgb(var(--console-cyan))] animate-pulse" />
							Updating...
						</div>
					)}

					<TimeRangeSelector value={timeRange} onChange={setTimeRange} />
				</div>
			</div>

			{/* Percentile Cards */}
			<section>
				<div className="flex items-center gap-2 mb-4">
					<div className="h-px flex-1 bg-gradient-to-r from-[rgba(var(--console-cyan),0.3)] to-transparent" />
					<span className="metric-label px-2">Latency Percentiles</span>
					<div className="h-px flex-1 bg-gradient-to-l from-[rgba(var(--console-cyan),0.3)] to-transparent" />
				</div>

				{isLoading ? (
					<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
						{["p50", "p95", "p99"].map((key) => (
							<PercentileSkeleton key={key} />
						))}
					</div>
				) : (
					<div className="grid grid-cols-1 md:grid-cols-3 gap-4 stagger">
						{metrics?.percentiles.map((p) => (
							<PercentileCard key={p.id} data={p} isLoading={isRefreshing} />
						))}
					</div>
				)}
			</section>

			{/* Charts Grid */}
			<div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
				<LatencyHistogram data={metrics?.latencyDistribution || []} isLoading={isLoading} />
				<StrategyComparisonChart data={metrics?.strategyComparison || []} isLoading={isLoading} />
			</div>
		</div>
	);
}
