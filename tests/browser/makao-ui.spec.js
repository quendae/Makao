import { test, expect } from '@playwright/test';

async function ready(page) {
  await page.goto('/index.html');
  await page.waitForFunction(() => Boolean(window.makaoGame));
  await page.evaluate(() => document.getElementById('main-menu')?.classList.remove('open'));
}

async function setHumanScenario(page, { hand, top, bots = 2 }) {
  await page.evaluate(({ hand, top, bots }) => {
    const game = window.makaoGame;
    clearTimeout(game.timer);
    game.queueCurrentTurn = () => {};
    game.state = game.emptyState();
    game.state.started = true;
    game.state.botCount = bots;
    game.state.players = game.createPlayers(bots);
    game.state.currentIndex = 0;
    game.state.players[0].hand = hand;
    game.state.discardPile = [top];
    game.state.drawPile = [];
    game.emit();
    document.getElementById('main-menu')?.classList.remove('open');
  }, { hand, top, bots });
  await page.waitForTimeout(50);
}

function buildDeck() {
  const ranks = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
  const suits = ['clubs','diamonds','hearts','spades'];
  return suits.flatMap((suit) => ranks.map((rank) => ({ id: `${rank}-${suit}`, rank, suit })));
}

test('40-card hand stays inside viewport and remains individually reachable', async ({ page }) => {
  await ready(page);
  const deck = buildDeck();
  const top = { id: 'Q-hearts', rank: 'Q', suit: 'hearts' };
  const hand = deck.filter((card) => card.id !== top.id).slice(0, 40);
  await setHumanScenario(page, { hand, top });

  await expect(page.locator('#human-hand')).toHaveClass(/hand-scroll-mode/);
  await expect(page.locator('#human-hand .hand-card')).toHaveCount(40);

  const layout = await page.evaluate(() => {
    const handRect = document.getElementById('human-hand').getBoundingClientRect();
    const action = document.getElementById('action-bar').getBoundingClientRect();
    const felt = document.getElementById('felt-table').getBoundingClientRect();
    return {
      innerHeight,
      docHeight: document.documentElement.scrollHeight,
      handTop: handRect.top,
      handBottom: handRect.bottom,
      actionCenter: action.left + action.width / 2,
      handCenter: handRect.left + handRect.width / 2,
      actionWidth: action.width,
      feltBottom: felt.bottom,
    };
  });

  expect(layout.docHeight).toBeLessThanOrEqual(layout.innerHeight + 2);
  expect(layout.handBottom).toBeLessThanOrEqual(layout.innerHeight + 1);
  expect(layout.feltBottom).toBeLessThanOrEqual(layout.innerHeight + 1);
  expect(layout.actionWidth).toBeLessThan(620);
  expect(Math.abs(layout.actionCenter - layout.handCenter)).toBeLessThan(8);

  // These are genuine Playwright pointer clicks. They deliberately fail if a
  // neighboring card physically intercepts the target's click point.
  for (const index of [0, 10, 20, 39]) {
    const locator = page.locator('#human-hand .hand-card').nth(index);
    await locator.scrollIntoViewIfNeeded();
    await expect(locator).toBeVisible();
    const box = await locator.boundingBox();
    expect(box.width).toBeGreaterThan(80);
    expect(box.height).toBeGreaterThan(110);
    await locator.click();
  }
});

test('medium hand either keeps safe fan hitboxes or switches to rack', async ({ page }) => {
  await ready(page);
  const deck = buildDeck();
  const top = { id: 'Q-hearts', rank: 'Q', suit: 'hearts' };
  const hand = deck.filter((card) => card.id !== top.id).slice(0, 14);
  await setHumanScenario(page, { hand, top });

  const cards = page.locator('#human-hand .hand-card');
  await expect(cards).toHaveCount(14);
  for (const index of [0, 5, 9, 13]) {
    const locator = cards.nth(index);
    await locator.scrollIntoViewIfNeeded();
    await locator.click();
  }
});

test('Jack choice exposes only held 5-10 ranks plus Nic and does not cover hand', async ({ page }) => {
  await ready(page);
  const hand = [
    { id: 'J-hearts', rank: 'J', suit: 'hearts' },
    { id: '5-clubs', rank: '5', suit: 'clubs' },
    { id: '7-diamonds', rank: '7', suit: 'diamonds' },
    { id: 'K-clubs', rank: 'K', suit: 'clubs' },
    { id: 'A-spades', rank: 'A', suit: 'spades' },
  ];
  await setHumanScenario(page, { hand, top: { id: '9-hearts', rank: '9', suit: 'hearts' } });

  await page.evaluate(() => {
    const game = window.makaoGame;
    game.playCards(0, [game.state.players[0].hand.find((card) => card.id === 'J-hearts')]);
  });

  await expect(page.locator('#choice-modal')).toHaveClass(/open/);
  await expect(page.locator('#choice-options .choice-none')).toHaveCount(1);
  const labels = await page.locator('#choice-options .choice-button').allTextContents();
  const joined = labels.map((text) => text.replace(/\s+/g, ' ').trim());
  expect(joined.some((text) => text.startsWith('5'))).toBe(true);
  expect(joined.some((text) => text.startsWith('7'))).toBe(true);
  expect(joined.some((text) => text.startsWith('Nic'))).toBe(true);
  for (const forbidden of ['6', '8', '9', '10']) {
    expect(joined.some((text) => text === forbidden || text.startsWith(`${forbidden} `))).toBe(false);
  }

  const positions = await page.evaluate(() => {
    const choice = document.querySelector('#choice-modal .choice-card').getBoundingClientRect();
    const handRect = document.getElementById('human-hand').getBoundingClientRect();
    const overlay = getComputedStyle(document.getElementById('choice-modal'));
    return { choiceBottom: choice.bottom, handTop: handRect.top, overlayPointerEvents: overlay.pointerEvents };
  });
  expect(positions.choiceBottom).toBeLessThanOrEqual(positions.handTop + 8);
  expect(positions.overlayPointerEvents).toBe('none');
});

test('Ace choice keeps hand visible and shows all four suit options with hand counts', async ({ page }) => {
  await ready(page);
  const hand = [
    { id: 'A-hearts', rank: 'A', suit: 'hearts' },
    { id: '5-hearts', rank: '5', suit: 'hearts' },
    { id: '7-hearts', rank: '7', suit: 'hearts' },
    { id: '9-clubs', rank: '9', suit: 'clubs' },
    { id: 'K-clubs', rank: 'K', suit: 'clubs' },
  ];
  await setHumanScenario(page, { hand, top: { id: '9-hearts', rank: '9', suit: 'hearts' } });

  await page.evaluate(() => {
    const game = window.makaoGame;
    game.playCards(0, [game.state.players[0].hand.find((card) => card.id === 'A-hearts')]);
  });

  await expect(page.locator('#choice-modal')).toHaveClass(/open/);
  await expect(page.locator('#choice-options .suit-choice')).toHaveCount(4);
  const labels = (await page.locator('#choice-options .suit-choice').allTextContents()).map((text) => text.replace(/\s+/g, ' ').trim());
  expect(labels.some((text) => text.includes('Kier') && text.includes('2 w ręce'))).toBe(true);
  expect(labels.some((text) => text.includes('Trefl') && text.includes('2 w ręce'))).toBe(true);

  const visible = await page.evaluate(() => {
    const handRect = document.getElementById('human-hand').getBoundingClientRect();
    const choice = document.querySelector('#choice-modal .choice-card').getBoundingClientRect();
    return {
      handInViewport: handRect.top >= 0 && handRect.bottom <= innerHeight + 1,
      noOverlap: choice.bottom <= handRect.top + 8,
      handOpacity: Number(getComputedStyle(document.getElementById('human-hand')).opacity || 1),
    };
  });
  expect(visible.handInViewport).toBe(true);
  expect(visible.noOverlap).toBe(true);
  expect(visible.handOpacity).toBeGreaterThan(0.9);
});

test('browser agent plays complete games through real DOM handlers without layout escape', async ({ page }) => {
  test.setTimeout(180_000);
  const gameCount = Math.max(2, Number.parseInt(process.env.UI_GAME_COUNT ?? '12', 10) || 12);

  // Keep genuine application handlers/timers, but cap presentation delays.
  await page.addInitScript(() => {
    const nativeSetTimeout = window.setTimeout.bind(window);
    window.setTimeout = (callback, delay = 0, ...args) => nativeSetTimeout(callback, Math.min(Number(delay) || 0, 2), ...args);
  });

  for (let gameNo = 0; gameNo < gameCount; gameNo += 1) {
    await page.goto('/index.html');
    await page.waitForFunction(() => Boolean(window.makaoGame));
    const bots = gameNo % 2 === 0 ? 2 : 3;

    const result = await page.evaluate(async ({ bots, seed }) => {
      function mulberry32(value) {
        let state = value >>> 0;
        return () => {
          state += 0x6d2b79f5;
          let t = state;
          t = Math.imul(t ^ (t >>> 15), t | 1);
          t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
      }

      Math.random = mulberry32(seed);
      const motion = document.getElementById('motion-toggle');
      if (motion) {
        motion.checked = false;
        motion.dispatchEvent(new Event('change', { bubbles: true }));
      }

      // The current Duren-style menu starts an offline game in two steps:
      // open setup, choose bot count, then confirm.
      document.getElementById('start-btn').click();
      document.querySelector(`[data-bots="${bots}"]`).click();
      document.getElementById('offline-start-btn').click();

      const game = window.makaoGame;
      const sleep = () => new Promise((resolve) => setTimeout(resolve, 3));
      const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
      const MAX_TICKS = 20_000;
      let ticks = 0;
      let maxHand = 0;
      let layoutChecks = 0;

      function layoutProblem() {
        const hand = document.getElementById('human-hand')?.getBoundingClientRect();
        const action = document.getElementById('action-bar')?.getBoundingClientRect();
        const felt = document.getElementById('felt-table')?.getBoundingClientRect();
        if (document.documentElement.scrollHeight > innerHeight + 2) return `document height ${document.documentElement.scrollHeight} > ${innerHeight}`;
        if (hand && hand.bottom > innerHeight + 1) return `hand bottom ${hand.bottom} > ${innerHeight}`;
        if (action && action.bottom > innerHeight + 1) return `action bottom ${action.bottom} > ${innerHeight}`;
        if (felt && felt.bottom > innerHeight + 1) return `felt bottom ${felt.bottom} > ${innerHeight}`;
        return null;
      }

      while (!game.state.gameOver && ticks < MAX_TICKS) {
        maxHand = Math.max(maxHand, ...game.state.players.map((player) => player.hand.length));
        const player = game.state.players[game.state.currentIndex];
        const choiceActor = Number.isInteger(game.state.pendingChoice?.actorIndex)
          ? game.state.players[game.state.pendingChoice.actorIndex]
          : null;

        // A Jack/Ace choice belongs to the player who played the functional
        // card. currentIndex may already point at the next player while the
        // modal is still waiting for that human choice.
        if (game.state.pendingChoice && choiceActor?.isHuman) {
          const choice = game.state.pendingChoice.type === 'jack'
            ? document.querySelector('#choice-options .choice-none') ?? document.querySelector('#choice-options .choice-button')
            : document.querySelector('#choice-options .choice-button');
          if (!choice) return { ok: false, problem: `no choice button for ${game.state.pendingChoice.type}`, ticks, turnNumber: game.state.turnNumber };
          choice.click();
        } else if (player?.isHuman && game.humanCanAct()) {
          if (game.state.drawnRescueCardId) {
            const rescue = document.querySelector(`#human-hand [data-card-id="${game.state.drawnRescueCardId}"]`);
            if (!rescue) return { ok: false, problem: `rescue card ${game.state.drawnRescueCardId} missing in DOM`, ticks, turnNumber: game.state.turnNumber };
            rescue.click();
            const makao = document.getElementById('makao-btn');
            if (makao && !makao.disabled) makao.click();
            document.getElementById('play-btn').click();
          } else {
            const playable = document.querySelector('#human-hand .hand-card.playable:not(.disabled-card)');
            if (playable) {
              playable.click();
              const makao = document.getElementById('makao-btn');
              if (makao && !makao.disabled) makao.click();
              const play = document.getElementById('play-btn');
              if (play.disabled) return { ok: false, problem: 'playable card selected but Play stayed disabled', ticks, turnNumber: game.state.turnNumber };
              play.click();
            } else {
              const draw = document.getElementById('draw-btn');
              if (!draw || draw.disabled) return { ok: false, problem: 'human can act but neither play nor draw is available', ticks, turnNumber: game.state.turnNumber };
              draw.click();
            }
          }
        }

        if (ticks % 30 === 0) {
          await frame();
          const problem = layoutProblem();
          layoutChecks += 1;
          if (problem) return { ok: false, problem, ticks, turnNumber: game.state.turnNumber, maxHand, layoutChecks };
        }

        ticks += 1;
        await sleep();
      }

      return {
        ok: game.state.gameOver,
        problem: game.state.gameOver ? null : `game did not finish within ${MAX_TICKS} browser ticks`,
        ticks,
        turnNumber: game.state.turnNumber,
        standings: game.state.standings.length,
        players: game.state.players.length,
        maxHand,
        layoutChecks,
      };
    }, { bots, seed: (0xc0ffee + Math.imul(gameNo + 1, 0x9e3779b1)) >>> 0 });

    expect(result.ok, `browser game ${gameNo + 1}: ${result.problem}; turn=${result.turnNumber}, ticks=${result.ticks}, maxHand=${result.maxHand}`).toBe(true);
    expect(result.standings).toBe(result.players);
    expect(result.layoutChecks).toBeGreaterThan(0);
  }
});
