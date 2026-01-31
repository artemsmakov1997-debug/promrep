import fs from "fs";
import path from "path";
import fetch from "node-fetch";

const VK_TOKEN = process.env.VK_TOKEN;

// === НАСТРОЙКИ ГРУППЫ ===
const GROUP_ID = 234602001;            // promrep
const OWNER_ID = -GROUP_ID;            // для wall.get у сообщества owner_id отрицательный

const API_VERSION = "5.199";

// === ПУТИ К JSON ===
const ROOT = process.cwd();
const TV_JSON = path.join(ROOT, "content/tv/videos.json");
const SHORTS_JSON = path.join(ROOT, "content/home/shorts.json");
const VOD_JSON = path.join(ROOT, "content/home/videoOfDay.json");

// ---------- VK API helper ----------
async function vk(method, params = {}) {
  const url = new URL(`https://api.vk.com/method/${method}`);

  const finalParams = {
    ...params,
    v: API_VERSION,
  };

  // Токен добавляем только если он есть (на публичных данных может работать и без него)
  if (VK_TOKEN) finalParams.access_token = VK_TOKEN;

  Object.entries(finalParams).forEach(([k, v]) => url.searchParams.set(k, String(v)));

  const res = await fetch(url);
  const json = await res.json();

  if (json.error) {
    throw new Error(`VK API error ${json.error.error_code}: ${json.error.error_msg}`);
  }
  return json.response;
}

// ---------- Utils ----------
function ensureDirForFile(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeJson(filePath, data) {
  ensureDirForFile(filePath);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

function pickThumb(video) {
  // VK даёт video.image = [{url,width,height}, ...]
  if (!video?.image?.length) return "";
  const img = video.image[video.image.length - 1];
  return img?.url || "";
}

function isVertical(video) {
  if (!video?.image?.length) return false;
  const img = video.image[video.image.length - 1];
  if (!img?.width || !img?.height) return false;
  return img.height > img.width;
}

function formatDuration(seconds) {
  if (!seconds && seconds !== 0) return "";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function buildVideoExtUrl(ownerId, id) {
  // embed URL для iframe
  // NB: с token мы не лезем сюда, просто формируем embed на клиенте
  return `https://vk.com/video_ext.php?oid=${ownerId}&id=${id}`;
}

function normalizeVideo(video, postDate) {
  // video.owner_id, video.id, video.player, video.title, video.duration, video.views, video.description, video.image
  const ownerId = video.owner_id;
  const vid = video.id;

  // player обычно уже содержит URL плеера, но иногда удобнее хранить “страницу видео”
  // Страница видео:
  const pageHref = `https://vk.com/video${ownerId}_${vid}`;

  return {
    title: video.title || "Видео",
    href: pageHref,
    embedUrl: buildVideoExtUrl(ownerId, vid),
    thumb: pickThumb(video),
    duration: formatDuration(video.duration),
    dateISO: new Date(postDate * 1000).toISOString(),           // для сортировки
    date: new Date(postDate * 1000).toISOString().split("T")[0],// для UI
    views: video.views ?? 0,
    description: video.description || "",
    isShort: isVertical(video),
    owner_id: ownerId,
    id: vid
  };
}

// ---------- Fetch videos via wall.get ----------
async function fetchVideosFromWall() {
  let offset = 0;
  const count = 100;
  const all = [];

  while (true) {
    const data = await vk("wall.get", {
      owner_id: OWNER_ID,
      count,
      offset
    });

    for (const post of data.items || []) {
      if (!post.attachments) continue;

      for (const att of post.attachments) {
        if (att.type === "video" && att.video) {
          all.push(normalizeVideo(att.video, post.date));
        }
      }
    }

    offset += count;
    if (offset >= (data.count || 0)) break;

    // небольшой предохранитель: если вдруг API отдаст странное количество
    if (count === 0) break;
  }

  return all;
}

// ---------- Main logic ----------
function uniqByKey(items, keyFn) {
  const map = new Map();
  for (const it of items) {
    const k = keyFn(it);
    if (!k) continue;
    if (!map.has(k)) map.set(k, it);
    // если дубль — оставим первый (он обычно свежее по сортировке)
  }
  return Array.from(map.values());
}

function sortNewestFirst(items) {
  return items
    .slice()
    .sort((a, b) => {
      const ta = Date.parse(a.dateISO || a.date || 0) || 0;
      const tb = Date.parse(b.dateISO || b.date || 0) || 0;
      return tb - ta;
    });
}

async function main() {
  console.log("Fetching videos from VK wall...");
  const raw = await fetchVideosFromWall();

  // сортируем сразу по новизне
  const sorted = sortNewestFirst(raw);

  // убираем дубли по owner_id+id (бывает, если видео встречается в нескольких постах)
  const unique = uniqByKey(sorted, (v) => `${v.owner_id}_${v.id}`);

  // split shorts vs tv
  const shorts = unique.filter(v => v.isShort);
  const tv = unique.filter(v => !v.isShort);

  // Ограничения по количеству (можешь менять)
  const TV_LIMIT = 60;
  const SHORTS_LIMIT = 30;

  const tvItems = tv.slice(0, TV_LIMIT).map(({ dateISO, isShort, owner_id, id, ...rest }) => rest);
  const shortItems = shorts.slice(0, SHORTS_LIMIT).map(({ dateISO, isShort, owner_id, id, ...rest }) => rest);

  // Видео дня: берём самое свежее вообще (если хочешь — можно только горизонтальное)
  const vodSource = unique[0] || null;

  // Форматы файлов такие, чтобы tv.html мог просто читать items[]
  const nowIso = new Date().toISOString();

  const tvJson = {
    updatedAt: nowIso,
    items: tvItems
  };

  const shortsJson = {
    updatedAt: nowIso,
    items: shortItems
  };

  // videoOfDay — сделаем универсальным (VK, без youtubeId)
  // если у тебя где-то ожидается youtubeId — оставим поле пустым
  const vodJson = vodSource
    ? {
        updatedAt: nowIso,
        title: vodSource.title,
        duration: vodSource.duration,
        youtubeId: "",
        href: vodSource.href,
        embedUrl: vodSource.embedUrl + "&autoplay=1",
        thumb: vodSource.thumb,
        description: vodSource.description,
        date: vodSource.date,
        views: vodSource.views
      }
    : {
        updatedAt: nowIso,
        title: "",
        duration: "",
        youtubeId: "",
        href: "#",
        embedUrl: "",
        thumb: "",
        description: "",
        date: "",
        views: 0
      };

  console.log(`TV: ${tvItems.length}, Shorts: ${shortItems.length}, VOD: ${vodSource ? "yes" : "no"}`);

  writeJson(TV_JSON, tvJson);
  writeJson(SHORTS_JSON, shortsJson);
  writeJson(VOD_JSON, vodJson);

  console.log("JSON files updated successfully.");
}

// run
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
