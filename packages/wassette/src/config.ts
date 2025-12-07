export interface WassetteConfig {
  memoryLimit: number; // Pages (64KB chunks) or MB? Let's use MB for config, convert later.
  timeoutMs: number;
  env: Record<string, string>;
  preopens: Record<string, string>; // Host Path -> Guest Path
  stdin?: string;
}

export const DEFAULT_CONFIG: WassetteConfig = {
  memoryLimit: 512, // 512MB
  timeoutMs: 5000, // 5s
  env: {},
  preopens: {
    "/sandbox": "/app", // Default mount
  },
};
