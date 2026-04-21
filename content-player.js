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
        const v = findVideo();
        if (v) attachToVideo(v);
      }
    }, 1000);
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
