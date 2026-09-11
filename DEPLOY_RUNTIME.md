# Makao — produkcyjny runtime statyczny

Po wdrożeniu server-authoritative multiplayera katalog `makao.qqnd.fyi` powinien zawierać wyłącznie pliki potrzebne przez `index.html` i importy ES modules.

```text
index.html
css/styles.css
css/ux-fixes.css
css/multiplayer.css
css/cardroom-refresh.css
js/constants.js
js/rules.js
js/bot.js
js/game.js
js/multiplayer.js
js/ui.js
js/cardroom-ui.js
js/ux-effects.js
js/main.js
```

Nie kopiuj do runtime:

```text
.github/
cloudflare-signaling/
rules/
scripts/
tests/
DEPLOY_*.md
README.md
package.json
playwright.config.js
makao-single.html
```

`cloudflare-signaling/` jest legacy rollbackiem i nie jest ładowany przez produkcyjny frontend. Po zakończonym live smoke może zostać usunięty z repozytorium osobnym cleanup commitem.

## Kontrola po kopiowaniu

Sprawdź przez HTTPS:

```text
/
/css/styles.css
/css/multiplayer.css
/css/cardroom-refresh.css
/js/main.js
/js/cardroom-ui.js
/js/multiplayer.js
```

Playwright smoke powinien otwierać `/`, a nie bezpośrednio `index.html`.
