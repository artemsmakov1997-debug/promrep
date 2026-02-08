import fs from "fs";
import path from "path";

const VK_TOKEN = process.env.VK_TOKEN;

// promrep
const GROUP_ID = 234602001;
const OWNER_ID = -GROUP_ID;

// VK API version
const API_VERSION = "5.199";

const ROOT = process.cwd();
const TV_JSON = path.join(ROOT, "content/tv/videos.json");
const SHORTS_JSON = path.join(ROOT, "content/home/shorts.json");
const VOD_JSON = path.join(ROOT, "content/home/videoOfDay.json");

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeJson(filePath, data) {
  ensureDir(filePath);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

async function vk(method, params = {}) {
  if (!VK_TOKEN) throw new Error("VK_TOKEN is missing (GitHub Secret VK_TOKEN).");

  const url = new URL(`https://api.vk.com/method/${method}`);
  const merged = { ...params, access_token: VK_TOKEN, v: API_VERSION };

  Object.entries(merged).forEach(([k, v]) => url.searchParams.set(k, String(v)));

  const res = await fetch(url.toString());
  const json = await res.json();

  if (json.error) {
    throw new Error(`VK API error ${json.error.error_code}: ${json.error.error_msg}`);
  }
  return json.response;
}

function pickLargestImage(images = []) {
  if (!Array.isArray(images) || images.length === 0) return null;
  const sorted = [...images].sort((a, b) => (a.width * a.height) - (b.width * b.height));
  return sorted[sorted.length - 1];
}

function isVerticalByThumb(video) {
  const img = pickLargestImage(video.image);
  if (!img) return false;
  return (img.height || 0) > (img.width || 0);
}

function secondsToMMSS(sec) {
  if (!sec || typeof sec !== "number") return "";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function normalizeFromWallVideo(video, post) {
  const img = pickLargestImage(video.image);
  const thumb = img?.url || "";

  const oid = video.owner_id;
  const id = video.id;

  const href = video.player || `https://vk.com/video${oid}_${id}`;

  return {
    title: video.title || "Видео",
    href,                         // ← ВАЖНО: добавлено
    thumb,
    duration: secondsToMMSS(video.duration),
    date: new Date((post.date || video.date || 0) * 1000)
      .toISOString()
      .slice(0, 10),
    views: video.views ?? 0,
    oid,
    id,
    isShort: isVerticalByThumb(video),
  };
}

async function fetchVideosFromWall() {
  console.log("Fetching videos from VK wall via wall.get ...");
  console.log("OWNER_ID:", OWNER_ID);

  const all = [];
  const COUNT = 100;
  let offset = 0;

  while (true) {
    const data = await vk("wall.get", {
      owner_id: OWNER_ID,
      count: COUNT,
      offset,
    });

    const items = data.items || [];
    for (const post of items) {
      const atts = post.attachments || [];
      for (const att of atts) {
        if (att.type === "video" && att.video) {
          all.push(normalizeFromWallVideo(att.video, post));
        }
      }
    }

    offset += COUNT;
    if (offset >= (data.count || 0)) break;

    await new Promise((r) => setTimeout(r, 350));
  }

  // remove duplicates
  const seen = new Set();
  const uniq = [];
  for (const v of all) {
    const key = `${v.oid}_${v.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push(v);
  }

  // sort by date desc
  uniq.sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  console.log("Total videos found on wall:", uniq.length);
  return uniq;
}

function buildOutputs(videos) {
  const shorts = videos.filter(v => v.isShort);
  const tv = videos.filter(v => !v.isShort);

  const vod = tv[0] || videos[0] || null;

  function mapItem(v) {
    return {
      title: v.title,
      href: v.href,
      thumb: v.thumb,
      duration: v.duration,
      date: Math.floor(new Date(v.date).getTime() / 1000),
      views: v.views,
      description: "",
      ownerId: v.oid,
      id: v.id,
      embedUrl: `https://vk.com/video_ext.php?oid=${v.oid}&id=${v.id}`
    };
  }

  const tvJson = {
    updatedAt: new Date().toISOString(),
    items: tv.map(mapItem)
  };

  const shortsJson = {
    updatedAt: new Date().toISOString(),
    items: shorts.map(mapItem)
  };

  const vodJson = vod
    ? {
        updatedAt: new Date().toISOString(),
        item: mapItem(vod)
      }
    : {
        updatedAt: new Date().toISOString(),
        item: null
      };

  return {
    tvJson,
    shortsJson,
    vodJson,
    counts: { tv: tv.length, shorts: shorts.length }
  };
}

async function main() {
  const videos = await fetchVideosFromWall();
  const { tvJson, shortsJson, vodJson, counts } = buildOutputs(videos);

  writeJson(TV_JSON, tvJson);
  writeJson(SHORTS_JSON, shortsJson);
  writeJson(VOD_JSON, vodJson);

  console.log("Wrote JSON:");
  console.log("- TV:", counts.tv);
  console.log("- Shorts:", counts.shorts);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
