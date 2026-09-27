import { expect, test } from '@playwright/test';
import { api, registerOrganizer } from './helpers';

test('Mon club : création, adhérent, demande publique, pointage QR', async ({ page, browser }) => {
  await registerOrganizer(page);
  await page.goto('/club');
  await page.getByPlaceholder('Club Poker de la Vallée').fill('Club E2E');
  await page.getByPlaceholder(/Présentez votre club/).fill('Un club convivial qui organise un tournoi chaque vendredi soir.');
  await page.getByRole('button', { name: 'Créer mon club' }).click();
  await expect(page.getByRole('heading', { name: 'Club E2E' })).toBeVisible();

  // ajout d'un adhérent sans compte
  await page.getByRole('button', { name: 'Ajouter un adhérent' }).click();
  await page.getByRole('dialog').locator('input').first().fill('Papy Jo');
  await page.getByRole('dialog').getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByRole('cell', { name: /Papy Jo/ })).toBeVisible();
  await expect(page.getByText('Cotisation en attente').first()).toBeVisible();

  // publication + demande d'adhésion publique
  await page.getByRole('button', { name: 'Paramètres et page publique' }).click();
  await page.getByRole('switch').first().click();
  await expect(page.getByText('Page club publiée.')).toBeVisible();
  const { club } = await api<{ club: { publicToken: string } }>(page.request, 'GET', '/club');
  const visitor = await browser.newContext();
  const pub = await visitor.newPage();
  await pub.goto(`/p/club/${club.publicToken}`);
  await expect(pub.getByRole('heading', { name: 'Club E2E' })).toBeVisible();
  const inputs = pub.locator('form input');
  await inputs.nth(0).fill('Nouvelle');
  await inputs.nth(1).fill('nouvelle@test.local');
  await pub.getByRole('button', { name: 'Envoyer ma demande' }).click();
  await expect(pub.getByText('Demande envoyée')).toBeVisible();
  await visitor.close();

  await page.reload();
  await page.getByRole('button', { name: /Demandes \(1\)/ }).click();
  await page.getByRole('button', { name: 'Accepter' }).click();
  await expect(page.getByText('Demande acceptée.')).toBeVisible();

  // pointage de la carte membre dans un live (saisie du code)
  const members = await api<{ members: { pseudo: string; code: string }[] }>(page.request, 'GET', '/club/members');
  const { id } = await api<{ id: string }>(page.request, 'POST', '/tournaments', { title: 'Live club' });
  await page.goto(`/live/${id}`);
  await page.getByRole('button', { name: 'Scan QR code' }).click();
  await page.getByPlaceholder('Ou saisir le code du QR').fill(members.members.find((m) => m.pseudo === 'Papy Jo')!.code);
  await page.getByRole('button', { name: 'Valider' }).click();
  await expect(page.getByRole('dialog')).toContainText('ajouté au tournoi');
});
