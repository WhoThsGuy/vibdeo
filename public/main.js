let selectedFile = null;
let isOptimizing = false;

// ── Directory ────────────────────────────────────────────────────────────────

document.getElementById("dirInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") loadDir();
});

async function loadDir() {
  const dir = document.getElementById("dirInput").value.trim();
  if (!dir) return;
  try {
    const res = await fetch(`/api/files?dir=${encodeURIComponent(dir)}`);
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || "Error");
      return;
    }
    renderList(data.files);
  } catch {
    alert("Could not connect to server");
  }
}

function renderList(files) {
  const list = document.getElementById("fileList");
  const empty = document.getElementById("listEmpty");
  const count = document.getElementById("fileCount");

  list.querySelectorAll(".file-item").forEach((el) => el.remove());
  count.textContent = files.length;
  empty.style.display = files.length ? "none" : "";

  files.forEach((file) => {
    const item = document.createElement("div");
    item.className = "file-item";
    item.dataset.path = file.path;
    item.innerHTML = `
      <span class="ficon">🎞</span>
      <div class="fmeta">
        <div class="fname" title="${esc(file.name)}">${esc(file.name)}</div>
        <div class="fsize">${fmtSize(file.size)}</div>
      </div>
      <div class="fdot ${file.isOptimized ? "done" : ""}" title="${file.isOptimized ? "Optimized" : ""}"></div>`;
    item.addEventListener("click", () => selectFile(file));
    list.appendChild(item);
  });
}

// ── File selection ───────────────────────────────────────────────────────────

async function selectFile(file) {
  selectedFile = file;

  document
    .querySelectorAll(".file-item")
    .forEach((el) =>
      el.classList.toggle("selected", el.dataset.path === file.path),
    );

  const video = document.getElementById("origVideo");
  video.src = `/api/serve?path=${encodeURIComponent(file.path)}`;
  video.classList.add("visible");
  document.getElementById("origEmpty").classList.add("hidden");
  const ext = file.name.split(".").pop()?.toUpperCase() ?? "";
  document.getElementById("origSize").textContent = ext
    ? `${ext} · ${fmtSize(file.size)}`
    : fmtSize(file.size);
  document.getElementById("origName").textContent = file.name;

  document.getElementById("optBtn").disabled = isOptimizing;
  resetOptPanel();
  await checkExistingOptimized(file.path);
}

async function checkExistingOptimized(filePath) {
  try {
    const res = await fetch(
      `/api/optimized-info?path=${encodeURIComponent(filePath)}`,
    );
    if (!res.ok) return;
    const data = await res.json();
    if (data.mp4 || data.webm) showResult(data);
  } catch {}
}

// ── Reset optimized panel ────────────────────────────────────────────────────

function resetOptPanel() {
  const video = document.getElementById("optVideo");
  video.src = "";
  video.classList.remove("visible");
  document.getElementById("optEmpty").classList.remove("hidden");
  document.getElementById("optEmptyText").textContent = "Click Optimize";
  document.getElementById("optSize").textContent = "";
  document.getElementById("progWrap").classList.remove("visible");
  document.getElementById("resultLinks").classList.remove("visible");
  document.getElementById("errMsg").classList.remove("visible");
}

// ── Show result ──────────────────────────────────────────────────────────────

function showResult(results) {
  const video = document.getElementById("optVideo");
  const empty = document.getElementById("optEmpty");
  const links = document.getElementById("resultLinks");

  links.innerHTML = "";

  let firstLink = null;
  let firstPath = null;
  let firstLabel = null;

  if (results.mp4) {
    const l = mkLink("MP4", results.mp4);
    links.appendChild(l);
    if (!firstLink) { firstLink = l; firstPath = results.mp4; firstLabel = "MP4"; }
  }
  if (results.webm) {
    const l = mkLink("WebM", results.webm);
    links.appendChild(l);
    if (!firstLink) { firstLink = l; firstPath = results.webm; firstLabel = "WebM"; }
  }
  if (results.cover) links.appendChild(mkRevealLink("Cover", results.cover));
  links.classList.add("visible");

  if (firstPath) {
    video.src = `/api/serve?path=${encodeURIComponent(firstPath)}`;
    video.classList.add("visible");
    empty.classList.add("hidden");
    firstLink.classList.add("active");
    fetchSize(firstPath).then((s) => {
      if (s) document.getElementById("optSize").textContent = `${firstLabel} · ${fmtSize(s)}`;
    });
  }
}

function mkLink(label, filePath) {
  const el = document.createElement("span");
  el.className = "rlink";
  el.textContent = label;
  el.addEventListener("click", () => {
    document.querySelectorAll(".rlink").forEach((l) => l.classList.remove("active"));
    el.classList.add("active");
    document.getElementById("optVideo").src = `/api/serve?path=${encodeURIComponent(filePath)}`;
    document.getElementById("optSize").textContent = `${label} · …`;
    fetchSize(filePath).then((s) => {
      if (s) document.getElementById("optSize").textContent = `${label} · ${fmtSize(s)}`;
    });
  });
  return el;
}

function mkRevealLink(label, filePath) {
  const el = document.createElement("span");
  el.className = "rlink";
  el.textContent = label;
  el.title = "Reveal in Finder";
  el.addEventListener("click", () => {
    fetch(`/api/reveal?path=${encodeURIComponent(filePath)}`).catch(() => {});
  });
  return el;
}

async function fetchSize(filePath) {
  try {
    const res = await fetch(`/api/serve?path=${encodeURIComponent(filePath)}`, { method: "HEAD" });
    const cl = res.headers.get("content-length");
    return cl ? parseInt(cl) : null;
  } catch {
    return null;
  }
}

// ── Optimize ─────────────────────────────────────────────────────────────────

async function startOptimize() {
  if (!selectedFile || isOptimizing) return;

  isOptimizing = true;
  document.getElementById("optBtn").disabled = true;
  document.getElementById("errMsg").classList.remove("visible");
  document.getElementById("resultLinks").classList.remove("visible");

  const video = document.getElementById("optVideo");
  video.src = "";
  video.classList.remove("visible");
  document.getElementById("optEmpty").classList.remove("hidden");
  document.getElementById("optEmptyText").textContent = "Optimizing...";

  setProgress(0, "Preparing...");
  document.getElementById("progWrap").classList.add("visible");

  const settings = getSettings();

  try {
    const res = await fetch("/api/optimize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filePath: selectedFile.path, settings }),
    });
    const { jobId } = await res.json();

    const es = new EventSource(`/api/progress/${jobId}`);
    es.onmessage = (e) => {
      const d = JSON.parse(e.data);

      if (d.error) {
        showError(d.error);
        es.close();
        doneOptimize();
        return;
      }

      if (typeof d.progress === "number") setProgress(d.progress, d.step ?? "");

      if (d.done) {
        es.close();
        if (d.results) {
          setProgress(100, "Done!");
          setTimeout(() => {
            document.getElementById("progWrap").classList.remove("visible");
            showResult(d.results);
            markDone(selectedFile.path);
          }, 600);
        }
        doneOptimize();
      }
    };
    es.onerror = () => {
      es.close();
      showError("Connection lost");
      doneOptimize();
    };
  } catch {
    showError("Failed to start");
    doneOptimize();
  }
}

function doneOptimize() {
  isOptimizing = false;
  document.getElementById("optBtn").disabled = false;
}

function setProgress(pct, step) {
  document.getElementById("progFill").style.width = `${pct}%`;
  document.getElementById("progPct").textContent = `${pct}%`;
  document.getElementById("progStep").textContent = step;
}

function showError(msg) {
  const el = document.getElementById("errMsg");
  el.textContent = msg;
  el.classList.add("visible");
  document.getElementById("progWrap").classList.remove("visible");
  document.getElementById("optEmptyText").textContent = "Error";
}

function markDone(filePath) {
  document.querySelectorAll(".file-item").forEach((item) => {
    if (item.dataset.path === filePath) {
      const dot = item.querySelector(".fdot");
      if (dot) { dot.classList.add("done"); dot.title = "Optimized"; }
    }
  });
}

// ── Settings ─────────────────────────────────────────────────────────────────

function toggleSettings() {
  const body = document.getElementById("settingsBody");
  const arrow = document.getElementById("toggleArrow");
  body.classList.toggle("open");
  arrow.classList.toggle("open");
}

function getSettings() {
  const unit = document.getElementById("webmBitrateUnit").value;
  const val = parseInt(document.getElementById("webmBitrateVal").value) || 1;
  const webmBitrate = unit === "" ? "0" : `${val}${unit}`;
  return {
    genCover: document.getElementById("genCover").checked,
    genWebm: document.getElementById("genWebm").checked,
    genMp4: document.getElementById("genMp4").checked,
    removeAudio: document.getElementById("removeAudio").checked,
    mp4Crf: parseInt(document.getElementById("mp4Crf").value),
    mp4Preset: document.getElementById("mp4Preset").value,
    webmCrf: parseInt(document.getElementById("webmCrf").value),
    webmBitrate,
  };
}

function onBitrateUnitChange() {
  const unit = document.getElementById("webmBitrateUnit").value;
  document.getElementById("webmBitrateVal").disabled = unit === "";
}

document.getElementById("genMp4").addEventListener("change", (e) => {
  document.getElementById("sgMp4").style.opacity = e.target.checked ? "1" : ".3";
});
document.getElementById("genWebm").addEventListener("change", (e) => {
  document.getElementById("sgWebm").style.opacity = e.target.checked ? "1" : ".3";
});

// ── Drag & Drop ──────────────────────────────────────────────────────────────

const dropZone = document.getElementById("dropZone");
const fileInput = document.getElementById("fileInput");

dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("drag-over");
});
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("drag-over"));
dropZone.addEventListener("drop", async (e) => {
  e.preventDefault();
  dropZone.classList.remove("drag-over");
  const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("video/"));
  if (files.length) await uploadFiles(files);
});

fileInput.addEventListener("change", async () => {
  if (fileInput.files.length) await uploadFiles(Array.from(fileInput.files));
  fileInput.value = "";
});

async function uploadFiles(files) {
  const dir = document.getElementById("dirInput").value.trim();
  const query = dir ? `?dir=${encodeURIComponent(dir)}` : "";

  for (const file of files) {
    const form = new FormData();
    form.append("video", file);
    try {
      const res = await fetch(`/api/upload${query}`, { method: "POST", body: form });
      const data = await res.json();
      if (data.error) { alert(data.error); continue; }
      if (!dir) {
        document.getElementById("dirInput").value = data.path.slice(0, data.path.lastIndexOf("/"));
      }
      await loadDir();
    } catch {
      alert("Upload failed");
    }
  }
}

// ── Utils ────────────────────────────────────────────────────────────────────

function fmtSize(b) {
  if (b < 1024) return b + " B";
  if (b < 1048576) return (b / 1024).toFixed(1) + " KB";
  if (b < 1073741824) return (b / 1048576).toFixed(1) + " MB";
  return (b / 1073741824).toFixed(2) + " GB";
}

function esc(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Playback ─────────────────────────────────────────────────────────────────

const playBtn = document.getElementById("playBtn");
const scrubber = document.getElementById("scrubber");
const timeDisplay = document.getElementById("timeDisplay");

function fmtTime(s) {
  if (!s || isNaN(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60).toString().padStart(2, "0");
  return `${m}:${sec}`;
}

function getVideos() {
  return {
    orig: document.getElementById("origVideo"),
    opt: document.getElementById("optVideo"),
  };
}

function updateScrubber() {
  const { orig } = getVideos();
  if (!orig.duration) return;
  scrubber.value = orig.currentTime / orig.duration;
  timeDisplay.textContent = `${fmtTime(orig.currentTime)} / ${fmtTime(orig.duration)}`;
}

function updatePlayIcon() {
  const { orig } = getVideos();
  playBtn.textContent = orig.paused ? "▶" : "⏸";
}

const origVideo = document.getElementById("origVideo");

origVideo.addEventListener("loadedmetadata", () => {
  scrubber.disabled = false;
  playBtn.disabled = false;
  scrubber.value = 0;
  timeDisplay.textContent = `0:00 / ${fmtTime(origVideo.duration)}`;
});

origVideo.addEventListener("timeupdate", updateScrubber);
origVideo.addEventListener("play", updatePlayIcon);
origVideo.addEventListener("pause", updatePlayIcon);
origVideo.addEventListener("ended", () => {
  const { opt } = getVideos();
  opt.pause();
  updatePlayIcon();
});

playBtn.addEventListener("click", togglePlay);

document.addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
  if (e.code === "Space") { e.preventDefault(); togglePlay(); }
});

function togglePlay() {
  const { orig, opt } = getVideos();
  if (!orig.src) return;
  const hasOpt = opt.src && opt.readyState >= 2;
  if (orig.paused) {
    if (orig.ended) {
      orig.currentTime = 0;
      if (hasOpt) opt.currentTime = 0;
    } else if (hasOpt) {
      opt.currentTime = orig.currentTime;
    }
    if (hasOpt) opt.play();
    orig.play();
  } else {
    orig.pause();
    if (hasOpt) opt.pause();
  }
}

scrubber.addEventListener("input", () => {
  const { orig, opt } = getVideos();
  if (!orig.duration) return;
  const time = parseFloat(scrubber.value) * orig.duration;
  orig.currentTime = time;
  const hasOpt = opt.src && opt.readyState >= 2;
  if (hasOpt) opt.currentTime = time;
});

// ── Init ─────────────────────────────────────────────────────────────────────

toggleSettings();

(async () => {
  try {
    const res = await fetch("/api/config");
    const { uploadDir } = await res.json();
    document.getElementById("dirInput").value = uploadDir;
    await loadDir();
  } catch {}
})();
