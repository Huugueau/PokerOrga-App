import { defineConfig, devices } from '@playwright/test';

// Tests E2E : l'API sert le front buildé sur un port dédié.
// Prérequis : une base PostgreSQL joignable (npm run dev:db, ou docker compose -f docker-compose.dev.yml up -d).
const PORT = Number(process.env.E2E_PORT ?? 8090);

export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  expect: { timeout: 8_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: 'fr-FR',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 850 } }, testIgnore: /mobile\.spec/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /mobile\.spec/ },
  ],
  webServer: {
    command: process.env.E2E_SKIP_BUILD ? 'node apps/api/dist/server.js' : 'npm run build && node apps/api/dist/server.js',
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: { PORT: String(PORT), NODE_ENV: 'production', DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://pokerorga:pokerorga@localhost:5432/pokerorga' },
  },
});
