import { createNodeLogger } from "@engram/logger";

const logger = createNodeLogger({
	service: "observatory",
	base: { component: "api-telemetry" },
});

export const trackUsage = (
	req: Request,
	status: number,
	duration: number,
	userId?: string,
	meta?: Record<string, unknown>,
) => {
	logger.info({
		event: "api_request",
		method: req.method,
		url: req.url,
		status,
		duration_ms: duration,
		userId,
		...meta,
	});
};

export const withTelemetry =
	(handler: (req: Request, ...args: unknown[]) => Promise<Response>) =>
	async (req: Request, ...args: unknown[]) => {
		const start = performance.now();
		let res: Response;
		try {
			res = await handler(req, ...args);
		} catch (e) {
			// Should have been caught by validate/apiError, but just in case
			res = new Response("Internal Server Error", { status: 500 });
			throw e;
		} finally {
			const duration = performance.now() - start;
			// Note: userId might not be easily accessible here without re-running auth()
			// We rely on downstream/upstream to set it or just log what we have.
			// If we really needed userId, we'd put this inside the auth block.
			trackUsage(req, res.status, duration);
		}
		return res;
	};
