import fs from "node:fs";
import path from "node:path";

const VK_TOKEN = process.env.VK_TOKEN;
const VK_API = "https://api.vk.com/method";
const V = "5.131";

// ВАЖНО: promrep = 234602001 (из ваших ссылок на видео)
// owner_id для сообщества в VK API всегда отрицательный
const GROUP_ID = 234602001;
const OWNER_ID = -GROUP_ID;

if (!VK_TOKEN) {
  console.error("❌ VK_TOKEN is missing. Add it to GitHub Secrets.");
  process.exit(1);
}

function out(p) {
  return path.join(process.cwd(), p);
}
function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}
function writeJSON(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

async function vk(method, params = {}) {
  const url = new URL(`${VK_API}/${method}`);
  url.searchParams.set("access_token", VK_TOKEN);
  url.searchParams.set("v", V);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

  const res = await fetch(url);
  const json = await res.json();
  if (json.error) throw new Error(`VK API error (${method}): ${json.error.error_msg}`);
  return json.response;
}

function pickThumb(images) {
  if (!Array.isArray(images) || images.length === 0) return "";
  const sorted = [...images].sort((a, b) => (b.width || 0) - (a.width || 0));
  return sorted[0]?.url || "";
}
function secToTime(sec) {
  const s = Number(sec || 0);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}
function isoDate(unix) {
  if (!unix) return "";
  return new Date(unix * 1000).toISOString().slice(0, 10);
}

async function fetchAllVideos() {
  const items = [];
  const countPerPage = 200;
  let offset = 0;

  while (true) {
    const r = await vk("video.get", {
      owner_id: OWNER_ID,
      count: countPerPage,
      offset
    });

    const batch = r.items || [];
    for (const v of batch) {
      items.push({
        id: `video${v.owner_id}_${v.id}`,
        type: "video",
        title: v.title || "",
        href: `https://vk.com/video${v.owner_id}_${v.id}`,
        thumb: pickThumb(v.image),
        duration: secToTime(v.duration),
        date: isoDate(v.date),
        views: v.views || 0
      });
    }

    offset += batch.length;
    if (batch.length < countPerPage) break;
  }

  return items;
}

// clips.get может быть недоступен для некоторых токенов — поэтому “safe”
async function fetchClipsSafe() {
  try {
    const r = await vk("clips.get", { owner_id: OWNER_ID, count: 100 });
    const items = (r.items || []).map(c => ({
      id: `clip${c.owner_id}_${c.id}`,
      type: "clip",
      title: c.title || c.description?.slice(0, 80) || "Клип",
      href: c.clip?.url || c.player || c.url || "",
      thumb: pickThumb(c.image),
      duration: c.duration ? secToTime(c.duration) : "",
      date: c.date ? isoDate(c.date) : "",
      views: c.views || 0
    }));
    return items.filter(x => x.href);
  } catch (e) {
    console.warn("⚠️ clips.get недоступен — пропускаю клипы.");
    return [];
  }
}

async function main() {
  const updatedAt = new Date().toISOString();

  const videos = await fetchAllVideos();
  const clips = await fetchClipsSafe();

  const tvItems = [...videos, ...clips].sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  const vod = videos
    .slice()
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""))[0];

  const videoOfDay = vod
    ? {
        updatedAt,
        type: "video",
        title: vod.title,
        desc: "",
        hrefWatch: vod.href,
        thumb: vod.thumb,
        duration: vod.duration,
        date: vod.date,
        rubric: "TV"
      }
    : { updatedAt, type: "video", title: "Видео дня", desc: "Пока нет видео.", hrefWatch: "https://vk.com/promrep", thumb: "", duration: "", date: "", rubric: "TV" };

  const shortsSource = clips.length
    ? clips
    : videos.filter(v => {
        const [m, s] = (v.duration || "0:00").split(":").map(Number);
        const sec = (m || 0) * 60 + (s || 0);
        return sec > 0 && sec <= 90;
      });

  const shorts = shortsSource.slice(0, 20).map(x => ({
    id: x.id,
    title: x.title,
    href: x.href,
    thumb: x.thumb,
    time: x.duration || "",
    badge: x.type === "clip" ? "Клип" : "Short"
  }));

  writeJSON(out("content/tv/videos.json"), { updatedAt, items: tvItems });
  writeJSON(out("content/home/shorts.json"), { updatedAt, items: shorts });
  writeJSON(out("content/home/videoOfDay.json"), videoOfDay);

  console.log(`✅ Updated: tv=${tvItems.length}, shorts=${shorts.length}`);
}

main().catch(err => {
  console.error("❌ Failed:", err);
  process.exit(1);
});
