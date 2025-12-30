"use client";

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
import { Area, AreaChart, Bar, BarChart, XAxis, YAxis } from "recharts";

import { Button } from "@/components/ui/button";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
	const selected = TIME_RANGES.find((r) => r.id === value) || TIME_RANGES[2];

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="outline" size="sm" className="gap-2 font-mono">
					<Clock className="h-4 w-4 text-primary" />
					<span>{selected.label}</span>
					<ChevronDown className="h-4 w-4" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				{TIME_RANGES.map((range) => (
					<DropdownMenuItem
						key={range.id}
						onClick={() => onChange(range.id)}
						className="font-mono text-xs"
					>
						{range.label}
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
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
	p50: "--success",
	p95: "--warning",
	p99: "--destructive",
};

function PercentileCard({ data, isLoading }: { data: PercentileData; isLoading: boolean }) {
	const Icon = PERCENTILE_ICONS[data.id] || Timer;
	const colorVar = PERCENTILE_COLORS[data.id] || "--primary";
	const isPositive = data.change <= 0; // Lower latency is better
	const isAboveThreshold = data.threshold && data.value > data.threshold;

	const chartData = data.sparkline.map((point) => ({
		index: point.index,
		value: point.value,
	}));

	const chartConfig = {
		value: {
			label: "Latency",
			color:
				data.id === "p99"
					? "hsl(var(--destructive))"
					: data.id === "p95"
						? "hsl(45 100% 50%)"
						: "hsl(142 76% 36%)",
		},
	};

	return (
		<div className="bg-card border border-border rounded-lg p-5 hover:-translate-y-0.5 hover:shadow-lg transition-all group relative overflow-hidden">
			{/* Background glow */}
			<div
				className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
				style={{
					background: `radial-gradient(ellipse at bottom right, color-mix(in oklch, var(${colorVar}) 6%, transparent) 0%, transparent 70%)`,
				}}
			/>

			{/* Threshold warning indicator */}
			{isAboveThreshold && (
				<div className="absolute top-0 right-0 w-12 h-12 overflow-hidden">
					<div className="absolute rotate-45 translate-x-4 -translate-y-2 w-16 h-6 flex items-center justify-center bg-amber-500">
						<span className="text-[8px] font-bold text-background">SLO</span>
					</div>
				</div>
			)}

			{/* Header */}
			<div className="flex items-start justify-between mb-4 relative">
				<div
					className="w-11 h-11 rounded-lg flex items-center justify-center transition-transform group-hover:scale-105"
					style={{ background: `color-mix(in oklch, var(${colorVar}) 12%, transparent)` }}
				>
					<Icon className="w-5 h-5" style={{ color: `hsl(var(${colorVar}))` }} />
				</div>

				<div
					className={`flex items-center gap-1 text-sm font-mono ${isPositive ? "text-green-500" : "text-destructive"}`}
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
					<div className="h-10 w-28 rounded bg-secondary animate-pulse" />
				) : (
					<span
						className="font-mono text-4xl font-semibold tracking-tight"
						style={{
							background: `linear-gradient(180deg, hsl(var(--foreground)) 0%, hsl(var(--secondary-foreground)) 100%)`,
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
			<div className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
				{data.label}
			</div>

			{/* Sparkline */}
			<div className="absolute bottom-3 right-3 w-24 h-10 opacity-30 group-hover:opacity-60 transition-opacity">
				<ChartContainer config={chartConfig} className="h-full w-full">
					<AreaChart data={chartData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
						<Area
							type="monotone"
							dataKey="value"
							stroke={chartConfig.value.color}
							fill={chartConfig.value.color}
							fillOpacity={0.3}
							strokeWidth={1}
						/>
					</AreaChart>
				</ChartContainer>
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

	const chartConfig = {
		Requests: {
			label: "Requests",
			color: "hsl(270 70% 60%)",
		},
	};

	return (
		<div className="bg-card border border-border rounded-lg p-6 relative overflow-hidden">
			{/* Corner accent */}
			<div
				className="absolute top-0 left-0 w-24 h-24 pointer-events-none"
				style={{
					background:
						"radial-gradient(circle at top left, color-mix(in oklch, var(--violet) 8%, transparent) 0%, transparent 70%)",
				}}
			/>

			{/* Header */}
			<div className="flex items-center justify-between mb-6 relative">
				<div>
					<h3 className="font-display text-lg text-foreground flex items-center gap-2">
						<div className="w-2 h-2 rounded-full bg-purple-500" />
						Latency Distribution
					</h3>
					<p className="text-sm text-muted-foreground mt-1 font-mono">
						Response time histogram by bucket
					</p>
				</div>

				{/* Legend */}
				<div className="flex items-center gap-4 text-xs font-mono text-muted-foreground">
					<div className="flex items-center gap-2">
						<div className="w-3 h-3 rounded-sm bg-purple-500" />
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
							className="flex-1 bg-secondary animate-pulse rounded-t"
							style={{ height: `${30 + ((i * 17) % 60)}%` }}
						/>
					))}
				</div>
			) : (
				<div className="h-72">
					<ChartContainer config={chartConfig} className="h-full w-full">
						<BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
							<XAxis dataKey="range" axisLine={false} tickLine={false} tick={{ fontSize: 10 }} />
							<YAxis
								width={60}
								axisLine={false}
								tickLine={false}
								tick={{ fontSize: 10 }}
								tickFormatter={(v) => `${v.toLocaleString()}`}
							/>
							<ChartTooltip
								content={<ChartTooltipContent />}
								cursor={{ fill: "var(--muted)", opacity: 0.2 }}
							/>
							<Bar dataKey="Requests" fill="var(--color-Requests)" radius={[4, 4, 0, 0]} />
						</BarChart>
					</ChartContainer>
				</div>
			)}

			{/* Bottom stats */}
			<div className="grid grid-cols-3 gap-4 mt-6 pt-4 border-t border-primary/10">
				<div>
					<div className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-1">
						Fastest Bucket
					</div>
					<div className="font-mono text-sm text-green-500">0-10ms</div>
				</div>
				<div>
					<div className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-1">
						Mode
					</div>
					<div className="font-mono text-sm text-foreground">
						{data.length > 0 ? data.reduce((a, b) => (a.count > b.count ? a : b)).range : "-"}
					</div>
				</div>
				<div>
					<div className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-1">
						Total Requests
					</div>
					<div className="font-mono text-sm text-foreground">
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

	const chartConfig = {
		Dense: {
			label: "Dense",
			color: "hsl(190 95% 50%)",
		},
		Sparse: {
			label: "Sparse",
			color: "hsl(45 100% 50%)",
		},
		Hybrid: {
			label: "Hybrid",
			color: "hsl(270 70% 60%)",
		},
	};

	return (
		<div className="bg-card border border-border rounded-lg p-6 relative overflow-hidden">
			{/* Corner accent */}
			<div
				className="absolute top-0 right-0 w-32 h-32 pointer-events-none"
				style={{
					background:
						"radial-gradient(circle at top right, color-mix(in oklch, var(--primary) 6%, transparent) 0%, transparent 70%)",
				}}
			/>

			{/* Header */}
			<div className="flex items-center justify-between mb-6 relative">
				<div>
					<h3 className="font-display text-lg text-foreground flex items-center gap-2">
						<Search className="w-4 h-4 text-primary" />
						Search Strategy Performance
					</h3>
					<p className="text-sm text-muted-foreground mt-1 font-mono">
						Avg latency by retrieval strategy over time
					</p>
				</div>

				{/* Strategy legend with badges */}
				<div className="flex items-center gap-3">
					{[
						{ name: "Dense", color: "--primary", desc: "Vector" },
						{ name: "Sparse", color: "--warning", desc: "BM25" },
						{ name: "Hybrid", color: "--violet", desc: "RRF" },
					].map((strategy) => (
						<div
							key={strategy.name}
							className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-secondary border border-primary/10"
						>
							<div
								className="w-2 h-2 rounded-full"
								style={{ background: `hsl(var(${strategy.color}))` }}
							/>
							<span className="text-xs font-mono text-secondary-foreground">{strategy.name}</span>
						</div>
					))}
				</div>
			</div>

			{/* Chart */}
			{isLoading ? (
				<div className="h-72 flex items-center justify-center">
					<div className="w-full h-48 bg-secondary animate-pulse rounded" />
				</div>
			) : (
				<div className="h-72">
					<ChartContainer config={chartConfig} className="h-full w-full">
						<AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
							<defs>
								<linearGradient id="gradientDense" x1="0" y1="0" x2="0" y2="1">
									<stop offset="0%" stopColor="var(--color-Dense)" stopOpacity={0.3} />
									<stop offset="100%" stopColor="var(--color-Dense)" stopOpacity={0} />
								</linearGradient>
								<linearGradient id="gradientSparse" x1="0" y1="0" x2="0" y2="1">
									<stop offset="0%" stopColor="var(--color-Sparse)" stopOpacity={0.3} />
									<stop offset="100%" stopColor="var(--color-Sparse)" stopOpacity={0} />
								</linearGradient>
								<linearGradient id="gradientHybrid" x1="0" y1="0" x2="0" y2="1">
									<stop offset="0%" stopColor="var(--color-Hybrid)" stopOpacity={0.3} />
									<stop offset="100%" stopColor="var(--color-Hybrid)" stopOpacity={0} />
								</linearGradient>
							</defs>
							<XAxis
								dataKey="timestamp"
								axisLine={false}
								tickLine={false}
								tick={{ fontSize: 10 }}
							/>
							<YAxis
								width={50}
								axisLine={false}
								tickLine={false}
								tick={{ fontSize: 10 }}
								tickFormatter={(v) => `${v}ms`}
							/>
							<ChartTooltip
								content={<ChartTooltipContent indicator="line" />}
								cursor={{ stroke: "var(--border)", strokeWidth: 1 }}
							/>
							<Area
								type="monotone"
								dataKey="Dense"
								stroke="var(--color-Dense)"
								fill="url(#gradientDense)"
								strokeWidth={1.5}
							/>
							<Area
								type="monotone"
								dataKey="Sparse"
								stroke="var(--color-Sparse)"
								fill="url(#gradientSparse)"
								strokeWidth={1.5}
							/>
							<Area
								type="monotone"
								dataKey="Hybrid"
								stroke="var(--color-Hybrid)"
								fill="url(#gradientHybrid)"
								strokeWidth={1.5}
							/>
						</AreaChart>
					</ChartContainer>
				</div>
			)}

			{/* Bottom comparison stats */}
			<div className="grid grid-cols-3 gap-4 mt-6 pt-4 border-t border-primary/10">
				{[
					{
						name: "Dense",
						color: "--primary",
						value: data.length ? data.reduce((s, d) => s + d.dense, 0) / data.length : 0,
					},
					{
						name: "Sparse",
						color: "--warning",
						value: data.length ? data.reduce((s, d) => s + d.sparse, 0) / data.length : 0,
					},
					{
						name: "Hybrid",
						color: "--violet",
						value: data.length ? data.reduce((s, d) => s + d.hybrid, 0) / data.length : 0,
					},
				].map((strategy) => (
					<div key={strategy.name}>
						<div className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-1">
							{strategy.name} Avg
						</div>
						<div
							className="font-mono text-lg font-medium"
							style={{ color: `hsl(var(${strategy.color}))` }}
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
		<div className="bg-card border border-border rounded-lg p-5 animate-pulse">
			<div className="flex items-start justify-between mb-4">
				<div className="w-11 h-11 rounded-lg bg-secondary" />
				<div className="h-5 w-16 rounded bg-secondary" />
			</div>
			<div className="h-10 w-28 rounded bg-secondary mb-2" />
			<div className="h-4 w-20 rounded bg-secondary" />
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
					<h1 className="font-display text-2xl text-foreground flex items-center gap-3">
						<div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-purple-500 flex items-center justify-center">
							<Gauge className="w-4 h-4 text-background" />
						</div>
						Performance Analytics
					</h1>
					<p className="text-sm text-muted-foreground mt-1 ml-11">
						Latency metrics, percentiles, and search strategy performance
					</p>
				</div>

				<div className="flex items-center gap-4">
					{/* Refresh indicator */}
					{isRefreshing && (
						<div className="flex items-center gap-2 text-xs font-mono text-muted-foreground">
							<div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
							Updating...
						</div>
					)}

					<TimeRangeSelector value={timeRange} onChange={setTimeRange} />
				</div>
			</div>

			{/* Percentile Cards */}
			<section>
				<div className="flex items-center gap-2 mb-4">
					<div className="h-px flex-1 bg-gradient-to-r from-primary/30 to-transparent" />
					<span className="text-xs font-mono uppercase tracking-wider text-muted-foreground px-2">
						Latency Percentiles
					</span>
					<div className="h-px flex-1 bg-gradient-to-l from-primary/30 to-transparent" />
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
