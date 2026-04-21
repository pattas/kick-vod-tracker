# Kick VOD Tracker

Browser extension (Manifest V3), která sleduje, kolik a kam až jsi dokoukal
záznamy (VOD) na [kick.com](https://kick.com). Na stránce streamera v sekci
`/videos` obarví rozkoukané thumbnaily zeleným rámečkem, u dokoukaných je
šedý rámeček. Klik na rozkoukaný thumbnail automaticky pokračuje v místě,
kde jsi skončil.

## Co to umí

- Automaticky rozpozná VOD stránky `kick.com/{streamer}/videos/{id}` a ukládá pozici přehrávání (každých 5 s + při pauze/seeku/konci).
- Při návratu na stejný VOD obnoví přehrávání na poslední pozici.
- Na stránce `kick.com/{streamer}/videos` kreslí kolem thumbnailů barevný rámeček + badge s procenty a progress bar ve spodu.
  - Zelená = rozkoukáno
  - Šedá = dokoukáno (≥ 95 % nebo zbývá < 30 s)
- V popup ikony rozšíření je seznam všech sledovaných VODů napříč streamery s fulltextovým filtrem, skrytím dokoukaných, tlačítkem "Vymazat vše" a odstraněním jednotlivých záznamů.
- Vše je jen lokálně (`chrome.storage.local`), nic se nikam neposílá.

## Instalace (Chrome / Edge / Brave / Opera)

1. Otevři `chrome://extensions` (resp. `edge://extensions`).
2. Zapni **Developer mode** (vpravo nahoře).
3. Klikni **Load unpacked** a vyber složku s touto extensionou.
4. Ikona zeleného play tlačítka by měla přibýt do lišty rozšíření.

## Instalace (Firefox)

Manifest V3 ve Firefoxu funguje, ale hostované extensiony musí být podepsané.
Pro lokální testování:

1. `about:debugging#/runtime/this-firefox`
2. **Load Temporary Add-on** → vyber `manifest.json`.

## Použití

1. Otevři jakýkoli Kick VOD, např.:
   `https://kick.com/fattypillow/videos/0fe0eee9-8b50-45e5-bc0f-6f2cba198449`
2. Kouknij chvíli, pak zavři.
3. Otevři `https://kick.com/fattypillow/videos` — rozkoukaný záznam bude mít
   kolem dokola **zelený rámeček** a dole progress bar. Klik na něj ho pustí
   v místě, kde jsi skončil (přidá se `?t=<sekundy>` do URL).
4. Pro přehled všech záznamů klikni na ikonu rozšíření v liště.

## Struktura

```
manifest.json        — MV3 manifest
common.js            — sdílená logika (parsing URL, storage helpers)
content-player.js    — content script na stránce VOD (sleduje přehrávač)
content-list.js      — content script na seznamu /videos (kreslí rámečky)
content-list.css     — styl rámečků, progress baru a badge
popup.html / .css / .js — popup okno se seznamem historie
background.js        — MV3 service worker (minimal)
icons/               — PNG ikony 16/48/128
make_icons.py        — skript pro regeneraci ikon (vyžaduje Pillow)
```

## Poznámky

- Pokud Kick změní strukturu DOMu, detekce `<video>` elementu a thumbnailů
  může vyžadovat úpravu v `content-player.js` / `content-list.js`.
- Historie se ukládá pod klíčem `{streamer}/{vodId}` — přejmenování streamera
  nerozbije dohledání.
- URL parametr `?t=<sekundy>` v sdíleném linku má přednost před uloženou pozicí.
