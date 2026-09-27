import { expect, test } from '@playwright/test';
import { createLive, registerOrganizer } from './helpers';

test('vue mobile : télécommande du timer', async ({ page }) => {
  await registerOrganizer(page);
  const id = await createLive(page, { players: ['Alice', 'Bob', 'Carl'] });
  await page.goto(`/live/${id}`);
  await expect(page.getByRole('button', { name: 'Sortant' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Scan QR code' })).toBeVisible();
  await expect(page.getByRole('slider', { name: 'Progression du niveau en cours' })).toBeVisible();

  await page.getByRole('button', { name: 'Reprendre' }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();

  await page.getByRole('button', { name: 'Sortant' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /^Carl/ }).click();
  await page.getByRole('button', { name: /C'EST FAIT/ }).click();
  await expect(page.getByText('2/3')).toBeVisible();
});
