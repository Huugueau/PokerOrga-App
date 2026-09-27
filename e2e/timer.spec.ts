import { expect, test } from '@playwright/test';
import { api, createLive, readClock, registerOrganizer } from './helpers';

test.describe('Timer', () => {
  test.beforeEach(async ({ page }) => {
    await registerOrganizer(page);
  });

  test('démarrage refusé sans joueurs', async ({ page }) => {
    const id = await createLive(page);
    await page.goto(`/live/${id}`);
    await page.getByRole('button', { name: 'Reprendre' }).click();
    await expect(page.getByText('Ajoutez au moins 2 joueurs pour démarrer.')).toBeVisible();
  });

  test('play, pause, niveau suivant et raccourci clavier', async ({ page }) => {
    const id = await createLive(page, { players: ['Alice', 'Bob', 'Carl'] });
    await page.goto(`/live/${id}`);
    await expect(page.getByText('20:00')).toBeVisible();

    await page.getByRole('button', { name: 'Reprendre' }).click();
    await expect.poll(() => readClock(page), { timeout: 6000 }).toBeLessThan(1200);

    await page.getByRole('button', { name: 'Pause' }).click();
    await expect(page.getByRole('button', { name: 'Reprendre' })).toBeVisible();
    await page.waitForTimeout(800);
    const paused = await readClock(page);
    await page.waitForTimeout(1500);
    expect(await readClock(page)).toBe(paused);

    await page.getByRole('button', { name: 'Niveau suivant' }).click();
    await expect(page.getByRole('dialog')).toContainText('Passer au niveau 2 ?');
    await page.getByRole('button', { name: 'Confirmer' }).click();
    await expect(page.getByText('75 / 150').first()).toBeVisible();
    await expect(page.getByText('NIVEAU 2', { exact: false }).first()).toBeVisible();

    // espace = reprise
    await page.locator('body').press('Space');
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  });

  test('sortant : élimination, stats et places payées', async ({ page }) => {
    const id = await createLive(page, { players: ['Alice', 'Bob', 'Carl', 'Dora'], settings: { buyin: 20, trackKills: true } });
    await page.goto(`/live/${id}`);
    await expect(page.getByText('80 €').first()).toBeVisible();
    await expect(page.getByText('4 / 4')).toBeVisible();

    await page.getByRole('button', { name: 'Sortant' }).click();
    await page.getByRole('dialog').getByRole('button', { name: /^Dora/ }).click();
    await expect(page.getByRole('dialog')).toContainText('Qui a éliminé Dora ?');
    await page.getByRole('dialog').getByRole('button', { name: /^Alice/ }).click();
    await expect(page.getByRole('dialog')).toContainText('Dora est éliminé');
    await expect(page.getByRole('dialog')).toContainText('Éliminé par Alice');
    await page.getByRole('button', { name: /C'EST FAIT/ }).click();
    await expect(page.getByText('3 / 4')).toBeVisible();

    const snap = await api<{ players: { pseudo: string; kills: number; finishRank: number | null }[] }>(page.request, 'GET', `/tournaments/${id}/full`);
    expect(snap.players.find((p) => p.pseudo === 'Alice')?.kills).toBe(1);
    expect(snap.players.find((p) => p.pseudo === 'Dora')?.finishRank).toBe(4);
  });

  test('re-entry : nouveau siège attribué', async ({ page }) => {
    const id = await createLive(page, { players: ['Alice', 'Bob', 'Carl'], draw: true, settings: { entryFormat: 'reentry' } });
    await page.goto(`/live/${id}`);
    await page.getByRole('button', { name: 'Sortant' }).click();
    await page.getByRole('dialog').getByRole('button', { name: /^Bob/ }).click();
    await expect(page.getByRole('dialog')).toContainText('Faire un re-entry ?');
    await page.getByRole('button', { name: /OUI \(re-entry\)/ }).click();
    await expect(page.getByRole('dialog')).toContainText('RE-ENTRY VALIDÉ');
    await expect(page.getByRole('dialog')).toContainText(/Nouveau siège attribué à Bob : Table 1 – Siège \d+/);
    await page.getByRole('button', { name: /C'EST FAIT/ }).click();
    await expect(page.getByText('3 / 4')).toBeVisible();
  });

  test('mode TV : contrôles masqués', async ({ page }) => {
    const id = await createLive(page, { players: ['Alice', 'Bob'] });
    await page.goto(`/live/${id}?tv=1`);
    await expect(page.getByText('TEMPS RESTANT :', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sortant' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /RÉGLAGES/ })).toHaveCount(0);
  });
});
