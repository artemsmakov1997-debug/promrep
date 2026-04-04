import fs from "fs";

const TOKEN = process.env.VK_TOKEN;
const DOMAIN = "promrep"; // короткий адрес сообщества, например vk.com/promrep
const LIMIT = 30;
const API_VERSION = "5.199";

function cleanText(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractPhoto(post) {
  const attachments = Array.isArray(post?.attachments) ? post.attachments : [];

  for (const att of attachments) {
    if (att.type === "photo" && att.photo?.sizes?.length) {
      const sorted = att.photo.sizes
        .slice()
        .sort((a, b) => (a.width || 0) - (b.width || 0));
      return sorted[sorted.length - 1]?.url || null;
    }
  }

  return null;
}

async function main() {
  if (!TOKEN) {
    throw new Error("VK_TOKEN is missing in environment variables");
  }

  const url =
    `https://api.vk.com/method/wall.get` +
    `?domain=${encodeURIComponent(DOMAIN)}` +
    `&count=${LIMIT}` +
    `&filter=owner` +
    `&v=${API_VERSION}` +
    `&access_token=${encodeURIComponent(TOKEN)}`;

  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0"
    }
  });

  if (!res.ok) {
    throw new Error(`VK API HTTP error: ${res.status}`);
  }

  const data = await res.json();

  if (data.error) {
    throw new Error(`VK API error: ${JSON.stringify(data.error)}`);
  }

  const posts = Array.isArray(data?.response?.items) ? data.response.items : [];

  const items = posts
    .filter(post => !post.is_pinned)
    .filter(post => cleanText(post.text))
    .map(post => ({
      id: post.id,
      text: cleanText(post.text),
      date: post.date || Math.floor(Date.now() / 1000),
      photo: extractPhoto(post),
      url: `https://vk.com/wall${post.owner_id}_${post.id}`
    }));

  const out = items.reverse();

  fs.mkdirSync("content/news", { recursive: true });
  fs.writeFileSync(
    "content/news/feed.json",
    JSON.stringify(out, null, 2),
    "utf-8"
  );

  console.log("News updated from VK:", out.length);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
