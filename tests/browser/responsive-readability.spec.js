import { test, expect } from '@playwright/test';

const DEVICES = [
  { name: 'compact-phone', portrait: { width: 360, height: 800 } },
  { name: 'large-phone', portrait: { width: 430, height: 932 } },
  { name: 'tablet-10in', portrait: { width: 800, height: 1280 } },
];

const orientations = (device) => [
  { name: 'portrait', viewport: device.portrait },
  { name: 'landscape', viewport: { width: device.portrait.height, height: device.portrait.width } },
];

function sampleHand() {
  const ranks = ['5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  const suits = ['clubs', 'diamonds', 'hearts', 'spades'];
  return suits.flatMap((suit) => ranks.map((rank) => ({ id: `${rank}-${suit}`, rank, suit }))).slice(0, 18);
}

async function readyAt(page, viewport) {
  await page.setViewportSize(viewport);
  await page.goto('/index.html');
  await page.waitForFunction(() => Boolean(window.makaoGame));
  await page.evaluate(() => document.getElementById('main-menu')?.classList.remove('open'));
}

async function setReadableGameState(page, { choice = null } = {}) {
  await page.evaluate(({ hand, choice }) => {
    const game = window.makaoGame;
    clearTimeout(game.timer);
    game.queueCurrentTurn = () => {};
    game.state = game.emptyState();
    game.state.started = true;
    game.state.botCount = 3;
    game.state.players = game.createPlayers(3);
    game.state.currentIndex = 0;
    game.state.players[0].hand = hand;
    game.state.players[1].hand = hand.slice(0, 7);
    game.state.players[2].hand = hand.slice(0, 9);
    game.state.players[3].hand = hand.slice(0, 5);
    game.state.discardPile = [{ id: '9-hearts', rank: '9', suit: 'hearts' }];
    game.state.drawPile = [{ id: '2-clubs', rank: '2', suit: 'clubs' }];
    if (choice === 'jack') game.state.pendingChoice = { type: 'jack', actorIndex: 0 };
    if (choice === 'ace') game.state.pendingChoice = { type: 'ace', actorIndex: 0 };
    game.emit();
    document.getElementById('main-menu')?.classList.remove('open');
  }, { hand: sampleHand(), choice });
  await page.waitForTimeout(60);
}

async function auditReadability(page, label, { choiceOpen = false } = {}) {
  const report = await page.evaluate(({ choiceOpen }) => {
    const visible = (element) => {
      if (!element) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0.05 && rect.width > 0 && rect.height > 0;
    };

    const rectOf = (selector) => {
      const element = document.querySelector(selector);
      if (!visible(element)) return null;
      const r = element.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
    };

    const overlap = (a, b) => {
      if (!a || !b) return 0;
      const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
      const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
      return width * height;
    };

    const criticalSelectors = [
      '#felt-table', '#human-hand', '#action-bar', '#human-seat',
      '#draw-btn', '#play-btn', '#makao-btn', '.phase-ribbon',
    ];
    const critical = Object.fromEntries(criticalSelectors.map((selector) => [selector, rectOf(selector)]));

    const textSelectors = ['#draw-btn', '#play-btn', '#makao-btn', '.phase-ribbon', '#human-seat .plate-copy strong'];
    const text = textSelectors.map((selector) => {
      const element = document.querySelector(selector);
      if (!visible(element)) return { selector, visible: false };
      const style = getComputedStyle(element);
      return {
        selector,
        visible: true,
        fontSize: Number.parseFloat(style.fontSize),
        lineHeight: Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize),
      };
    });

    const targetSelectors = ['#draw-btn', '#play-btn', '#makao-btn', '.helper-tab'];
    const targets = targetSelectors.flatMap((selector) => [...document.querySelectorAll(selector)])
      .filter(visible)
      .map((element) => {
        const r = element.getBoundingClientRect();
        return { label: element.textContent.trim().replace(/\s+/g, ' ').slice(0, 32), width: r.width, height: r.height };
      });

    const choice = choiceOpen ? rectOf('#choice-modal .choice-card') : null;
    const choiceOptions = choiceOpen
      ? [...document.querySelectorAll('#choice-options .choice-button')].filter(visible).map((element) => {
          const r = element.getBoundingClientRect();
          return { width: r.width, height: r.height, text: element.textContent.trim().replace(/\s+/g, ' ') };
        })
      : [];

    return {
      viewport: { width: innerWidth, height: innerHeight },
      body: {
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
      },
      critical,
      text,
      targets,
      choice,
      choiceOptions,
      actionHandOverlap: overlap(critical['#action-bar'], critical['#human-hand']),
      choiceHandOverlap: overlap(choice, critical['#human-hand']),
      handScrollMode: document.getElementById('human-hand')?.classList.contains('hand-scroll-mode') ?? false,
    };
  }, { choiceOpen });

  // Mobile/tablet gameplay is intentionally a vertically scrollable table below
  // the header. It must never escape horizontally, and every critical control
  // must be reachable by normal page scrolling.
  expect(report.body.scrollWidth, `${label}: body has horizontal overflow`).toBeLessThanOrEqual(report.viewport.width + 2);

  for (const [selector, rect] of Object.entries(report.critical)) {
    expect(rect, `${label}: critical element ${selector} is not visible`).not.toBeNull();
    expect(
      rect.left >= -2 && rect.right <= report.viewport.width + 2,
      `${label}: ${selector} escapes horizontally (${JSON.stringify(rect)}) in ${report.viewport.width}x${report.viewport.height}`,
    ).toBe(true);
  }

  for (const selector of ['#human-hand', '#action-bar', '#human-seat', '#draw-btn', '#play-btn', '#makao-btn']) {
    const locator = page.locator(selector).first();
    await locator.scrollIntoViewIfNeeded();
    await expect(locator, `${label}: ${selector} cannot be reached by scrolling`).toBeVisible();
    const box = await locator.boundingBox();
    expect(box, `${label}: ${selector} has no layout box after scroll`).not.toBeNull();
    const top = box.y;
    const bottom = box.y + box.height;
    expect(bottom, `${label}: ${selector} remains below viewport after scroll`).toBeLessThanOrEqual(report.viewport.height + 2);
    expect(top, `${label}: ${selector} remains above viewport after scroll`).toBeGreaterThanOrEqual(-2);
  }

  expect(report.actionHandOverlap, `${label}: action bar overlaps the player's hand`).toBeLessThan(80);

  for (const item of report.text) {
    expect(item.visible, `${label}: ${item.selector} text is not visible`).toBe(true);
    expect(item.fontSize, `${label}: ${item.selector} font is too small (${item.fontSize}px)`).toBeGreaterThanOrEqual(10);
  }

  for (const target of report.targets) {
    expect(target.width, `${label}: tap target '${target.label}' is too narrow`).toBeGreaterThanOrEqual(36);
    expect(target.height, `${label}: tap target '${target.label}' is too short`).toBeGreaterThanOrEqual(36);
  }

  if (choiceOpen) {
    // Choice panels are fixed overlays and therefore should stay wholly in the
    // viewport even when the underlying table itself scrolls vertically.
    expect(report.choice, `${label}: choice panel is missing`).not.toBeNull();
    expect(
      report.choice.left >= -2 && report.choice.top >= -2 && report.choice.right <= report.viewport.width + 2 && report.choice.bottom <= report.viewport.height + 2,
      `${label}: choice panel is clipped (${JSON.stringify(report.choice)})`,
    ).toBe(true);
    expect(report.choiceHandOverlap, `${label}: choice panel covers the player's cards`).toBeLessThan(100);
    expect(report.choiceOptions.length, `${label}: no visible choice buttons`).toBeGreaterThan(0);
    for (const option of report.choiceOptions) {
      expect(option.width, `${label}: choice '${option.text}' is too narrow`).toBeGreaterThanOrEqual(44);
      expect(option.height, `${label}: choice '${option.text}' is too short`).toBeGreaterThanOrEqual(40);
    }
  }

  return report;
}

for (const device of DEVICES) {
  for (const orientation of orientations(device)) {
    const label = `${device.name} ${orientation.name} ${orientation.viewport.width}x${orientation.viewport.height}`;

    test(`${label}: gameplay remains readable and tappable`, async ({ page }) => {
      await readyAt(page, orientation.viewport);
      await setReadableGameState(page);
      const report = await auditReadability(page, label);

      // Eighteen cards should not destroy the table layout on compact screens.
      if (orientation.viewport.width <= 932) expect(report.handScrollMode, `${label}: large hand should use scroll-rack`).toBe(true);
    });

    test(`${label}: Jack choice remains readable without hiding hand`, async ({ page }) => {
      await readyAt(page, orientation.viewport);
      await setReadableGameState(page, { choice: 'jack' });
      await expect(page.locator('#choice-modal')).toHaveClass(/open/);
      await auditReadability(page, `${label} Jack`, { choiceOpen: true });
    });

    test(`${label}: Ace choice remains readable without hiding hand`, async ({ page }) => {
      await readyAt(page, orientation.viewport);
      await setReadableGameState(page, { choice: 'ace' });
      await expect(page.locator('#choice-modal')).toHaveClass(/open/);
      await auditReadability(page, `${label} Ace`, { choiceOpen: true });
    });
  }
}
