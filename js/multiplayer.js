import { BOT_NAMES } from './constants.js';

const GAME_ID = 'makao';
const WS_URL = 'wss://api.qqnd.fyi/api/v1/ws';
const SESSION_STORAGE_KEY = 'makao.qqnd.server-session.v1';
const REQUEST_TIMEOUT_MS = 12000;
const GAME_ACTIONS = new Set(['play-cards', 'draw', 'pass-after-draw', 'toggle-makao', 'choose-pending']);

export function normalizeRoomCode(value) {
  const raw = String(value || '').toUpperCase().replace(/[^A-Z2-9]/g, '');
  return raw.length === 8 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : '';
}

export function validateNickname(value) {
  const nickname = String(value || '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const length = Array.from(nickname).length;
  if (length < 3 || length > 20) return { ok: false, message: 'Nick powinien mieć od 3 do 20 znaków.' };
  if (/https?:|www\.|[<>@]/iu.test(nickname) || !/^[\p{L}\p{N} _-]+$/u.test(nickname)) {
    return { ok: false, message: 'Nick może zawierać litery, cyfry, spacje, _ i -.' };
  }
  return { ok: true, nickname };
}

export function lobbyReady({ humanCount, botCount, tableSize }) {
  return Number.isInteger(tableSize) && [3, 4].includes(tableSize) && humanCount >= 1 && humanCount + botCount === tableSize;
}

function safeJsonParse(raw) {
  try { return JSON.parse(typeof raw === 'string' ? raw : String(raw || '')); }
  catch { return null; }
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

export class MakaoMultiplayer {
  constructor(game) {
    this.game = game;
    this.ui = null;
    this.pendingTableSize = 3;
    this.lobbyBotCount = 0;
    this.socket = null;
    this.socketPromise = null;
    this.waiters = [];
    this.reconnectTimer = null;
    this.reconnectAttempt = 0;
    this.intentionalClose = false;
    this.authSession = null;
    this.resumeToken = '';
    this.rooms = [];
    this.presence = new Map();
    this.graceTicker = null;
    this.session = this.emptySession();
    this.el = {};
  }

  emptySession() {
    return {
      active: false,
      room: '',
      roomObj: null,
      role: null,
      localSeat: -1,
      tableSize: this.pendingTableSize || 3,
      names: ['', '', '', ''],
      botSeats: new Set(),
      inGame: false,
      authoritative: false,
      lastRevision: 0,
    };
  }

  attachUI(ui) {
    this.ui = ui;
    this.bindElements();
    this.upgradeMarkup();
    this.bindEvents();
    this.restoreName();
    this.renderEntry();
    this.updateNetworkPill();
    this.resumeStoredSession(true).catch(() => {});
  }

  bindElements() {
    const $ = (id) => document.getElementById(id);
    this.el = {
      open: $('multiplayer-btn'), modal: $('multiplayer-modal'), close: $('mp-close'), entry: $('mp-entry'),
      hostPanel: $('mp-host-panel'), guestPanel: $('mp-guest-panel'), lobbyPanel: $('mp-lobby-panel'),
      chooseHost: $('mp-choose-host'), chooseGuest: $('mp-choose-guest'), hostBack: $('mp-host-back'), guestBack: $('mp-guest-back'),
      hostNick: $('mp-host-nick'), guestNick: $('mp-guest-nick'), roomInput: $('mp-room-code'), create: $('mp-create-room'), join: $('mp-join-room'),
      hostStatus: $('mp-host-status'), guestStatus: $('mp-guest-status'), lobbyStatus: $('mp-lobby-status'), roomCode: $('mp-room-code-display'),
      copyRoom: $('mp-copy-room'), seats: $('mp-seats'), start: $('mp-start-game'), leave: $('mp-leave-room'), tableSize: $('mp-table-size'),
      pill: $('network-pill'), disconnect: $('mp-disconnect'), disconnectText: $('mp-disconnect-text'), disconnectLeave: $('mp-disconnect-leave'),
    };
  }

  upgradeMarkup() {
    document.title = 'Makao — Offline / Online';
    const topEyebrow = document.querySelector('.brand-block .eyebrow');
    if (topEyebrow) topEyebrow.textContent = 'PRYWATNY STÓŁ · OFFLINE / ONLINE';
    const lead = document.querySelector('#main-menu .menu-lead');
    if (lead) lead.textContent = 'Graj offline z botami albo przy wspólnym stole online z reconnectem i botami zastępczymi.';
    const multiplayerStrong = this.el.open?.querySelector('strong');
    if (multiplayerStrong) multiplayerStrong.textContent = 'Multiplayer online';
    const mpTitle = document.getElementById('mp-title');
    if (mpTitle) mpTitle.textContent = 'QQND Card Room';
    const mpLead = this.el.entry?.querySelector('.mp-lead');
    if (mpLead) mpLead.textContent = 'Utwórz publiczny lub prywatny pokój, dołącz kodem albo wybierz stół z listy. Serwer pilnuje kart, zasad i botów.';
    const footnote = this.el.entry?.querySelector('.mp-footnote');
    if (footnote) footnote.textContent = 'Po rozłączeniu miejsce jest rezerwowane przez 60 s, potem ten sam seat i rękę przejmuje bot. Powrót odzyskuje aktualny stan bez cofania gry.';

    const hostPassword = document.getElementById('mp-host-password')?.closest('.mp-field');
    const guestPassword = document.getElementById('mp-guest-password')?.closest('.mp-field');
    hostPassword?.classList.add('hidden');
    guestPassword?.classList.add('hidden');

    if (!document.getElementById('mp-visibility')) {
      const field = document.createElement('label');
      field.className = 'mp-field';
      field.innerHTML = '<span>Widoczność pokoju</span><select id="mp-visibility"><option value="public">Publiczny — widoczny na liście</option><option value="private">Prywatny — tylko kod pokoju</option></select>';
      this.el.tableSize?.closest('.mp-field')?.before(field);
    }
    this.el.visibility = document.getElementById('mp-visibility');

    if (!document.getElementById('mp-room-browser')) {
      const browser = document.createElement('section');
      browser.id = 'mp-room-browser';
      browser.className = 'mp-browser';
      browser.innerHTML = '<div class="mp-browser-head"><div><span class="eyebrow">PUBLICZNE STOŁY</span><strong>Dostępne pokoje</strong></div><button id="mp-refresh-rooms" class="btn ghost compact" type="button">Odśwież</button></div><div id="mp-room-list" class="mp-room-list"><p class="mp-empty">Łączenie z serwerem…</p></div>';
      this.el.entry?.appendChild(browser);
    }
    this.el.refreshRooms = document.getElementById('mp-refresh-rooms');
    this.el.roomList = document.getElementById('mp-room-list');

    const lobbyFootnote = this.el.lobbyPanel?.querySelector('.mp-footnote');
    if (lobbyFootnote) lobbyFootnote.textContent = 'Wolne miejsca możesz zapełnić botami. Po starcie serwer jest jedynym źródłem stanu gry.';
    const disconnectTitle = this.el.disconnect?.querySelector('h2');
    if (disconnectTitle) disconnectTitle.textContent = 'Status gracza';
    if (this.el.disconnectLeave) this.el.disconnectLeave.textContent = 'Opuść stół';
  }

  bindEvents() {
    this.el.open?.addEventListener('click', () => this.openModal());
    this.el.close?.addEventListener('click', () => this.closeModal());
    this.el.modal?.addEventListener('click', (event) => { if (event.target === this.el.modal) this.closeModal(); });
    this.el.chooseHost?.addEventListener('click', () => this.showPanel('host'));
    this.el.chooseGuest?.addEventListener('click', () => this.showPanel('guest'));
    this.el.hostBack?.addEventListener('click', () => this.renderEntry());
    this.el.guestBack?.addEventListener('click', () => this.renderEntry());
    this.el.create?.addEventListener('click', () => this.createRoom());
    this.el.join?.addEventListener('click', () => this.joinRoom());
    this.el.copyRoom?.addEventListener('click', () => this.copyRoomCode());
    this.el.start?.addEventListener('click', () => this.startGame());
    this.el.leave?.addEventListener('click', () => this.leaveRoom());
    this.el.disconnectLeave?.addEventListener('click', () => this.leaveRoom());
    this.el.refreshRooms?.addEventListener('click', () => this.refreshRooms());
    this.el.roomList?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-room-id]');
      if (button) this.joinPublicRoom(button.dataset.roomId);
    });
    this.el.hostNick?.addEventListener('input', () => this.syncNickInputs(this.el.hostNick, this.el.guestNick));
    this.el.guestNick?.addEventListener('input', () => this.syncNickInputs(this.el.guestNick, this.el.hostNick));
    this.el.tableSize?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-mp-table-size]');
      if (!button || this.session.inGame) return;
      this.pendingTableSize = Number(button.dataset.mpTableSize) === 4 ? 4 : 3;
      this.session.tableSize = this.pendingTableSize;
      this.el.tableSize.querySelectorAll('[data-mp-table-size]').forEach((item) => item.classList.toggle('active', item === button));
      this.reconcileLobbyBots();
      this.broadcastLobbyMeta();
      this.renderLobby();
    });
    this.el.seats?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-mp-bot-seat]');
      if (!button || this.session.role !== 'host' || this.session.inGame) return;
      const seat = Number(button.dataset.mpBotSeat);
      const humanCount = this.session.roomObj?.players?.length || 0;
      const botStart = humanCount;
      const isBot = seat >= botStart && seat < botStart + this.lobbyBotCount;
      this.lobbyBotCount = Math.max(0, Math.min(this.session.tableSize - humanCount, this.lobbyBotCount + (isBot ? -1 : 1)));
      this.broadcastLobbyMeta();
      this.renderLobby();
    });
  }

  syncNickInputs(source, target) { if (source && target && document.activeElement !== target) target.value = source.value; }

  restoreName() {
    const stored = this.loadStoredSession();
    let name = stored?.nickname || '';
    try { name ||= localStorage.getItem('makao-player-name') || ''; } catch {}
    if (name) {
      if (this.el.hostNick) this.el.hostNick.value = name;
      if (this.el.guestNick) this.el.guestNick.value = name;
    }
  }

  persistName(name) { try { localStorage.setItem('makao-player-name', name); } catch {} }

  loadStoredSession() {
    try {
      const parsed = JSON.parse(localStorage.getItem(SESSION_STORAGE_KEY) || 'null');
      if (parsed?.sessionId && parsed?.resumeToken) return parsed;
    } catch {}
    return null;
  }

  storeSession() {
    if (!this.authSession?.id || !this.resumeToken) return;
    try { localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ sessionId: this.authSession.id, resumeToken: this.resumeToken, nickname: this.authSession.nickname })); } catch {}
  }

  clearStoredSession() { try { localStorage.removeItem(SESSION_STORAGE_KEY); } catch {} }

  openModal() {
    this.ui?.closeMenu?.();
    this.el.modal?.classList.add('open');
    if (this.session.active) this.renderLobby(); else this.renderEntry();
    this.refreshRooms().catch(() => {});
  }

  closeModal() { this.el.modal?.classList.remove('open'); }
  renderEntry() { this.setView('entry'); this.setStatus('host', ''); this.setStatus('guest', ''); }
  showPanel(name) { this.setView(name); }
  setView(name) {
    this.el.entry?.classList.toggle('hidden', name !== 'entry');
    this.el.hostPanel?.classList.toggle('hidden', name !== 'host');
    this.el.guestPanel?.classList.toggle('hidden', name !== 'guest');
    this.el.lobbyPanel?.classList.toggle('hidden', name !== 'lobby');
  }

  setStatus(target, text, isError = false) {
    const element = target === 'host' ? this.el.hostStatus : target === 'guest' ? this.el.guestStatus : this.el.lobbyStatus;
    if (!element) return;
    element.textContent = text || '';
    element.classList.toggle('error', Boolean(isError));
  }

  addWaiter(types) {
    const expected = new Set(Array.isArray(types) ? types : [types]);
    return new Promise((resolve, reject) => {
      const waiter = { types: expected, resolve, reject, timer: null };
      waiter.timer = setTimeout(() => {
        this.waiters = this.waiters.filter((item) => item !== waiter);
        reject(new Error('request_timeout'));
      }, REQUEST_TIMEOUT_MS);
      this.waiters.push(waiter);
    });
  }

  settleWaiters(message) {
    for (const waiter of [...this.waiters]) {
      if (!waiter.types.has(message.type) && message.type !== 'error') continue;
      clearTimeout(waiter.timer);
      this.waiters = this.waiters.filter((item) => item !== waiter);
      if (message.type === 'error') waiter.reject(new Error(message.code || message.message || 'server_error'));
      else waiter.resolve(message);
      break;
    }
  }

  socketSend(payload) {
    if (this.socket?.readyState !== WebSocket.OPEN) throw new Error('server_offline');
    this.socket.send(JSON.stringify(payload));
  }

  async request(payload, successTypes) {
    await this.ensureSocket();
    const waiting = this.addWaiter(successTypes);
    this.socketSend(payload);
    return waiting;
  }

  ensureSocket() {
    if (this.socket?.readyState === WebSocket.OPEN) return Promise.resolve(this.socket);
    if (this.socketPromise) return this.socketPromise;
    this.intentionalClose = false;
    this.socketPromise = new Promise((resolve, reject) => {
      const socket = new WebSocket(WS_URL);
      this.socket = socket;
      let greeted = false;
      const timer = setTimeout(() => { if (!greeted) { try { socket.close(); } catch {} reject(new Error('server_timeout')); } }, REQUEST_TIMEOUT_MS);
      socket.onmessage = (event) => {
        const message = safeJsonParse(event.data);
        if (!message) return;
        if (message.type === 'hello') {
          greeted = true;
          clearTimeout(timer);
          this.reconnectAttempt = 0;
          resolve(socket);
        }
        this.settleWaiters(message);
        this.handleServerMessage(message);
      };
      socket.onerror = () => { if (!greeted) reject(new Error('server_offline')); };
      socket.onclose = () => {
        clearTimeout(timer);
        if (this.socket === socket) this.socket = null;
        this.socketPromise = null;
        this.authSession = null;
        this.resumeToken = '';
        for (const waiter of this.waiters.splice(0)) { clearTimeout(waiter.timer); waiter.reject(new Error('connection_closed')); }
        this.updateNetworkPill();
        if (!this.intentionalClose && this.loadStoredSession()) this.scheduleReconnect();
        if (this.session.inGame) this.showDisconnect('Utracono połączenie z serwerem. Trwa automatyczne ponowne łączenie…');
      };
    }).finally(() => { this.socketPromise = null; });
    return this.socketPromise;
  }

  scheduleReconnect() {
    if (this.reconnectTimer) return;
    const delay = Math.min(10000, 700 * Math.pow(1.7, this.reconnectAttempt++));
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try { await this.ensureSocket(); await this.resumeStoredSession(true); }
      catch { this.scheduleReconnect(); }
    }, delay);
  }

  async resumeStoredSession(silent = false) {
    if (this.authSession) return this.authSession;
    const stored = this.loadStoredSession();
    if (!stored) return null;
    try {
      await this.ensureSocket();
      const message = await this.request({ type: 'session.resume', sessionId: stored.sessionId, resumeToken: stored.resumeToken }, 'session.resumed');
      this.authSession = message.session;
      this.resumeToken = stored.resumeToken;
      const room = (message.rooms || []).find((candidate) => candidate.game === GAME_ID);
      if (room) {
        this.syncRoom(room);
        if (room.status === 'in_game') this.socketSend({ type: 'game.state.get', roomId: room.id });
      }
      if (!silent) this.restoreName();
      return this.authSession;
    } catch (error) {
      if (/invalid_session_credentials|session_expired/.test(String(error?.message || error))) this.clearStoredSession();
      throw error;
    }
  }

  async ensureSession(rawNickname) {
    const checked = validateNickname(rawNickname);
    if (!checked.ok) throw new Error(checked.message);
    await this.ensureSocket();
    if (!this.authSession) await this.resumeStoredSession(true).catch(() => null);
    if (this.authSession?.nickname === checked.nickname) return this.authSession;
    if (this.authSession && this.session.active) throw new Error('Najpierw opuść bieżący pokój.');
    if (this.authSession) { this.authSession = null; this.resumeToken = ''; this.clearStoredSession(); }
    const message = await this.request({ type: 'session.create', nickname: checked.nickname }, 'session.created');
    this.authSession = message.session;
    this.resumeToken = message.resumeToken;
    this.storeSession();
    this.persistName(checked.nickname);
    return this.authSession;
  }

  async createRoom() {
    try {
      const nickname = this.el.hostNick?.value || '';
      await this.ensureSession(nickname);
      this.pendingTableSize = Number(this.el.tableSize?.querySelector('.active')?.dataset?.mpTableSize) === 4 ? 4 : 3;
      this.lobbyBotCount = 0;
      this.setStatus('host', 'Tworzenie pokoju…');
      const visibility = this.el.visibility?.value === 'private' ? 'private' : 'public';
      const message = await this.request({ type: 'room.create', game: GAME_ID, name: `Makao · ${this.authSession.nickname}`, visibility }, 'room.created');
      this.syncRoom(message.room);
      this.session.tableSize = this.pendingTableSize;
      this.broadcastLobbyMeta();
      this.renderLobby();
      this.setStatus('lobby', visibility === 'public' ? 'Pokój jest widoczny na liście publicznej.' : 'Prywatny pokój gotowy — przekaż kod pozostałym graczom.');
    } catch (error) { this.setStatus('host', this.errorMessage(error), true); }
  }

  async joinRoom() {
    const roomId = normalizeRoomCode(this.el.roomInput?.value);
    if (!roomId) return this.setStatus('guest', 'Wpisz pełny kod pokoju.', true);
    return this.joinById(roomId, this.el.guestNick?.value || '');
  }

  async joinPublicRoom(roomId) { return this.joinById(roomId, this.el.guestNick?.value || this.el.hostNick?.value || ''); }

  async joinById(roomId, nickname) {
    try {
      await this.ensureSession(nickname);
      this.setStatus('guest', 'Dołączanie do pokoju…');
      const message = await this.request({ type: 'room.join', roomId }, 'room.joined');
      this.syncRoom(message.room);
      this.renderLobby();
      this.setStatus('lobby', 'Połączono ze stołem. Czekaj na start gospodarza.');
    } catch (error) { this.setStatus('guest', this.errorMessage(error), true); }
  }

  async refreshRooms() {
    try {
      await this.ensureSocket();
      if (!this.authSession) await this.resumeStoredSession(true).catch(() => null);
      this.socketSend({ type: 'rooms.list', game: GAME_ID });
    } catch {
      if (this.el.roomList) this.el.roomList.innerHTML = '<p class="mp-empty">Serwer jest chwilowo niedostępny.</p>';
    }
  }

  reconcileLobbyBots() {
    const humans = this.session.roomObj?.players?.length || 0;
    if (humans > this.session.tableSize) this.session.tableSize = humans >= 4 ? 4 : 3;
    this.lobbyBotCount = Math.max(0, Math.min(this.lobbyBotCount, this.session.tableSize - humans));
  }

  syncRoom(room) {
    if (!room || room.game !== GAME_ID) return;
    this.session.active = true;
    this.session.room = room.id;
    this.session.roomObj = room;
    this.session.localSeat = this.authSession ? room.players.findIndex((player) => player.id === this.authSession.id) : -1;
    this.session.role = this.authSession?.id === room.ownerSessionId ? 'host' : 'guest';
    if (room.status === 'in_game') this.session.inGame = true;
    this.reconcileLobbyBots();
    this.renderLobby();
    this.updateNetworkPill();
  }

  broadcastLobbyMeta() {
    if (this.session.role !== 'host' || !this.session.room || this.session.inGame || this.socket?.readyState !== WebSocket.OPEN) return;
    this.socketSend({ type: 'room.send', roomId: this.session.room, payload: { type: 'makao.lobby', tableSize: this.session.tableSize, botCount: this.lobbyBotCount } });
  }

  applyLobbyMeta(payload) {
    if (!payload || payload.type !== 'makao.lobby' || this.session.inGame) return;
    this.session.tableSize = Number(payload.tableSize) === 4 ? 4 : 3;
    const humans = this.session.roomObj?.players?.length || 0;
    this.lobbyBotCount = Math.max(0, Math.min(Number(payload.botCount) || 0, this.session.tableSize - humans));
    this.renderLobby();
  }

  handleServerMessage(message) {
    if (!message || typeof message !== 'object') return;
    if (message.type === 'session.created') {
      this.authSession = message.session; this.resumeToken = message.resumeToken; this.storeSession(); this.restoreName(); return;
    }
    if (message.type === 'session.resumed') {
      this.authSession = message.session;
      const room = (message.rooms || []).find((candidate) => candidate.game === GAME_ID);
      if (room) { this.syncRoom(room); if (room.status === 'in_game') this.socketSend({ type: 'game.state.get', roomId: room.id }); }
      return;
    }
    if (['room.created', 'room.joined', 'room.updated'].includes(message.type) && message.room?.game === GAME_ID) { this.syncRoom(message.room); return; }
    if (message.type === 'room.left' && message.roomId === this.session.room) { this.clearRoomState(); return; }
    if (message.type === 'room.closed' && message.roomId === this.session.room) { this.showDisconnect('Pokój został zamknięty.'); this.clearRoomState(); return; }
    if (message.type === 'room.message' && message.roomId === this.session.room) { this.applyLobbyMeta(message.payload); return; }
    if (message.type === 'rooms.list') { this.rooms = Array.isArray(message.rooms) ? message.rooms : []; this.renderRoomBrowser(); return; }
    if (message.type === 'game.started' && message.roomId === this.session.room) {
      if (Number.isInteger(message.seat)) this.session.localSeat = message.seat;
      this.session.botSeats = new Set(message.botSeats || []);
      this.session.inGame = true;
      this.session.authoritative = Boolean(message.authoritative);
      this.applyPresenceSnapshot(message.presence);
      this.closeModal();
      this.ui?.closeMenu?.();
      this.updateNetworkPill();
      return;
    }
    if (message.type === 'game.state' && message.roomId === this.session.room) {
      if (Number.isInteger(message.viewerSeat)) this.session.localSeat = message.viewerSeat;
      this.session.botSeats = new Set(message.botSeats || message.state?.botSeats || []);
      this.session.inGame = true;
      this.session.authoritative = true;
      this.session.lastRevision = Number(message.revision) || this.session.lastRevision;
      this.applyPresenceSnapshot(message.presence);
      this.game.applyRemoteState(message.state, this.session.localSeat);
      this.closeModal();
      this.ui?.closeMenu?.();
      this.updateNetworkPill();
      return;
    }
    if (message.type === 'game.presence' && message.roomId === this.session.room) {
      this.session.botSeats = new Set(message.botSeats || []);
      this.applyPresenceSnapshot(message.presence);
      return;
    }
    if (message.type === 'game.player.connection' && message.roomId === this.session.room) {
      this.session.botSeats = new Set(message.botSeats || [...this.session.botSeats]);
      if (message.connected) {
        this.presence.delete(message.seat);
        this.showDisconnect(`${message.nickname || 'Gracz'} wrócił do gry${message.reclaimedFromBot ? ' i odzyskał miejsce od bota' : ''}.`, true);
      } else {
        this.presence.set(message.seat, { phase: 'waiting', nickname: message.nickname || 'Gracz', deadline: Number(message.graceDeadline) || Date.now() + 60000 });
        this.refreshPresenceNotice();
      }
      return;
    }
    if (message.type === 'game.player.bot_takeover' && message.roomId === this.session.room) {
      this.session.botSeats = new Set(message.botSeats || []);
      this.presence.set(message.seat, { phase: 'bot', nickname: message.nickname || 'Gracz', deadline: 0 });
      this.refreshPresenceNotice();
      return;
    }
    if (message.type === 'error') this.ui?.showToast?.(this.errorMessage({ message: message.code || message.message }));
  }

  applyPresenceSnapshot(entries) {
    if (!Array.isArray(entries)) return;
    const next = new Map();
    for (const entry of entries) {
      if (!entry || !Number.isInteger(entry.seat) || entry.sessionId === this.authSession?.id) continue;
      if (!entry.connected && entry.botActive) next.set(entry.seat, { phase: 'bot', nickname: entry.nickname || 'Gracz', deadline: 0 });
      else if (!entry.connected && Number.isFinite(entry.graceDeadline)) next.set(entry.seat, { phase: 'waiting', nickname: entry.nickname || 'Gracz', deadline: entry.graceDeadline });
    }
    this.presence = next;
    this.refreshPresenceNotice();
  }

  refreshPresenceNotice() {
    clearInterval(this.graceTicker);
    const values = [...this.presence.values()];
    if (!values.length) { this.hideDisconnect(); return; }
    const render = () => {
      const waiting = values.find((item) => item.phase === 'waiting');
      const bot = values.find((item) => item.phase === 'bot');
      if (waiting) {
        const seconds = Math.max(0, Math.ceil((waiting.deadline - Date.now()) / 1000));
        this.showDisconnect(`Utracono połączenie z graczem ${waiting.nickname}. Bot przejmie jego miejsce za ${seconds} s.`);
      } else if (bot) {
        this.showDisconnect(`Bot przejął miejsce gracza ${bot.nickname} i kontynuuje jego aktualną rękę. Jeśli gracz wróci, przejmie zastany stan.`);
      }
    };
    render();
    if (values.some((item) => item.phase === 'waiting')) this.graceTicker = setInterval(render, 1000);
  }

  handleGameAction(action, payload = {}) {
    if (!this.session.inGame) return { ok: false, reason: 'Multiplayer nie jest aktywny.' };
    if (!GAME_ACTIONS.has(action)) return { ok: false, reason: 'Nieznana akcja.' };
    try {
      this.socketSend({ type: 'game.action', roomId: this.session.room, action, payload });
      return { ok: true, pending: true };
    } catch {
      return { ok: false, reason: 'Brak połączenia z serwerem.' };
    }
  }

  isGameActive() { return Boolean(this.session.active && this.session.inGame); }
  isGuest() { return this.session.role === 'guest'; }

  async startGame() {
    if (this.session.role !== 'host' || this.session.inGame) return;
    const humanCount = this.session.roomObj?.players?.length || 0;
    if (!lobbyReady({ humanCount, botCount: this.lobbyBotCount, tableSize: this.session.tableSize })) return;
    try {
      this.socketSend({ type: 'game.start', roomId: this.session.room, botCount: this.lobbyBotCount, settings: { playerCount: this.session.tableSize } });
      this.setStatus('lobby', 'Uruchamianie gry na serwerze…');
    } catch (error) { this.setStatus('lobby', this.errorMessage(error), true); }
  }

  renderLobby() {
    if (!this.session.active) return;
    this.setView('lobby');
    if (this.el.roomCode) this.el.roomCode.textContent = this.session.room || '—';
    if (!this.el.seats) return;
    const players = this.session.roomObj?.players || [];
    const humanCount = players.length;
    this.reconcileLobbyBots();
    const rows = [];
    for (let seat = 0; seat < this.session.tableSize; seat += 1) {
      const human = players[seat];
      const isLocal = human?.id === this.authSession?.id;
      const isBot = !human && seat < humanCount + this.lobbyBotCount;
      const connected = Boolean(human?.connected);
      const name = human?.nickname || (isBot ? BOT_NAMES[(seat - humanCount) % BOT_NAMES.length] || `Bot ${seat + 1}` : 'Wolne miejsce');
      const status = isBot ? 'BOT · GOTOWY' : connected ? 'POŁĄCZONY' : human ? 'ROZŁĄCZONY' : 'WOLNE';
      const canEdit = this.session.role === 'host' && !human && !this.session.inGame;
      const button = canEdit ? `<button type="button" class="mp-seat-action" data-mp-bot-seat="${seat}">${isBot ? 'Usuń bota' : 'Dodaj bota'}</button>` : '';
      rows.push(`<div class="mp-seat ${isLocal ? 'local' : ''} ${isBot ? 'bot' : ''}"><div class="mp-seat-index">${seat + 1}</div><div class="mp-seat-copy"><strong>${escapeHtml(name)}${isLocal ? ' · Ty' : ''}</strong><span>${status}</span></div>${button}</div>`);
    }
    this.el.seats.innerHTML = rows.join('');
    if (this.el.start) {
      this.el.start.classList.toggle('hidden', this.session.role !== 'host');
      this.el.start.disabled = !lobbyReady({ humanCount, botCount: this.lobbyBotCount, tableSize: this.session.tableSize });
    }
    this.updateNetworkPill();
  }

  renderRoomBrowser() {
    if (!this.el.roomList) return;
    const rooms = this.rooms.filter((room) => room.game === GAME_ID && room.visibility === 'public' && room.status !== 'in_game');
    if (!rooms.length) { this.el.roomList.innerHTML = '<p class="mp-empty">Brak otwartych publicznych pokojów.</p>'; return; }
    this.el.roomList.innerHTML = rooms.map((room) => {
      const count = room.players?.length || 0;
      return `<article class="mp-room-item"><div><strong>${escapeHtml(room.name || 'Makao')}</strong><span>${count}/4 graczy · ${escapeHtml(room.id)}</span></div><button class="btn ghost compact" type="button" data-room-id="${escapeHtml(room.id)}">Dołącz</button></article>`;
    }).join('');
  }

  async copyRoomCode() {
    if (!this.session.room) return;
    try { await navigator.clipboard.writeText(this.session.room); this.ui?.showToast?.('Kod pokoju skopiowany.'); }
    catch { this.ui?.showToast?.(`Kod pokoju: ${this.session.room}`); }
  }

  showDisconnect(message, transient = false) {
    if (this.el.disconnectText) this.el.disconnectText.textContent = message;
    this.el.disconnect?.classList.add('open');
    if (transient) setTimeout(() => { if (![...this.presence.values()].length) this.hideDisconnect(); }, 2800);
  }

  hideDisconnect() { this.el.disconnect?.classList.remove('open'); }

  async leaveRoom() {
    if (this.session.room && this.socket?.readyState === WebSocket.OPEN) {
      try { this.socketSend({ type: 'room.leave', roomId: this.session.room }); } catch {}
    }
    this.clearRoomState();
    this.game.stop();
    this.hideDisconnect();
    this.closeModal();
    this.ui?.openMenu?.();
  }

  clearRoomState() {
    this.session = this.emptySession();
    this.lobbyBotCount = 0;
    this.presence.clear();
    clearInterval(this.graceTicker);
    this.hideDisconnect();
    this.updateNetworkPill();
  }

  updateNetworkPill() {
    if (!this.el.pill) return;
    if (!this.session.active) {
      this.el.pill.textContent = this.socket?.readyState === WebSocket.OPEN ? 'ONLINE · GOTOWY' : 'OFFLINE';
      this.el.pill.classList.toggle('online', this.socket?.readyState === WebSocket.OPEN);
      this.el.pill.classList.remove('warning');
      return;
    }
    if (this.presence.size) {
      this.el.pill.textContent = 'ONLINE · ZMIANA GRACZA';
      this.el.pill.classList.remove('online');
      this.el.pill.classList.add('warning');
      return;
    }
    this.el.pill.textContent = this.session.inGame ? `ONLINE · MIEJSCE ${this.session.localSeat + 1}` : 'ONLINE · LOBBY';
    this.el.pill.classList.add('online');
    this.el.pill.classList.remove('warning');
  }

  errorMessage(error) {
    const code = String(error?.message || error || 'Błąd połączenia');
    const messages = {
      server_offline: 'Nie udało się połączyć ze wspólnym serwerem QQND.', request_timeout: 'Serwer nie odpowiedział na czas.',
      room_full: 'Pokój jest pełny.', room_not_found: 'Pokój nie istnieje.', invalid_player_count: 'Stół wymaga 3 albo 4 miejsc.',
      not_your_turn: 'Teraz nie jest Twoja tura.', seat_controlled_by_bot: 'To miejsce jest obecnie sterowane przez bota.',
      card_not_owned: 'Nie masz tej karty.', illegal_play: 'Ta karta nie jest teraz legalna.',
    };
    return messages[code] || code.replaceAll('_', ' ');
  }

  debug() {
    return {
      active: this.session.active, room: this.session.room, role: this.session.role, localSeat: this.session.localSeat,
      tableSize: this.session.tableSize, lobbyBotCount: this.lobbyBotCount, botSeats: [...this.session.botSeats],
      inGame: this.session.inGame, authoritative: this.session.authoritative, revision: this.session.lastRevision,
    };
  }

  debugHostLobby({ tableSize = 4, botSeats = [2, 3], connectedSeats = [1] } = {}) {
    this.authSession = { id: 'debug-host', nickname: 'Host' };
    this.session = this.emptySession();
    this.session.active = true;
    this.session.role = 'host';
    this.session.localSeat = 0;
    this.session.room = 'TEST-ROOM';
    this.session.tableSize = tableSize === 3 ? 3 : 4;
    this.session.roomObj = {
      id: 'TEST-ROOM', game: GAME_ID, ownerSessionId: 'debug-host', status: 'waiting', visibility: 'private',
      players: [{ id: 'debug-host', nickname: 'Host', connected: true }, ...connectedSeats.map((seat) => ({ id: `debug-${seat}`, nickname: `Guest ${seat}`, connected: true }))],
    };
    this.lobbyBotCount = Math.min(botSeats.length, this.session.tableSize - this.session.roomObj.players.length);
    this.openModal();
    this.renderLobby();
    return this.debug();
  }
}
