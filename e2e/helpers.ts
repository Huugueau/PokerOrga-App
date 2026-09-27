import { expect, type APIRequestContext, type Page } from '@playwright/test';

export const uniq = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/** Crée un organisateur via l'API ; la session (cookie) est partagée avec la page. */
export async function registerOrganizer(page: Page) {
  const email = `e2e-${uniq()}@test.local`;
  const res = await page.request.post('/api/auth/register', { data: { email, password: 'secret123', acceptTerms: true } });
  expect(res.ok()).toBeTruthy();
  return email;
}

export async function api<T = unknown>(request: APIRequestContext, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, data?: unknown): Promise<T> {
  const res = await request.fetch('/api' + path, { method, data });
  if (!res.ok()) throw new Error(`${method} ${path} → ${res.status()} ${await res.text()}`);
  return (await res.json()) as T;
}

/** Crée un live prêt (joueurs ajoutés, sièges tirés si demandé) et renvoie son id. */
export async function createLive(page: Page, opts: { title?: string; players?: string[]; draw?: boolean; settings?: Record<string, unknown> } = {}) {
  const { id } = await api<{ id: string }>(page.request, 'POST', '/tournaments', { title: opts.title ?? 'Tournoi E2E' });
  if (opts.settings) await api(page.request, 'PATCH', `/tournaments/${id}`, { settings: opts.settings });
  if (opts.players?.length) await api(page.request, 'POST', `/tournaments/${id}/players/import`, { rows: opts.players.map((pseudo) => ({ pseudo })) });
  if (opts.draw) await api(page.request, 'POST', `/tournaments/${id}/seating/draw`);
  return id;
}

/** Lit le temps restant affiché (mm:ss) sur le timer. */
export async function readClock(page: Page) {
  const txt = await page.getByText(/^\d{2}:\d{2}$/).first().innerText();
  const [m, s] = txt.split(':').map(Number);
  return m * 60 + s;
}
