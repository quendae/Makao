import { MakaoGame } from './game.js';
import { MakaoMultiplayer } from './multiplayer.js';
import { MakaoUI } from './ui.js';
import { installUxEffects } from './ux-effects.js';
import { installCardroomUi } from './cardroom-ui.js';

const OFFLINE_SESSION_KEY = 'makao.offline-session.v1';
const LAST_SESSION_KEY = 'makao.last-session.v1';

const theme = document.createElement('link');
theme.rel = 'stylesheet';
theme.href = './css/cardroom-refresh.css?v=20260911-2';
document.head.appendChild(theme);

function readStored(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null');
  } catch {
    return null;
  }
}

function writeStored(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

function removeStored(key) {
  try { localStorage.removeItem(key); } catch {}
}

function validOfflineSnapshot(snapshot) {
  const state = snapshot?.state;
  return Boolean(
    state &&
    state.started === true &&
    state.multiplayer !== true &&
    state.gameOver !== true &&
    Array.isArray(state.players) &&
    state.players.length >= 3 &&
    Array.isArray(state.drawPile) &&
    Array.isArray(state.discardPile),
  );
}

function loadOfflineSnapshot() {
  const snapshot = readStored(OFFLINE_SESSION_KEY);
  return validOfflineSnapshot(snapshot) ? snapshot : null;
}

function persistOfflineState(state) {
  if (!state || state.multiplayer === true) return;

  if (state.started && !state.gameOver) {
    const savedAt = Date.now();
    writeStored(OFFLINE_SESSION_KEY, { savedAt, state });
    writeStored(LAST_SESSION_KEY, { type: 'offline', savedAt });
    return;
  }

  if (state.gameOver) {
    removeStored(OFFLINE_SESSION_KEY);
    if (readStored(LAST_SESSION_KEY)?.type === 'offline') removeStored(LAST_SESSION_KEY);
  }
}

function markOnlineState(state, roomId) {
  if (!state || !roomId) return;
  if (state.started && !state.gameOver) {
    writeStored(LAST_SESSION_KEY, { type: 'online', roomId, savedAt: Date.now() });
    return;
  }
  if (state.gameOver) {
    const marker = readStored(LAST_SESSION_KEY);
    if (marker?.type === 'online' && (!marker.roomId || marker.roomId === roomId)) removeStored(LAST_SESSION_KEY);
  }
}

let ui;
let multiplayer;
let refreshContinueButton = () => {};

const game = new MakaoGame({
  onChange: (state) => {
    persistOfflineState(state);
    ui?.render(state);
    refreshContinueButton();
  },
  onMessage: (message) => ui?.showToast(message),
});

multiplayer = new MakaoMultiplayer(game);

// A cold page load should offer an explicit Continue action instead of
// silently dropping the player back into an online game. Reconnects after the
// app is already running keep the multiplayer class' normal resume behavior.
const resumeStoredOnlineSession = multiplayer.resumeStoredSession.bind(multiplayer);
let suppressInitialOnlineResume = true;
multiplayer.resumeStoredSession = (...args) => {
  if (suppressInitialOnlineResume) {
    suppressInitialOnlineResume = false;
    return Promise.resolve(null);
  }
  return resumeStoredOnlineSession(...args);
};

// Runtime bot ownership is fresher than a seat projection during the exact
// reconnect/takeover boundary. Apply it before the existing UI model sees the
// snapshot so a reclaimed human seat is interactive immediately.
const applyRemoteState = game.applyRemoteState.bind(game);
game.applyRemoteState = (view, localSeat) => {
  const botSeats = multiplayer?.session?.botSeats;
  const normalized = view && Array.isArray(view.players) && botSeats instanceof Set
    ? {
        ...view,
        botCount: botSeats.size,
        botSeats: [...botSeats],
        players: view.players.map((player, index) => ({
          ...player,
          isBot: botSeats.has(index),
          isHuman: !botSeats.has(index),
          isLocal: index === localSeat,
        })),
      }
    : view;
  const result = applyRemoteState(normalized, localSeat);
  markOnlineState(normalized, multiplayer?.session?.room);
  refreshContinueButton();
  return result;
};

function restoreOfflineGame(snapshot) {
  if (!validOfflineSnapshot(snapshot)) return false;
  clearTimeout(game.timer);
  game.timer = null;
  game.readOnlyView = false;

  const restored = JSON.parse(JSON.stringify(snapshot.state));
  restored.multiplayer = false;
  restored.networkPaused = false;
  const localSeat = Math.max(0, restored.players.findIndex((player) => player?.isLocal && !player?.isBot));
  game.localSeat = localSeat;
  restored.players.forEach((player, index) => {
    player.isBot = Boolean(player.isBot);
    player.isHuman = !player.isBot;
    player.isLocal = index === localSeat;
  });
  restored.botCount = restored.players.filter((player) => player.isBot).length;
  game.state = restored;
  game.emit();
  game.queueCurrentTurn();
  return true;
}

function continueChoice() {
  if (game.state?.started && !game.state.gameOver) {
    return game.state.multiplayer
      ? { type: 'online', current: true, roomId: multiplayer?.session?.room || '' }
      : { type: 'offline', current: true, botCount: game.state.botCount || 0 };
  }

  const marker = readStored(LAST_SESSION_KEY);
  if (marker?.type === 'online') return { type: 'online', current: false, roomId: marker.roomId || '' };

  const offline = loadOfflineSnapshot();
  if (offline) return { type: 'offline', current: false, botCount: offline.state.botCount || offline.state.players.filter((player) => player.isBot).length };
  return null;
}

function continueLabel(choice) {
  if (!choice) return 'Kontynuuj grę';
  if (choice.type === 'online') return 'Kontynuuj · online';
  const bots = Number(choice.botCount) || 2;
  return `Kontynuuj · ${bots} ${bots === 2 ? 'boty' : 'botów'}`;
}

ui = new MakaoUI(game, multiplayer);
multiplayer.attachUI(ui);
suppressInitialOnlineResume = false;
installCardroomUi(ui, game, multiplayer);
installUxEffects(game, ui);

refreshContinueButton = () => {
  const button = ui?.el?.resumeBtn;
  if (!button) return;
  const choice = continueChoice();
  button.classList.toggle('hidden', !choice);
  const copy = button.querySelector('strong');
  if (copy) copy.textContent = continueLabel(choice);
  button.dataset.continueType = choice?.type || '';
};

const openMenu = ui.openMenu.bind(ui);
ui.openMenu = (...args) => {
  const result = openMenu(...args);
  refreshContinueButton();
  return result;
};

ui.el.resumeBtn?.addEventListener('click', async () => {
  const choice = continueChoice();
  if (!choice || choice.current) return;

  ui.selected.clear();
  if (choice.type === 'offline') {
    const snapshot = loadOfflineSnapshot();
    if (!snapshot || !restoreOfflineGame(snapshot)) {
      removeStored(OFFLINE_SESSION_KEY);
      if (readStored(LAST_SESSION_KEY)?.type === 'offline') removeStored(LAST_SESSION_KEY);
      ui.openMenu();
      ui.showToast('Nie udało się odtworzyć zapisanej gry offline.');
    }
    refreshContinueButton();
    return;
  }

  const button = ui.el.resumeBtn;
  const copy = button?.querySelector('strong');
  if (button) button.disabled = true;
  if (copy) copy.textContent = 'Łączenie z grą online…';
  try {
    if (multiplayer.authSession && multiplayer.session?.inGame && multiplayer.session?.room) {
      await multiplayer.ensureSocket();
      multiplayer.socketSend({ type: 'game.state.get', roomId: multiplayer.session.room });
    } else {
      const resumed = await resumeStoredOnlineSession(true);
      if (!resumed || !multiplayer.session?.inGame || !multiplayer.session?.room) throw new Error('no_active_online_game');
    }
    ui.closeMenu();
  } catch {
    const marker = readStored(LAST_SESSION_KEY);
    if (marker?.type === 'online') removeStored(LAST_SESSION_KEY);
    ui.openMenu();
    ui.showToast('Nie udało się wznowić ostatniej gry online.');
  } finally {
    if (button) button.disabled = false;
    refreshContinueButton();
  }
});

// Leaving an online table is intentional, so it must not remain as a Continue
// target on the next visit.
const leaveRoom = multiplayer.leaveRoom.bind(multiplayer);
multiplayer.leaveRoom = async (...args) => {
  const roomId = multiplayer.session?.room || '';
  const result = await leaveRoom(...args);
  const marker = readStored(LAST_SESSION_KEY);
  if (marker?.type === 'online' && (!marker.roomId || marker.roomId === roomId)) removeStored(LAST_SESSION_KEY);
  refreshContinueButton();
  return result;
};

ui.render(game.state);
refreshContinueButton();

window.makaoGame = game;
window.makaoMultiplayer = multiplayer;
