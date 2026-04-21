// Běží na všech Kick stránkách. Aktivuje se jen na /{streamer}/videos.
// Kolem rozkoukaných VOD thumbnailů přidá barevný rámeček, progress bar,
// badge se stavem a indikátor komentáře.

(function () {
  const K = window.KVT;
  const DEBUG = false;
  let history = {};
  let decorateTimer = null;
  let isActive = false;
  let mo = null;
  let lastHref = location.href;

  function log(...args) {
    if (DEBUG) console.log("[KVT-list]", ...args);
  }

  function onListPage() {
    return !!K.parseListUrl(location.href);
  }

  async function reloadHistory() {
    history = await K.loadHistory();
  }

  function isElementVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  // Najde thumbnail container v kartě obsahující daný anchor.
  // Pracuje i s background-image (Kick může mít CSS pozadí místo <img>).
  // Strategie:
  //   1) vystoupáme od anchoru, dokud nenajdeme "kartu" (rozumná šířka)
  //   2) v kartě hledáme největší element s video-like aspect ratio (16:9-ish)
  function findThumbContainer(anchor) {
    // 1. Najdi kartu — rodiče, který pravděpodobně obaluje thumbnail + footer.
    let card = anchor;
    for (let i = 0; i < 7 && card.parentElement; i++) {
      const pr = card.parentElement.getBoundingClientRect();
      if (pr.height > 700 || pr.width > 900) break;
      card = card.parentElement;
    }

    // 2. Projdeme strom karty a hledáme element s video aspect ratio.
    let best = null;
    let bestArea = 0;
    const walker = document.createTreeWalker(card, NodeFilter.SHOW_ELEMENT);
    let node = walker.currentNode;
    while ((node = walker.nextNode())) {
      const rect = node.getBoundingClientRect();
      if (rect.width < 150 || rect.height < 70) continue;
      if (rect.width > 900 || rect.height > 550) continue;
      const ratio = rect.width / rect.height;
      if (ratio < 1.3 || ratio > 2.5) continue;
      // Musí obsahovat nějakou obrazovou informaci (img / picture / bg-image)
      const tag = node.tagName.toLowerCase();
      const hasImg =
        tag === "img" || tag === "picture" || !!node.querySelector("img, picture");
      let hasBg = false;
      if (!hasImg) {
        try {
          const cs = getComputedStyle(node);
          hasBg =
            cs.backgroundImage &&
            cs.backgroundImage !== "none" &&
            cs.backgroundImage !== "initial";
        } catch {}
      }
      if (!hasImg && !hasBg) continue;
      const area = rect.width * rect.height;
      if (area > bestArea) {
        best = node;
        bestArea = area;
      }
    }
    return best;
  }

  // Sleduje, kde je aktuálně aplikována dekorace pro daný VOD.
  // Díky tomu překreslujeme jen to, co se změnilo, a ne mažeme/přidáváme
  // elementy při každém tiknutí MutationObserveru (což působilo flickering).
  const decoratedByKey = new Map();

  function decorate() {
    if (!onListPage()) return;

    // Všechny odkazy na VOD detail
    const anchors = document.querySelectorAll('a[href*="/videos/"]');
    log("anchors found:", anchors.length);

    // Seskupíme anchory podle klíče VODu, decorate jen ten s největším
    // thumbnail containerem (ignorujeme text-only odkazy jako titulek).
    const groups = new Map();
    anchors.forEach((a) => {
      const vod = K.parseVodUrl(a.href);
      if (!vod) return;
      if (!isElementVisible(a)) return;
      if (!groups.has(vod.key)) groups.set(vod.key, []);
      groups.get(vod.key).push(a);
    });

    log("vod groups:", groups.size);

    const seenKeys = new Set();

    groups.forEach((anchorList, key) => {
      const entry = history[key];

      let container = null;
      for (const a of anchorList) {
        const c = findThumbContainer(a);
        if (c) {
          container = c;
          break;
        }
      }

      if (!container) return;
      seenKeys.add(key);

      const previous = decoratedByKey.get(key);
      if (previous && previous !== container && document.contains(previous)) {
        clearDecoration(previous, null);
      }

      if (!entry) {
        clearDecoration(container, anchorList[0]);
        decoratedByKey.delete(key);
        return;
      }

      applyDecoration(container, anchorList[0], entry);
      decoratedByKey.set(key, container);
    });

    // Uklid kontejnery, které už nejsou v DOMu nebo jejichž VOD zmizel z historie.
    for (const [key, container] of Array.from(decoratedByKey.entries())) {
      if (!document.contains(container) || !history[key]) {
        if (document.contains(container)) clearDecoration(container, null);
        decoratedByKey.delete(key);
      }
    }
  }

  function setIf(el, prop, value) {
    if (el[prop] !== value) el[prop] = value;
  }
  function setAttrIf(el, name, value) {
    if (el.getAttribute(name) !== value) el.setAttribute(name, value);
  }
  function setStyleIf(el, prop, value) {
    if (el.style[prop] !== value) el.style[prop] = value;
  }

  function applyDecoration(container, anchor, entry) {
    const completed = K.isCompleted(entry);
    const ratio = K.progressRatio(entry);

    if (!container.classList.contains("kvt-marked"))
      container.classList.add("kvt-marked");
    const wantCompleted = completed;
    const wantInProgress = !completed;
    if (container.classList.contains("kvt-completed") !== wantCompleted)
      container.classList.toggle("kvt-completed", wantCompleted);
    if (container.classList.contains("kvt-inprogress") !== wantInProgress)
      container.classList.toggle("kvt-inprogress", wantInProgress);

    const computed = getComputedStyle(container);
    if (computed.position === "static") {
      setStyleIf(container, "position", "relative");
    }

    let badge = container.querySelector(":scope > .kvt-badge");
    if (!badge) {
      badge = document.createElement("div");
      badge.className = "kvt-badge";
      container.appendChild(badge);
    }
    const badgeText = completed ? "✓" : `${Math.round(ratio * 100)}%`;
    setIf(badge, "textContent", badgeText);
    const badgeTitle = completed
      ? "Dokoukáno"
      : `${K.formatTime(entry.position)} / ${K.formatTime(entry.duration)}`;
    setAttrIf(badge, "title", badgeTitle);

    let bar = container.querySelector(":scope > .kvt-progress");
    if (!bar) {
      bar = document.createElement("div");
      bar.className = "kvt-progress";
      const fill = document.createElement("div");
      fill.className = "kvt-progress-fill";
      bar.appendChild(fill);
      container.appendChild(bar);
    }
    const fill = bar.querySelector(".kvt-progress-fill");
    setStyleIf(fill, "width", `${Math.round(ratio * 100)}%`);

    let noteIcon = container.querySelector(":scope > .kvt-note-icon");
    if (entry.note) {
      if (!noteIcon) {
        noteIcon = document.createElement("div");
        noteIcon.className = "kvt-note-icon";
        noteIcon.textContent = "📝";
        container.appendChild(noteIcon);
      }
      setAttrIf(noteIcon, "data-note", entry.note);
      setAttrIf(noteIcon, "title", entry.note);
    } else if (noteIcon) {
      noteIcon.remove();
    }

    if (!completed && entry.position > K.MIN_SAVE_SECONDS) {
      try {
        const resumeUrl = K.buildResumeUrl(
          entry.streamer,
          entry.vodId,
          entry.position,
        );
        const u = new URL(resumeUrl);
        const newHref = u.pathname + u.search;
        if (anchor.getAttribute("href") !== newHref) {
          anchor.dataset.kvtOriginal = anchor.getAttribute("href") || "";
          anchor.setAttribute("href", newHref);
        }
      } catch {}
    }
  }

  function clearDecoration(container, anchor) {
    if (!container) return;
    container.classList.remove("kvt-marked", "kvt-completed", "kvt-inprogress");
    container.querySelector(":scope > .kvt-badge")?.remove();
    container.querySelector(":scope > .kvt-progress")?.remove();
    container.querySelector(":scope > .kvt-note-icon")?.remove();
    if (anchor && anchor.dataset.kvtOriginal) {
      anchor.setAttribute("href", anchor.dataset.kvtOriginal);
      delete anchor.dataset.kvtOriginal;
    }
  }

  function scheduleDecorate() {
    if (decorateTimer) return;
    decorateTimer = setTimeout(() => {
      decorateTimer = null;
      decorate();
    }, 200);
  }

  async function activate() {
    if (isActive) return;
    isActive = true;
    log("activating on", location.href);
    await reloadHistory();
    decorate();

    if (!mo) {
      mo = new MutationObserver(scheduleDecorate);
      mo.observe(document.body, { childList: true, subtree: true });
    }

    // Zkus znovu po pár prodlevách — Kick může thumbnaily renderovat postupně.
    [500, 1200, 2500, 5000].forEach((ms) => setTimeout(scheduleDecorate, ms));
  }

  function deactivate() {
    if (!isActive) return;
    isActive = false;
    log("deactivating");
    if (mo) {
      mo.disconnect();
      mo = null;
    }
    // Necháme existující dekorace na stránce — po SPA nav se DOM odstraní sám.
  }

  function watchRoute() {
    if (onListPage()) activate();
    else deactivate();

    setInterval(() => {
      if (location.href !== lastHref) {
        lastHref = location.href;
        if (onListPage()) {
          deactivate();
          activate();
        } else {
          deactivate();
        }
      }
    }, 500);
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[K.STORAGE_KEY]) {
      history = changes[K.STORAGE_KEY].newValue || {};
      if (isActive) scheduleDecorate();
    }
  });

  window.addEventListener("focus", async () => {
    if (isActive) {
      await reloadHistory();
      scheduleDecorate();
    }
  });

  watchRoute();
})();
