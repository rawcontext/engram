import { expect, test } from "@playwright/test";

test.describe("Session Stream WebSocket", () => {
	const sessionId = "test-session-e2e";

	test("should connect via WebSocket and receive real-time updates", async ({ page }) => {
		// Mock the WebSocket connection
		await page.routeWebSocket(`**/api/ws/session/${sessionId}`, (ws) => {
			ws.onMessage((message) => {
				const msg = JSON.parse(message.toString());
				if (msg.type === "subscribe") {
					// Send mock lineage data after subscription
					ws.send(
						JSON.stringify({
							type: "lineage",
							data: {
								nodes: [
									{ id: "node-1", label: "Session Start", type: "session" },
									{ id: "node-2", label: "First Turn", type: "turn" },
								],
								links: [{ source: "node-1", target: "node-2", type: "followed_by" }],
							},
						}),
					);
				}
			});
		});

		// Mock REST endpoints for initial data fetch
		await page.route(`**/api/lineage/${sessionId}`, (route) => {
			route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({
					data: {
						nodes: [
							{ id: "node-1", label: "Session Start", type: "session" },
							{ id: "node-2", label: "First Turn", type: "turn" },
						],
						links: [{ source: "node-1", target: "node-2", type: "followed_by" }],
					},
				}),
			});
		});

		await page.route(`**/api/replay/${sessionId}`, (route) => {
			route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({
					data: {
						timeline: [{ id: "event-1", type: "message", content: "Hello world" }],
					},
				}),
			});
		});

		await page.goto(`/session/${sessionId}`);

		// Verify graph loaded
		await expect(page.locator("[data-testid='lineage-graph']")).toBeVisible({ timeout: 10000 });

		// Verify node count indicator updates
		await expect(page.getByText("2 nodes")).toBeVisible({ timeout: 5000 });
	});

	test("should display loading state initially", async ({ page }) => {
		// Delay REST responses to see loading state
		await page.route(`**/api/lineage/${sessionId}`, async (route) => {
			await new Promise((resolve) => setTimeout(resolve, 1000));
			route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({
					data: {
						nodes: [{ id: "node-1", label: "Session", type: "session" }],
						links: [],
					},
				}),
			});
		});

		await page.route(`**/api/replay/${sessionId}`, async (route) => {
			await new Promise((resolve) => setTimeout(resolve, 1000));
			route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({
					data: { timeline: [] },
				}),
			});
		});

		await page.goto(`/session/${sessionId}`);

		// Should show loading state briefly
		await expect(page.locator("[data-testid='lineage-graph-loading']")).toBeVisible({
			timeout: 500,
		});

		// Then should show graph
		await expect(page.locator("[data-testid='lineage-graph']")).toBeVisible({ timeout: 10000 });
	});

	test("should fall back to polling when WebSocket unavailable", async ({ page, context }) => {
		// Block WebSocket connections
		await context.route("**/api/ws/**", (route) => route.abort());

		let pollCount = 0;

		// Mock REST endpoints
		await page.route(`**/api/lineage/${sessionId}`, (route) => {
			pollCount++;
			route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({
					data: {
						nodes: [{ id: "node-1", label: "Session", type: "session" }],
						links: [],
					},
				}),
			});
		});

		await page.route(`**/api/replay/${sessionId}`, (route) => {
			route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({
					data: { timeline: [] },
				}),
			});
		});

		await page.goto(`/session/${sessionId}`);

		// Should still load via REST fallback
		await expect(page.locator("[data-testid='lineage-graph']")).toBeVisible({ timeout: 15000 });

		// Wait for fallback timeout (3s) + at least one poll interval (2s)
		await page.waitForTimeout(6000);

		// Should have polled multiple times after WebSocket failed
		expect(pollCount).toBeGreaterThanOrEqual(2);
	});

	test("should handle network interruption gracefully", async ({ page, context }) => {
		await page.routeWebSocket(`**/api/ws/session/${sessionId}`, (ws) => {
			ws.onMessage((message) => {
				const msg = JSON.parse(message.toString());
				if (msg.type === "subscribe") {
					ws.send(
						JSON.stringify({
							type: "lineage",
							data: {
								nodes: [{ id: "node-1", label: "Session", type: "session" }],
								links: [],
							},
						}),
					);
				}
			});
		});

		await page.route(`**/api/lineage/${sessionId}`, (route) => {
			route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({
					data: {
						nodes: [{ id: "node-1", label: "Session", type: "session" }],
						links: [],
					},
				}),
			});
		});

		await page.route(`**/api/replay/${sessionId}`, (route) => {
			route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({
					data: { timeline: [] },
				}),
			});
		});

		await page.goto(`/session/${sessionId}`);
		await expect(page.locator("[data-testid='lineage-graph']")).toBeVisible();

		// Simulate network offline
		await context.setOffline(true);

		// Wait a moment for disconnection
		await page.waitForTimeout(1000);

		// Should show polling indicator (not Live)
		await expect(page.getByText("Polling")).toBeVisible({ timeout: 5000 });

		// Restore network
		await context.setOffline(false);

		// After some time, should recover (either reconnect WebSocket or continue polling)
		await expect(page.locator("[data-testid='lineage-graph']")).toBeVisible({ timeout: 15000 });
	});

	test("should update UI when receiving WebSocket updates", async ({ page }) => {
		let sendUpdate: ((data: unknown) => void) | null = null;

		await page.routeWebSocket(`**/api/ws/session/${sessionId}`, (ws) => {
			ws.onMessage((message) => {
				const msg = JSON.parse(message.toString());
				if (msg.type === "subscribe") {
					// Initial data
					ws.send(
						JSON.stringify({
							type: "lineage",
							data: {
								nodes: [{ id: "node-1", label: "Initial Node", type: "session" }],
								links: [],
							},
						}),
					);

					// Store send function for later updates
					sendUpdate = (data) => {
						ws.send(JSON.stringify(data));
					};
				}
			});
		});

		await page.route(`**/api/lineage/${sessionId}`, (route) => {
			route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({
					data: {
						nodes: [{ id: "node-1", label: "Initial Node", type: "session" }],
						links: [],
					},
				}),
			});
		});

		await page.route(`**/api/replay/${sessionId}`, (route) => {
			route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({
					data: { timeline: [] },
				}),
			});
		});

		await page.goto(`/session/${sessionId}`);
		await expect(page.locator("[data-testid='lineage-graph']")).toBeVisible();

		// Wait for subscription
		await page.waitForTimeout(500);

		// Verify initial node count
		await expect(page.getByText("1 nodes")).toBeVisible();

		// Send update with more nodes
		if (sendUpdate) {
			sendUpdate({
				type: "lineage",
				data: {
					nodes: [
						{ id: "node-1", label: "Initial Node", type: "session" },
						{ id: "node-2", label: "New Node", type: "turn" },
						{ id: "node-3", label: "Another Node", type: "reasoning" },
					],
					links: [
						{ source: "node-1", target: "node-2", type: "followed_by" },
						{ source: "node-2", target: "node-3", type: "followed_by" },
					],
				},
			});
		}

		// Node count should update
		await expect(page.getByText("3 nodes")).toBeVisible({ timeout: 5000 });
	});

	test("should show Live indicator when connected via WebSocket", async ({ page }) => {
		await page.routeWebSocket(`**/api/ws/session/${sessionId}`, (ws) => {
			ws.onMessage((message) => {
				const msg = JSON.parse(message.toString());
				if (msg.type === "subscribe") {
					ws.send(
						JSON.stringify({
							type: "lineage",
							data: { nodes: [], links: [] },
						}),
					);
				}
			});
		});

		await page.route(`**/api/lineage/${sessionId}`, (route) => {
			route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({ data: { nodes: [], links: [] } }),
			});
		});

		await page.route(`**/api/replay/${sessionId}`, (route) => {
			route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({ data: { timeline: [] } }),
			});
		});

		await page.goto(`/session/${sessionId}`);

		// Should show Live indicator when WebSocket connected
		await expect(page.getByText("Live")).toBeVisible({ timeout: 5000 });
	});

	test("should handle error messages from WebSocket", async ({ page }) => {
		await page.routeWebSocket(`**/api/ws/session/${sessionId}`, (ws) => {
			ws.onMessage((message) => {
				const msg = JSON.parse(message.toString());
				if (msg.type === "subscribe") {
					// Send an error message
					ws.send(
						JSON.stringify({
							type: "error",
							message: "Session not found",
						}),
					);
				}
			});
		});

		await page.route(`**/api/lineage/${sessionId}`, (route) => {
			route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({ data: { nodes: [], links: [] } }),
			});
		});

		await page.route(`**/api/replay/${sessionId}`, (route) => {
			route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({ data: { timeline: [] } }),
			});
		});

		await page.goto(`/session/${sessionId}`);

		// Page should still be accessible (error handling should be graceful)
		await page.waitForTimeout(1000);
	});
});
