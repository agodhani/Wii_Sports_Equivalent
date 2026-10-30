import { defineConfig, devices } from '@playwright/test';

/**
 * E2E suite for Webcam Tennis. Serial workers on purpose: WebGL is
 * software-rendered (swiftshader) so every frame costs real CPU, and the
 * pointer-swing tests time real mouse flicks against ~50 ms perfect /
 * ~150 ms hit windows. Parallel browser instances would contend for CPU and
 * make those timings non-deterministic.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.e2e\.ts/,
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 120_000,
  reporter: [['list']],
  use: {
    viewport: { width: 1280, height: 800 },
    launchOptions: { args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] },
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npx vite --port 5299 --strictPort',
    url: 'http://localhost:5299',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
