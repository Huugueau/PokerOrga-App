// Test de bout en bout de l'API (serveur lancé sur BASE).
// Usage : node apps/api/scripts/smoke.mjs [http://localhost:3000]
const BASE = process.argv[2] ?? 'http://localhost:3000';
let cookie = '';
async function call(method, path, body) {
  const res = await fetch(BASE + '/api' + path, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), cookie },
    body: body ? JSON.stringify(body) : undefined,
  });
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(data)}`);
  return data;
}
const assert = (c, m) => {
  if (!c) throw new Error('ÉCHEC : ' + m);
  console.log('✓', m);
};

const email = `smoke${Date.now()}@test.local`;
await call('POST', '/auth/register', { email, password: 'secret123', acceptTerms: true });
const me = await call('GET', '/auth/me');
assert(me.user.email === email, 'inscription + session');

const { id } = await call('POST', '/tournaments/current');
await call('PATCH', `/tournaments/${id}`, { title: 'Smoke Test', settings: { entryFormat: 'reentry', buyin: 20, maxPerTable: 6, finalTableSize: 6, trackKills: true, bounty: { type: 'progressive', amount: 5, drawFrom: null } } });
const names = Array.from({ length: 12 }, (_, i) => ({ pseudo: `Joueur${i + 1}` }));
const imp = await call('POST', `/tournaments/${id}/players/import`, { rows: [...names, { pseudo: 'joueur1' }] });
assert(imp.added.length === 12 && imp.skipped.length === 1, 'import CSV avec doublon ignoré');
await call('POST', `/tournaments/${id}/seating/draw`);
let snap = await call('GET', `/tournaments/${id}/full`);
assert(snap.tables.length === 2, 'tirage : 2 tables de 6');
assert(snap.stats.prizePool === 180 && snap.stats.bountyPool === 60, 'prize pool 180 € + bounty 60 €');
await call('POST', `/tournaments/${id}/clock`, { action: 'play' });
snap = await call('GET', `/tournaments/${id}/full`);
assert(snap.tournament.status === 'running' && snap.tournament.clock.running, 'démarrage du timer');

const P = (s) => snap.players.filter((p) => p.status === 'active');
// re-entry
let act = P(snap);
let r = await call('POST', `/tournaments/${id}/players/${act[0].id}/bust`, { eliminatedBy: act[1].id, again: true });
assert(r.newSeat, 're-entry : nouveau siège');
snap = await call('GET', `/tournaments/${id}/full`);
assert(snap.stats.totalEntries === 13, '13 entrées');
const killer = snap.players.find((p) => p.id === act[1].id);
assert(killer.bountyWon === 2.5 && killer.bountyValue === 7.5, 'bounty progressif');
// éliminations jusqu'à 1
let guard = 0;
while (P(snap).length > 1 && guard++ < 30) {
  act = P(snap);
  await call('POST', `/tournaments/${id}/players/${act[act.length - 1].id}/bust`, { eliminatedBy: act[0].id });
  snap = await call('GET', `/tournaments/${id}/full`);
  const tables = new Set(P(snap).map((p) => p.tableNumber));
  if (P(snap).length <= 6) assert(tables.size === 1, `fusion table finale à ${P(snap).length}`);
}
const ranks = snap.players.map((p) => p.finishRank).sort((a, b) => a - b);
assert(ranks.join() === Array.from({ length: 12 }, (_, i) => i + 1).join(), 'classement complet 1..12');
const paid = snap.players.filter((p) => p.prizeAmount).reduce((a, p) => a + p.prizeAmount, 0);
assert(paid === snap.stats.prizePool, `gains distribués = prize pool (${paid})`);
// undo + redo
const last = snap.players.find((p) => p.finishRank === 2);
await call('POST', `/tournaments/${id}/players/${last.id}/undo-bust`);
snap = await call('GET', `/tournaments/${id}/full`);
assert(P(snap).length === 2, "annulation d'élimination");
await call('POST', `/tournaments/${id}/players/${last.id}/bust`, {});
// championnat
const champ = await call('POST', '/championships', { name: 'Saison test', type: 'mtt' });
const fin = await call('POST', `/tournaments/${id}/finish`);
assert(fin.nextId && fin.nextId !== id, 'fin du tournoi → nouveau live');
const hist = await call('GET', '/history');
assert(hist.items.some((h) => h.id === id), 'historique');
await call('POST', `/championships/${champ.id}/import`, { tournamentId: id });
const cv = await call('GET', `/championships/${champ.id}`);
assert(cv.ranking.length === 12 && cv.ranking[0].points === Math.round(10 * Math.sqrt(13) * 10) / 10, 'points championnat');
// planning
const ev = await call('POST', '/events', { name: 'Tournoi du samedi', capacity: 2, options: [{ label: 'Repas ?' }] });
await call('POST', `/events/${ev.id}/status`, { status: 'open' });
const pub = await call('GET', `/public/events/${ev.publicToken}`);
const opt = pub.options[0].id;
for (const ps of ['Alice', 'Bob', 'Carl']) await call('POST', `/public/events/${ev.publicToken}/register`, { pseudo: ps, answers: { [opt]: 'yes' } });
const evd = await call('GET', `/events/${ev.id}`);
assert(evd.registrations.filter((x) => x.status === 'waitlist').length === 1, "liste d'attente quand complet");
for (const reg of evd.registrations.filter((x) => x.status === 'pending')) await call('PATCH', `/events/${ev.id}/registrations/${reg.id}`, { status: 'validated' });
const imported = await call('POST', `/events/${ev.id}/import`, { tournamentId: fin.nextId, mode: 'validated' });
assert(imported.added.length === 2, 'import des préinscrits dans le live');
// Mon club
const club = await call('POST', '/club', { name: 'Club Test', city: 'Lyon', description: 'Un club convivial pour tester la page publique.', season: { name: 'Saison 2026', duesAmount: 20 } });
await call('PATCH', '/club', { published: true });
const cinfo = await call('GET', '/club');
const season = cinfo.seasons[0];
const mem = await call('POST', '/club/members', { pseudo: 'Adhérent1', seasonId: season.id });
await call('POST', `/public/club/${club.publicToken}/request`, { pseudo: 'Nouveau', email: 'n@test.local' });
const reqs = await call('GET', '/club/requests');
await call('POST', `/club/requests/${reqs.items[0].id}/accept`);
await call('POST', `/club/members/${mem.id}/payments`, { seasonId: season.id, kind: 'dues', amount: 20, paidOn: '2026-09-27' });
const ml = await call('GET', `/club/members?seasonId=${season.id}`);
assert(ml.members.length === 2 && ml.members.find((m) => m.pseudo === 'Adhérent1').duesStatus === 'paid', 'club : adhérents, demande acceptée, cotisation payée');
const ci = await call('POST', `/tournaments/${fin.nextId}/checkin`, { code: mem.code });
assert(ci.state === 'added', 'scan carte membre → ajouté au live');
const ci2 = await call('POST', `/tournaments/${fin.nextId}/checkin`, { code: `https://x/p/${mem.code}` });
assert(ci2.state === 'already', 'second scan → déjà présent');
// Multi Sit-and-Go
const { id: sngId } = await call('POST', '/tournaments', { title: 'Session SnG' });
await call('PATCH', `/tournaments/${sngId}`, { settings: { multiSng: true, maxPerTable: 3 } });
for (const [pseudo, g] of [['A1', 1], ['A2', 1], ['A3', 1], ['B1', 2], ['B2', 2]]) await call('POST', `/tournaments/${sngId}/players`, { pseudo, sngGroup: g });
let sng = await call('GET', `/tournaments/${sngId}/full`);
assert(sng.tournament.settings.isFree && sng.tables.length === 2, 'session Multi SnG : 2 SnG, gratuit imposé');
await call('POST', `/tournaments/${sngId}/clock`, { action: 'play' });
const byPseudo = (p) => sng.players.find((x) => x.pseudo === p);
await call('POST', `/tournaments/${sngId}/players/${byPseudo('A3').id}/bust`, { eliminatedBy: byPseudo('A1').id });
await call('POST', `/tournaments/${sngId}/players/${byPseudo('A2').id}/bust`, {});
await call('POST', `/tournaments/${sngId}/players/${byPseudo('B2').id}/bust`, {});
sng = await call('GET', `/tournaments/${sngId}/full`);
assert(byPseudo('A1').finishRank === 1 && byPseudo('A3').finishRank === 3 && byPseudo('B1').finishRank === 1, 'classement par SnG');
assert(!sng.tournament.clock.running, 'timer en pause quand tous les SnG sont terminés');
const sngChamp = await call('POST', '/championships', { name: 'SnG 2026', type: 'sng', pointsGrid: [10, 5, 2] });
await call('POST', `/championships/${sngChamp.id}/import`, { tournamentId: sngId });
const sv = await call('GET', `/championships/${sngChamp.id}`);
assert(sv.imports.length === 2 && sv.ranking.find((r) => r.name === 'A1').points === 10, 'export SnG : un import par SnG, barème appliqué');
// Horloge liée
const { id: mainId } = await call('POST', '/tournaments', { title: 'Main Event' });
const { id: sideId } = await call('POST', '/tournaments', { title: 'Side Event', linkTo: mainId });
for (const pseudo of ['M1', 'M2']) await call('POST', `/tournaments/${mainId}/players`, { pseudo });
await call('POST', `/tournaments/${sideId}/players`, { pseudo: 'S1' });
let refused = false;
try {
  await call('POST', `/tournaments/${mainId}/clock`, { action: 'play' });
} catch {
  refused = true;
}
assert(refused, 'horloge liée : démarrage refusé si un tournoi lié a moins de 2 joueurs');
await call('POST', `/tournaments/${sideId}/players`, { pseudo: 'S2' });
await call('POST', `/tournaments/${mainId}/clock`, { action: 'play' });
await call('POST', `/tournaments/${mainId}/clock`, { action: 'next', expectedLevel: 0 });
let side = await call('GET', `/tournaments/${sideId}/full`);
assert(side.tournament.status === 'running' && side.tournament.clock.levelIndex === 1 && side.tournament.clock.running, 'horloge liée : play et niveau suivant reportés');
assert(side.linked.length === 1 && side.linked[0].title === 'Main Event', 'horloge liée : lien visible');
await call('POST', `/tournaments/${sideId}/clock`, { action: 'pause' });
const main = await call('GET', `/tournaments/${mainId}/full`);
assert(!main.tournament.clock.running, 'horloge liée : pause depuis l’autre live');
await call('POST', `/tournaments/${sideId}/unlink`);
await call('POST', `/tournaments/${sideId}/clock`, { action: 'play' });
const main2 = await call('GET', `/tournaments/${mainId}/full`);
side = await call('GET', `/tournaments/${sideId}/full`);
assert(!main2.tournament.clock.running && main2.tournament.clockGroupId === null && side.tournament.clockGroupId === null, 'séparation : horloges indépendantes');
// Tournois flights
const series = await call('POST', '/flights', { name: 'Main Event', qualifyPct: 50, day1Stack: 30000 });
let fl = await call('GET', `/flights/${series.id}`);
const day2 = fl.days.find((d) => d.label === 'Day 2');
const day1a = fl.days.find((d) => d.label === 'Day 1A');
const day1b = await call('POST', `/flights/${series.id}/days`, { label: 'Day 1B', stage: 1, targetDayId: day2.id });
let refusedLaunch = false;
try {
  await call('POST', `/flights/${series.id}/days/${day2.id}/launch`);
} catch {
  refusedLaunch = true;
}
assert(refusedLaunch, 'flights : Day 2 non lançable avant la clôture des Day 1');
async function playDay(dayId, names, bustCount, stack) {
  const { tournamentId } = await call('POST', `/flights/${series.id}/days/${dayId}/launch`);
  for (const pseudo of names) await call('POST', `/tournaments/${tournamentId}/players`, { pseudo });
  await call('POST', `/tournaments/${tournamentId}/clock`, { action: 'play' });
  let s = await call('GET', `/tournaments/${tournamentId}/full`);
  for (let i = 0; i < bustCount; i++) {
    const act = s.players.filter((p) => p.status === 'active');
    await call('POST', `/tournaments/${tournamentId}/players/${act[act.length - 1].id}/bust`, { eliminatedBy: act[0].id });
    s = await call('GET', `/tournaments/${tournamentId}/full`);
  }
  const stacks = Object.fromEntries(s.players.filter((p) => p.status === 'active').map((p) => [p.id, stack]));
  await call('POST', `/flights/${series.id}/days/${dayId}/close`, { stacks });
  return tournamentId;
}
await playDay(day1a.id, ['F1', 'F2', 'F3', 'F4'], 2, 50000);
await playDay(day1b.id, ['G1', 'G2', 'G3', 'G4'], 2, 60000);
const { tournamentId: d2t } = await call('POST', `/flights/${series.id}/days/${day2.id}/launch`);
let d2 = await call('GET', `/tournaments/${d2t}/full`);
assert(d2.players.length === 4 && d2.stats.chipsInPlay === 220000, 'flights : Day 2 avec les 4 qualifiés et leurs tapis bagués');
await call('POST', `/tournaments/${d2t}/clock`, { action: 'play' });
while (d2.players.filter((p) => p.status === 'active').length > 1) {
  const act = d2.players.filter((p) => p.status === 'active');
  await call('POST', `/tournaments/${d2t}/players/${act[act.length - 1].id}/bust`, {});
  d2 = await call('GET', `/tournaments/${d2t}/full`);
}
await call('POST', `/flights/${series.id}/days/${day2.id}/close`, {});
await call('POST', `/flights/${series.id}/close`);
fl = await call('GET', `/flights/${series.id}`);
assert(fl.recap.rows.length === 8 && fl.recap.totalEntries === 8 && fl.recap.rows[0].bestStage === 2 && fl.recap.rows[7].bestStage === 1, 'flights : classement global (Day 2 puis Day 1)');
const flChamp = await call('POST', '/championships', { name: 'Flights 2026', type: 'mtt' });
await call('POST', `/flights/${series.id}/export`, { championshipId: flChamp.id });
const fv = await call('GET', `/championships/${flChamp.id}`);
assert(fv.ranking.length === 8 && fv.ranking[0].points === Math.round(10 * Math.sqrt(8) * 10) / 10, 'flights : export championnat');
// Compte joueur (cookie distinct de l'organisateur)
let pcookie = '';
async function pcall(method, path, body) {
  const res = await fetch(BASE + '/api' + path, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), cookie: pcookie }, body: body ? JSON.stringify(body) : undefined });
  const sc = res.headers.get('set-cookie');
  if (sc) pcookie = sc.split(';')[0];
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(data)}`);
  return data;
}
const pl = await pcall('POST', '/player/register', { email: `joueur${Date.now()}@test.local`, password: 'secret123', pseudo: 'JoueurQR' });
const ev2 = await call('POST', '/events', { name: 'Tournoi joueurs', capacity: 10 });
await call('POST', `/events/${ev2.id}/status`, { status: 'open' });
await pcall('POST', `/public/events/${ev2.publicToken}/register`, { pseudo: 'JoueurQR', answers: {} });
const mine = await pcall('GET', '/player/me/tournaments');
assert(mine.registrations.length === 1 && mine.registrations[0].eventName === 'Tournoi joueurs', 'compte joueur : préinscription visible dans « Mes tournois »');
const { id: pLive } = await call('POST', '/tournaments', { title: 'Live joueurs' });
const pc = await call('POST', `/tournaments/${pLive}/checkin`, { code: pl.player.qrCode, add: true });
assert(pc.kind === 'registration' && pc.state === 'added', 'scan QR du compte joueur → préinscription pointée et joueur ajouté');
const pSnap = await call('GET', `/tournaments/${pLive}/full`);
assert(pSnap.players.some((p) => p.pseudo === 'JoueurQR' && p.present), 'joueur présent dans le live');
const m2 = await call('POST', '/club/members', { pseudo: 'JoueurQR-club' });
await call('PATCH', `/club/members/${m2.id}`, { playerEmail: pl.player.email });
const pc2 = await call('POST', `/tournaments/${pLive}/checkin`, { code: pl.player.qrCode });
assert(pc2.kind === 'member', 'compte joueur lié à une fiche adhérent → reconnu comme adhérent');

// ---- Modifications partielles : les champs non envoyés ne reviennent pas à leur valeur par défaut ----
const { club: myClub } = await call('GET', '/club');
const roleId = myClub.roles[0].id;
const m3 = await call('POST', '/club/members', { pseudo: 'Rôles', membershipType: 'both', roleIds: [roleId] });
await call('PATCH', `/club/members/${m3.id}`, { note: 'ok' });
const m3b = (await call('GET', '/club/members')).members.find((m) => m.id === m3.id);
assert(m3b.membershipType === 'both' && m3b.roleIds[0] === roleId && m3b.note === 'ok', 'PATCH adhérent partiel : type et rôles conservés');
const ev3 = await call('POST', '/events', { name: 'Partiel', buyin: 25, maxPerTable: 8 });
const ev3b = await call('PATCH', `/events/${ev3.id}`, { listed: true });
assert(ev3b.buyin === 25 && ev3b.maxPerTable === 8 && ev3b.listed === true, 'PATCH événement partiel : buy-in et format conservés');
const { id: t3 } = await call('POST', '/tournaments', { title: 'Partiel' });
await call('PATCH', `/tournaments/${t3}`, { settings: { multiSng: true, rebuyLimit: 2 } });
await call('PATCH', `/tournaments/${t3}`, { settings: { buyin: 15 } });
const t3b = await call('GET', `/tournaments/${t3}/full`);
assert(t3b.tournament.settings.multiSng === true && t3b.tournament.settings.rebuyLimit === 2, 'PATCH réglages partiel : Multi SnG et limite de recaves conservés');

// ---- Annuaire public et recherche de joueurs ----
await call('POST', `/events/${ev3.id}/status`, { status: 'open' });
const dir = await call('GET', '/public/directory');
assert(dir.events.some((e) => e.name === 'Partiel' && e.buyin === 25), 'annuaire public : événement listé visible');
assert(!dir.events.some((e) => e.name === 'Tournoi joueurs'), 'annuaire public : événement non listé absent');
const found = await call('GET', '/directory/players?q=JoueurQR');
const acc = found.players.find((s) => s.playerAccountId === pl.player.id);
assert(acc && !('email' in acc), 'recherche : compte joueur trouvé, sans email');
await pcall('PATCH', '/player/me', { discoverable: false });
const hidden = await call('GET', '/directory/players?q=JoueurQR');
assert(!hidden.players.some((s) => s.key === 'a:' + pl.player.id), 'recherche : compte non trouvable masqué (sauf joueurs déjà connus de l’organisateur)');
console.log('\nTous les tests de fumée sont passés.');
