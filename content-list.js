// Běží na stránce seznamu záznamů streamera: https://kick.com/{streamer}/videos
// U každého thumbnailu VODu, který je v historii, přidá barevný rámeček
// a progress bar podle toho, kolik z VODu už uživatel viděl.

(function () {
  const K = window.KVT;
  let history = {};
  let decorateTimer = null;

  async function reloadHistory() {
    history = await K.loadHistory();
  }

  function decorate() {
    // Najdeme všechny odkazy na VOD záznamy na stránce.
    const anchors = document.querySelectorAll('a[href*="/videos/"]');
    anchors.forEach((a) => {
      const vod = K.parseVodUrl(a.href);
      if (!vod) return;
      const entry = history[vod.key];
      if (!entry) {
        // Když záznam zmizel z historie, sundej zvýraznění.
        const wrap = a.closest(".kvt-wrap");
        if (wrap) clearDecoration(a);
        return;
      }
      applyDecoration(a, entry);
    });
  }

  function findThumbContainer(anchor) {
    // Chceme container, který obaluje náhled (obrázek + délka).
    // Fallback: samotný anchor, pokud je dostatečně velký.
    const imgWrap = anchor.querySelector("img")?.closest("div");
    return imgWrap || anchor;
  }

  function applyDecoration(anchor, entry) {
    const container = findThumbContainer(anchor);
    if (!container) return;

    const completed = K.isCompleted(entry);
    const ratio = K.progressRatio(entry);

    container.classList.add("kvt-marked");
    container.classList.toggle("kvt-completed", completed);
    container.classList.toggle("kvt-inprogress", !completed);
    container.style.position = container.style.position || "relative";

    // Badge
    let badge = container.querySelector(":scope > .kvt-badge");
    if (!badge) {
      badge = document.createElement("div");
      badge.className = "kvt-badge";
      container.appendChild(badge);
    }
    badge.textContent = completed
      ? "✓ Dokoukáno"
      : `▶ ${Math.round(ratio * 100)}% • ${K.formatTime(entry.position)}`;

    // Progress bar
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

    // Upravíme href, aby klik obnovil přehrávání na poslední pozici.
    if (!completed && entry.position > K.MIN_SAVE_SECONDS) {
      const resumeUrl = K.buildResumeUrl(entry.streamer, entry.vodId, entry.position);
      if (anchor.getAttribute("href") !== new URL(resumeUrl).pathname + new URL(resumeUrl).search) {
        anchor.dataset.kvtOriginal = anchor.getAttribute("href");
        anchor.setAttribute("href", new URL(resumeUrl).pathname + new URL(resumeUrl).search);
      }
    }
  }

  function clearDecoration(anchor) {
    const container = findThumbContainer(anchor);
    if (!container) return;
    container.classList.remove("kvt-marked", "kvt-completed", "kvt-inprogress");
    container.querySelector(":scope > .kvt-badge")?.remove();
    container.querySelector(":scope > .kvt-progress")?.remove();
    if (anchor.dataset.kvtOriginal) {
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

  async function init() {
    await reloadHistory();
    decorate();

    // Přehlížíme změny DOMu — Kick načítá seznam postupně / po scrollu.
    const mo = new MutationObserver(scheduleDecorate);
    mo.observe(document.body, { childList: true, subtree: true });

    // Po změnách historie (z jiné záložky) překreslíme.
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes[K.STORAGE_KEY]) {
        history = changes[K.STORAGE_KEY].newValue || {};
        decorate();
      }
    });

    // Když se uživatel vrátí na tab, osvěžíme.
    window.addEventListener("focus", async () => {
      await reloadHistory();
      decorate();
    });
  }

  init();
})();
