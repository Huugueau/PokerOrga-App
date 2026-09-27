/**
 * Moteur d'une main de No-Limit Hold'em : blinds & antes, enchères (relances minimales,
 * all-in incomplets qui ne rouvrent pas les enchères), side pots, mises non suivies,
 * abattage avec partages et jetons indivisibles.
 *
 * La main est entièrement dérivée de sa configuration + de la liste de ses actions
 * (`replayHand`) : l'annulation consiste à retirer la dernière action.
 */
import { bestHand, describeHand, duplicateCard, explainWin, isCard, type Card, type HandValue } from './cards';

export type AnteMode = 'none' | 'bb' | 'all';

export interface HandSeatConfig {
  seat: number;
  playerId: string | null;
  name: string;
  stack: number;
}

export interface HandConfig {
  seats: HandSeatConfig[];
  /** Siège du bouton (doit être un joueur de la main). */
  button: number;
  sb: number;
  bb: number;
  ante: number;
  /** `bb` = big blind ante (payée par la grosse blinde, argent mort), `all` = ante classique. */
  anteMode: AnteMode;
}

export type HandAction =
  | { type: 'fold'; seat: number }
  | { type: 'check'; seat: number }
  | { type: 'call'; seat: number }
  /** Mise / relance « à » `to` (montant total misé sur le tour d'enchères). */
  | { type: 'bet'; seat: number; to: number }
  | { type: 'allin'; seat: number }
  /** Remplace le board (3 à 5 cartes selon le tour). */
  | { type: 'board'; cards: Card[] }
  | { type: 'show'; seat: number; cards: Card[] }
  | { type: 'muck'; seat: number }
  /** Valide l'abattage et distribue les pots. */
  | { type: 'resolve' };

export type Street = 'preflop' | 'flop' | 'turn' | 'river';
export type HandPhase = Street | 'showdown' | 'complete';

export const STREET_LABEL: Record<HandPhase, string> = {
  preflop: 'Préflop',
  flop: 'Flop',
  turn: 'Turn',
  river: 'River',
  showdown: 'Abattage',
  complete: 'Terminée',
};

/** Nombre de cartes du board attendues à chaque phase. */
export const BOARD_SIZE: Record<HandPhase, number> = { preflop: 0, flop: 3, turn: 4, river: 5, showdown: 5, complete: 5 };

export interface HandPlayer {
  seat: number;
  playerId: string | null;
  name: string;
  startStack: number;
  /** Jetons encore devant le joueur. */
  stack: number;
  /** Total engagé dans la main (antes classiques comprises). */
  committed: number;
  /** Engagé sur le tour d'enchères en cours. */
  streetBet: number;
  folded: boolean;
  allIn: boolean;
  /** A parlé volontairement sur ce tour. */
  acted: boolean;
  /** Niveau de mise au moment de sa dernière parole (droit de relance). */
  actedAtBet: number;
  cards: Card[] | null;
  mucked: boolean;
}

export type HandEventKind = 'ante' | 'sb' | 'bb' | 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allin' | 'street' | 'board' | 'show' | 'muck' | 'return' | 'win';

export interface HandEvent {
  phase: HandPhase;
  seat: number | null;
  kind: HandEventKind;
  amount?: number;
  cards?: Card[];
  text: string;
  /** Index de l'action (dans la liste des actions) qui a produit l'évènement ; -1 = mise en place. */
  action: number;
}

export interface Pot {
  amount: number;
  /** Sièges pouvant gagner ce pot. */
  eligible: number[];
}

export interface PotResult extends Pot {
  label: string;
  winners: number[];
  /** Gain par siège. */
  shares: Record<number, number>;
  /** Description de la main gagnante (si abattage disputé). */
  hand: string | null;
  /** Explication du départage face à la meilleure main battue. */
  reason: string | null;
}

export interface HandResult {
  pots: PotResult[];
  returned: { seat: number; amount: number }[];
  /** Total reçu par siège (pots + mise non suivie rendue). */
  collected: Record<number, number>;
  finalStacks: Record<number, number>;
  /** Mains évaluées à l'abattage. */
  hands: Record<number, { description: string; cards: Card[] }>;
  showdown: boolean;
}

export interface HandState {
  config: HandConfig;
  players: HandPlayer[];
  phase: HandPhase;
  board: Card[];
  sbSeat: number;
  bbSeat: number;
  currentBet: number;
  /** Incrément minimal d'une relance complète. */
  lastRaise: number;
  toAct: number | null;
  /** Argent mort (big blind ante), ajouté au pot principal. */
  dead: number;
  events: HandEvent[];
  result: HandResult | null;
  /** Nombre d'actions appliquées. */
  step: number;
}

export class HandError extends Error {}

const fmt = (n: number) => n.toLocaleString('fr-FR');

// ---------------- Helpers ----------------

function byseat(s: HandState, seat: number): HandPlayer {
  const p = s.players.find((x) => x.seat === seat);
  if (!p) throw new HandError(`Siège ${seat} absent de la main.`);
  return p;
}

/** Joueurs dans l'ordre horaire à partir du siège suivant `seat`. */
function after(s: HandState, seat: number): HandPlayer[] {
  const i = s.players.findIndex((p) => p.seat > seat);
  const k = i < 0 ? 0 : i;
  return [...s.players.slice(k), ...s.players.slice(0, k)];
}

const live = (s: HandState) => s.players.filter((p) => !p.folded);
const canBet = (p: HandPlayer) => !p.folded && !p.allIn;

function needsToAct(s: HandState, p: HandPlayer): boolean {
  if (!canBet(p)) return false;
  if (p.streetBet < s.currentBet) return true;
  if (p.acted) return false;
  // seul joueur encore capable de miser et déjà à niveau : rien à décider
  return s.players.some((o) => o !== p && canBet(o));
}

function pay(p: HandPlayer, amount: number, street = true): number {
  const a = Math.max(0, Math.min(amount, p.stack));
  p.stack -= a;
  p.committed += a;
  if (street) p.streetBet += a;
  if (p.stack === 0) p.allIn = true;
  return a;
}

function event(s: HandState, e: Omit<HandEvent, 'phase' | 'action'>) {
  s.events.push({ phase: s.phase, action: s.step - 1, ...e });
}

// ---------------- Mise en place ----------------

export function startHand(config: HandConfig): HandState {
  const seats = config.seats.filter((x) => x.stack > 0).sort((a, b) => a.seat - b.seat);
  if (seats.length < 2) throw new HandError('Il faut au moins 2 joueurs avec des jetons.');
  if (new Set(seats.map((x) => x.seat)).size !== seats.length) throw new HandError('Deux joueurs occupent le même siège.');
  if (!seats.some((x) => x.seat === config.button)) throw new HandError('Le bouton doit être devant un joueur de la main.');
  if (config.bb <= 0 || config.sb < 0 || config.ante < 0) throw new HandError('Blindes invalides.');

  const s: HandState = {
    config,
    players: seats.map((x) => ({
      seat: x.seat,
      playerId: x.playerId,
      name: x.name,
      startStack: x.stack,
      stack: x.stack,
      committed: 0,
      streetBet: 0,
      folded: false,
      allIn: false,
      acted: false,
      actedAtBet: 0,
      cards: null,
      mucked: false,
    })),
    phase: 'preflop',
    board: [],
    sbSeat: 0,
    bbSeat: 0,
    currentBet: config.bb,
    lastRaise: config.bb,
    toAct: null,
    dead: 0,
    events: [],
    result: null,
    step: 0,
  };
  // En tête-à-tête, le bouton est petite blinde.
  const sbp = seats.length === 2 ? byseat(s, config.button) : after(s, config.button)[0];
  const bbp = after(s, sbp.seat)[0];
  s.sbSeat = sbp.seat;
  s.bbSeat = bbp.seat;

  if (config.anteMode === 'all' && config.ante > 0) {
    for (const p of after(s, config.button)) {
      const a = pay(p, config.ante, false);
      event(s, { seat: p.seat, kind: 'ante', amount: a, text: `${p.name} paie l'ante ${fmt(a)}${p.allIn ? ' (tapis)' : ''}` });
    }
  }
  if (config.sb > 0 && !sbp.allIn) {
    const a = pay(sbp, config.sb);
    event(s, { seat: sbp.seat, kind: 'sb', amount: a, text: `${sbp.name} poste la petite blinde ${fmt(a)}${sbp.allIn ? ' (tapis)' : ''}` });
  }
  if (!bbp.allIn) {
    const a = pay(bbp, config.bb);
    event(s, { seat: bbp.seat, kind: 'bb', amount: a, text: `${bbp.name} poste la grosse blinde ${fmt(a)}${bbp.allIn ? ' (tapis)' : ''}` });
  }
  // Big blind ante : la blinde est prioritaire, l'ante (argent mort) est prise sur le reste.
  if (config.anteMode === 'bb' && config.ante > 0 && !bbp.allIn) {
    const a = Math.min(config.ante, bbp.stack);
    bbp.stack -= a;
    if (bbp.stack === 0) bbp.allIn = true;
    s.dead += a;
    event(s, { seat: bbp.seat, kind: 'ante', amount: a, text: `${bbp.name} paie la big blind ante ${fmt(a)}${bbp.allIn ? ' (tapis)' : ''}` });
  }
  // Même si la grosse blinde est à tapis pour moins, il faut payer une grosse blinde complète.
  s.currentBet = config.bb;
  s.lastRaise = config.bb;
  moveOn(s, bbp.seat);
  return s;
}

// ---------------- Enchères ----------------

export interface LegalActions {
  seat: number;
  toCall: number;
  canCheck: boolean;
  canCall: boolean;
  /** Suivre met le joueur à tapis. */
  callIsAllIn: boolean;
  canRaise: boolean;
  /** Ouverture (mise) plutôt que relance. */
  isBet: boolean;
  minTo: number;
  maxTo: number;
}

export function legalActions(s: HandState): LegalActions | null {
  if (s.toAct == null || s.phase === 'showdown' || s.phase === 'complete') return null;
  const p = byseat(s, s.toAct);
  const toCall = Math.max(0, Math.min(s.currentBet - p.streetBet, p.stack));
  const maxTo = p.streetBet + p.stack;
  const reopened = !p.acted || s.currentBet - p.actedAtBet >= s.lastRaise;
  const opponents = s.players.some((o) => o !== p && canBet(o));
  const canRaise = reopened && opponents && maxTo > s.currentBet;
  const isBet = s.currentBet === 0;
  const minTo = Math.min(isBet ? s.config.bb : s.currentBet + s.lastRaise, maxTo);
  return {
    seat: p.seat,
    toCall,
    canCheck: p.streetBet >= s.currentBet,
    canCall: p.streetBet < s.currentBet,
    callIsAllIn: toCall > 0 && toCall === p.stack,
    canRaise,
    isBet,
    minTo,
    maxTo,
  };
}

function betTo(s: HandState, p: HandPlayer, to: number) {
  const la = legalActions(s)!;
  if (!la.canRaise) throw new HandError(la.canCall ? 'Relance impossible : le joueur peut seulement suivre ou se coucher.' : 'Relance impossible.');
  if (!Number.isInteger(to) || to <= s.currentBet) throw new HandError(`La mise doit dépasser ${fmt(s.currentBet)}.`);
  if (to > la.maxTo) throw new HandError(`Mise supérieure au tapis (${fmt(la.maxTo)} maximum).`);
  if (to < la.minTo && to !== la.maxTo) throw new HandError(`${la.isBet ? 'Mise' : 'Relance'} minimum : ${fmt(la.minTo)}.`);
  const wasBet = la.isBet;
  const increment = to - s.currentBet;
  pay(p, to - p.streetBet);
  const full = increment >= s.lastRaise || (wasBet && to >= s.config.bb);
  if (full) s.lastRaise = Math.max(increment, s.config.bb);
  s.currentBet = to;
  const verb = wasBet ? 'mise' : 'relance à';
  const allin = p.allIn ? (full ? ' (tapis)' : ` (tapis, ${wasBet ? 'mise' : 'relance'} incomplète)`) : '';
  event(s, { seat: p.seat, kind: p.allIn ? 'allin' : wasBet ? 'bet' : 'raise', amount: to, text: `${p.name} ${verb} ${fmt(to)}${allin}` });
}

function act(s: HandState, a: Extract<HandAction, { seat: number }>) {
  if (s.toAct == null) throw new HandError("Ce n'est à personne de parler.");
  if (a.seat !== s.toAct) throw new HandError(`C'est à ${byseat(s, s.toAct).name} de parler.`);
  const p = byseat(s, a.seat);
  const la = legalActions(s)!;
  switch (a.type) {
    case 'fold':
      p.folded = true;
      event(s, { seat: p.seat, kind: 'fold', text: `${p.name} se couche` });
      break;
    case 'check':
      if (!la.canCheck) throw new HandError(`Impossible de checker : il faut suivre ${fmt(la.toCall)}.`);
      event(s, { seat: p.seat, kind: 'check', text: `${p.name} checke` });
      break;
    case 'call': {
      if (!la.canCall) throw new HandError('Rien à suivre : le joueur peut checker.');
      const paid = pay(p, s.currentBet - p.streetBet);
      event(s, { seat: p.seat, kind: p.allIn ? 'allin' : 'call', amount: paid, text: `${p.name} suit ${fmt(paid)}${p.allIn ? ' (tapis)' : ''}` });
      break;
    }
    case 'bet':
      betTo(s, p, a.to);
      break;
    case 'allin':
      if (la.maxTo <= s.currentBet) {
        const paid = pay(p, p.stack);
        event(s, { seat: p.seat, kind: 'allin', amount: paid, text: `${p.name} suit ${fmt(paid)} (tapis)` });
      } else betTo(s, p, la.maxTo);
      break;
  }
  if (!p.folded) {
    p.acted = true;
    p.actedAtBet = s.currentBet;
  }
  moveOn(s, p.seat);
}

/** Passe la parole, ou clôt le tour d'enchères. */
function moveOn(s: HandState, fromSeat: number) {
  if (live(s).length === 1) {
    s.toAct = null;
    finish(s);
    return;
  }
  const next = after(s, fromSeat).find((p) => needsToAct(s, p));
  if (next) {
    s.toAct = next.seat;
    return;
  }
  // tour d'enchères terminé
  for (const p of s.players) {
    p.streetBet = 0;
    p.acted = false;
    p.actedAtBet = 0;
  }
  s.currentBet = 0;
  s.lastRaise = s.config.bb;
  s.toAct = null;
  const bettors = s.players.filter(canBet);
  if (bettors.length <= 1 || s.phase === 'river') {
    s.phase = 'showdown';
    event(s, { seat: null, kind: 'street', text: bettors.length <= 1 && s.board.length < 5 ? 'Plus d\'enchères possibles : abattage' : 'Abattage' });
    return;
  }
  s.phase = s.phase === 'preflop' ? 'flop' : s.phase === 'flop' ? 'turn' : 'river';
  event(s, { seat: null, kind: 'street', text: STREET_LABEL[s.phase] });
  s.toAct = after(s, s.config.button).find((p) => needsToAct(s, p))?.seat ?? null;
}

// ---------------- Pots ----------------

/** Découpe les engagements en pot principal + side pots ; isole les mises non suivies. */
export function computePots(s: Pick<HandState, 'players' | 'dead'>): { pots: Pot[]; returned: { seat: number; amount: number }[] } {
  const pots: Pot[] = [];
  const returned: { seat: number; amount: number }[] = [];
  const levels = [...new Set(s.players.map((p) => p.committed).filter((c) => c > 0))].sort((a, b) => a - b);
  let prev = 0;
  for (const lvl of levels) {
    const contributors = s.players.filter((p) => p.committed > prev);
    const amount = contributors.reduce((a, p) => a + Math.min(p.committed, lvl) - prev, 0);
    const eligible = s.players.filter((p) => !p.folded && p.committed >= lvl).map((p) => p.seat);
    prev = lvl;
    if (amount === 0) continue;
    const last = pots[pots.length - 1];
    if (contributors.length === 1 && eligible.length === 1 && eligible[0] === contributors[0].seat) {
      returned.push({ seat: eligible[0], amount });
    } else if (eligible.length === 0 && last) {
      last.amount += amount;
    } else if (last && last.eligible.join() === eligible.join()) {
      last.amount += amount;
    } else {
      pots.push({ amount, eligible });
    }
  }
  if (s.dead > 0) {
    if (pots.length) pots[0].amount += s.dead;
    else pots.push({ amount: s.dead, eligible: s.players.filter((p) => !p.folded).map((p) => p.seat) });
  }
  return { pots, returned };
}

/** Pot total visible au centre de la table. */
export const totalPot = (s: HandState) => s.players.reduce((a, p) => a + p.committed, 0) + s.dead;

// ---------------- Abattage ----------------

function usedCards(s: HandState, exceptSeat?: number): Card[] {
  return [...s.board, ...s.players.filter((p) => p.seat !== exceptSeat && p.cards).flatMap((p) => p.cards!)];
}

function checkCards(cards: Card[], expected: number[], what: string) {
  if (!cards.every(isCard)) throw new HandError(`Carte invalide dans ${what}.`);
  if (!expected.includes(cards.length)) throw new HandError(`${what} : ${expected.join(' ou ')} cartes attendues.`);
  const d = duplicateCard(cards);
  if (d) throw new HandError(`Carte en double : ${d}.`);
}

/** Évalue la main d'un joueur si ses cartes et le board complet sont connus. */
export function handValueOf(s: HandState, seat: number): HandValue | null {
  const p = byseat(s, seat);
  if (!p.cards || p.cards.length !== 2 || s.board.length !== 5) return null;
  return bestHand([...p.cards, ...s.board]);
}

/** Distribue les pots. Lève une erreur si l'abattage est incomplet. */
function finish(s: HandState) {
  const { pots, returned } = computePots(s);
  const collected: Record<number, number> = {};
  const hands: HandResult['hands'] = {};
  let showdown = false;
  const order = after(s, s.config.button).map((p) => p.seat); // jetons indivisibles : premier à gauche du bouton
  const potResults: PotResult[] = pots.map((pot, i) => {
    const contenders = pot.eligible.filter((seat) => !byseat(s, seat).mucked);
    if (contenders.length === 0) throw new HandError(`${i === 0 ? 'Pot principal' : `Side pot ${i}`} : au moins un joueur doit montrer ses cartes.`);
    let winners = contenders;
    let hand: string | null = null;
    let reason: string | null = null;
    if (contenders.length > 1) {
      if (s.board.length !== 5) throw new HandError('Saisissez le board complet (5 cartes) pour départager.');
      const vals = contenders.map((seat) => {
        const v = handValueOf(s, seat);
        if (!v) throw new HandError(`Saisissez les cartes de ${byseat(s, seat).name} (ou faites-le jeter).`);
        hands[seat] = { description: describeHand(v), cards: v.cards };
        return { seat, v };
      });
      showdown = true;
      const top = Math.max(...vals.map((x) => x.v.score));
      const best = vals.filter((x) => x.v.score === top);
      winners = best.map((x) => x.seat);
      hand = describeHand(best[0].v);
      const losers = vals.filter((x) => x.v.score < top).sort((a, b) => b.v.score - a.v.score);
      reason = losers.length ? explainWin(best[0].v, losers[0].v) : null;
      if (best.length > 1) reason = `Partage entre ${best.length} joueurs (mains identiques)${reason ? ` — ${reason}` : ''}`;
    }
    const shares: Record<number, number> = {};
    const base = Math.floor(pot.amount / winners.length);
    let odd = pot.amount - base * winners.length;
    for (const w of winners) shares[w] = base;
    for (const seat of order) {
      if (odd <= 0) break;
      if (winners.includes(seat)) {
        shares[seat]++;
        odd--;
      }
    }
    for (const [seat, amt] of Object.entries(shares)) collected[+seat] = (collected[+seat] ?? 0) + amt;
    return { ...pot, label: i === 0 ? 'Pot principal' : `Side pot ${i}`, winners, shares, hand, reason };
  });
  for (const r of returned) collected[r.seat] = (collected[r.seat] ?? 0) + r.amount;
  const finalStacks: Record<number, number> = {};
  for (const p of s.players) finalStacks[p.seat] = p.stack + (collected[p.seat] ?? 0);

  s.phase = 'complete';
  s.toAct = null;
  s.result = { pots: potResults, returned, collected, finalStacks, hands, showdown };
  for (const r of returned) event(s, { seat: r.seat, kind: 'return', amount: r.amount, text: `Mise non suivie rendue à ${byseat(s, r.seat).name} : ${fmt(r.amount)}` });
  for (const pr of potResults) {
    const names = pr.winners.map((w) => byseat(s, w).name).join(' et ');
    const split = pr.winners.length > 1 ? ' (partage)' : '';
    event(s, { seat: pr.winners[0], kind: 'win', amount: pr.amount, text: `${names} remporte ${pr.label.toLowerCase()} (${fmt(pr.amount)})${split}${pr.hand ? ` avec ${pr.hand}` : ''}` });
  }
}

// ---------------- Application ----------------

export function applyAction(state: HandState, a: HandAction): HandState {
  if (state.phase === 'complete') throw new HandError('La main est terminée.');
  const s: HandState = structuredClone(state);
  s.step++;
  switch (a.type) {
    case 'fold':
    case 'check':
    case 'call':
    case 'bet':
    case 'allin':
      if (s.phase === 'showdown') throw new HandError('Les enchères sont terminées.');
      act(s, a);
      break;
    case 'board': {
      const max = BOARD_SIZE[s.phase];
      if (max === 0) throw new HandError('Le board se saisit à partir du flop.');
      const allowed = [0, 3, 4, 5].filter((n) => n <= max);
      checkCards(a.cards, allowed, 'Le board');
      const clash = a.cards.find((c) => usedCards({ ...s, board: [] }).includes(c));
      if (clash) throw new HandError(`La carte ${clash} est déjà dans la main d'un joueur.`);
      s.board = a.cards.slice();
      event(s, { seat: null, kind: 'board', cards: s.board, text: `Board : ${s.board.join(' ') || '(vide)'}` });
      break;
    }
    case 'show': {
      const p = byseat(s, a.seat);
      if (p.folded) throw new HandError(`${p.name} s'est couché.`);
      checkCards(a.cards, [2], 'La main');
      const clash = a.cards.find((c) => usedCards(s, p.seat).includes(c));
      if (clash) throw new HandError(`La carte ${clash} est déjà utilisée.`);
      p.cards = a.cards.slice();
      p.mucked = false;
      event(s, { seat: p.seat, kind: 'show', cards: p.cards, text: `${p.name} montre ${p.cards.join(' ')}` });
      break;
    }
    case 'muck': {
      if (s.phase !== 'showdown') throw new HandError("On ne jette sa main qu'à l'abattage.");
      const p = byseat(s, a.seat);
      if (p.folded) throw new HandError(`${p.name} s'est couché.`);
      p.mucked = true;
      p.cards = null;
      event(s, { seat: p.seat, kind: 'muck', text: `${p.name} jette sa main` });
      break;
    }
    case 'resolve':
      if (s.phase !== 'showdown') throw new HandError("La main n'est pas à l'abattage.");
      finish(s);
      break;
    default:
      throw new HandError('Action inconnue.');
  }
  return s;
}

export function replayHand(config: HandConfig, actions: HandAction[]): HandState {
  let s = startHand(config);
  for (const a of actions) s = applyAction(s, a);
  return s;
}

/** Aperçu du résultat de l'abattage (sans erreur si incomplet). */
export function previewShowdown(s: HandState): { result: HandResult | null; error: string | null } {
  if (s.phase !== 'showdown') return { result: s.result, error: null };
  try {
    return { result: applyAction(s, { type: 'resolve' }).result, error: null };
  } catch (e) {
    return { result: null, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Siège du prochain bouton : joueur suivant (dans le sens horaire) parmi les sièges donnés. */
export function nextButton(prevButton: number | null, seats: number[]): number | null {
  const sorted = [...new Set(seats)].sort((a, b) => a - b);
  if (!sorted.length) return null;
  if (prevButton == null) return sorted[0];
  return sorted.find((x) => x > prevButton) ?? sorted[0];
}

/** Ante par défaut : big blind ante si l'ante égale la grosse blinde. */
export const defaultAnteMode = (ante: number, bb: number): AnteMode => (ante <= 0 ? 'none' : ante === bb ? 'bb' : 'all');
