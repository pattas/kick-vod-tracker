// Sdílená logika pro Kick VOD Tracker.
// Běží v content scriptu i v popup prostředí.

const KVT = {
  STORAGE_KEY: "kvt_watch_history",
  // VOD se považuje za "dokoukaný", když zbývá méně než tento počet sekund
  // nebo je pokrok vyšší než COMPLETED_RATIO.
  COMPLETED_TAIL_SECONDS: 30,
  COMPLETED_RATIO: 0.95,
  // Minimální doba sledování, aby se VOD vůbec uložil (anti-spam).
  MIN_SAVE_SECONDS: 5,

  // Parsování URL typu /{streamer}/videos/{vodId}
  parseVodUrl(href) {
    try {
      const url = new URL(href, location.origin);
      const m = url.pathname.match(/^\/([^\/]+)\/videos\/([0-9a-fA-F-]{8,})/);
      if (!m) return null;
      const t = url.searchParams.get("t");
      return {
        streamer: m[1],
        vodId: m[2],
        t: t ? Math.max(0, parseInt(t, 10) || 0) : 0,
        key: `${m[1]}/${m[2]}`,
      };
    } catch {
      return null;
    }
  },

  // Seznam VOD na stránce /{streamer}/videos — detekce jen streamer segmentu.
  parseListUrl(href) {
    try {
      const url = new URL(href, location.origin);
      const m = url.pathname.match(/^\/([^\/]+)\/videos\/?$/);
      if (!m) return null;
      return { streamer: m[1] };
    } catch {
      return null;
    }
  },

  async loadHistory() {
    const res = await chrome.storage.local.get(this.STORAGE_KEY);
    return res[this.STORAGE_KEY] || {};
  },

  async saveEntry(entry) {
    const hist = await this.loadHistory();
    const prev = hist[entry.key] || {};
    hist[entry.key] = { ...prev, ...entry, updatedAt: Date.now() };
    await chrome.storage.local.set({ [this.STORAGE_KEY]: hist });
    return hist[entry.key];
  },

  async removeEntry(key) {
    const hist = await this.loadHistory();
    delete hist[key];
    await chrome.storage.local.set({ [this.STORAGE_KEY]: hist });
  },

  async saveNote(key, note, fallbackMeta = null) {
    const hist = await this.loadHistory();
    if (!hist[key]) {
      if (!fallbackMeta) return null;
      hist[key] = {
        key,
        streamer: fallbackMeta.streamer,
        vodId: fallbackMeta.vodId,
        title: fallbackMeta.title || "",
        position: 0,
        duration: 0,
        url: this.buildResumeUrl(fallbackMeta.streamer, fallbackMeta.vodId, 0),
        updatedAt: Date.now(),
      };
    }
    const trimmed = (note || "").trim();
    if (trimmed) {
      hist[key].note = trimmed;
      hist[key].noteUpdatedAt = Date.now();
    } else {
      delete hist[key].note;
      delete hist[key].noteUpdatedAt;
    }
    await chrome.storage.local.set({ [this.STORAGE_KEY]: hist });
    return hist[key];
  },

  async clearAll() {
    await chrome.storage.local.remove(this.STORAGE_KEY);
  },

  isCompleted(entry) {
    if (!entry) return false;
    if (entry.completed === true) return true;
    if (!entry.duration || entry.duration <= 0) return false;
    const remaining = entry.duration - (entry.position || 0);
    if (remaining <= this.COMPLETED_TAIL_SECONDS) return true;
    if ((entry.position || 0) / entry.duration >= this.COMPLETED_RATIO) return true;
    return false;
  },

  progressRatio(entry) {
    if (!entry || !entry.duration) return 0;
    return Math.min(1, Math.max(0, (entry.position || 0) / entry.duration));
  },

  formatTime(seconds) {
    const s = Math.max(0, Math.floor(seconds || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const pad = (n) => n.toString().padStart(2, "0");
    return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
  },

  buildResumeUrl(streamer, vodId, position) {
    const t = Math.max(0, Math.floor(position || 0));
    return `https://kick.com/${streamer}/videos/${vodId}${t > 0 ? `?t=${t}` : ""}`;
  },
};

if (typeof module !== "undefined") module.exports = KVT;
if (typeof window !== "undefined") window.KVT = KVT;
