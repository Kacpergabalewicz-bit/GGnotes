# GG Notes (PWA)

Prosty, darmowy notatnik jako PWA — działa offline, bez logowania.

Jak uruchomić lokalnie:

1. Otwórz `index.html` w przeglądarce (najlepiej uruchomić prosty serwer).

Przykład (Python):
```bash
python -m http.server 8000
# potem otwórz http://localhost:8000
```

Instalacja na iPhone (darmowo):

- Otwórz stronę w Safari.
- Stuknij ikonę udostępniania → wybierz "Dodaj do ekranu początkowego".

Uwagi o AltStore / App Store:

- AltStore służy do sideloadowania natywnych plików .ipa i nie jest potrzebny dla PWA.
- PWA to najprostszy sposób, aby aplikacja była zawsze darmowa i bez logowania.

Funkcje zaimplementowane:

- Tworzenie, edycja i usuwanie notatek
- Wyszukiwanie notatek
- Przechowywanie w IndexedDB (trwałe, offline)
- Eksport/Import JSON
- Service Worker do cachowania plików aplikacji
