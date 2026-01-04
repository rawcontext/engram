/**
 * Docker Engine API Integration
 *
 * Provides container list, stats, and management actions via Unix socket.
 * Requires access to Docker socket (typically /var/run/docker.sock).
 *
 * @see https://docs.docker.com/engine/api/
 */

const DOCKER_SOCKET_PATH = process.env.DOCKER_SOCKET_PATH ?? "/var/run/docker.sock";

export interface Container {
	id: string;
	names: string[];
	image: string;
	imageId: string;
	command: string;
	created: number;
	state: "created" | "restarting" | "running" | "removing" | "paused" | "exited" | "dead";
	status: string;
	ports: ContainerPort[];
	labels: Record<string, string>;
	networkMode: string;
	mounts: ContainerMount[];
}

export interface ContainerPort {
	privatePort: number;
	publicPort?: number;
	type: "tcp" | "udp";
	ip?: string;
}

export interface ContainerMount {
	type: "bind" | "volume" | "tmpfs";
	source: string;
	destination: string;
	mode: string;
	rw: boolean;
}

export interface ContainerStats {
	id: string;
	name: string;
	cpu: {
		usage: number;
		system: number;
		percentage: number;
	};
	memory: {
		usage: number;
		limit: number;
		percentage: number;
	};
	network: {
		rxBytes: number;
		txBytes: number;
		rxPackets: number;
		txPackets: number;
	};
	blockIO: {
		read: number;
		write: number;
	};
	pids: number;
	timestamp: string;
}

export interface ContainerInfo extends Container {
	stats?: ContainerStats;
}

class DockerClient {
	private socketPath: string;

	constructor(socketPath: string = DOCKER_SOCKET_PATH) {
		this.socketPath = socketPath;
	}

	/**
	 * Make a request to the Docker Engine API via Unix socket
	 */
	private async fetch<T>(path: string, options: RequestInit = {}): Promise<T> {
		// Use Bun's native Unix socket support
		const response = await fetch(`unix://${this.socketPath}:${path}`, {
			...options,
			headers: {
				"Content-Type": "application/json",
				...options.headers,
			},
		});

		if (!response.ok) {
			const error = await response.json().catch(() => ({}));
			throw new Error(error.message || `Docker API error: ${response.status}`);
		}

		return response.json();
	}

	/**
	 * List all containers
	 */
	async listContainers(all = true): Promise<Container[]> {
		const params = new URLSearchParams({ all: String(all) });
		const data = await this.fetch<RawContainer[]>(`/containers/json?${params}`);
		return data.map(mapContainer);
	}

	/**
	 * Get container stats (one-shot, not streaming)
	 */
	async getContainerStats(id: string): Promise<ContainerStats> {
		// stream=false returns a single stats snapshot instead of streaming
		const data = await this.fetch<RawStats>(`/containers/${id}/stats?stream=false`);
		return mapStats(id, data);
	}

	/**
	 * Get all containers with their stats
	 */
	async getContainersWithStats(all = false): Promise<ContainerInfo[]> {
		const containers = await this.listContainers(all);

		// Only fetch stats for running containers
		const runningContainers = containers.filter((c) => c.state === "running");

		const statsPromises = runningContainers.map(async (container) => {
			try {
				const stats = await this.getContainerStats(container.id);
				return { id: container.id, stats };
			} catch {
				return { id: container.id, stats: undefined };
			}
		});

		const statsResults = await Promise.all(statsPromises);
		const statsMap = new Map(statsResults.map((r) => [r.id, r.stats]));

		return containers.map((container) => ({
			...container,
			stats: statsMap.get(container.id),
		}));
	}

	/**
	 * Stop a container
	 */
	async stopContainer(id: string, timeout = 10): Promise<void> {
		await this.fetch(`/containers/${id}/stop?t=${timeout}`, { method: "POST" });
	}

	/**
	 * Start a container
	 */
	async startContainer(id: string): Promise<void> {
		await this.fetch(`/containers/${id}/start`, { method: "POST" });
	}

	/**
	 * Restart a container
	 */
	async restartContainer(id: string, timeout = 10): Promise<void> {
		await this.fetch(`/containers/${id}/restart?t=${timeout}`, { method: "POST" });
	}

	/**
	 * Pause a container
	 */
	async pauseContainer(id: string): Promise<void> {
		await this.fetch(`/containers/${id}/pause`, { method: "POST" });
	}

	/**
	 * Unpause a container
	 */
	async unpauseContainer(id: string): Promise<void> {
		await this.fetch(`/containers/${id}/unpause`, { method: "POST" });
	}

	/**
	 * Get container logs
	 */
	async getContainerLogs(
		id: string,
		options: { tail?: number; since?: number; timestamps?: boolean } = {},
	): Promise<string> {
		const params = new URLSearchParams({
			stdout: "true",
			stderr: "true",
			tail: String(options.tail ?? 100),
			timestamps: String(options.timestamps ?? false),
		});
		if (options.since) params.set("since", String(options.since));

		const response = await fetch(`unix://${this.socketPath}:/containers/${id}/logs?${params}`);
		if (!response.ok) {
			throw new Error(`Docker API error: ${response.status}`);
		}

		// Logs are returned as raw stream with multiplexed stdout/stderr
		const buffer = await response.arrayBuffer();
		return parseDockerLogs(buffer);
	}

	/**
	 * Check if Docker is available
	 */
	async ping(): Promise<boolean> {
		try {
			const response = await fetch(`unix://${this.socketPath}:/_ping`);
			return response.ok;
		} catch {
			return false;
		}
	}

	/**
	 * Get Docker version info
	 */
	async version(): Promise<{ version: string; apiVersion: string; os: string; arch: string }> {
		const data = await this.fetch<{
			Version: string;
			ApiVersion: string;
			Os: string;
			Arch: string;
		}>("/version");
		return {
			version: data.Version,
			apiVersion: data.ApiVersion,
			os: data.Os,
			arch: data.Arch,
		};
	}
}

// Raw API response types
interface RawContainer {
	Id: string;
	Names: string[];
	Image: string;
	ImageID: string;
	Command: string;
	Created: number;
	State: Container["state"];
	Status: string;
	Ports: Array<{
		PrivatePort: number;
		PublicPort?: number;
		Type: "tcp" | "udp";
		IP?: string;
	}>;
	Labels: Record<string, string>;
	HostConfig: { NetworkMode: string };
	Mounts: Array<{
		Type: "bind" | "volume" | "tmpfs";
		Source: string;
		Destination: string;
		Mode: string;
		RW: boolean;
	}>;
}

interface RawStats {
	read: string;
	cpu_stats: {
		cpu_usage: {
			total_usage: number;
		};
		system_cpu_usage: number;
		online_cpus: number;
	};
	precpu_stats: {
		cpu_usage: {
			total_usage: number;
		};
		system_cpu_usage: number;
	};
	memory_stats: {
		usage: number;
		limit: number;
	};
	networks?: Record<
		string,
		{
			rx_bytes: number;
			tx_bytes: number;
			rx_packets: number;
			tx_packets: number;
		}
	>;
	blkio_stats?: {
		io_service_bytes_recursive?: Array<{
			op: string;
			value: number;
		}>;
	};
	pids_stats: {
		current: number;
	};
	name: string;
}

// Mapping functions
function mapContainer(raw: RawContainer): Container {
	return {
		id: raw.Id,
		names: raw.Names.map((n) => n.replace(/^\//, "")), // Remove leading /
		image: raw.Image,
		imageId: raw.ImageID,
		command: raw.Command,
		created: raw.Created,
		state: raw.State,
		status: raw.Status,
		ports: raw.Ports.map((p) => ({
			privatePort: p.PrivatePort,
			publicPort: p.PublicPort,
			type: p.Type,
			ip: p.IP,
		})),
		labels: raw.Labels,
		networkMode: raw.HostConfig.NetworkMode,
		mounts: raw.Mounts.map((m) => ({
			type: m.Type,
			source: m.Source,
			destination: m.Destination,
			mode: m.Mode,
			rw: m.RW,
		})),
	};
}

function mapStats(id: string, raw: RawStats): ContainerStats {
	// Calculate CPU percentage
	const cpuDelta = raw.cpu_stats.cpu_usage.total_usage - raw.precpu_stats.cpu_usage.total_usage;
	const systemDelta = raw.cpu_stats.system_cpu_usage - raw.precpu_stats.system_cpu_usage;
	const cpuPercent =
		systemDelta > 0 ? (cpuDelta / systemDelta) * raw.cpu_stats.online_cpus * 100 : 0;

	// Aggregate network stats across all interfaces
	const networks = raw.networks ?? {};
	const networkStats = Object.values(networks).reduce(
		(acc, net) => ({
			rxBytes: acc.rxBytes + net.rx_bytes,
			txBytes: acc.txBytes + net.tx_bytes,
			rxPackets: acc.rxPackets + net.rx_packets,
			txPackets: acc.txPackets + net.tx_packets,
		}),
		{ rxBytes: 0, txBytes: 0, rxPackets: 0, txPackets: 0 },
	);

	// Parse block I/O stats
	const blkioStats = raw.blkio_stats?.io_service_bytes_recursive ?? [];
	const blockRead = blkioStats.find((s) => s.op === "Read")?.value ?? 0;
	const blockWrite = blkioStats.find((s) => s.op === "Write")?.value ?? 0;

	return {
		id,
		name: raw.name.replace(/^\//, ""),
		cpu: {
			usage: raw.cpu_stats.cpu_usage.total_usage,
			system: raw.cpu_stats.system_cpu_usage,
			percentage: Math.round(cpuPercent * 100) / 100,
		},
		memory: {
			usage: raw.memory_stats.usage,
			limit: raw.memory_stats.limit,
			percentage: Math.round((raw.memory_stats.usage / raw.memory_stats.limit) * 10000) / 100,
		},
		network: networkStats,
		blockIO: {
			read: blockRead,
			write: blockWrite,
		},
		pids: raw.pids_stats.current,
		timestamp: raw.read,
	};
}

/**
 * Parse Docker multiplexed log stream
 * Format: 8-byte header (1 byte stream type, 3 unused, 4 bytes size) + payload
 */
function parseDockerLogs(buffer: ArrayBuffer): string {
	const view = new DataView(buffer);
	const decoder = new TextDecoder();
	const lines: string[] = [];

	let offset = 0;
	while (offset < buffer.byteLength - 8) {
		// Stream type: 0=stdin, 1=stdout, 2=stderr
		// const streamType = view.getUint8(offset);
		// Next 3 bytes unused

		// Size is big-endian 32-bit at offset 4
		const size = view.getUint32(offset + 4, false);

		if (offset + 8 + size > buffer.byteLength) break;

		const payload = new Uint8Array(buffer, offset + 8, size);
		lines.push(decoder.decode(payload));

		offset += 8 + size;
	}

	return lines.join("");
}

/**
 * Create a Docker client instance
 * Uses DOCKER_SOCKET_PATH environment variable or default /var/run/docker.sock
 */
export function createDockerClient(): DockerClient {
	return new DockerClient();
}

/**
 * Check if Docker is available on this system
 */
export async function isDockerAvailable(): Promise<boolean> {
	try {
		const client = createDockerClient();
		return await client.ping();
	} catch {
		return false;
	}
}
