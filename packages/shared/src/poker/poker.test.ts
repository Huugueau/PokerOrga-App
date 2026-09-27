import { describe, expect, it } from 'vitest';
import {
  applyAction,
  bestHand,
  computeEquity,
  computePots,
  describeHand,
  explainWin,
  legalActions,
  nextButton,
  replayHand,
  startHand,
  type HandAction,
  type HandConfig,
} from '../index';

const hv = (s: string) => bestHand(s.split(' '));

function cfg(stacks: number[], extra: Partial<HandConfig> = {}): HandConfig {
  return {
    seats: stacks.map((stack, i) => ({ seat: i + 1, playerId: null, name: String.fromCharCode(65 + i), stack })),
    button: 1,
    sb: 50,
    bb: 100,
    ante: 0,
    anteMode: 'none',
    ...extra,
  };
}

const run = (c: HandConfig, actions: HandAction[]) => replayHand(c, actions);

describe('évaluateur', () => {
  it('classe les catégories', () => {
    expect(hv('As Ks Qs Js Ts 2d 3c').category).toBe(8);
    expect(describeHand(hv('As Ks Qs Js Ts 2d 3c'))).toBe('Quinte flush royale');
    expect(hv('9h 9d 9s 9c Ah 2d 3c').category).toBe(7);
    expect(describeHand(hv('Kh Kd Ks 8c 8h 2d 3c'))).toBe('Full aux Rois par les 8');
    expect(hv('Ah 2h 7h 9h Jh Kd Kc').category).toBe(5);
    expect(hv('Ah 2d 3c 4s 5h Kd Kc').category).toBe(4);
    expect(describeHand(hv('Ah 2d 3c 4s 5h Kd Qc'))).toBe('Quinte hauteur 5');
    expect(hv('6h 2d 3c 4s 5h Ad Kc').ranks[0]).toBe(6);
  });
  it('départage au kicker', () => {
    const a = hv('Ah Ad Kc 9s 5h 3d 2c');
    const b = hv('Ah Ad Qc 9s 5h 3d 2c');
    expect(a.score).toBeGreaterThan(b.score);
    expect(explainWin(a, b)).toBe('Départage au kicker : Roi contre Dame.');
    const c = hv('Ah Ad Kc Js 5h 3d 2c');
    expect(explainWin(c, a)).toBe('Départage au 2e kicker : Valet contre 9.');
  });
  it('le board joue : égalité', () => {
    const board = 'As Ks Qd Jc Th';
    expect(hv(`2c 3d ${board}`).score).toBe(hv(`4h 5h ${board}`).score);
  });
  it('double paire : la 5e carte compte', () => {
    const a = hv('Ah 2c Kd Kc 7s 7d 3h');
    const b = hv('Qh 2d Kd Kc 7s 7d 3h');
    expect(explainWin(a, b)).toContain('kicker');
  });
  it('équité exacte à la river et au turn', () => {
    const e = computeEquity([['Ah', 'Ad'], ['Kh', 'Kd']], ['2c', '7s', '9d', 'Jc']);
    expect(e.exact).toBe(true);
    expect(e.samples).toBe(44);
    expect(e.equity[0]).toBeCloseTo(42 / 44, 5);
  });
});

describe('main : enchères', () => {
  it('blindes et parole préflop à 3 joueurs', () => {
    const s = startHand(cfg([1000, 1000, 1000]));
    expect(s.sbSeat).toBe(2);
    expect(s.bbSeat).toBe(3);
    expect(s.toAct).toBe(1);
    expect(legalActions(s)!.minTo).toBe(200);
  });
  it('tête-à-tête : le bouton est petite blinde et parle en premier', () => {
    const s = startHand(cfg([1000, 1000]));
    expect(s.sbSeat).toBe(1);
    expect(s.toAct).toBe(1);
    const f = run(cfg([1000, 1000]), [{ type: 'call', seat: 1 }, { type: 'check', seat: 2 }]);
    expect(f.phase).toBe('flop');
    expect(f.toAct).toBe(2);
  });
  it('option de la grosse blinde', () => {
    const s = run(cfg([1000, 1000, 1000]), [{ type: 'call', seat: 1 }, { type: 'call', seat: 2 }]);
    expect(s.toAct).toBe(3);
    expect(legalActions(s)!.canCheck).toBe(true);
    expect(legalActions(s)!.canRaise).toBe(true);
  });
  it('relance minimale', () => {
    const s = run(cfg([5000, 5000, 5000]), [{ type: 'bet', seat: 1, to: 300 }]);
    expect(legalActions(s)!.minTo).toBe(500);
    expect(() => applyAction(s, { type: 'bet', seat: 2, to: 400 })).toThrow(/minimum : 500/);
  });
  it("un all-in incomplet ne rouvre pas les enchères", () => {
    // postflop : A mise 1000, B tapis 1500 (incomplet), C suit ; A ne peut que suivre ou se coucher
    const c = cfg([10000, 1600, 10000], { button: 3 });
    const s = run(c, [
      { type: 'call', seat: 3 },
      { type: 'call', seat: 1 },
      { type: 'check', seat: 2 },
      { type: 'bet', seat: 1, to: 1000 },
      { type: 'allin', seat: 2 },
    ]);
    expect(s.currentBet).toBe(1500);
    expect(s.toAct).toBe(3);
    expect(legalActions(s)!.canRaise).toBe(true); // C n'a pas encore parlé
    const s2 = applyAction(s, { type: 'call', seat: 3 });
    expect(s2.toAct).toBe(1);
    const la = legalActions(s2)!;
    expect(la.canRaise).toBe(false);
    expect(la.toCall).toBe(500);
  });
  it('des all-in incomplets cumulés rouvrent les enchères', () => {
    const c = cfg([10000, 1600, 2200, 10000], { button: 4 });
    const s = run(c, [
      { type: 'call', seat: 3 },
      { type: 'call', seat: 4 },
      { type: 'call', seat: 1 },
      { type: 'check', seat: 2 },
      { type: 'bet', seat: 1, to: 1000 },
      { type: 'allin', seat: 2 }, // 1500
      { type: 'allin', seat: 3 }, // 2100
      { type: 'call', seat: 4 },
    ]);
    expect(s.toAct).toBe(1);
    expect(legalActions(s)!.canRaise).toBe(true);
  });
  it('grosse blinde à tapis pour moins : il faut suivre une blinde complète', () => {
    const s = startHand(cfg([1000, 1000, 60]));
    expect(s.currentBet).toBe(100);
    expect(legalActions(s)!.toCall).toBe(100);
  });
  it('tout le monde se couche : la grosse blinde gagne et récupère sa mise non suivie', () => {
    const s = run(cfg([1000, 1000, 1000], { ante: 100, anteMode: 'bb' }), [
      { type: 'fold', seat: 1 },
      { type: 'fold', seat: 2 },
    ]);
    expect(s.phase).toBe('complete');
    expect(s.result!.finalStacks).toEqual({ 1: 1000, 2: 950, 3: 1050 });
  });
  it('les jetons sont conservés', () => {
    const c = cfg([3000, 800, 5000], { ante: 100, anteMode: 'bb' });
    const s = run(c, [
      { type: 'bet', seat: 1, to: 300 },
      { type: 'allin', seat: 2 },
      { type: 'call', seat: 3 },
      { type: 'call', seat: 1 },
      { type: 'board', cards: ['2c', '7d', '9h'] },
      { type: 'bet', seat: 3, to: 1000 },
      { type: 'fold', seat: 1 },
    ]);
    expect(s.phase).toBe('showdown');
    const done = applyAction(
      applyAction(applyAction(applyAction(s, { type: 'board', cards: ['2c', '7d', '9h', 'Ks', '3s'] }), { type: 'show', seat: 2, cards: ['Ah', 'Ad'] }), { type: 'show', seat: 3, cards: ['Kh', 'Qd'] }),
      { type: 'resolve' },
    );
    const total = Object.values(done.result!.finalStacks).reduce((a, b) => a + b, 0);
    expect(total).toBe(8800);
  });
});

describe('main : side pots et abattage', () => {
  it('all-in partiel : pot principal + side pot', () => {
    // A 500, B 2000, C 2000 ; tout le monde à tapis préflop
    const c = cfg([500, 2000, 2000], { button: 1 });
    let s = run(c, [
      { type: 'allin', seat: 1 },
      { type: 'allin', seat: 2 },
      { type: 'call', seat: 3 },
    ]);
    expect(s.phase).toBe('showdown');
    const { pots } = computePots(s);
    expect(pots).toEqual([
      { amount: 1500, eligible: [1, 2, 3] },
      { amount: 3000, eligible: [2, 3] },
    ]);
    s = applyAction(s, { type: 'board', cards: ['2c', '7d', '9h', 'Js', '3s'] });
    s = applyAction(s, { type: 'show', seat: 1, cards: ['Ah', 'Ad'] });
    s = applyAction(s, { type: 'show', seat: 2, cards: ['Kh', 'Kd'] });
    s = applyAction(s, { type: 'show', seat: 3, cards: ['Qh', 'Qd'] });
    s = applyAction(s, { type: 'resolve' });
    expect(s.result!.pots.map((p) => p.winners)).toEqual([[1], [2]]);
    expect(s.result!.finalStacks).toEqual({ 1: 1500, 2: 3000, 3: 0 });
  });
  it('mise non suivie rendue au plus gros tapis', () => {
    const s = run(cfg([5000, 1000, 1000], { button: 1 }), [
      { type: 'allin', seat: 1 },
      { type: 'call', seat: 2 },
      { type: 'fold', seat: 3 },
    ]);
    expect(s.phase).toBe('showdown');
    const { pots, returned } = computePots(s);
    expect(pots).toEqual([{ amount: 2100, eligible: [1, 2] }]);
    expect(returned).toEqual([{ seat: 1, amount: 4000 }]);
  });
  it('partage avec jeton indivisible au premier joueur à gauche du bouton', () => {
    const c = cfg([1001, 1000, 1000], { button: 3, sb: 0, bb: 1 });
    // pot de 3 : A tapis 1001, B tapis 1000, C (bouton) suit 1000 → pot principal 3000 + 1 rendu
    let s = run(c, [
      { type: 'allin', seat: 3 },
      { type: 'allin', seat: 1 },
      { type: 'call', seat: 2 },
    ]);
    s = applyAction(s, { type: 'board', cards: ['As', 'Ks', 'Qd', 'Jc', 'Th'] });
    for (const [seat, cards] of [[1, ['2c', '3d']], [2, ['4h', '5h']], [3, ['6c', '7c']]] as const) s = applyAction(s, { type: 'show', seat, cards: [...cards] });
    s = applyAction(s, { type: 'resolve' });
    expect(s.result!.pots[0].winners).toEqual([1, 2, 3]);
    expect(s.result!.pots[0].reason).toMatch(/Partage/);
  });
  it('mains jetées et joueur seul à montrer', () => {
    let s = run(cfg([1000, 1000]), [{ type: 'allin', seat: 1 }, { type: 'call', seat: 2 }]);
    s = applyAction(s, { type: 'muck', seat: 2 });
    s = applyAction(s, { type: 'resolve' });
    expect(s.result!.finalStacks).toEqual({ 1: 2000, 2: 0 });
  });
  it("refuse l'abattage incomplet et les doublons", () => {
    const s = run(cfg([1000, 1000]), [{ type: 'allin', seat: 1 }, { type: 'call', seat: 2 }]);
    expect(() => applyAction(s, { type: 'resolve' })).toThrow(/board complet/);
    const b = applyAction(s, { type: 'board', cards: ['As', 'Ks', 'Qd', 'Jc', 'Th'] });
    expect(() => applyAction(b, { type: 'show', seat: 1, cards: ['As', '2c'] })).toThrow(/déjà utilisée/);
  });
  it('ante classique et 3 niveaux de tapis', () => {
    const c = cfg([300, 1000, 2000, 5000], { button: 4, ante: 50, anteMode: 'all' });
    let s = run(c, [
      { type: 'allin', seat: 3 },
      { type: 'call', seat: 4 },
      { type: 'allin', seat: 1 },
      { type: 'allin', seat: 2 },
    ]);
    expect(s.phase).toBe('showdown');
    const { pots, returned } = computePots(s);
    expect(pots.map((p) => p.amount)).toEqual([1200, 2100, 2000]);
    expect(pots.map((p) => p.eligible)).toEqual([[1, 2, 3, 4], [2, 3, 4], [3, 4]]);
    expect(returned).toEqual([]);
    s = applyAction(s, { type: 'board', cards: ['2c', '7d', '9h', '4s', '3s'] });
    s = applyAction(s, { type: 'show', seat: 1, cards: ['Ah', 'Ad'] });
    s = applyAction(s, { type: 'show', seat: 2, cards: ['Kh', 'Kd'] });
    s = applyAction(s, { type: 'show', seat: 3, cards: ['Qh', 'Qd'] });
    s = applyAction(s, { type: 'show', seat: 4, cards: ['Jh', 'Jd'] });
    s = applyAction(s, { type: 'resolve' });
    expect(s.result!.finalStacks).toEqual({ 1: 1200, 2: 2100, 3: 2000, 4: 3000 });
  });
  it('bouton suivant', () => {
    expect(nextButton(3, [1, 3, 5, 8])).toBe(5);
    expect(nextButton(8, [1, 3, 5, 8])).toBe(1);
    expect(nextButton(4, [1, 3, 5])).toBe(5);
  });
});
