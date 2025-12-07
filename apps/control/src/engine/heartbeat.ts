export class HeartbeatService {
  // In XState implementation, heartbeat/timeouts are handled natively via 'after' transitions.
  // This service serves as a health check reporter for the system monitor.

  private lastHeartbeat: number = Date.now();

  ping() {
    this.lastHeartbeat = Date.now();
  }

  isHealthy(timeoutMs = 60000): boolean {
    return Date.now() - this.lastHeartbeat < timeoutMs;
  }

  getStats() {
    return {
      lastHeartbeat: new Date(this.lastHeartbeat).toISOString(),
      uptime: process.uptime(),
    };
  }
}
