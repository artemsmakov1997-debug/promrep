import fs from "fs";
import path from "path";
import fetch from "node-fetch";

const VK_TOKEN = process.env.VK_TOKEN;
const GROUP_ID = 234602001;            // promrep
const OWNER_ID = -GROUP_ID;
const API_VERSION = "5.199";

const ROOT = process.cwd();
const TV_JSON = path.join(ROOT, "content/tv/videos.json");
const SHORTS_JSON = path.join(ROOT, "content/home/shorts.json");
const VOD_JSON = path.join(ROOT, "content/home/videoOfDay.json");

async function vk(method, params = {}) {
  const url = new URL(`https://api.vk.com/method/${method}`);
  Object.entries({
    ...params,
    access_token: VK_TOKEN,
    v: API_VERSION
  }).forEach(([k, v]) => url.searchParams.set(k, v));

  const res = await fetch(url);
  const json = await res.json();

  if (json.error) {
    throw new Error(`VK API error ${json.error.error_code}: ${json.error.error_msg}`);
  }
  return json.response;
}

function isVertical(video) {
  if (!video.image || !video.image.length) return false;
  const img = video.image[video.image.length - 1];
  return img.height > img.width;
}

function pickThumb(video) {
  if (!video.image) return "";
  const img = video.image[video.image.length - 1];
  return img.url;
}

function normalizeVideo(video, postDate) {
  return {
    title: video.title || "Видео",
    href: video.player,
    thumb: pickThumb(video),
    duration: video.duration
      ? `${Math.floor(video.duration / 60)}:${String(video.duration % 60).padStart(2, "0")}`
      : "",
    date: new Date(postDate * 1000).toISOString().split("T")[0],
    views: video.views ?? 0,
    isShort: isVertical(video)
  };
}

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

    for (const post of data.items) {
      if (!post.attachments) continue;

      for (const att of post.attachments) {
        if (att.type === "video") {
          all.push(normalizeVideo(att.video, post.date));
        }
      }
    }

    offset += count;
    if (offset >= data.count) break;
  }
