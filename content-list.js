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

  // Najde vhodný vizuální wrapper thumbnailu kolem odkazu na VOD.
  // Hledá nejbližší container s <img> a rozumnou velikostí.
  function findThumbContainer(anchor) {
    // Zkus samotný anchor pokud obsahuje obrázek a je dost velký.
    let best = null;
    let bestArea = 0;
    let node = anchor;
    for (let i = 0; i < 8 && node && node !== document.body; i++) {
      if (node.querySelector && node.querySelector("img")) {
        const rect = node.getBoundingClientRect();
        const area = rect.width * rect.height;
        // Preferujeme container, který je dostatečně velký (thumbnail),
        // ale ne celá stránka. Rozumný rozsah: 120px+ šířka, ne více než 600.
        if (rect.width >= 120 && rect.width <= 700 && rect.height >= 70) {
          if (area > bestArea) {
            best = node;
            bestArea = area;
          }
        }
      }
      node = node.parentElement;
    }
    return best || anchor;
  }

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

    groups.forEach((anchorList, key) => {
      const entry = history[key];

      // Vyber anchor, který má nejlepší thumbnail container (obsahuje <img>).
      let bestAnchor = null;
      let bestContainer = null;
      let bestArea = 0;
      anchorList.forEach((a) => {
        const c = findThumbContainer(a);
        if (!c) return;
        const hasImg = !!c.querySelector("img");
        if (!hasImg) return;
        const rect = c.getBoundingClientRect();
        const area = rect.width * rect.height;
        if (area > bestArea) {
          bestAnchor = a;
          bestContainer = c;
          bestArea = area;
        }
      });

      if (!bestAnchor || !bestContainer) {
        // Není thumbnail na stránce (třeba jen text linky).
        return;
      }

      if (!entry) {
        clearDecoration(bestContainer, bestAnchor);
        return;
      }

      applyDecoration(bestContainer, bestAnchor, entry);
    });
  }

  function applyDecoration(container, anchor, entry) {
    const completed = K.isCompleted(entry);
    const ratio = K.progressRatio(entry);

    container.classList.add("kvt-marked");
    container.classList.toggle("kvt-completed", completed);
    container.classList.toggle("kvt-inprogress", !completed);

    const computed = getComputedStyle(container);
    if (computed.position === "static") {
      container.style.position = "relative";
    }

    let badge = container.querySelector(":scope > .kvt-badge");
    if (!badge) {
      badge = document.createElement("div");
      badge.className = "kvt-badge";
      container.appendChild(badge);
    }
    badge.textContent = completed
      ? "✓ Dokoukáno"
      : `▶ ${Math.round(ratio * 100)}% • ${K.formatTime(entry.position)}`;

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
    fill.style.width = `${Math.round(ratio * 100)}%`;

    let noteIcon = container.querySelector(":scope > .kvt-note-icon");
    if (entry.note) {
      if (!noteIcon) {
        noteIcon = document.createElement("div");
        noteIcon.className = "kvt-note-icon";
        noteIcon.textContent = "📝";
        container.appendChild(noteIcon);
      }
      noteIcon.setAttribute("data-note", entry.note);
      noteIcon.title = entry.note;
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
        const newHref =
          new URL(resumeUrl).pathname + new URL(resumeUrl).search;
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
