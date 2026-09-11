import test from 'node:test';
import assert from 'node:assert/strict';

import { MakaoGame } from '../js/game.js';
import { MakaoMultiplayer, lobbyReady, normalizeRoomCode, validateNickname } from '../js/multiplayer.js';

test('room codes are normalized to QQND room format', () => {
  assert.equal(normalizeRoomCode('abcd-efgh'), 'ABCD-EFGH');
  assert.equal(normalizeRoomCode('ABCDEFGH'), 'ABCD-EFGH');
  assert.equal(normalizeRoomCode('short'), '');
});

test('nickname validation rejects unsafe/invalid names and accepts normal player names', () => {
  assert.equal(validateNickname('Grzegorz').ok, true);
  assert.equal(validateNickname('Anna Maria').ok, true);
  assert.equal(validateNickname('ab').ok, false);
  assert.equal(validateNickname('https://spam.example').ok, false);
  assert.equal(validateNickname('<script>').ok, false);
});

test('3/4-seat lobby becomes ready only when humans plus selected server bots fill the table', () => {
  assert.equal(lobbyReady({ humanCount: 2, botCount: 1, tableSize: 3 }), true);
  assert.equal(lobbyReady({ humanCount: 2, botCount: 2, tableSize: 4 }), true);
  assert.equal(lobbyReady({ humanCount: 2, botCount: 1, tableSize: 4 }), false);
  assert.equal(lobbyReady({ humanCount: 2, botCount: 0, tableSize: 2 }), false, 'official online 2-player mode stays disabled');
});

test('online actions are sent as game.action and never executed against the local canonical engine', () => {
  const game = new MakaoGame();
  let localExecutions = 0;
  game.executePlayerAction = () => { localExecutions += 1; return { ok: true }; };
  const multiplayer = new MakaoMultiplayer(game);
  multiplayer.session.active = true;
  multiplayer.session.inGame = true;
  multiplayer.session.room = 'ABCD-EFGH';
  const frames = [];
  multiplayer.socketSend = (frame) => frames.push(frame);

  const result = multiplayer.handleGameAction('draw', {});
  assert.equal(result.ok, true);
  assert.equal(localExecutions, 0);
  assert.deepEqual(frames, [{ type: 'game.action', roomId: 'ABCD-EFGH', action: 'draw', payload: {} }]);
  assert.equal(multiplayer.handleGameAction('overwrite-state', {}).ok, false);
});

test('server snapshots are applied read-only to the existing UI game model', () => {
  const game = new MakaoGame();
  const multiplayer = new MakaoMultiplayer(game);
  const snapshot = {
    started: true,
    gameOver: false,
    multiplayer: true,
    networkPaused: false,
    players: [
      { id: 'seat-0', name: 'Alice', isBot: false, hand: [{ id: '7-hearts', rank: '7', suit: 'hearts' }], finishPlace: null, blockedTurns: 0 },
      { id: 'seat-1', name: 'Bob', isBot: false, hand: [{ id: 'hidden-1-0', hidden: true }], finishPlace: null, blockedTurns: 0 },
      { id: 'seat-2', name: 'Bot', isBot: true, hand: [{ id: 'hidden-2-0', hidden: true }], finishPlace: null, blockedTurns: 0 },
    ],
    dealerIndex: 2,
    currentIndex: 0,
    drawPile: [{ id: 'hidden--1-0', hidden: true }],
    discardPile: [{ id: '8-hearts', rank: '8', suit: 'hearts' }],
    pendingDraw: null,
    pendingSkip: null,
    jackDemand: null,
    aceDemand: null,
    pendingChoice: null,
    drawnRescueCardId: null,
    makaoArmed: false,
    standings: [],
    log: [],
    turnNumber: 1,
  };

  game.applyRemoteState(snapshot, 0);
  assert.equal(game.readOnlyView, true);
  assert.equal(game.localSeat, 0);
  assert.equal(game.state.players[0].isLocal, true);
  assert.equal(game.state.players[2].isBot, true);
  assert.equal(game.executePlayerAction(0, 'draw').ok, false, 'browser copy cannot mutate authoritative state');
});
