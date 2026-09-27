import { expect, test } from '@playwright/test';
import { api, registerOrganizer } from './helpers';

test('tournoi flight : Day 1A clôturé avec tapis, qualifiés vers le Day 2', async ({ page }) => {
  await registerOrganizer(page);
  await page.goto('/flights');
  await page.getByRole('button', { name: 'Nouveau dossier' }).click();
  await page.getByPlaceholder('Main Event').fill('Main E2E');
  await page.getByRole('button', { name: 'Créer le dossier' }).click();
  await expect(page.getByRole('heading', { name: 'Main E2E' })).toBeVisible();

  // Day 2 bloqué tant que le Day 1A n'est pas clôturé
  const launchButtons = page.getByRole('button', { name: 'Lancer' });
  await expect(launchButtons).toHaveCount(2);
  await expect(launchButtons.nth(1)).toBeDisabled();

  await launchButtons.first().click();
  await expect(page).toHaveURL(/\/live\//);
  const tid = page.url().split('/live/')[1];
  await api(page.request, 'POST', `/tournaments/${tid}/players/import`, { rows: ['P1', 'P2', 'P3', 'P4'].map((pseudo) => ({ pseudo })) });
  await api(page.request, 'POST', `/tournaments/${tid}/clock`, { action: 'play' });
  const snap = await api<{ players: { id: string; pseudo: string }[] }>(page.request, 'GET', `/tournaments/${tid}/full`);
  await api(page.request, 'POST', `/tournaments/${tid}/players/${snap.players.find((p) => p.pseudo === 'P4')!.id}/bust`, {});

  await page.goBack();
  await page.getByRole('button', { name: 'Clôturer et baguer' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Les 3 joueur(s) encore en jeu partent vers Day 2');
  await dialog.getByRole('button', { name: 'Répartir le reste' }).click();
  await dialog.getByRole('button', { name: 'Vérifier et clôturer' }).click();
  await expect(page.getByText('3 qualifié(s) en attente')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Lancer' }).last()).toBeEnabled();
  await expect(page.getByRole('cell', { name: 'Qualifié → Day 2' }).first()).toBeVisible();
});
