import { expect, test, type Browser } from '@playwright/test';
import { api, registerOrganizer, uniq } from './helpers';

/** Crée un compte joueur dans un contexte séparé (cookie joueur) et renvoie la page connectée. */
async function playerAccount(browser: Browser, pseudo: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await api(page.request, 'POST', '/player/register', { email: `joueur-${uniq()}@test.local`, password: 'secret123', pseudo, firstName: 'Camille', lastName: 'Durand' });
  return { ctx, page };
}

test('annuaire public : un tournoi et un club affichés, inscription depuis la liste', async ({ page, browser }) => {
  await registerOrganizer(page);
  const name = `Deepstack ${uniq()}`;
  const ev = await api<{ id: string }>(page.request, 'POST', '/events', { name, location: 'Salle des fêtes', capacity: 20, eventDate: '2099-06-01', eventTime: '20:00' });
  await api(page.request, 'POST', `/events/${ev.id}/status`, { status: 'open' });

  // non listé par défaut
  const visitor = await browser.newContext();
  const pub = await visitor.newPage();
  await pub.goto('/tournois');
  await pub.getByPlaceholder(/Nom, lieu/).fill(name);
  await expect(pub.getByText('Aucun tournoi à venir')).toBeVisible();

  // l'organisateur l'affiche dans l'annuaire depuis la fiche de l'événement
  await page.goto(`/planning/${ev.id}`);
  await page.getByRole('switch', { name: /annuaire public/ }).click();
  await expect(page.getByText('Événement affiché dans l’annuaire public.')).toBeVisible();

  await pub.reload();
  await pub.getByPlaceholder(/Nom, lieu/).fill(name);
  const card = pub.getByRole('listitem').filter({ hasText: name });
  await expect(card).toContainText('Salle des fêtes');
  await expect(card).toContainText('0/20 places');
  await card.getByRole('link', { name: "S'inscrire" }).click();
  await expect(pub).toHaveURL(/\/p\/register\//);
  await expect(pub.getByRole('heading', { name: "S'inscrire" })).toBeVisible();
  await pub.locator('input').first().fill(`Visiteur-${uniq()}`);
  await pub.getByRole('button', { name: /S'inscrire/ }).click();
  await expect(pub.getByText(/Inscription enregistrée/)).toBeVisible();
  await pub.goto('/tournois');
  await pub.getByPlaceholder(/Nom, lieu/).fill(name);
  await expect(pub.getByRole('listitem').filter({ hasText: name })).toContainText('1/20 places');

  // club publié + listé → onglet Clubs
  const club = `Club annuaire ${uniq()}`;
  await api(page.request, 'POST', '/club', { name: club, description: 'Un club convivial ouvert à tous les joueurs.', season: { name: '2026' } });
  await api(page.request, 'PATCH', '/club', { published: true, listed: true });
  await pub.reload();
  await pub.getByRole('button', { name: /Clubs/ }).click();
  await pub.getByPlaceholder(/Nom du club/).fill(club);
  await expect(pub.getByRole('link', { name: new RegExp(club) })).toContainText('1 tournoi(s) à venir');
  await visitor.close();
});

test('recherche de joueurs : ajout d’un compte joueur au club et à un tournoi', async ({ page, browser }) => {
  await registerOrganizer(page);
  const pseudo = `Cam${uniq()}`;
  const player = await playerAccount(browser, pseudo);

  // ajout au club par la recherche : le joueur voit le club dans son espace
  await api(page.request, 'POST', '/club', { name: 'Club recherche', season: { name: '2026' } });
  await page.goto('/club');
  await page.getByRole('button', { name: 'Ajouter un adhérent' }).click();
  await page.getByRole('dialog').getByPlaceholder('Pseudo ou rechercher…').fill(pseudo);
  const option = page.getByRole('option', { name: new RegExp(pseudo) });
  await expect(option).toContainText('Camille D.'); // initiale du nom seulement
  await option.click();
  await expect(page.getByRole('dialog')).toContainText(`Lié : Compte joueur ${pseudo}`);
  await page.getByRole('dialog').getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByRole('cell', { name: new RegExp(pseudo) })).toBeVisible();

  await player.page.goto('/joueur/espace');
  await expect(player.page.getByRole('heading', { name: 'Mes clubs' })).toBeVisible();
  await expect(player.page.getByText('Club recherche')).toBeVisible();

  // ajout à un tournoi depuis le timer : l'adhérent est proposé et reste lié au compte
  const { id } = await api<{ id: string }>(page.request, 'POST', '/tournaments', { title: 'Live recherche' });
  await page.goto(`/live/${id}`);
  await page.getByRole('button', { name: /^(Ajouter joueur|Joueur)$/ }).click();
  await page.getByPlaceholder(/rechercher un joueur connu/).fill(pseudo.slice(0, 6));
  await page.getByRole('option', { name: new RegExp(pseudo) }).click();
  await expect(page.getByRole('dialog')).toContainText('Lié : Adhérent du club');
  await page.getByRole('dialog').getByRole('button', { name: 'Ajouter' }).click();
  await expect(page.getByText(`${pseudo} ajouté`)).toBeVisible();

  // le joueur peut se rendre introuvable
  await player.page.getByRole('switch', { name: /Les organisateurs peuvent me trouver/ }).click();
  await expect(player.page.getByText('Vous n’apparaissez plus dans la recherche.')).toBeVisible();
  const other = await browser.newContext();
  const orga2 = await other.newPage();
  await registerOrganizer(orga2);
  const res = await api<{ players: { pseudo: string }[] }>(orga2.request, 'GET', `/directory/players?q=${pseudo}`);
  expect(res.players).toHaveLength(0);
  await other.close();
  await player.ctx.close();
});
