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

  // Najde wrapper PŘÍMO kolem thumbnail <img> (ne kolem titulku / avatara).
  // Strategie: vyber největší <img> uvnitř anchor + okolí, který má video
  // aspect ratio (~16:9), a vrať jeho bezprostřední obal.
  function findThumbContainer(anchor) {
    // 1. Sbírej všechny <img> uvnitř anchoru i v sourozencích anchoru.
    const candidates = new Set();
    anchor.querySelectorAll("img").forEach((i) => candidates.add(i));
    // Pokud anchor obaluje jen titulek, koukneme i na sousední anchor v kartě.
    const parent = anchor.parentElement;
    if (parent) {
      parent.querySelectorAll("img").forEach((i) => candidates.add(i));
      const grand = parent.parentElement;
      if (grand) grand.querySelectorAll("img").forEach((i) => candidates.add(i));
    }

    let bestImg = null;
    let bestArea = 0;
    candidates.forEach((img) => {
      const rect = img.getBoundingClientRect();
      if (rect.width < 140 || rect.height < 70) return;
      const ratio = rect.width / rect.height;
      // Video thumbnaily mají poměr kolem 16:9 (1.78). Povolíme 1.3 – 2.2.
      if (ratio < 1.3 || ratio > 2.3) return;
      const area = rect.width * rect.height;
      if (area > bestArea) {
        bestImg = img;
        bestArea = area;
      }
    });

    if (!bestImg) return null;

    // 2. Najdi nejtěsnější wrapper kolem toho obrázku (ne celou kartu).
    //    Zpravidla je to <picture> nebo <div> s overflow/aspect ratio.
    let wrapper = bestImg.parentElement;
    // Pokud je parent <picture>, vezmi jeho parent (obvykle div s poměrem stran).
    if (wrapper && wrapper.tagName.toLowerCase() === "picture") {
      wrapper = wrapper.parentElement || wrapper;
    }
    if (!wrapper) return bestImg;

    // Ověř, že wrapper má podobnou velikost jako img (jinak jsme šli moc vysoko).
    const wr = wrapper.getBoundingClientRect();
    const ir = bestImg.getBoundingClientRect();
    if (wr.height > ir.height * 1.6) {
      // Wrapper je moc velký — použij přímého rodiče obrázku.
      wrapper = bestImg.parentElement || bestImg;
    }
    return wrapper;
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

      // Projdi anchory a najdi jeden s odpovídajícím video thumbnailem.
      let container = null;
      for (const a of anchorList) {
        const c = findThumbContainer(a);
        if (c) {
          container = c;
          break;
        }
      }

      if (!container) return;

      if (!entry) {
        clearDecoration(container, anchorList[0]);
        return;
      }

      applyDecoration(container, anchorList[0], entry);
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
    badge.textContent = completed ? "✓" : `${Math.round(ratio * 100)}%`;
    badge.title = completed
      ? "Dokoukáno"
      : `${K.formatTime(entry.position)} / ${K.formatTime(entry.duration)}`;

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
