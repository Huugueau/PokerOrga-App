import { expect, test } from '@playwright/test';
import { api, createLive, readClock, registerOrganizer } from './helpers';

test('deux écrans restent synchronisés en temps réel', async ({ page, context }) => {
  await registerOrganizer(page);
  const id = await createLive(page, { players: ['Alice', 'Bob', 'Carl'] });
  const tv = await context.newPage();
  await tv.goto(`/live/${id}?tv=1`);
  await page.goto(`/live/${id}`);
  await expect(tv.getByText('20:00')).toBeVisible();

  // play sur l'écran de pilotage → la TV défile
  await page.getByRole('button', { name: 'Reprendre' }).click();
  await expect.poll(() => readClock(tv), { timeout: 8000 }).toBeLessThan(1199);

  // élimination faite par un autre appareil (API) → la TV se met à jour sans rechargement
  const snap = await api<{ players: { id: string; pseudo: string }[] }>(page.request, 'GET', `/tournaments/${id}/full`);
  await api(page.request, 'POST', `/tournaments/${id}/players/${snap.players.find((p) => p.pseudo === 'Carl')!.id}/bust`, {});
  await expect(tv.getByText('2 / 3')).toBeVisible();
  // notification en direct sur la TV
  await expect(tv.getByText(/Carl éliminé/)).toBeVisible();

  // pause depuis la TV impossible (pas de contrôles) mais depuis le pilotage oui
  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(tv.getByText('PAUSE', { exact: true }).first()).toBeVisible();
  await tv.waitForTimeout(800);
  const frozen = await readClock(tv);
  await tv.waitForTimeout(1500);
  expect(await readClock(tv)).toBe(frozen);
});

test('horloge liée : le niveau change sur les deux lives', async ({ page, context }) => {
  await registerOrganizer(page);
  const main = await createLive(page, { title: 'Main', players: ['A1', 'A2'] });
  const { id: side } = await api<{ id: string }>(page.request, 'POST', '/tournaments', { title: 'Side', linkTo: main });
  await api(page.request, 'POST', `/tournaments/${side}/players/import`, { rows: [{ pseudo: 'B1' }, { pseudo: 'B2' }] });
  const other = await context.newPage();
  await other.goto(`/live/${side}`);
  await expect(other.getByText('Horloge liée avec Main')).toBeVisible();
  await page.goto(`/live/${main}`);
  await page.getByRole('button', { name: 'Niveau suivant' }).click();
  await page.getByRole('button', { name: 'Confirmer' }).click();
  await expect(other.getByText('75 / 150').first()).toBeVisible();
});
