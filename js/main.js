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
ui = new MakaoUI(game, multiplayer);
multiplayer.attachUI(ui);
installUxEffects(game, ui);
ui.render(game.state);

window.makaoGame = game;
window.makaoMultiplayer = multiplayer;
