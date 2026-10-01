import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against the production build (`npm run build` first),
 * served by `vite preview`. iPhone sizes first; one desktop project.
 * Nothing here talks to the internet: exercise photos and sync relays are
 * stubbed or run locally.
 */
const iPhone = { ...devices['iPhone 13'], defaultBrowserType: 'chromium' as const };

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 45_000,
  use: {
    baseURL: 'http://localhost:4173/',
    trace: 'retain-on-failure',
    serviceWorkers: 'block',
  },
  projects: [
    { name: 'iphone-390', use: { ...iPhone, viewport: { width: 390, height: 844 } } },
    { name: 'iphone-375', use: { ...iPhone, viewport: { width: 375, height: 667 } }, grep: /@small/ },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } }, grep: /@desktop/ },
  ],
  webServer: {
    command: 'npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173/',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
