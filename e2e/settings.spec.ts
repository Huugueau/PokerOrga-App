import { expect, test } from '@playwright/test';
import { api, createLive, registerOrganizer } from './helpers';

test.describe('Panneau Réglages', () => {
  test.beforeEach(async ({ page }) => {
    await registerOrganizer(page);
  });

  test('renommer le tournoi et changer les réglages', async ({ page }) => {
    const id = await createLive(page, { players: ['Alice', 'Bob'] });
    await page.goto(`/live/${id}`);
    await page.getByRole('button', { name: /RÉGLAGES/ }).click();
    const title = page.locator('input.text-lg');
    await title.fill('Soirée du jeudi');
    await title.press('Enter');
    await expect(page.getByText('✓ Enregistré')).toBeVisible();

    // format re-entry + bounty progressif
    await page.getByRole('button', { name: 'Re-entry', exact: true }).click();
    await page.getByRole('button', { name: 'Progressif', exact: true }).click();
    await expect.poll(async () => (await api<{ tournament: { settings: { entryFormat: string; bounty: { type: string } } } }>(page.request, 'GET', `/tournaments/${id}/full`)).tournament.settings).toMatchObject({
      entryFormat: 'reentry',
      bounty: { type: 'progressive' },
    });

    await page.getByRole('button', { name: 'Fermer' }).first().click();
    await expect(page.getByRole('heading', { name: 'Soirée du jeudi' })).toBeVisible();
  });

  test('gestion des joueurs : import CSV, tirage des sièges, plan public', async ({ page, browser }) => {
    const id = await createLive(page);
    await page.goto(`/live/${id}`);
    await page.getByRole('button', { name: /RÉGLAGES/ }).click();
    await page.getByRole('button', { name: 'Gestion des joueurs' }).click();

    const csv = 'pseudo;prenom;nom\n' + Array.from({ length: 12 }, (_, i) => `Joueur${i + 1};;`).join('\n');
    await page.locator('input[type=file][accept*=".csv"]').setInputFiles({ name: 'joueurs.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await expect(page.getByRole('dialog')).toContainText('Importer ces joueurs ?');
    await page.getByRole('button', { name: /Importer 12 joueur/ }).click();
    await expect(page.getByText('12 actif(s)', { exact: false })).toBeVisible();

    await page.getByRole('button', { name: 'Tirage des sièges' }).click();
    await expect(page.getByRole('heading', { name: /Table 2/ })).toBeVisible();

    const href = await page.getByRole('link', { name: 'Plan des tables' }).getAttribute('href');
    const visitor = await browser.newContext();
    const pub = await visitor.newPage();
    await pub.goto(href!);
    await expect(pub.getByRole('heading', { name: /Plan des tables/ })).toBeVisible();
    await expect(pub.getByText('12 joueurs en lice', { exact: false })).toBeVisible();
    await visitor.close();
  });

  test('éditeur de structure : ajout d’un niveau et sauvegarde', async ({ page }) => {
    const id = await createLive(page);
    await page.goto(`/live/${id}`);
    await page.getByRole('button', { name: /RÉGLAGES/ }).click();
    await page.getByRole('button', { name: 'Éditeur de structure' }).click();
    await expect(page.getByText('15 niveau(x)', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Ajouter un niveau' }).click();
    await page.getByRole('button', { name: /^Sauvegarder$/ }).click();
    await expect(page.getByRole('button', { name: /^Sauvegardé$/ })).toBeVisible();
    await expect(page.getByText('16 niveau(x)', { exact: false })).toBeVisible();
    const snap = await api<{ tournament: { structure: unknown[] } }>(page.request, 'GET', `/tournaments/${id}/full`);
    expect(snap.tournament.structure).toHaveLength(20);
  });
});
