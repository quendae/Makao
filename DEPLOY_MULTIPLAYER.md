# Wdrożenie multiplayera Makao — QQND Card Room

Makao korzysta ze wspólnego backendu `quendae/qqnd-game-server`. Frontend pozostaje statyczny, a cała rozgrywka online jest **server-authoritative**.

- API: `https://api.qqnd.fyi`
- WebSocket: `wss://api.qqnd.fyi/api/v1/ws`
- frontend: `https://makao.qqnd.fyi/`
- game id: `makao`
- oficjalny online: 3 albo 4 miejsca

## Kolejność wdrożenia

**Najpierw backend, potem frontend.** Frontend z tej migracji wymaga adaptera Makao w `qqnd-game-server`.

Backend:

```bash
cd /opt/qqnd-game-server
git pull
npm install
npm run typecheck
npm test
npm run build
systemctl restart qqnd-game-server
systemctl status qqnd-game-server --no-pager
curl https://api.qqnd.fyi/api/v1/health
```

Smoke WebSocket:

```bash
npx wscat -c wss://api.qqnd.fyi/api/v1/ws
```

Pierwsza ramka powinna być podobna do:

```json
{"type":"hello","protocol":1,"service":"qqnd-game-server"}
```

## Frontend

Wyczyść poprzedni runtime Makao na serwerze statycznym i skopiuj wyłącznie pliki z `DEPLOY_RUNTIME.md`. Produkcyjny entry point to `index.html`.

Po wdrożeniu wykonaj hard refresh; jeśli stary JS/CSS nadal jest serwowany, wyczyść cache reverse proxy/CDN.

## Model multiplayera

Klient tworzy albo wznawia anonimową sesję przez `session.create` / `session.resume`. Resume token jest przechowywany lokalnie i nie powinien być logowany.

Lobby wspiera:

- pokoje publiczne widoczne na liście,
- pokoje prywatne dostępne kodem,
- stoły 3- i 4-osobowe,
- uzupełnianie wolnych miejsc botami przed startem.

Po starcie przeglądarka wysyła wyłącznie intencje jako `game.action`. Serwer posiada talię, ręce, pending effects, wybory J/A, legalność ruchów, boty i wynik/klasyfikację. Klient nie wysyła `game.state.commit` ani `game.state.publish`.

## Disconnect / takeover

Podczas aktywnej gry odłączenie człowieka nie usuwa jego miejsca:

1. przez 60 s seat i aktualna ręka pozostają zarezerwowane;
2. po timeout bot przejmuje **ten sam seat i zastany stan**;
3. jeżeli człowiek wróci później przez `session.resume`, odbiera miejsce botowi;
4. rozgrywka nie jest cofana — gracz dostaje stan pozostawiony przez bota.

UI pokazuje stały centralny komunikat podczas grace period oraz po przejęciu miejsca przez bota.

## Test po wdrożeniu

Przetestuj co najmniej:

1. `/` zwraca 200 i ładuje CSS/JS;
2. public room create/list/join;
3. private room create/join kodem;
4. 3 ludzi;
5. 4 ludzi;
6. człowiek + bot fill do 3/4 miejsc;
7. legalny ruch i odrzucenie nielegalnego ruchu;
8. disconnect krótszy niż 60 s i resume tego samego seat;
9. disconnect dłuższy niż 60 s, takeover bota i późny reconnect/reclaim;
10. cudze ręce oraz kolejność draw pile nie pojawiają się w snapshotach klienta.

## Legacy Cloudflare/WebRTC

Nowy runtime nie używa `cloudflare-signaling/`, `RTCPeerConnection`, STUN ani SDP. Katalog legacy pozostaje chwilowo w repozytorium wyłącznie jako rollback do czasu zakończenia live smoke. Po odbiorze produkcyjnym należy go usunąć osobnym cleanup commitem i poprawić `npm run check`, aby nie sprawdzał Workera.
