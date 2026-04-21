// Běží na stránce konkrétního VOD: https://kick.com/{streamer}/videos/{vodId}
// Najde <video>, sleduje pozici, ukládá do storage a při načtení stránky
// obnoví přehrávání tam, kde uživatel skončil.

(function () {
  const K = window.KVT;
  const SAVE_INTERVAL_MS = 5000;

  let currentVideo = null;
  let lastVod = null;
  let saveTimer = null;
  let resumedFor = null; // klíč VODu, u kterého už jsme provedli resume
  let titleObserver = null;

  function log(...args) {
    // odkomentuj pro ladění
    // console.log("[KVT]", ...args);
  }

  function currentVod() {
    return K.parseVodUrl(location.href);
  }

  function getTitle() {
    // Kick stránky VOD mívají titulek v <h1> nebo v document.title
    const h1 = document.querySelector("h1");
    if (h1 && h1.textContent.trim()) return h1.textContent.trim();
    return (document.title || "").replace(/ - Kick$/i, "").trim();
  }

  function attachToVideo(video) {
    if (!video || video === currentVideo) return;
    currentVideo = video;
    log("attached to <video>", video);
    ensureNoteButton();

    const tryResume = async () => {
      const vod = currentVod();
      if (!vod) return;
      if (resumedFor === vod.key) return;

      const hist = await K.loadHistory();
      const entry = hist[vod.key];

      // Pokud URL obsahuje explicitní ?t=, respektujeme ji.
      if (vod.t > 0) {
        resumedFor = vod.key;
        return;
      }

      if (entry && entry.position > K.MIN_SAVE_SECONDS && !K.isCompleted(entry)) {
        try {
          // Nastavíme pozici jen pokud je video připravené.
          if (video.readyState >= 1 && isFinite(video.duration) && video.duration > 0) {
            const target = Math.min(entry.position, video.duration - 5);
            if (Math.abs(video.currentTime - target) > 2) {
              video.currentTime = target;
              log("resumed to", target);
            }
            resumedFor = vod.key;
            showToast(`Obnoveno od ${K.formatTime(target)}`);
          }
        } catch (e) {
          log("resume failed", e);
        }
      } else {
        resumedFor = vod.key;
      }
    };

    const persist = async (opts = {}) => {
      const vod = currentVod();
      if (!vod) return;
      const pos = video.currentTime || 0;
      const dur = isFinite(video.duration) ? video.duration : 0;
      if (pos < K.MIN_SAVE_SECONDS && !opts.force) return;

      const title = getTitle();
      const entry = {
        key: vod.key,
        streamer: vod.streamer,
        vodId: vod.vodId,
        position: pos,
        duration: dur,
        title,
        url: K.buildResumeUrl(vod.streamer, vod.vodId, pos),
      };
      if (dur > 0 && dur - pos <= K.COMPLETED_TAIL_SECONDS) {
        entry.completed = true;
      }
      await K.saveEntry(entry);
      lastVod = vod.key;
    };

    video.addEventListener("loadedmetadata", tryResume);
    video.addEventListener("canplay", tryResume);
    video.addEventListener("play", tryResume);
    video.addEventListener("pause", () => persist({ force: true }));
    video.addEventListener("seeked", () => persist({ force: true }));
    video.addEventListener("ended", async () => {
      const vod = currentVod();
      if (!vod) return;
      await K.saveEntry({
        key: vod.key,
        streamer: vod.streamer,
        vodId: vod.vodId,
        position: video.duration || 0,
        duration: video.duration || 0,
        title: getTitle(),
        completed: true,
        url: K.buildResumeUrl(vod.streamer, vod.vodId, 0),
      });
    });

    if (saveTimer) clearInterval(saveTimer);
    saveTimer = setInterval(() => {
      if (!video.paused && !video.ended) persist();
    }, SAVE_INTERVAL_MS);

    // Pokus o okamžité obnovení, pokud už metadata jsou.
    tryResume();
  }

  function findVideo() {
    // Kick používá standardní <video>, někdy uvnitř shadow DOM playeru,
    // tak hledáme všechny na stránce.
    return document.querySelector("video");
  }

  function observeDom() {
    const mo = new MutationObserver(() => {
      const v = findVideo();
      if (v && v !== currentVideo) attachToVideo(v);
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });

    // Při změně URL (SPA navigace) resetujeme resumedFor.
    let lastHref = location.href;
    setInterval(() => {
      if (location.href !== lastHref) {
        lastHref = location.href;
        resumedFor = null;
        // sundat overlay komentáře pokud je otevřený
        document.getElementById("kvt-note-overlay")?.remove();
        const v = findVideo();
        if (v) attachToVideo(v);
        refreshNoteBadge();
      }
    }, 1000);

    // Aktualizujeme badge tlačítka po externí změně (třeba z popupu).
    if (chrome?.storage?.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === "local" && changes[K.STORAGE_KEY]) {
          refreshNoteBadge();
        }
      });
    }
  }

  async function openNoteEditor() {
    const vod = currentVod();
    if (!vod) return;
    const existing = document.getElementById("kvt-note-overlay");
    if (existing) {
      existing.remove();
      return;
    }

    const hist = await K.loadHistory();
    const entry = hist[vod.key] || {};
    const current = entry.note || "";

    const overlay = document.createElement("div");
    overlay.id = "kvt-note-overlay";
    Object.assign(overlay.style, {
      position: "fixed",
      bottom: "80px",
      right: "24px",
      width: "340px",
      background: "rgba(12, 12, 12, 0.97)",
      color: "#e8e8e8",
      border: "1px solid #53fc18",
      borderRadius: "10px",
      padding: "12px",
      zIndex: "2147483646",
      fontFamily: "system-ui, sans-serif",
      fontSize: "13px",
      boxShadow: "0 8px 28px rgba(0,0,0,0.5)",
      display: "flex",
      flexDirection: "column",
      gap: "8px",
    });

    const title = document.createElement("div");
    title.textContent = "Komentář k záznamu";
    Object.assign(title.style, {
      color: "#53fc18",
      fontWeight: "700",
      fontSize: "12px",
      letterSpacing: "0.03em",
    });

    const ta = document.createElement("textarea");
    ta.value = current;
    ta.placeholder = "Tvůj komentář…";
    Object.assign(ta.style, {
      width: "100%",
      minHeight: "80px",
      maxHeight: "200px",
      background: "#161616",
      color: "#e8e8e8",
      border: "1px solid #242424",
      borderRadius: "6px",
      padding: "8px 10px",
      fontFamily: "inherit",
      fontSize: "13px",
      resize: "vertical",
      outline: "none",
      lineHeight: "1.4",
      boxSizing: "border-box",
    });
    ta.addEventListener("focus", () => (ta.style.borderColor = "#53fc18"));
    ta.addEventListener("blur", () => (ta.style.borderColor = "#242424"));

    const hint = document.createElement("div");
    hint.textContent = "Ctrl+Enter uloží • Esc zavře";
    Object.assign(hint.style, {
      color: "#8a8a8a",
      fontSize: "11px",
      fontStyle: "italic",
    });

    const btnRow = document.createElement("div");
    Object.assign(btnRow.style, { display: "flex", gap: "6px" });

    const mkBtn = (text, primary) => {
      const b = document.createElement("button");
      b.textContent = text;
      Object.assign(b.style, {
        padding: "6px 12px",
        border: "1px solid " + (primary ? "#53fc18" : "#242424"),
        background: primary ? "#53fc18" : "transparent",
        color: primary ? "#0a0a0a" : "#e8e8e8",
        borderRadius: "6px",
        fontFamily: "inherit",
        fontSize: "12px",
        fontWeight: primary ? "700" : "500",
        cursor: "pointer",
      });
      return b;
    };

    const saveBtn = mkBtn("Uložit", true);
    const cancelBtn = mkBtn("Zavřít", false);

    const save = async () => {
      const currentTitle = getTitle();
      await K.saveNote(vod.key, ta.value, {
        streamer: vod.streamer,
        vodId: vod.vodId,
        title: currentTitle,
      });
      overlay.remove();
      showToast(ta.value.trim() ? "Komentář uložen" : "Komentář smazán");
    };

    saveBtn.addEventListener("click", save);
    cancelBtn.addEventListener("click", () => overlay.remove());

    ta.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) {
        ev.preventDefault();
        save();
      } else if (ev.key === "Escape") {
        ev.preventDefault();
        overlay.remove();
      }
    });

    btnRow.appendChild(saveBtn);
    btnRow.appendChild(cancelBtn);

    overlay.appendChild(title);
    overlay.appendChild(ta);
    overlay.appendChild(btnRow);
    overlay.appendChild(hint);

    document.body.appendChild(overlay);
    setTimeout(() => ta.focus(), 0);
  }

  function ensureNoteButton() {
    if (document.getElementById("kvt-note-btn")) return;
    const btn = document.createElement("button");
    btn.id = "kvt-note-btn";
    btn.type = "button";
    btn.textContent = "📝";
    btn.title = "Napsat komentář k tomuto záznamu";
    Object.assign(btn.style, {
      position: "fixed",
      bottom: "24px",
      right: "24px",
      width: "44px",
      height: "44px",
      borderRadius: "50%",
      background: "rgba(12, 12, 12, 0.92)",
      color: "#53fc18",
      border: "1px solid #53fc18",
      cursor: "pointer",
      fontSize: "20px",
      zIndex: "2147483645",
      boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "0",
      transition: "transform 0.1s ease, filter 0.2s ease",
    });
    btn.addEventListener("mouseenter", () => {
      btn.style.transform = "scale(1.08)";
      btn.style.filter = "drop-shadow(0 0 6px rgba(83, 252, 24, 0.6))";
    });
    btn.addEventListener("mouseleave", () => {
      btn.style.transform = "";
      btn.style.filter = "";
    });
    btn.addEventListener("click", openNoteEditor);
    document.body.appendChild(btn);

    refreshNoteBadge();
  }

  async function refreshNoteBadge() {
    const btn = document.getElementById("kvt-note-btn");
    if (!btn) return;
    const vod = currentVod();
    if (!vod) return;
    const hist = await K.loadHistory();
    const entry = hist[vod.key];
    if (entry && entry.note) {
      btn.style.background = "#53fc18";
      btn.style.color = "#0a0a0a";
      btn.title = "Upravit komentář: " + entry.note;
    } else {
      btn.style.background = "rgba(12, 12, 12, 0.92)";
      btn.style.color = "#53fc18";
      btn.title = "Napsat komentář k tomuto záznamu";
    }
  }

  function showToast(text) {
    const existing = document.getElementById("kvt-toast");
    if (existing) existing.remove();
    const el = document.createElement("div");
    el.id = "kvt-toast";
    el.textContent = text;
    Object.assign(el.style, {
      position: "fixed",
      bottom: "24px",
      right: "24px",
      background: "rgba(20,20,20,0.92)",
      color: "#53fc18",
      padding: "10px 14px",
      borderRadius: "8px",
      fontFamily: "system-ui, sans-serif",
      fontSize: "14px",
      fontWeight: "600",
      zIndex: "2147483647",
      border: "1px solid #53fc18",
      boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
      pointerEvents: "none",
      transition: "opacity 0.4s",
    });
    document.body.appendChild(el);
    setTimeout(() => {
      el.style.opacity = "0";
      setTimeout(() => el.remove(), 500);
    }, 2500);
  }

  // Před opuštěním stránky ještě jednou uložíme.
  window.addEventListener("beforeunload", () => {
    if (currentVideo) {
      const vod = currentVod();
      if (vod) {
        const hist = JSON.parse(localStorage.getItem("kvt_pending") || "{}");
        hist[vod.key] = {
          key: vod.key,
          streamer: vod.streamer,
          vodId: vod.vodId,
          position: currentVideo.currentTime || 0,
          duration: currentVideo.duration || 0,
          title: getTitle(),
          url: K.buildResumeUrl(vod.streamer, vod.vodId, currentVideo.currentTime || 0),
          updatedAt: Date.now(),
        };
        // Synchronně uložíme přes storage (best effort — MV3 service worker umí zpracovat).
        try {
          chrome.storage.local.get(K.STORAGE_KEY, (res) => {
            const all = res[K.STORAGE_KEY] || {};
            all[vod.key] = { ...(all[vod.key] || {}), ...hist[vod.key] };
            chrome.storage.local.set({ [K.STORAGE_KEY]: all });
          });
        } catch {}
      }
    }
  });

  observeDom();
  const v = findVideo();
  if (v) attachToVideo(v);
})();
