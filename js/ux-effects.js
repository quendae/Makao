// Visual-only UX layer: card flight animations and hand compression.
// It deliberately does not contain Makao rules or networking authority.

export function installUxEffects(game, ui) {
  let previous = snapshot(game.state);
  let localPlaySources = [];

  const playButton = document.getElementById('play-btn');
  const hand = document.getElementById('human-hand');
  const drawPile = document.getElementById('draw-pile');
  const discard = document.getElementById('discard-pile');
  const opponents = document.getElementById('opponents');
  const motionToggle = document.getElementById('motion-toggle');

  playButton?.addEventListener('click', () => {
    localPlaySources = [...hand.querySelectorAll('.hand-card.selected')]
      .map((element) => elementGeometry(element))
      .filter(Boolean)
      .sort((a, b) => a.rect.left - b.rect.left);
  }, true);

  // Preserve the bootstrap callback. State is rendered immediately, but a new
  // discard card can be held back while its flight is still visible. This
  // prevents the landed card and the transient flight card from flashing at
  // the same time.
  const baseOnChange = game.onChange;
  game.onChange = (state) => {
    const before = previous;
    const next = snapshot(state);
    const discardDelta = next.discardCount - before.discardCount;
    const canAnimate = before?.started && state.started && motionEnabled(motionToggle);
    const opponentSources = captureOpponentSources(opponents, state, game.localSeat);
    const drawSource = elementGeometry(drawPile);

    if (canAnimate && discardDelta > 0) {
      ui.beginDiscardFlight?.(state.discardPile.at(-1));
    }

    baseOnChange(state);
    enhanceChoicePanel(state);

    requestAnimationFrame(() => {
      compressHumanHand(hand);
      animateStateChange({
        before,
        state,
        game,
        ui,
        hand,
        drawPile,
        discard,
        opponents,
        motionToggle,
        localPlaySources,
        opponentSources,
        drawSource,
      });
      localPlaySources = [];
    });
    previous = next;
  };

  window.addEventListener('resize', () => requestAnimationFrame(() => compressHumanHand(hand)));
  requestAnimationFrame(() => {
    compressHumanHand(hand);
    enhanceChoicePanel(game.state);
  });
}

function snapshot(state) {
  return {
    started: Boolean(state.started),
    currentIndex: state.currentIndex,
    discardCount: state.discardPile?.length ?? 0,
    playerHands: (state.players ?? []).map((player) => player.hand.map((card) => card.id ?? null)),
  };
}

function motionEnabled(toggle) {
  return Boolean(toggle?.checked) && !document.body.classList.contains('reduce-motion');
}

function compressHumanHand(hand) {
  if (!hand) return;
  const cards = [...hand.querySelectorAll('.hand-card')];
  hand.classList.remove('hand-scroll-mode');
  if (cards.length < 2) return;

  const available = Math.max(260, hand.clientWidth - 24);
  const sampleWidth = cards[0].getBoundingClientRect().width || 106;
  const idealStep = (available - sampleWidth) / Math.max(1, cards.length - 1);
  const minCentreSafeStep = Math.max(62, sampleWidth * 0.64);
  const useScrollRack = window.innerWidth <= 560 || idealStep < minCentreSafeStep;

  if (useScrollRack) {
    hand.classList.add('hand-scroll-mode');
    cards.forEach((card) => {
      card.style.marginLeft = '0px';
      card.style.setProperty('--angle', '0deg');
      card.style.setProperty('--hover-angle', '0deg');
      card.style.setProperty('--selected-angle', '0deg');
      card.style.setProperty('--drop', '0px');
    });
    return;
  }

  const step = Math.min(sampleWidth * .78, idealStep);
  const margin = Math.round(step - sampleWidth);
  cards.forEach((card, index) => {
    card.style.marginLeft = index === 0 ? '0px' : `${margin}px`;
  });
}

function enhanceChoicePanel(state) {
  const modal = document.getElementById('choice-modal');
  const options = document.getElementById('choice-options');
  const description = document.getElementById('choice-description');
  const choice = state.pendingChoice;
  if (!modal || !options || !choice) return;

  modal.classList.add('choice-peek-overlay');
  const actor = state.players[choice.actorIndex];
  if (!actor) return;

  if (choice.type === 'jack') {
    const allowed = new Map();
    for (const card of actor.hand) {
      if (['5', '6', '7', '8', '9', '10'].includes(card.rank)) {
        allowed.set(card.rank, (allowed.get(card.rank) ?? 0) + 1);
      }
    }

    options.querySelectorAll('.rank-choice').forEach((button) => {
      const rank = button.textContent.trim();
      if (rank === 'Nic') {
        button.innerHTML = '<b>Nic</b><small>bez żądania</small>';
        return;
      }
      const count = allowed.get(rank) ?? 0;
      if (count) button.innerHTML = `<b>${rank}</b><small>${count} ${count === 1 ? 'karta' : 'karty'} w ręce</small>`;
    });

    if (description) {
      description.textContent = allowed.size
        ? 'Możesz zażądać tylko wartości 5–10, którą nadal masz w ręce, albo nie żądać niczego.'
        : 'Nie masz w ręce żadnej wartości 5–10. Wybierz „Nic”.';
    }
  } else if (choice.type === 'ace') {
    const suitMap = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' };
    const counts = Object.fromEntries(Object.keys(suitMap).map((suit) => [suit, actor.hand.filter((card) => card.suit === suit).length]));
    options.querySelectorAll('.suit-choice').forEach((button) => {
      const suit = Object.keys(suitMap).find((key) => button.classList.contains(`suit-${key}`));
      if (!suit) return;
      const label = button.querySelector('span')?.textContent ?? '';
      button.innerHTML = `<b>${suitMap[suit]}</b><span>${label}<small>${counts[suit]} w ręce</small></span>`;
    });
    if (description) description.textContent = 'Wybierz kolor dla następnego gracza. Liczby pokazują ile kart danego koloru masz.';
  }
}

function animateStateChange({
  before,
  state,
  game,
  ui,
  hand,
  drawPile,
  discard,
  opponents,
  motionToggle,
  localPlaySources,
  opponentSources,
  drawSource,
}) {
  if (!before?.started || !state.started || !motionEnabled(motionToggle)) return;

  const newSnapshot = snapshot(state);
  const actorIndex = before.currentIndex;
  const discardDelta = newSnapshot.discardCount - before.discardCount;
  let baseDelay = 0;

  if (discardDelta > 0) {
    const played = state.discardPile.slice(-discardDelta);
    played.forEach((card, index) => {
      const from = actorIndex === game.localSeat
        ? localPlaySources[index] ?? humanSourceGeometry(hand)
        : opponentSources.get(actorIndex) ?? opponentSourceGeometry(opponents, state, game.localSeat, actorIndex);
      const to = discardTargetRect(discard);
      if (from && to) window.setTimeout(() => flyFaceCard(ui, card, from, to), index * 95);
    });

    const settleDelay = Math.max(0, (played.length - 1) * 95) + 420;
    const finalCard = played.at(-1);
    if (finalCard) window.setTimeout(() => ui.finishDiscardFlight?.(finalCard), settleDelay);
    baseDelay = discardDelta * 95;
  }

  newSnapshot.playerHands.forEach((ids, playerIndex) => {
    const beforeIds = new Set(before.playerHands[playerIndex] ?? []);
    const addedIds = ids.filter((id) => id && !beforeIds.has(id));
    if (!addedIds.length) return;

    if (playerIndex === game.localSeat) {
      addedIds.forEach((id) => {
        const element = [...hand.querySelectorAll('[data-card-id]')].find((item) => item.dataset.cardId === id);
        element?.classList.add('ux-arriving-card');
        window.setTimeout(() => element?.classList.remove('ux-arriving-card'), baseDelay + addedIds.length * 105 + 430);
      });
    }

    addedIds.forEach((_, index) => {
      const from = drawSource ?? elementGeometry(drawPile);
      const to = playerIndex === game.localSeat
        ? humanTargetGeometry(hand)
        : opponentTargetGeometry(opponents, state, game.localSeat, playerIndex);
      if (from && to) window.setTimeout(() => flyBackCard(from, to), baseDelay + index * 105);
    });
  });
}

function elementGeometry(element) {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  return { rect, rotation: elementRotation(element) };
}

function elementRotation(element) {
  if (!element) return 0;
  const transform = getComputedStyle(element).transform;
  if (!transform || transform === 'none') return 0;
  try {
    const matrix = new DOMMatrixReadOnly(transform);
    return Math.atan2(matrix.b, matrix.a) * (180 / Math.PI);
  } catch {
    return 0;
  }
}

function humanSourceGeometry(hand) {
  const selected = hand?.querySelector('.hand-card.selected');
  const any = selected ?? hand?.querySelector('.hand-card');
  return elementGeometry(any ?? hand);
}

function humanTargetGeometry(hand) {
  const cards = [...(hand?.querySelectorAll('.hand-card') ?? [])];
  return elementGeometry(cards.at(-1) ?? hand);
}

function opponentSeat(opponents, state, localSeat, playerIndex) {
  const opponentIndices = (state.players ?? []).map((_, index) => index).filter((index) => index !== localSeat);
  const renderedIndex = opponentIndices.indexOf(playerIndex);
  return renderedIndex >= 0 ? opponents?.querySelectorAll('.opponent-seat')?.[renderedIndex] ?? null : null;
}

function opponentSourceGeometry(opponents, state, localSeat, playerIndex) {
  const seat = opponentSeat(opponents, state, localSeat, playerIndex);
  const visibleBacks = seat ? [...seat.querySelectorAll('.mini-back')] : [];
  return elementGeometry(visibleBacks.at(-1)
    ?? seat?.querySelector('.opponent-hand')
    ?? seat);
}

function opponentTargetGeometry(opponents, state, localSeat, playerIndex) {
  return opponentSourceGeometry(opponents, state, localSeat, playerIndex);
}

function captureOpponentSources(opponents, state, localSeat) {
  const sources = new Map();
  (state.players ?? []).forEach((_, playerIndex) => {
    if (playerIndex === localSeat) return;
    const source = opponentSourceGeometry(opponents, state, localSeat, playerIndex);
    if (source) sources.set(playerIndex, source);
  });
  return sources;
}

function discardTargetRect(discard) {
  return discard?.querySelector('.table-card')?.getBoundingClientRect() ?? discard?.getBoundingClientRect() ?? null;
}

function flyFaceCard(ui, card, from, to) {
  const element = ui.makeCard(card, { table: true });
  const compact = window.innerWidth <= 820;
  prepareFlight(element, from, to, 0, {
    width: compact ? 78 : 106,
    height: compact ? 110 : 152,
  });
}

function flyBackCard(from, to) {
  const element = document.createElement('div');
  element.className = 'card card-back';
  element.innerHTML = '<div class="back-inner"><span>MAKAO</span></div>';
  prepareFlight(element, from, to, 0);
}

function prepareFlight(element, from, to, endRotation = 0, size = null) {
  const fromRect = from?.rect ?? from;
  const toRect = to?.rect ?? to;
  if (!fromRect || !toRect) return;

  const width = size?.width ?? Math.max(46, Math.min(120, fromRect.width || 106));
  const height = size?.height ?? Math.max(64, Math.min(168, fromRect.height || 152));
  const sourceX = fromRect.left + (fromRect.width - width) / 2;
  const sourceY = fromRect.top + (fromRect.height - height) / 2;
  const targetX = toRect.left + (toRect.width - width) / 2;
  const targetY = toRect.top + (toRect.height - height) / 2;
  const dx = targetX - sourceX;
  const dy = targetY - sourceY;
  const startRotation = Number.isFinite(from?.rotation) ? from.rotation : 0;

  element.classList.add('ux-flight-card');
  element.dataset.flightStartRotation = String(startRotation);
  element.style.left = `${sourceX}px`;
  element.style.top = `${sourceY}px`;
  element.style.width = `${width}px`;
  element.style.height = `${height}px`;
  element.style.transform = `translate(0,0) rotate(${startRotation}deg) scale(1)`;
  document.body.appendChild(element);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      element.classList.add('is-flying');
      element.style.transform = `translate(${dx}px, ${dy}px) rotate(${endRotation}deg) scale(.96)`;
      element.style.opacity = '.9';
    });
  });

  window.setTimeout(() => element.remove(), 455);
}
