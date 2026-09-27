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
console.log('\nTous les tests de fumée sont passés.');
