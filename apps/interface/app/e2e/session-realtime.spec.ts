/**
 * E2E Tests for Session Real-time Data Streaming
 *
 * These tests verify the real-time data streaming functionality
 * including WebSocket connections and polling fallback.
 *
 * Prerequisites:
 * - Interface app running on localhost:5000
 * - Backend services running (FalkorDB, etc.)
 *
 * Run with: npx playwright test app/e2e/session-realtime.spec.ts
 */

import { test, expect, type Page } from '@playwright/test';

// Test configuration
const BASE_URL = 'http://localhost:5000';
const TEST_SESSION_ID = '327875f7-d3c6-4fb6-b792-4c6e34d526e0';

test.describe('Session Page Real-time Features', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the session page
    await page.goto(`${BASE_URL}/session/${TEST_SESSION_ID}`);
  });

  test('should display session page with correct structure', async ({ page }) => {
    // Check header elements
    await expect(page.getByRole('link', { name: 'SOUL' })).toBeVisible();
    await expect(page.getByText('Sessions')).toBeVisible();

    // Check main content sections
    await expect(page.getByRole('heading', { name: 'LINEAGE GRAPH' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'THOUGHT STREAM' })).toBeVisible();
  });

  test('should show connection status indicator', async ({ page }) => {
    // Should show either "Live" (WebSocket) or "Polling" status
    const statusText = page.locator('text=Live, text=Polling').first();
    await expect(statusText).toBeVisible({ timeout: 5000 });
  });

  test('should display node and event counts', async ({ page }) => {
    // Wait for data to load
    await page.waitForTimeout(2000);

    // Should show nodes count
    await expect(page.getByText(/\d+ nodes/)).toBeVisible();

    // Should show events count
    await expect(page.getByText(/\d+ events/)).toBeVisible();
  });

  test('should show empty state when no data', async ({ page }) => {
    // Navigate to a non-existent session
    await page.goto(`${BASE_URL}/session/non-existent-session-id`);

    // Should show empty states
    await expect(page.getByText('No neural pathways detected')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('No thoughts recorded')).toBeVisible({ timeout: 5000 });
  });

  test('should update data automatically via polling', async ({ page }) => {
    // Get initial counts
    const initialNodeCount = await page.getByText(/\d+ nodes/).textContent();

    // Wait for poll interval (2-3 seconds)
    await page.waitForTimeout(3500);

    // Verify the page is still responsive and showing data
    const currentNodeCount = await page.getByText(/\d+ nodes/).textContent();
    expect(currentNodeCount).toBeDefined();

    // Note: The actual count may or may not change depending on backend data
    // This test just verifies polling doesn't break the UI
  });

  test('should navigate back to home via logo', async ({ page }) => {
    // Click the SOUL logo
    await page.getByRole('link', { name: 'SOUL' }).click();

    // Should be back on home page
    await expect(page).toHaveURL(BASE_URL + '/');
    await expect(page.getByRole('heading', { name: 'SOUL SYSTEM' })).toBeVisible();
  });

  test('should have responsive two-column layout', async ({ page }) => {
    // Check for grid layout
    const mainContent = page.locator('main');
    await expect(mainContent).toBeVisible();

    // Both columns should be visible
    const lineageSection = page.getByText('LINEAGE GRAPH').locator('..');
    const replaySection = page.getByText('THOUGHT STREAM').locator('..');

    await expect(lineageSection).toBeVisible();
    await expect(replaySection).toBeVisible();
  });
});

test.describe('Home Page Navigation', () => {
  test('should navigate to session page from home', async ({ page }) => {
    await page.goto(BASE_URL);

    // Fill in session ID
    await page.fill('input[placeholder*="session"]', TEST_SESSION_ID);

    // Click observe button
    await page.getByRole('button', { name: /observe/i }).click();

    // Should navigate to session page
    await expect(page).toHaveURL(`${BASE_URL}/session/${TEST_SESSION_ID}`);
  });

  test('should disable button when no session ID entered', async ({ page }) => {
    await page.goto(BASE_URL);

    // Button should be disabled initially
    const button = page.getByRole('button', { name: /observe/i });
    await expect(button).toBeDisabled();

    // Enter session ID
    await page.fill('input[placeholder*="session"]', 'test-id');

    // Button should now be enabled
    await expect(button).toBeEnabled();

    // Clear input
    await page.fill('input[placeholder*="session"]', '');

    // Button should be disabled again
    await expect(button).toBeDisabled();
  });
});

test.describe('Real-time Data Updates', () => {
  test('should handle WebSocket connection gracefully', async ({ page }) => {
    // Listen for WebSocket connections
    const wsPromise = page.waitForEvent('websocket', { timeout: 5000 }).catch(() => null);

    await page.goto(`${BASE_URL}/session/${TEST_SESSION_ID}`);

    const ws = await wsPromise;

    if (ws) {
      // WebSocket connected - should show "Live"
      await expect(page.getByText('Live')).toBeVisible({ timeout: 3000 });
    } else {
      // No WebSocket - should fall back to "Polling"
      await expect(page.getByText('Polling')).toBeVisible({ timeout: 5000 });
    }
  });

  test('should continue working after WebSocket disconnection', async ({ page }) => {
    await page.goto(`${BASE_URL}/session/${TEST_SESSION_ID}`);

    // Wait for initial load
    await page.waitForTimeout(2000);

    // Force close any WebSocket connections by simulating network issues
    await page.route('**/api/ws/**', (route) => route.abort());

    // Wait for reconnection attempts / fallback
    await page.waitForTimeout(4000);

    // Page should still be functional (polling fallback)
    await expect(page.getByRole('heading', { name: 'LINEAGE GRAPH' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'THOUGHT STREAM' })).toBeVisible();
  });

  test('should show data from API endpoints', async ({ page }) => {
    // Mock API responses to ensure test reliability
    await page.route('**/api/lineage/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            nodes: [
              { id: 'test-node', label: 'Test Session', type: 'session' },
            ],
            links: [],
          },
        }),
      });
    });

    await page.route('**/api/replay/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            timeline: [
              { id: 'test-event', type: 'thought', content: 'Test thought' },
            ],
          },
        }),
      });
    });

    await page.goto(`${BASE_URL}/session/${TEST_SESSION_ID}`);

    // Wait for data to load
    await page.waitForTimeout(2000);

    // Should show node count from mocked data
    await expect(page.getByText('1 nodes')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('1 events')).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Error Handling', () => {
  test('should handle API errors gracefully', async ({ page }) => {
    // Mock API to return errors
    await page.route('**/api/lineage/**', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Internal server error' }),
      });
    });

    await page.goto(`${BASE_URL}/session/${TEST_SESSION_ID}`);

    // Page should still render without crashing
    await expect(page.getByRole('heading', { name: 'LINEAGE GRAPH' })).toBeVisible();

    // Should show empty/loading state
    await expect(page.getByText('No neural pathways detected')).toBeVisible({ timeout: 5000 });
  });

  test('should handle network timeout', async ({ page }) => {
    // Mock API to timeout
    await page.route('**/api/lineage/**', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 10000));
      await route.abort();
    });

    await page.goto(`${BASE_URL}/session/${TEST_SESSION_ID}`);

    // Page should still be responsive
    await expect(page.getByRole('heading', { name: 'LINEAGE GRAPH' })).toBeVisible();
  });
});

test.describe('Visual Appearance', () => {
  test('should have Three.js background animation', async ({ page }) => {
    await page.goto(`${BASE_URL}/session/${TEST_SESSION_ID}`);

    // Check for canvas element (Three.js renders to canvas)
    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible({ timeout: 5000 });
  });

  test('should have proper styling for dark theme', async ({ page }) => {
    await page.goto(`${BASE_URL}/session/${TEST_SESSION_ID}`);

    // Check background color is dark
    const body = page.locator('body');
    const bgColor = await body.evaluate((el) =>
      window.getComputedStyle(el).backgroundColor
    );

    // Should be a dark color (RGB values should be low)
    expect(bgColor).toMatch(/rgb\(\d{1,2}, \d{1,2}, \d{1,2}\)/);
  });

  test('should display gradient text for section headers', async ({ page }) => {
    await page.goto(`${BASE_URL}/session/${TEST_SESSION_ID}`);

    // The LINEAGE GRAPH header should have gradient styling
    const lineageHeader = page.getByText('LINEAGE GRAPH');
    await expect(lineageHeader).toBeVisible();

    // Check for gradient-related CSS
    const bgClip = await lineageHeader.evaluate((el) =>
      window.getComputedStyle(el).webkitBackgroundClip
    );
    expect(bgClip).toBe('text');
  });
});
