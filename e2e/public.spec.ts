import { expect, test } from '@playwright/test';
import { uniq } from './helpers';

test.describe('Pages publiques sans compte', () => {
  test('calculateur de payout', async ({ page }) => {
    await page.goto('/outils/payout');
    await expect(page.getByText('400 €').first()).toBeVisible(); // 20 entrées × 20 €
    await expect(page.getByText('1er Prix')).toBeVisible();
  });

  test('générateur de structure', async ({ page }) => {
    await page.goto('/outils/structure');
    await expect(page.getByText('Durée estimée')).toBeVisible();
    await expect(page.getByRole('button', { name: /Exporter en CSV/ })).toBeVisible();
  });

  test('compte joueur : création puis espace avec QR', async ({ page }) => {
    await page.goto('/joueur');
    await page.getByRole('button', { name: 'Créer mon compte' }).click();
    await page.locator('form input').nth(0).fill('Joueur E2E');
    await page.locator('input[type=email]').fill(`joueur-${uniq()}@test.local`);
    await page.locator('input[type=password]').fill('secret123');
    await page.getByRole('button', { name: 'Créer mon compte joueur' }).click();
    await expect(page).toHaveURL(/\/joueur\/espace/);
    await expect(page.getByRole('heading', { name: 'Joueur E2E' })).toBeVisible();
    await expect(page.getByAltText(/^QR P/)).toBeVisible();
    await expect(page.getByText('Aucune préinscription')).toBeVisible();
  });
});
