import fs from "fs";
import path from "path";

const ROOT = process.cwd();

// === НАСТРОЙКИ ===
const VK_TOKEN = process.env.VK_TOKEN;
const VK_API_VERSION = process.env.VK_API_VERSION || "5.199";

// ВАЖНО: это promrep (у вас в ссылках фигурирует -234602001)
const VK_OWNER_ID = Number(process.env.VK_OWNER_ID || "-234602001");

// сколько тянуть
const TV_COUNT = Number(process.env.TV_COUNT || "50");
const SHORTS_COUNT = Number(process.env.SHORTS_COUNT || "30");

// куда писать
const OUT_TV = path.join(ROOT, "content", "tv", "videos.json");
const OUT_SHORTS = path.join(ROOT, "content", "home", "shorts.json");
const OUT_VOD = path.join(ROOT, "content", "home", "videoOfDay.json");

function ensureToken() {
  if (!VK_TOKEN) {
    throw new Error("VK_TOKEN is missing. Add it to GitHub Secrets and pass to workflow env.");
  }
}

function mkdirp(p) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
}

function writeJson(filePath, data) {
  mkdirp(filePath);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

function pickBestImage(images) {
  // VK обычно отдаёт image: [{url,width,height}, ...]
  if (!Array.isArray(images) || images.length === 0) return "";
  const sorted = [...images].sort((a, b) => (b.width || 0) - (a.width || 0));
  return sorted[0]?.url || "";
}

async function vkCall(method, params) {
  const url = new URL(`https://api.vk.com/method/${method}`);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    url.searchParams.set(k, String(v));
  }
  url.searchParams.set("access_token", VK_TOKEN);
  url.searchParams.set("v", VK_API_VERSION);

  const res = await fetch(url.toString());
  const json = await res.json();

  if (json.error) {
    const msg = `VK API error ${json.error.error_code}: ${json.error.error_msg}`;
    throw new Error(msg);
  }
  return json.response;
}

function mapVkVideoItem(v) {
  // Поля у video.get: id, owner_id, title, description, duration, date, views, image[], player
  const id = v.id;
  const ownerId = v.owner_id;

  return {
    id,
    ownerId,
    title: v.title || "",
    description: v.description || "",
    duration: Number(v.duration || 0),
    date: Number(v.date || 0),
    views: Number(v.views || 0),
    thumb: pickBestImage(v.image),
    href: `https://vk.com/video${ownerId}_${id}`,
    embedUrl: (v.player || "").replace(/&autoplay=\d+/g, "") // autoplay добавим уже на фронте при клике
  };
}

async function fetchAllVideosFromGroup() {
  // Берём свежие видео из группы
  // extended=1, чтобы получить image/player
  const resp = await vkCall("video.get", {
    owner_id: VK_OWNER_ID,
    count: TV_COUNT,
    offset: 0,
    extended: 1
  });

  const items = Array.isArray(resp?.items) ? resp.items : [];
  return items.map(mapVkVideoItem).filter(x => x.id && x.ownerId);
}

async function fetchShortsFromGroup() {
  // У VK “клипы” могут быть доступны по разным методам/пакетам.
  // Мы пробуем несколько вариантов. Если не сработает — shorts останутся пустыми, но TV будет работать.
  const tryMethods = [
    // Вариант 1 (часто встречается)
    { method: "clips.get", params: { owner_id: VK_OWNER_ID, count: SHORTS_COUNT, offset: 0 } },
    // Вариант 2 (у некоторых аккаунтов/версий)
    { method: "shortVideo.get", params: { owner_id: VK_OWNER_ID, count: SHORTS_COUNT, offset: 0 } }
  ];

  for (const t of tryMethods) {
    try {
      const resp = await vkCall(t.method, t.params);

      const rawItems =
        Array.isArray(resp?.items) ? resp.items :
        Array.isArray(resp?.clips) ? resp.clips :
        [];

      // Унифицируем как видео: пытаемся вытащить player/image где возможно
      const items = rawItems.map((c) => {
        // разные схемы: где-то video объект, где-то поля на верхнем уровне
        const v = c.video || c;

        const id = v.id || c.id;
        const ownerId = v.owner_id || c.owner_id || VK_OWNER_ID;

        const title = v.title || c.title || "";
        const description = v.description || c.description || "";
        const duration = Number(v.duration || c.duration || 0);
        const date = Number(v.date || c.date || 0);
        const views = Number(v.views || c.views || 0);

        const imageArr = v.image || c.image || v.images || c.images || [];
        const thumb = pickBestImage(imageArr);

        // ссылки у клипов могут быть вида clip{owner}_{id}
        const href =
          (String(c?.type || "").includes("clip") || String(v?.type || "").includes("clip"))
            ? `https://vk.com/clip${ownerId}_${id}`
            : `https://vk.com/video${ownerId}_${id}`;

        const embedUrl = (v.player || c.player || "").replace(/&autoplay=\d+/g, "");

        return { id, ownerId, title, description, duration, date, views, thumb, href, embedUrl };
      });

      return items.filter(x => x.id && x.ownerId);
    } catch (e) {
      // пробуем следующий метод
    }
  }

  return [];
}

function toIsoNow() {
  return new Date().toISOString();
}

(async function main() {
  ensureToken();

  console.log("VK_OWNER_ID:", VK_OWNER_ID);

  const tvVideos = await fetchAllVideosFromGroup();
  console.log("TV videos:", tvVideos.length);

  const shorts = await fetchShortsFromGroup();
  console.log("Shorts:", shorts.length);

  const videoOfDay = tvVideos[0] || null;

  writeJson(OUT_TV, { updatedAt: toIsoNow(), items: tvVideos });
  writeJson(OUT_SHORTS, { updatedAt: toIsoNow(), items: shorts });
  writeJson(OUT_VOD, { updatedAt: toIsoNow(), item: videoOfDay });

  console.log("Done. JSON updated.");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
