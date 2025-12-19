import { Hono } from "hono";

export function createHealthRoutes() {
	const app = new Hono();

	app.get("/health", (c) => {
		return c.json({
			success: true,
			data: {
				status: "healthy",
				service: "engram-api",
				version: "0.0.1",
				timestamp: new Date().toISOString(),
			},
		});
	});

	return app;
}
