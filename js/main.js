import { MakaoGame } from './game.js';
import { MakaoMultiplayer } from './multiplayer.js';
import { MakaoUI } from './ui.js';
import { installUxEffects } from './ux-effects.js';

const theme = document.createElement('link');
theme.rel = 'stylesheet';
theme.href = './css/cardroom-refresh.css?v=20260911-1';
document.head.appendChild(theme);

let ui;
let multiplayer;
const game = new MakaoGame({
  onChange: (state) => ui?.render(state),
  onMessage: (message) => ui?.showToast(message),
});

multiplayer = new MakaoMultiplayer(game);

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
  return applyRemoteState(normalized, localSeat);
};

ui = new MakaoUI(game, multiplayer);
multiplayer.attachUI(ui);
installUxEffects(game, ui);
ui.render(game.state);

window.makaoGame = game;
window.makaoMultiplayer = multiplayer;
