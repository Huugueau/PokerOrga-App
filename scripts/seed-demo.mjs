// Crée un compte de démonstration avec un live prêt à jouer.
// Usage : node scripts/seed-demo.mjs [http://localhost:3000]
// Compte de démo (instance locale uniquement) :
const EMAIL = 'demo@pokerorga.test';
const PASSWORD = 'demo1234';

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
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(data)}`);
  return data;
}

try {
  await call('POST', '/auth/register', { email: EMAIL, password: PASSWORD, acceptTerms: true });
  console.log('Compte créé :', EMAIL);
} catch {
  await call('POST', '/auth/login', { email: EMAIL, password: PASSWORD });
  console.log('Compte existant :', EMAIL);
}
await call('PATCH', '/account', { pseudo: 'Organisateur', clubName: 'Club Démo' });
const { id } = await call('POST', '/tournaments/current');
const snap = await call('GET', `/tournaments/${id}/full`);
if (snap.players.length === 0) {
  await call('PATCH', `/tournaments/${id}`, { title: 'Tournoi du vendredi', settings: { entryFormat: 'reentry', buyin: 20, maxPerTable: 8, finalTableSize: 8, trackKills: true } });
  const names = ['Maxou', 'La Fouine', 'Doyle', 'Phil', 'Vanessa', 'Gus', 'Patrik', 'Fedor', 'Bertrand', 'Kalid', 'Sam', 'Lucie', 'Nico', 'Julie'];
  await call('POST', `/tournaments/${id}/players/import`, { rows: names.map((pseudo) => ({ pseudo })) });
  await call('POST', `/tournaments/${id}/seating/draw`);
  console.log('Live prêt avec', names.length, 'joueurs :', `/live/${id}`);
}
const champs = await call('GET', '/championships');
if (champs.items.length === 0) await call('POST', '/championships', { name: 'Saison 2026', type: 'mtt', bestResults: null });
const events = await call('GET', '/events');
if (events.items.length === 0) {
  const ev = await call('POST', '/events', { name: 'Tournoi du samedi', capacity: 20, eventDate: '2026-10-10', eventTime: '20:30', location: 'Chez Max', options: [{ label: 'Présent au repas, prévoir 15€' }] });
  await call('POST', `/events/${ev.id}/status`, { status: 'open' });
}
console.log('Démo prête.');
