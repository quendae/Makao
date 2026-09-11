import { test, expect } from '@playwright/test';

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 1024, height: 768 },
  { name: 'phone-portrait', width: 390, height: 844 },
  { name: 'phone-landscape', width: 844, height: 390 },
];

for (const viewport of VIEWPORTS) {
  test(`multiplayer lobby stays usable on ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/');
    await expect(page.locator('#multiplayer-btn')).toBeVisible();
    await expect(page.locator('#multiplayer-btn strong')).toContainText('Gra online');

    const loadedTheme = await page.evaluate(() => [...document.styleSheets].some((sheet) => sheet.href?.includes('cardroom-refresh.css')));
    expect(loadedTheme).toBe(true);
    const multiplayerButtonStyle = await page.locator('#multiplayer-btn').evaluate((element) => {
      const style = getComputedStyle(element);
      return { display: style.display, radius: style.borderRadius };
    });
    expect(multiplayerButtonStyle.display).not.toBe('none');
    expect(multiplayerButtonStyle.radius).not.toBe('0px');

    await page.evaluate(() => window.makaoMultiplayer.debugHostLobby({
      tableSize: 4,
      connectedSeats: [1],
      botSeats: [2, 3],
    }));

    const modal = page.locator('#multiplayer-modal');
    await expect(modal).toHaveClass(/open/);
    await expect(page.locator('#mp-room-code-display')).toContainText('TEST-ROOM');
    await expect(page.locator('#mp-seats .mp-seat')).toHaveCount(4);
    await expect(page.locator('#mp-seats .mp-seat.bot')).toHaveCount(2);
    await expect(page.locator('#mp-start-game')).toBeEnabled();
    await expect(page.locator('#mp-leave-room')).toBeVisible();

    const overflow = await page.evaluate(() => ({
      document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      body: document.body.scrollWidth - document.body.clientWidth,
    }));
    expect(overflow.document).toBeLessThanOrEqual(1);
    expect(overflow.body).toBeLessThanOrEqual(1);

    for (const selector of ['#mp-room-code-display', '#mp-seats', '#mp-start-game', '#mp-leave-room']) {
      const box = await page.locator(selector).boundingBox();
      expect(box, `${selector} should have a layout box`).not.toBeNull();
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 2);
      expect(box.x).toBeGreaterThanOrEqual(-2);
    }
  });
}

test('multiplayer entry exposes server room browser and public/private room choice', async ({ page }) => {
  await page.goto('/');
  await page.locator('#multiplayer-btn').click();
  await expect(page.locator('#mp-title')).toContainText('QQND Card Room');
  await expect(page.locator('#mp-room-browser')).toBeVisible();
  await page.locator('#mp-choose-host').click();
  await expect(page.locator('#mp-visibility')).toBeVisible();
  await expect(page.locator('#mp-host-password')).toBeHidden();
});

test('closing multiplayer returns to the main menu instead of an idle table', async ({ page }) => {
  await page.goto('/');
  await page.locator('#multiplayer-btn').click();
  await expect(page.locator('#main-menu')).not.toHaveClass(/open/);
  await page.locator('#mp-close').click();
  await expect(page.locator('#multiplayer-modal')).not.toHaveClass(/open/);
  await expect(page.locator('#main-menu')).toHaveClass(/open/);
});

test('offline bot count lives in a second-step new game dialog', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#main-menu #bot-selector')).toHaveCount(0);
  await expect(page.locator('#start-btn strong')).toContainText('Nowa gra offline');
  await expect(page.locator('#multiplayer-btn strong')).toContainText('Gra online');
  await page.locator('#start-btn').click();
  await expect(page.locator('#offline-setup-modal')).toHaveClass(/open/);
  await expect(page.locator('#bot-selector')).toBeVisible();
  await page.locator('#bot-selector [data-bots="3"]').click();
  await page.locator('#offline-start-btn').click();
  await expect(page.locator('#offline-setup-modal')).not.toHaveClass(/open/);
  await expect(page.locator('#main-menu')).not.toHaveClass(/open/);
  await expect.poll(() => page.evaluate(() => window.makaoGame.state.players.length)).toBe(4);
});

test('rendering an unchanged state preserves discard and hand card DOM nodes', async ({ page }) => {
  await page.goto('/');
  const stable = await page.evaluate(() => {
    window.makaoGame.start(2);
    clearTimeout(window.makaoGame.timer);
    window.makaoGame.timer = null;
    window.makaoGame.state.currentIndex = 0;
    window.makaoGame.onChange(window.makaoGame.state);
    document.getElementById('main-menu')?.classList.remove('open');
    const discardBefore = document.querySelector('#discard-pile .table-card');
    const handBefore = document.querySelector('#human-hand .hand-card');
    const handId = handBefore?.dataset.cardId;
    window.makaoGame.onChange(window.makaoGame.state);
    const discardAfter = document.querySelector('#discard-pile .table-card');
    const handAfter = handId ? document.querySelector(`#human-hand [data-card-id="${handId}"]`) : null;
    return {
      hasDiscard: Boolean(discardBefore),
      hasHand: Boolean(handBefore),
      sameDiscard: discardBefore === discardAfter,
      sameHand: handBefore === handAfter,
    };
  });
  expect(stable.hasDiscard).toBe(true);
  expect(stable.hasHand).toBe(true);
  expect(stable.sameDiscard).toBe(true);
  expect(stable.sameHand).toBe(true);
});

async function startDeterministicHumanTurn(page) {
  await page.evaluate(() => {
    window.makaoGame.start(2);
    clearTimeout(window.makaoGame.timer);
    window.makaoGame.timer = null;
    window.makaoGame.state.currentIndex = 0;
    const firstCard = window.makaoGame.state.players[0]?.hand?.[0];
    const topCard = window.makaoGame.state.discardPile?.at(-1);
    if (firstCard && topCard) topCard.suit = firstCard.suit;
    window.makaoGame.onChange(window.makaoGame.state);
    document.getElementById('main-menu')?.classList.remove('open');
  });
}

test('full-size cards keep one geometry from hand through flight to discard', async ({ page }) => {
  await page.goto('/');
  await startDeterministicHumanTurn(page);

  const size = async (selector) => page.locator(selector).first().evaluate((element) => {
    const style = getComputedStyle(element);
    return { width: parseFloat(style.width), height: parseFloat(style.height) };
  });

  const handSize = await size('#human-hand .hand-card');
  const discardSize = await size('#discard-pile .table-card');
  const drawSize = await size('#draw-pile');
  expect(discardSize).toEqual(handSize);
  expect(drawSize).toEqual(handSize);

  const playable = page.locator('#human-hand .hand-card.playable').first();
  await expect(playable).toBeVisible();
  await playable.click();
  await page.locator('#play-btn').click();
  await page.evaluate(() => {
    clearTimeout(window.makaoGame.timer);
    window.makaoGame.timer = null;
  });

  const flight = page.locator('.ux-flight-card.is-flying').first();
  await expect(flight).toBeVisible();
  const flightSize = await size('.ux-flight-card.is-flying');
  expect(flightSize).toEqual(handSize);
  const transform = await flight.evaluate((element) => element.style.transform);
  expect(transform).toContain('scale(1)');
});

test('played card stays single during flight and straightens at the discard pile', async ({ page }) => {
  await page.goto('/');
  await startDeterministicHumanTurn(page);

  const oldDiscardId = await page.locator('#discard-pile .table-card').getAttribute('data-card-id');
  const playable = page.locator('#human-hand .hand-card.playable').first();
  await expect(playable).toBeVisible();
  const playedId = await playable.getAttribute('data-card-id');
  expect(playedId).toBeTruthy();
  await playable.click();
  await page.locator('#play-btn').click();
  await page.evaluate(() => {
    clearTimeout(window.makaoGame.timer);
    window.makaoGame.timer = null;
  });

  const flight = page.locator('.ux-flight-card.is-flying').first();
  await expect(flight).toBeVisible();
  await expect(page.locator('#discard-pile .table-card')).toHaveAttribute('data-card-id', oldDiscardId);
  const transform = await flight.evaluate((element) => element.style.transform);
  expect(transform).toContain('rotate(0deg)');

  await expect(flight).toHaveCount(0);
  await expect(page.locator('#discard-pile .table-card')).toHaveAttribute('data-card-id', playedId);
});
