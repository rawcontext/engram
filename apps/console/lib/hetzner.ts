/**
 * Hetzner Cloud API Integration
 *
 * Provides server metrics, info, and cost data from Hetzner Cloud.
 * Requires HETZNER_API_TOKEN environment variable.
 *
 * @see https://docs.hetzner.cloud/
 */

const HETZNER_API_BASE = "https://api.hetzner.cloud/v1";

export interface HetznerServer {
	id: number;
	name: string;
	status:
		| "running"
		| "initializing"
		| "starting"
		| "stopping"
		| "off"
		| "deleting"
		| "migrating"
		| "rebuilding"
		| "unknown";
	publicNet: {
		ipv4: { ip: string } | null;
		ipv6: { ip: string } | null;
	};
	serverType: {
		id: number;
		name: string;
		description: string;
		cores: number;
		memory: number;
		disk: number;
		cpuType: "shared" | "dedicated";
	};
	datacenter: {
		id: number;
		name: string;
		description: string;
		location: {
			id: number;
			name: string;
			city: string;
			country: string;
		};
	};
	created: string;
	labels: Record<string, string>;
}

export interface HetznerMetrics {
	start: string;
	end: string;
	step: number;
	timeSeries: Record<string, { values: [number, string][] }>;
}

export interface HetznerServerPrice {
	location: string;
	priceHourly: { net: string; gross: string };
	priceMonthly: { net: string; gross: string };
	includedTraffic: number;
	pricePerTbTraffic: { net: string; gross: string };
}

export interface HetznerServerType {
	id: number;
	name: string;
	description: string;
	cores: number;
	memory: number;
	disk: number;
	deprecated: boolean;
	prices: HetznerServerPrice[];
	storageType: "local" | "network";
	cpuType: "shared" | "dedicated";
	architecture: "x86" | "arm";
}

export interface ServerMetricsData {
	cpu: {
		usage: number;
		history: { timestamp: number; value: number }[];
	};
	memory: {
		used: number;
		total: number;
		percentage: number;
	};
	disk: {
		readBps: number;
		writeBps: number;
		history: { timestamp: number; read: number; write: number }[];
	};
	network: {
		inBps: number;
		outBps: number;
		history: { timestamp: number; in: number; out: number }[];
	};
	bandwidth: {
		usedBytes: number;
		includedBytes: number;
		percentage: number;
	};
}

export interface ServerInfo {
	id: number;
	name: string;
	status: HetznerServer["status"];
	ip: string | null;
	location: string;
	serverType: string;
	cores: number;
	memory: number;
	disk: number;
	cpuType: "shared" | "dedicated";
	created: string;
	labels: Record<string, string>;
	monthlyCost: {
		net: number;
		gross: number;
		currency: string;
	} | null;
}

class HetznerClient {
	private token: string;

	constructor(token: string) {
		this.token = token;
	}

	private async fetch<T>(path: string, options: RequestInit = {}): Promise<T> {
		const response = await fetch(`${HETZNER_API_BASE}${path}`, {
			...options,
			headers: {
				Authorization: `Bearer ${this.token}`,
				"Content-Type": "application/json",
				...options.headers,
			},
		});

		if (!response.ok) {
			const error = await response.json().catch(() => ({}));
			throw new Error(error.error?.message || `Hetzner API error: ${response.status}`);
		}

		return response.json();
	}

	/**
	 * List all servers in the account
	 */
	async listServers(): Promise<HetznerServer[]> {
		const data = await this.fetch<{ servers: RawServer[] }>("/servers");
		return data.servers.map(mapServer);
	}

	/**
	 * Get a single server by ID
	 */
	async getServer(id: number): Promise<HetznerServer> {
		const data = await this.fetch<{ server: RawServer }>(`/servers/${id}`);
		return mapServer(data.server);
	}

	/**
	 * Get server metrics (CPU, disk, or network)
	 */
	async getServerMetrics(
		id: number,
		type: "cpu" | "disk" | "network",
		start: Date,
		end: Date,
		step?: number,
	): Promise<HetznerMetrics> {
		const params = new URLSearchParams({
			type,
			start: start.toISOString(),
			end: end.toISOString(),
		});
		if (step) params.set("step", step.toString());

		const data = await this.fetch<{ metrics: RawMetrics }>(`/servers/${id}/metrics?${params}`);
		return mapMetrics(data.metrics);
	}

	/**
	 * Get all server types with pricing
	 */
	async getServerTypes(): Promise<HetznerServerType[]> {
		const data = await this.fetch<{ server_types: RawServerType[] }>("/server_types");
		return data.server_types.map(mapServerType);
	}

	/**
	 * Get pricing information
	 */
	async getPricing(): Promise<{
		currency: string;
		vatRate: string;
		serverTypes: { id: number; name: string; prices: HetznerServerPrice[] }[];
	}> {
		const data = await this.fetch<{ pricing: RawPricing }>("/pricing");
		return {
			currency: data.pricing.currency,
			vatRate: data.pricing.vat_rate,
			serverTypes: data.pricing.server_types.map((st) => ({
				id: st.id,
				name: st.name,
				prices: st.prices.map(mapPrice),
			})),
		};
	}

	/**
	 * Get comprehensive server info including monthly cost
	 */
	async getServerInfo(id: number): Promise<ServerInfo> {
		const [server, pricing] = await Promise.all([this.getServer(id), this.getPricing()]);

		const serverTypePricing = pricing.serverTypes.find((st) => st.name === server.serverType.name);
		const locationPricing = serverTypePricing?.prices.find(
			(p) => p.location === server.datacenter.location.name,
		);

		return {
			id: server.id,
			name: server.name,
			status: server.status,
			ip: server.publicNet.ipv4?.ip ?? server.publicNet.ipv6?.ip ?? null,
			location: `${server.datacenter.location.city}, ${server.datacenter.location.country}`,
			serverType: server.serverType.name,
			cores: server.serverType.cores,
			memory: server.serverType.memory,
			disk: server.serverType.disk,
			cpuType: server.serverType.cpuType,
			created: server.created,
			labels: server.labels,
			monthlyCost: locationPricing
				? {
						net: Number.parseFloat(locationPricing.priceMonthly.net),
						gross: Number.parseFloat(locationPricing.priceMonthly.gross),
						currency: pricing.currency,
					}
				: null,
		};
	}

	/**
	 * Get server metrics data formatted for dashboard display
	 */
	async getServerMetricsData(
		id: number,
		timeRange: "1h" | "6h" | "24h" | "7d" = "1h",
	): Promise<ServerMetricsData> {
		const now = new Date();
		const rangeMs: Record<string, number> = {
			"1h": 60 * 60 * 1000,
			"6h": 6 * 60 * 60 * 1000,
			"24h": 24 * 60 * 60 * 1000,
			"7d": 7 * 24 * 60 * 60 * 1000,
		};
		const start = new Date(now.getTime() - rangeMs[timeRange]);

		// Fetch all metric types in parallel
		const [cpuMetrics, diskMetrics, networkMetrics, server, serverTypes] = await Promise.all([
			this.getServerMetrics(id, "cpu", start, now),
			this.getServerMetrics(id, "disk", start, now),
			this.getServerMetrics(id, "network", start, now),
			this.getServer(id),
			this.getServerTypes(),
		]);

		// Get included traffic for bandwidth calculation
		const serverType = serverTypes.find((st) => st.name === server.serverType.name);
		const includedTraffic = serverType?.prices[0]?.includedTraffic ?? 0;

		// Parse CPU metrics
		const cpuValues = cpuMetrics.timeSeries.cpu?.values ?? [];
		const cpuHistory = cpuValues.map(([ts, val]) => ({
			timestamp: ts * 1000,
			value: Number.parseFloat(val),
		}));
		const currentCpu = cpuHistory.length > 0 ? cpuHistory[cpuHistory.length - 1].value : 0;

		// Parse disk metrics
		const diskReadValues = diskMetrics.timeSeries["disk.0.iops.read"]?.values ?? [];
		const diskWriteValues = diskMetrics.timeSeries["disk.0.iops.write"]?.values ?? [];
		const diskHistory = diskReadValues.map(([ts, val], i) => ({
			timestamp: ts * 1000,
			read: Number.parseFloat(val),
			write: Number.parseFloat(diskWriteValues[i]?.[1] ?? "0"),
		}));
		const currentDiskRead = diskHistory.length > 0 ? diskHistory[diskHistory.length - 1].read : 0;
		const currentDiskWrite = diskHistory.length > 0 ? diskHistory[diskHistory.length - 1].write : 0;

		// Parse network metrics
		const netInValues = networkMetrics.timeSeries["network.0.bandwidth.in"]?.values ?? [];
		const netOutValues = networkMetrics.timeSeries["network.0.bandwidth.out"]?.values ?? [];
		const networkHistory = netInValues.map(([ts, val], i) => ({
			timestamp: ts * 1000,
			in: Number.parseFloat(val),
			out: Number.parseFloat(netOutValues[i]?.[1] ?? "0"),
		}));
		const currentNetIn =
			networkHistory.length > 0 ? networkHistory[networkHistory.length - 1].in : 0;
		const currentNetOut =
			networkHistory.length > 0 ? networkHistory[networkHistory.length - 1].out : 0;

		// Calculate total bandwidth used (sum of in + out over the period)
		const totalBandwidth = networkHistory.reduce((sum, point) => sum + point.in + point.out, 0);

		return {
			cpu: {
				usage: currentCpu,
				history: cpuHistory,
			},
			memory: {
				// Hetzner doesn't expose memory metrics via API, use server type info
				used: 0, // Would need agent-based monitoring
				total: server.serverType.memory * 1024 * 1024 * 1024, // GB to bytes
				percentage: 0,
			},
			disk: {
				readBps: currentDiskRead,
				writeBps: currentDiskWrite,
				history: diskHistory,
			},
			network: {
				inBps: currentNetIn,
				outBps: currentNetOut,
				history: networkHistory,
			},
			bandwidth: {
				usedBytes: totalBandwidth,
				includedBytes: includedTraffic,
				percentage: includedTraffic > 0 ? (totalBandwidth / includedTraffic) * 100 : 0,
			},
		};
	}
}

// Raw API response types (snake_case)
interface RawServer {
	id: number;
	name: string;
	status: HetznerServer["status"];
	public_net: {
		ipv4: { ip: string } | null;
		ipv6: { ip: string } | null;
	};
	server_type: {
		id: number;
		name: string;
		description: string;
		cores: number;
		memory: number;
		disk: number;
		cpu_type: "shared" | "dedicated";
	};
	datacenter: {
		id: number;
		name: string;
		description: string;
		location: {
			id: number;
			name: string;
			city: string;
			country: string;
		};
	};
	created: string;
	labels: Record<string, string>;
}

interface RawMetrics {
	start: string;
	end: string;
	step: number;
	time_series: Record<string, { values: [number, string][] }>;
}

interface RawServerType {
	id: number;
	name: string;
	description: string;
	cores: number;
	memory: number;
	disk: number;
	deprecated: boolean;
	prices: RawPrice[];
	storage_type: "local" | "network";
	cpu_type: "shared" | "dedicated";
	architecture: "x86" | "arm";
}

interface RawPrice {
	location: string;
	price_hourly: { net: string; gross: string };
	price_monthly: { net: string; gross: string };
	included_traffic: number;
	price_per_tb_traffic: { net: string; gross: string };
}

interface RawPricing {
	currency: string;
	vat_rate: string;
	server_types: { id: number; name: string; prices: RawPrice[] }[];
}

// Mapping functions
function mapServer(raw: RawServer): HetznerServer {
	return {
		id: raw.id,
		name: raw.name,
		status: raw.status,
		publicNet: {
			ipv4: raw.public_net.ipv4,
			ipv6: raw.public_net.ipv6,
		},
		serverType: {
			id: raw.server_type.id,
			name: raw.server_type.name,
			description: raw.server_type.description,
			cores: raw.server_type.cores,
			memory: raw.server_type.memory,
			disk: raw.server_type.disk,
			cpuType: raw.server_type.cpu_type,
		},
		datacenter: raw.datacenter,
		created: raw.created,
		labels: raw.labels,
	};
}

function mapMetrics(raw: RawMetrics): HetznerMetrics {
	return {
		start: raw.start,
		end: raw.end,
		step: raw.step,
		timeSeries: raw.time_series,
	};
}

function mapServerType(raw: RawServerType): HetznerServerType {
	return {
		id: raw.id,
		name: raw.name,
		description: raw.description,
		cores: raw.cores,
		memory: raw.memory,
		disk: raw.disk,
		deprecated: raw.deprecated,
		prices: raw.prices.map(mapPrice),
		storageType: raw.storage_type,
		cpuType: raw.cpu_type,
		architecture: raw.architecture,
	};
}

function mapPrice(raw: RawPrice): HetznerServerPrice {
	return {
		location: raw.location,
		priceHourly: raw.price_hourly,
		priceMonthly: raw.price_monthly,
		includedTraffic: raw.included_traffic,
		pricePerTbTraffic: raw.price_per_tb_traffic,
	};
}

/**
 * Create a Hetzner client instance
 * Uses HETZNER_API_TOKEN environment variable
 */
export function createHetznerClient(): HetznerClient | null {
	const token = process.env.HETZNER_API_TOKEN;
	if (!token) {
		return null;
	}
	return new HetznerClient(token);
}

/**
 * Get Hetzner client, throwing if not configured
 */
export function getHetznerClient(): HetznerClient {
	const client = createHetznerClient();
	if (!client) {
		throw new Error("HETZNER_API_TOKEN environment variable is not set");
	}
	return client;
}
