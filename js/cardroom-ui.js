import { cardLabel, isCardLegal } from './rules.js';

export function installCardroomUi(ui, game, multiplayer) {
  installDurenStyleMenu(ui, game);
  installStableCardRendering(ui, game);
  installMultiplayerReturnToMenu(ui, multiplayer);
}

function installDurenStyleMenu(ui, game) {
  const menu = ui.el.mainMenu;
  const card = menu?.querySelector('.menu-card');
  const startButton = ui.el.startBtn;
  const botSelector = ui.el.botSelector;
  if (!menu || !card || !startButton || !botSelector) return;

  const eyebrow = card.querySelector('.eyebrow');
  const lead = card.querySelector('.menu-lead');
  if (eyebrow) eyebrow.textContent = 'OFFLINE · ONLINE · KARTY · MAKAO';
  if (lead) lead.textContent = 'Klasyczne Makao · gra offline i wspólny stół online.';

  const oldSection = botSelector.closest('.menu-section');
  oldSection?.remove();

  const replacementStart = startButton.cloneNode(true);
  startButton.replaceWith(replacementStart);
  ui.el.startBtn = replacementStart;
  replacementStart.querySelector('span:first-child')?.replaceChildren(document.createTextNode('＋'));
  const startCopy = replacementStart.querySelector('strong');
  if (startCopy) startCopy.textContent = 'Nowa gra offline';
  const startArrow = replacementStart.querySelector('span:last-child');
  if (startArrow) startArrow.textContent = '›';

  const multiplayerButton = document.getElementById('multiplayer-btn');
  const multiplayerCopy = multiplayerButton?.querySelector('strong');
  if (multiplayerCopy) multiplayerCopy.textContent = 'Gra online';
  const multiplayerIcon = multiplayerButton?.querySelector('span:first-child');
  if (multiplayerIcon) multiplayerIcon.textContent = '◉';
  const multiplayerArrow = multiplayerButton?.querySelector('span:last-child');
  if (multiplayerArrow) multiplayerArrow.textContent = '›';

  const resume = ui.el.resumeBtn;
  if (resume) {
    const resumeIcon = resume.querySelector('span:first-child');
    if (resumeIcon) resumeIcon.textContent = '▶';
    const resumeCopy = resume.querySelector('strong');
    if (resumeCopy) resumeCopy.textContent = 'Kontynuuj grę';
    const resumeArrow = resume.querySelector('span:last-child');
    if (resumeArrow) resumeArrow.textContent = '›';
    replacementStart.before(resume);
  }

  const rulesButton = ui.el.menuRulesBtn;
  if (rulesButton) {
    const rulesCopy = rulesButton.querySelector('strong');
    if (rulesCopy) rulesCopy.textContent = 'Jak grać / zasady';
    const rulesArrow = rulesButton.querySelector('span:last-child');
    if (rulesArrow) rulesArrow.textContent = '›';
  }

  let modal = document.getElementById('offline-setup-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'offline-setup-modal';
    modal.className = 'overlay modal-overlay offline-setup-overlay';
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-labelledby', 'offline-setup-title');
    modal.innerHTML = `
      <section class="modal-card offline-setup-card">
        <div class="offline-setup-head">
          <div>
            <span class="eyebrow">NOWA SESJA</span>
            <h2 id="offline-setup-title">Ustaw nową grę</h2>
          </div>
          <button id="offline-setup-close" class="modal-close inline-close" type="button" aria-label="Zamknij">×</button>
        </div>
        <p class="offline-setup-lead">Wybierz liczbę przeciwników komputerowych. Pozostałe zasady Makao zostają bez zmian.</p>
        <section class="offline-setup-section">
          <div>
            <b>Liczba botów</b>
            <small>Wybierz dwóch albo trzech przeciwników.</small>
          </div>
          <div id="offline-bot-selector-slot"></div>
        </section>
        <footer class="offline-setup-actions">
          <button id="offline-setup-cancel" class="btn ghost" type="button">Anuluj</button>
          <button id="offline-start-btn" class="btn primary" type="button">Rozpocznij grę</button>
        </footer>
      </section>`;
    document.body.appendChild(modal);
  }

  modal.querySelector('#offline-bot-selector-slot')?.appendChild(botSelector);

  const openSetup = () => modal.classList.add('open');
  const closeSetup = () => modal.classList.remove('open');

  replacementStart.addEventListener('click', () => openSetup());
  modal.querySelector('#offline-setup-close')?.addEventListener('click', closeSetup);
  modal.querySelector('#offline-setup-cancel')?.addEventListener('click', closeSetup);
  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeSetup();
  });
  modal.querySelector('#offline-start-btn')?.addEventListener('click', () => {
    ui.selected.clear();
    closeSetup();
    ui.closeMenu();
    game.start(ui.botCount);
  });
}

function installMultiplayerReturnToMenu(ui, multiplayer) {
  const modal = document.getElementById('multiplayer-modal');
  const close = document.getElementById('mp-close');
  if (!modal || !close) return;

  close.addEventListener('click', () => ui.openMenu());
  modal.addEventListener('click', (event) => {
    if (event.target === modal) ui.openMenu();
  });

  const originalLeaveRoom = multiplayer.leaveRoom?.bind(multiplayer);
  if (originalLeaveRoom) {
    multiplayer.leaveRoom = async (...args) => {
      const result = await originalLeaveRoom(...args);
      ui.openMenu();
      return result;
    };
  }
}

function installStableCardRendering(ui, game) {
  ui._pendingDiscardCard = null;

  ui.beginDiscardFlight = (card) => {
    if (!card?.id) return;
    ui._pendingDiscardCard = card;
  };

  ui.finishDiscardFlight = (card) => {
    if (!card?.id || ui._pendingDiscardCard?.id !== card.id) return;
    ui._pendingDiscardCard = null;
    syncDiscardCard(ui, card, { settled: true });
  };

  ui.renderCenter = (state) => {
    ui.el.drawCount.textContent = String(state.drawPile.length || 0);
    if (!state.started) {
      if (ui.el.discard.firstElementChild) ui.el.discard.replaceChildren();
      ui._pendingDiscardCard = null;
      ui.el.phaseRibbon.textContent = 'Wybierz tryb gry i rozpocznij partię';
      ui.el.centerState.innerHTML = '<span class="eyebrow">AKTUALNIE</span><strong>—</strong><small>Rozpocznij partię</small>';
      return;
    }

    const top = state.discardPile.at(-1);
    if (!ui._pendingDiscardCard || ui._pendingDiscardCard.id !== top?.id) {
      syncDiscardCard(ui, top);
    }

    ui.el.phaseRibbon.textContent = state.networkPaused ? 'Rozgrywka wstrzymana — utracono połączenie' : ui.phaseText(state);
    const current = state.players[state.currentIndex];
    const detail = state.networkPaused ? 'Oczekiwanie na decyzję o opuszczeniu stołu.' : ui.constraintDetail(state);
    ui.el.centerState.innerHTML = `<span class="eyebrow">AKTUALNA TURA</span><strong>${current?.name ?? '—'}</strong><small>${detail}</small>`;
  };

  ui.renderHuman = (state) => {
    const localIndex = ui.localIndex(state);
    const local = state.players?.[localIndex];
    if (!local) {
      if (ui.el.hand.firstElementChild) ui.el.hand.replaceChildren();
      ui.el.humanCount.textContent = '0 KART';
      return;
    }

    ui.el.humanSeat.classList.toggle('active', state.currentIndex === localIndex && !state.gameOver && !local.finishPlace && !state.networkPaused);
    ui.el.humanSeat.classList.toggle('finished', Boolean(local.finishPlace));
    ui.el.humanRole.textContent = local.finishPlace ? `${local.finishPlace}. MIEJSCE` : state.currentIndex === localIndex ? 'TWOJA TURA' : 'GRACZ';
    ui.el.humanCount.textContent = `${local.hand.length} ${ui.cardWord(local.hand.length)}`;
    if (ui.el.humanName) ui.el.humanName.textContent = local.name || 'Ty';
    if (ui.el.humanAvatar) ui.el.humanAvatar.textContent = local.avatar || 'TY';

    const existing = new Map([...ui.el.hand.querySelectorAll('[data-card-id]')].map((element) => [element.dataset.cardId, element]));
    const visibleCards = local.hand.filter((card) => !card.hidden);
    const isLocalTurn = game.humanCanAct();
    const drawnId = state.drawnRescueCardId;
    const selectedCards = [...ui.selected]
      .map((id) => local.hand.find((held) => held.id === id))
      .filter(Boolean);
    const center = (visibleCards.length - 1) / 2;

    visibleCards.forEach((card, index) => {
      let cardEl = existing.get(card.id);
      if (!cardEl) {
        cardEl = ui.makeCard(card, { hand: true });
        cardEl.dataset.cardId = card.id;
      }
      existing.delete(card.id);

      const legal = isLocalTurn && isCardLegal(card, state, localIndex);
      const isRescueAllowed = !drawnId || card.id === drawnId;
      const delta = index - center;
      cardEl.style.setProperty('--angle', `${delta * 2.35}deg`);
      cardEl.style.setProperty('--hover-angle', `${delta * 1.7}deg`);
      cardEl.style.setProperty('--selected-angle', `${delta * 1.2}deg`);
      cardEl.style.setProperty('--drop', `${Math.abs(delta) * 1.25}px`);

      const companion = selectedCards.length > 0 && selectedCards[0].rank === card.rank && selectedCards.length < 4;
      const canSelect = isRescueAllowed && (legal || companion || ui.selected.has(card.id));
      cardEl.classList.toggle('selected', ui.selected.has(card.id));
      cardEl.classList.toggle('playable', canSelect);
      cardEl.classList.toggle('disabled-card', !canSelect);
      cardEl.classList.toggle('rescue-card', drawnId === card.id);
      cardEl.setAttribute('aria-label', cardLabel(card));
      ui.el.hand.appendChild(cardEl);
    });

    for (const stale of existing.values()) stale.remove();
  };
}

function syncDiscardCard(ui, card, { settled = false } = {}) {
  const current = ui.el.discard.querySelector('.table-card');
  if (!card) {
    if (current) current.remove();
    return;
  }
  if (current?.dataset.cardId === card.id) return;

  const next = ui.makeCard(card, { table: true });
  next.dataset.cardId = card.id;
  if (settled) next.classList.add('ux-settled-card');
  ui.el.discard.replaceChildren(next);
}
