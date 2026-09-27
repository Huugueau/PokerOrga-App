import { expect, test } from '@playwright/test';
import { api, createLive, registerOrganizer } from './helpers';

test('fin de tournoi : classement, envoi au championnat, historique', async ({ page }) => {
  await registerOrganizer(page);
  const id = await createLive(page, { title: 'Finale E2E', players: ['Alice', 'Bob', 'Carl', 'Dora'], settings: { buyin: 10 } });
  await api(page.request, 'POST', '/championships', { name: 'Saison E2E', type: 'mtt' });
  await api(page.request, 'POST', `/tournaments/${id}/clock`, { action: 'play' });
  for (const pseudo of ['Dora', 'Carl', 'Bob']) {
    const snap = await api<{ players: { id: string; pseudo: string }[] }>(page.request, 'GET', `/tournaments/${id}/full`);
    await api(page.request, 'POST', `/tournaments/${id}/players/${snap.players.find((p) => p.pseudo === pseudo)!.id}/bust`, {});
  }

  await page.goto(`/live/${id}`);
  await expect(page.getByText('Tournoi terminé !')).toBeVisible();
  await expect(page.getByText('Vainqueur : Alice')).toBeVisible();
  await page.getByRole('button', { name: 'Voir le classement' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Classement final');
  await dialog.locator('select').selectOption({ label: 'Saison E2E (MTT)' });
  await dialog.getByRole('button', { name: 'Envoyer vers le championnat' }).click();
  await expect(page.getByText('Résultats envoyés au championnat !')).toBeVisible();

  await dialog.getByRole('button', { name: 'Terminer et archiver' }).click();
  await page.getByRole('dialog').last().getByRole('button', { name: 'Terminer' }).click();
  await expect(page).toHaveURL(new RegExp(`/history/${id}`));
  await expect(page.getByText('Alice').first()).toBeVisible();

  await page.goto('/championships');
  await page.getByRole('link', { name: /Saison E2E/ }).click();
  await expect(page.getByRole('cell', { name: 'Alice' })).toBeVisible();
  await expect(page.getByRole('cell', { name: '20' }).first()).toBeVisible(); // 10 × √(4/1)
});
