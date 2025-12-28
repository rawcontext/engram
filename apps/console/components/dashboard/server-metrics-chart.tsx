"use client";

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
import { Area, AreaChart, XAxis, YAxis } from "recharts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Toggle } from "@/components/ui/toggle";
import { useApiClient } from "@/lib/api-client";

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

const TIME_RANGES: { value: TimeRange; label: string; resolution: string }[] = [
	{ value: "1h", label: "1 Hour", resolution: "1min" },
	{ value: "6h", label: "6 Hours", resolution: "5min" },
	{ value: "24h", label: "24 Hours", resolution: "15min" },
	{ value: "7d", label: "7 Days", resolution: "1hr" },
];

const METRIC_CATEGORIES = [
	{ id: "cpu", label: "CPU", color: "var(--chart-1)", icon: Cpu },
	{ id: "memory", label: "Memory", color: "var(--chart-2)", icon: Database },
	{ id: "diskRead", label: "Disk Read", color: "var(--chart-3)", icon: HardDrive },
	{ id: "diskWrite", label: "Disk Write", color: "var(--chart-4)", icon: HardDrive },
	{ id: "networkIn", label: "Net In", color: "var(--chart-5)", icon: ArrowDown },
	{ id: "networkOut", label: "Net Out", color: "var(--destructive)", icon: ArrowUp },
] as const;

function CurrentValueCard({
	icon: Icon,
	label,
	value,
	unit,
	subValue,
	warningThreshold,
	criticalThreshold,
}: {
	icon: typeof Cpu;
	label: string;
	value: number;
	unit: string;
	subValue?: string;
	warningThreshold?: number;
	criticalThreshold?: number;
}) {
	const isWarning = warningThreshold && value >= warningThreshold;
	const isCritical = criticalThreshold && value >= criticalThreshold;

	return (
		<div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 border">
			<div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
				<Icon className="h-5 w-5 text-primary" />
			</div>
			<div className="flex-1 min-w-0">
				<div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
				<div className="flex items-baseline gap-1">
					<span
						className={`font-mono text-xl font-semibold ${
							isCritical
								? "text-destructive animate-pulse"
								: isWarning
									? "text-amber-500 animate-pulse"
									: ""
						}`}
					>
						{value.toFixed(1)}
					</span>
					<span className="text-xs text-muted-foreground">{unit}</span>
				</div>
				{subValue && <div className="text-xs text-muted-foreground font-mono">{subValue}</div>}
			</div>
			{(isWarning || isCritical) && (
				<div className={`w-2 h-8 rounded-full ${isCritical ? "bg-destructive" : "bg-amber-500"}`} />
			)}
		</div>
	);
}

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

	const toggleMetric = (id: string) => {
		setEnabledMetrics((prev) => ({ ...prev, [id]: !prev[id] }));
	};

	const chartData = history.map((point) => ({
		time: new Date(point.timestamp).toLocaleTimeString("en-US", {
			hour: "2-digit",
			minute: "2-digit",
			...(timeRange === "7d" && { hour12: false }),
		}),
		cpu: point.cpu,
		memory: point.memory,
		diskRead: point.diskRead,
		diskWrite: point.diskWrite,
		networkIn: point.networkIn,
		networkOut: point.networkOut,
	}));

	const chartConfig = {
		cpu: { label: "CPU", color: "var(--chart-1)" },
		memory: { label: "Memory", color: "var(--chart-2)" },
		diskRead: { label: "Disk Read", color: "var(--chart-3)" },
		diskWrite: { label: "Disk Write", color: "var(--chart-4)" },
		networkIn: { label: "Net In", color: "var(--chart-5)" },
		networkOut: { label: "Net Out", color: "var(--destructive)" },
	};

	const selectedTimeRange = TIME_RANGES.find((r) => r.value === timeRange);
	const enabledMetricIds = Object.entries(enabledMetrics)
		.filter(([, enabled]) => enabled)
		.map(([id]) => id);

	if (isLoading) {
		return (
			<Card>
				<CardHeader>
					<div className="flex items-center justify-between">
						<Skeleton className="h-6 w-40" />
						<Skeleton className="h-8 w-32" />
					</div>
				</CardHeader>
				<CardContent className="space-y-4">
					<Skeleton className="h-[300px] w-full" />
					<div className="grid grid-cols-4 gap-4">
						{[1, 2, 3, 4].map((i) => (
							<Skeleton key={i} className="h-20" />
						))}
					</div>
				</CardContent>
			</Card>
		);
	}

	return (
		<Card className="relative overflow-hidden">
			<CardHeader>
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-3">
						<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-primary/20 to-[rgb(var(--console-purple))]/20">
							<Activity className="h-5 w-5 text-primary" />
						</div>
						<div>
							<CardTitle className="text-base">Server Metrics</CardTitle>
							<p className="text-xs text-muted-foreground font-mono">
								{serverId || "All Servers"} • Real-time resource monitoring
							</p>
						</div>
					</div>
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button variant="outline" size="sm" className="gap-2 font-mono">
								<Clock className="h-3.5 w-3.5" />
								{selectedTimeRange?.label}
								<span className="text-muted-foreground">({selectedTimeRange?.resolution})</span>
								<ChevronDown className="h-3.5 w-3.5" />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end">
							{TIME_RANGES.map((range) => (
								<DropdownMenuItem
									key={range.value}
									onClick={() => setTimeRange(range.value)}
									className="font-mono text-xs"
								>
									<span className="flex-1">{range.label}</span>
									<span className="text-muted-foreground">{range.resolution}</span>
								</DropdownMenuItem>
							))}
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
			</CardHeader>

			<CardContent className="space-y-4">
				{/* Metric Toggles */}
				<div className="flex flex-wrap gap-2">
					{METRIC_CATEGORIES.map((cat) => (
						<Toggle
							key={cat.id}
							pressed={enabledMetrics[cat.id]}
							onPressedChange={() => toggleMetric(cat.id)}
							size="sm"
							className="gap-1.5 font-mono text-xs data-[state=on]:bg-primary/10"
						>
							<div
								className="h-2 w-2 rounded-full"
								style={{ backgroundColor: enabledMetrics[cat.id] ? cat.color : "var(--muted)" }}
							/>
							{cat.label}
						</Toggle>
					))}
				</div>

				{/* Chart */}
				<div style={{ height }}>
					{enabledMetricIds.length > 0 ? (
						<ChartContainer config={chartConfig} className="h-full w-full">
							<AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
								<defs>
									{enabledMetricIds.map((id) => (
										<linearGradient key={id} id={`gradient-${id}`} x1="0" y1="0" x2="0" y2="1">
											<stop
												offset="0%"
												stopColor={chartConfig[id as keyof typeof chartConfig].color}
												stopOpacity={0.3}
											/>
											<stop
												offset="100%"
												stopColor={chartConfig[id as keyof typeof chartConfig].color}
												stopOpacity={0}
											/>
										</linearGradient>
									))}
								</defs>
								<XAxis
									dataKey="time"
									axisLine={false}
									tickLine={false}
									tick={{ fontSize: 10 }}
									tickMargin={8}
								/>
								<YAxis
									width={45}
									axisLine={false}
									tickLine={false}
									tick={{ fontSize: 10 }}
									tickFormatter={(v) => `${v}%`}
								/>
								<ChartTooltip
									content={<ChartTooltipContent indicator="line" />}
									cursor={{ stroke: "var(--border)", strokeWidth: 1 }}
								/>
								{enabledMetricIds.map((id) => (
									<Area
										key={id}
										type="monotone"
										dataKey={id}
										stroke={chartConfig[id as keyof typeof chartConfig].color}
										strokeWidth={1.5}
										fill={`url(#gradient-${id})`}
									/>
								))}
							</AreaChart>
						</ChartContainer>
					) : (
						<div className="h-full flex items-center justify-center">
							<div className="text-center">
								<Network className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
								<p className="text-sm text-muted-foreground">Select metrics to display</p>
							</div>
						</div>
					)}
				</div>

				{/* Current Values Grid */}
				{current && (
					<div className="grid grid-cols-2 lg:grid-cols-4 gap-4 pt-4 border-t">
						<CurrentValueCard
							icon={Cpu}
							label="CPU Usage"
							value={current.cpu.usage}
							unit="%"
							subValue={`${current.cpu.cores} cores`}
							warningThreshold={thresholds?.cpu.warning}
							criticalThreshold={thresholds?.cpu.critical}
						/>
						<CurrentValueCard
							icon={Database}
							label="Memory"
							value={current.memory.percentage}
							unit="%"
							subValue={`${current.memory.used.toFixed(1)}/${current.memory.total}GB`}
							warningThreshold={thresholds?.memory.warning}
							criticalThreshold={thresholds?.memory.critical}
						/>
						<CurrentValueCard
							icon={HardDrive}
							label="Disk I/O"
							value={current.disk.read + current.disk.write}
							unit="MB/s"
							subValue={`R: ${current.disk.read.toFixed(1)} W: ${current.disk.write.toFixed(1)}`}
						/>
						<CurrentValueCard
							icon={Network}
							label="Network"
							value={(current.network.in + current.network.out) / 1000}
							unit="Gbps"
							subValue={`In: ${current.network.in.toFixed(0)} Out: ${current.network.out.toFixed(0)} Mbps`}
						/>
					</div>
				)}
			</CardContent>
		</Card>
	);
}
