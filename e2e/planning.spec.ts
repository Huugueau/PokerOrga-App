import { expect, test } from '@playwright/test';
import { api, registerOrganizer, uniq } from './helpers';

test('planning : inscription publique, validation, import dans le live', async ({ page, browser }) => {
  await registerOrganizer(page);
  const ev = await api<{ id: string; publicToken: string }>(page.request, 'POST', '/events', { name: 'Tournoi du samedi', capacity: 2, options: [{ label: 'Présent au repas' }] });
  await api(page.request, 'POST', `/events/${ev.id}/status`, { status: 'open' });

  // trois joueurs anonymes pour 2 places : le troisième part en liste d'attente
  const visitor = await browser.newContext();
  const pub = await visitor.newPage();
  for (const pseudo of [`Julie-${uniq()}`, `Marc-${uniq()}`, `Nina-${uniq()}`]) {
    await pub.goto(`/p/register/${ev.publicToken}`);
    await pub.locator('input').first().fill(pseudo);
    await pub.getByRole('button', { name: 'Oui', exact: true }).click();
    await pub.getByRole('button', { name: /S'inscrire/ }).click();
    await expect(pub.getByText(/Inscription enregistrée|Liste d'attente/)).toBeVisible();
  }
  await expect(pub.getByText(/position n°1/)).toBeVisible();
  await expect(pub.getByRole('link', { name: 'Suivre ou annuler mon inscription' })).toBeVisible();
  await visitor.close();

  await page.goto(`/planning/${ev.id}`);
  await expect(page.getByRole('button', { name: /À valider \(2\)/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Liste d'attente \(1\)/ })).toBeVisible();
  await page.getByRole('button', { name: 'Valider', exact: true }).first().click();
  await expect(page.getByRole('button', { name: /Validés \(1\)/ })).toBeVisible();
  await page.getByRole('button', { name: 'Valider', exact: true }).first().click();
  await expect(page.getByRole('button', { name: /Validés \(2\)/ })).toBeVisible();

  await page.getByRole('button', { name: 'Importer les joueurs' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Tous les validés/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Importer 2 joueur/ }).click();
  await expect(page).toHaveURL(/\/live\//);
  await expect(page.getByText('2 / 2')).toBeVisible();
});
