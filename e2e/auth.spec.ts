import { expect, test } from '@playwright/test';
import { uniq } from './helpers';

test.describe('Authentification organisateur', () => {
  test('inscription, déconnexion puis reconnexion', async ({ page }) => {
    const email = `e2e-${uniq()}@test.local`;
    await page.goto('/register');
    await page.getByPlaceholder('vous@exemple.com').fill(email);
    await page.getByPlaceholder('••••••••').fill('secret123');
    await page.getByRole('button', { name: /S'inscrire/ }).click();
    await expect(page.getByText('Vous devez accepter les CGU pour vous inscrire.')).toBeVisible();
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: /S'inscrire/ }).click();
    await expect(page).toHaveURL(/\/account\?welcome=1/);
    await expect(page.getByText(/Bienvenue/)).toBeVisible();

    await page.getByRole('button', { name: 'Déconnexion' }).first().click();
    await expect(page).toHaveURL(/\/login/);

    await page.getByPlaceholder('vous@exemple.com').fill(email);
    await page.getByPlaceholder('••••••••').fill('mauvais');
    await page.getByRole('button', { name: /Se connecter/ }).click();
    await expect(page.getByText('Email ou mot de passe incorrect.')).toBeVisible();
    await page.getByPlaceholder('••••••••').fill('secret123');
    await page.getByRole('button', { name: /Se connecter/ }).click();
    // la racine ouvre le live courant
    await expect(page).toHaveURL(/\/live\//);
    await expect(page.getByText('TEMPS RESTANT :', { exact: false })).toBeVisible();
  });

  test('les pages protégées redirigent vers la connexion', async ({ page }) => {
    await page.goto('/championships');
    await expect(page).toHaveURL(/\/login\?next=/);
  });
});
