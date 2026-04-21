const K = window.KVT;

const listEl = document.getElementById("list");
const countEl = document.getElementById("count");
const searchEl = document.getElementById("search");
const hideCompletedEl = document.getElementById("hide-completed");
const clearAllBtn = document.getElementById("clear-all");

let history = {};

async function refresh() {
  history = await K.loadHistory();
  render();
}

function render() {
  const q = (searchEl.value || "").trim().toLowerCase();
  const hideCompleted = hideCompletedEl.checked;

  const entries = Object.values(history)
    .filter((e) => {
      if (hideCompleted && K.isCompleted(e)) return false;
      if (!q) return true;
      return (
        (e.title || "").toLowerCase().includes(q) ||
        (e.streamer || "").toLowerCase().includes(q)
      );
    })
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  listEl.innerHTML = "";

  if (entries.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent =
      Object.keys(history).length === 0
        ? "Zatím žádný sledovaný VOD. Pusť si záznam na kick.com a vrať se sem."
        : "Nic neodpovídá filtru.";
    listEl.appendChild(empty);
  } else {
    entries.forEach((e) => listEl.appendChild(renderItem(e)));
  }

  countEl.textContent = `${Object.keys(history).length} záznamů`;
}

function renderItem(entry) {
  const completed = K.isCompleted(entry);
  const ratio = K.progressRatio(entry);

  const item = document.createElement("div");
  item.className = "item" + (completed ? " completed" : "");
  item.title = entry.title || entry.vodId;

  const title = document.createElement("div");
  title.className = "title";
  title.textContent = entry.title || `VOD ${entry.vodId.slice(0, 8)}`;

  const meta = document.createElement("div");
  meta.className = "meta";
  const streamer = document.createElement("span");
  streamer.className = "streamer";
  streamer.textContent = entry.streamer;
  meta.appendChild(streamer);

  const pos = document.createElement("span");
  pos.textContent = completed
    ? "Dokoukáno"
    : `${K.formatTime(entry.position)}${
        entry.duration ? ` / ${K.formatTime(entry.duration)}` : ""
      }`;
  meta.appendChild(pos);

  if (entry.duration) {
    const pct = document.createElement("span");
    pct.textContent = `${Math.round(ratio * 100)}%`;
    meta.appendChild(pct);
  }

  const actions = document.createElement("div");
  actions.className = "actions";
  const badge = document.createElement("span");
  badge.className = "badge";
  badge.textContent = completed ? "✓" : "▶";
  actions.appendChild(badge);

  const removeBtn = document.createElement("button");
  removeBtn.className = "remove-btn";
  removeBtn.textContent = "×";
  removeBtn.title = "Odstranit z historie";
  removeBtn.addEventListener("click", async (ev) => {
    ev.stopPropagation();
    await K.removeEntry(entry.key);
    await refresh();
  });
  actions.appendChild(removeBtn);

  const progress = document.createElement("div");
  progress.className = "progress";
  const fill = document.createElement("div");
  fill.className = "progress-fill";
  fill.style.width = `${Math.round(ratio * 100)}%`;
  progress.appendChild(fill);

  item.appendChild(title);
  item.appendChild(actions);
  item.appendChild(meta);
  item.appendChild(progress);

  item.addEventListener("click", () => {
    const url = completed
      ? K.buildResumeUrl(entry.streamer, entry.vodId, 0)
      : K.buildResumeUrl(entry.streamer, entry.vodId, entry.position);
    chrome.tabs.create({ url });
    window.close();
  });

  return item;
}

searchEl.addEventListener("input", render);
hideCompletedEl.addEventListener("change", render);

clearAllBtn.addEventListener("click", async () => {
  if (!confirm("Opravdu smazat celou historii sledování?")) return;
  await K.clearAll();
  await refresh();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[K.STORAGE_KEY]) {
    history = changes[K.STORAGE_KEY].newValue || {};
    render();
  }
});

refresh();
