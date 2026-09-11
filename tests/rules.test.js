import test from 'node:test';
import assert from 'node:assert/strict';
import { MakaoGame } from '../js/game.js';
import { chooseJackDemand } from '../js/bot.js';
import { createDeck, getTurnConstraint, isCardLegal, isFunctional, validateGroup } from '../js/rules.js';

const card = (rank, suit) => ({ id: `${rank}-${suit}-${Math.random()}`, rank, suit });

function state(overrides = {}) {
  return {
    discardPile: [card('7', 'clubs')],
    pendingDraw: null,
    pendingSkip: null,
    jackDemand: null,
    aceDemand: null,
    drawnRescueCardId: null,
    ...overrides,
  };
}

test('talia ma dokładnie 52 karty i nie zawiera jokerów', () => {
  const deck = createDeck();
  assert.equal(deck.length, 52);
  assert.equal(new Set(deck.map((item) => item.id)).size, 52);
  assert.equal(deck.some((item) => item.rank === 'JOKER'), false);
});

test('króle kier i pik są funkcyjne, trefl i karo są zwykłe', () => {
  assert.equal(isFunctional(card('K', 'hearts')), true);
  assert.equal(isFunctional(card('K', 'spades')), true);
  assert.equal(isFunctional(card('K', 'clubs')), false);
  assert.equal(isFunctional(card('K', 'diamonds')), false);
});

test('dama jest dzika w zwykłej grze', () => {
  const s = state();
  assert.equal(isCardLegal(card('Q', 'hearts'), s, 0), true);
  assert.equal(isCardLegal(card('Q', 'diamonds'), s, 0), true);
});

test('dama nie omija aktywnej kary ani żądania', () => {
  assert.equal(isCardLegal(card('Q', 'hearts'), state({ pendingDraw: { amount: 2, targetIndex: 0 } }), 0), false);
  assert.equal(isCardLegal(card('Q', 'hearts'), state({ pendingSkip: { count: 1, targetIndex: 0 } }), 0), false);
  assert.equal(isCardLegal(card('Q', 'hearts'), state({ jackDemand: { rank: '8', byIndex: 1 } }), 0), false);
  assert.equal(isCardLegal(card('Q', 'hearts'), state({ aceDemand: { suit: 'diamonds', targetIndex: 0, byIndex: 1 } }), 0), false);
});

test('przy karze z 2/3 wolno odpowiedzieć tylko 2/3 pasującą kolorem lub wartością', () => {
  const s = state({
    discardPile: [card('2', 'diamonds')],
    pendingDraw: { amount: 2, targetIndex: 0 },
  });
  assert.equal(isCardLegal(card('2', 'clubs'), s, 0), true);
  assert.equal(isCardLegal(card('3', 'diamonds'), s, 0), true);
  assert.equal(isCardLegal(card('3', 'clubs'), s, 0), false);
  assert.equal(isCardLegal(card('Q', 'diamonds'), s, 0), false);
});

test('wariant wielokartowy dopuszcza 1, 3 lub 4, ale nie parę', () => {
  const s = state({ discardPile: [card('7', 'clubs')] });
  assert.equal(validateGroup([card('7', 'hearts')], s, 0).ok, true);
  assert.equal(validateGroup([card('7', 'hearts'), card('7', 'spades')], s, 0).ok, false);
  assert.equal(validateGroup([card('7', 'hearts'), card('7', 'spades'), card('7', 'diamonds')], s, 0).ok, true);
  assert.equal(validateGroup([card('7', 'hearts'), card('7', 'spades'), card('7', 'diamonds'), card('7', 'clubs')], s, 0).ok, true);
});

test('grupa może rozpocząć się kartą pasującą, a kolejne są tej samej wartości', () => {
  const s = state({ discardPile: [card('9', 'clubs')] });
  const result = validateGroup([card('7', 'hearts'), card('7', 'clubs'), card('7', 'diamonds')], s, 0);
  assert.equal(result.ok, true);
});

test('kilka dwójek i trójek sumuje karę według łącznej liczby oczek', () => {
  const game = new MakaoGame();
  game.state.started = true;
  game.state.players = game.createPlayers(2);
  game.state.discardPile = [card('9', 'clubs')];
  game.applyCardEffects(0, [card('2', 'clubs'), card('2', 'hearts'), card('2', 'diamonds')], { type: 'normal' });
  assert.equal(game.state.pendingDraw.amount, 6);

  game.state.pendingDraw = { amount: 6, targetIndex: 0 };
  game.applyCardEffects(0, [card('3', 'clubs'), card('3', 'hearts'), card('3', 'diamonds')], { type: 'draw' });
  assert.equal(game.state.pendingDraw.amount, 15);
});

test('król kier daje tylko +5 kart bez utraty tury', () => {
  const game = new MakaoGame();
  game.state.started = true;
  game.state.players = game.createPlayers(2);
  game.state.players[1].hand = [card('5', 'clubs')];
  game.state.drawPile = [card('6', 'diamonds'), card('7', 'spades'), card('8', 'hearts'), card('9', 'clubs'), card('10', 'diamonds')];
  game.state.discardPile = [card('7', 'clubs')];

  game.applyCardEffects(0, [card('K', 'hearts')], { type: 'normal' });
  assert.equal(game.state.players[1].hand.length, 6);
  assert.equal(game.state.players[1].blockedTurns, 0);
});


test('walet może żądać tylko wartości 5–10 posiadanej w ręce, a bot może wybrać brak żądania', () => {
  assert.equal(chooseJackDemand([card('A', 'hearts'), card('K', 'clubs')]), null);
  assert.equal(chooseJackDemand([card('7', 'hearts'), card('7', 'clubs'), card('9', 'spades')]), '7');

  const game = new MakaoGame();
  game.state.started = true;
  game.state.gameOver = true;
  game.state.players = game.createPlayers(2);
  game.state.players[0].hand = [card('7', 'hearts'), card('A', 'clubs')];
  game.state.pendingChoice = { type: 'jack', actorIndex: 0 };

  const rejected = game.choosePending('8');
  assert.equal(rejected.ok, false);
  assert.equal(game.state.pendingChoice?.type, 'jack');
  assert.equal(game.state.jackDemand, null);
  assert.match(rejected.reason, /którą masz w ręce/);

  game.choosePending('7');
  assert.equal(game.state.jackDemand.rank, '7');
  assert.equal(game.state.pendingChoice, null);

  game.state.pendingChoice = { type: 'jack', actorIndex: 0 };
  game.choosePending(null);
  assert.equal(game.state.jackDemand, null);
  assert.equal(game.state.pendingChoice, null);
});

test('zaległa blokada nie omija aktywnej kary dobierania 2/3', () => {
  const game = new MakaoGame();
  game.state.started = true;
  game.state.players = game.createPlayers(2);
  game.state.currentIndex = 0;
  game.state.players[0].blockedTurns = 1;
  game.state.pendingDraw = { amount: 2, targetIndex: 0 };
  game.state.discardPile = [card('2', 'clubs')];

  const constraint = getTurnConstraint(game.state, 0);
  assert.equal(constraint.type, 'draw');
});

test('bot przy żądaniu waleta preferuje żądaną wartość zamiast kolejnego waleta', () => {
  const game = new MakaoGame();
  game.state.started = true;
  game.state.players = game.createPlayers(2);
  game.state.currentIndex = 1;
  game.state.players[1].hand = [card('J', 'clubs'), card('7', 'hearts')];
  game.state.discardPile = [card('J', 'spades')];
  game.state.jackDemand = { rank: '7', byIndex: 0 };

  const constraint = getTurnConstraint(game.state, 1);
  assert.equal(constraint.type, 'jack');
  assert.equal(isCardLegal(game.state.players[1].hand[0], game.state, 1), true);
  assert.equal(isCardLegal(game.state.players[1].hand[1], game.state, 1), true);
});

test('bot odpowiadający waletem na waleta wybiera potem brak żądania', () => {
  const game = new MakaoGame();
  game.state.started = true;
  game.state.players = game.createPlayers(2);
  game.state.players[1].hand = [card('J', 'clubs')];
  game.state.discardPile = [card('J', 'spades')];
  game.state.jackDemand = { rank: '7', byIndex: 0 };

  game.applyCardEffects(1, [card('J', 'clubs')], { type: 'jack', rank: '7' });
  assert.equal(game.state.jackDemand, null);
});

test('nowa gra ma 1 gracza + 2/3 boty, po 5 kart i zwykłą kartę startową', () => {
  const game = new MakaoGame();
  game.start(2);
  clearTimeout(game.timer);
  assert.equal(game.state.players.length, 3);
  assert.equal(game.state.players.every((player) => player.hand.length === 5), true);
  assert.equal(isFunctional(game.state.discardPile.at(-1)), false);

  game.start(3);
  clearTimeout(game.timer);
  assert.equal(game.state.players.length, 4);
  assert.equal(game.state.players.every((player) => player.hand.length === 5), true);
  assert.equal(isFunctional(game.state.discardPile.at(-1)), false);
});
