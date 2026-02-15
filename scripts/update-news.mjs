import fs from "fs";

const CHANNEL = "promreporter"; // имя канала без @
const LIMIT = 30;

// очистка HTML из текста поста
function stripHtml(s) {
  return s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'");
}

async function main() {
  const url = `https://t.me/s/${CHANNEL}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" }
  });

  const html = await res.text();

  // ищем блоки постов
  const re = /data-post="[^"]*\/(\d+)"([\s\S]*?)tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/g;

  const items = [];
  let m;

  while ((m = re.exec(html)) && items.length < LIMIT) {
    const id = Number(m[1]);
    const postChunk = m[0];
    const textHtml = m[3];

    const text = stripHtml(textHtml).trim();
    if (!text) continue;

    // ищем картинку превью
    let photo = null;

    // вариант 1: background-image
    const bg = postChunk.match(/background-image:\s*url\('([^']+)'\)/i);
    if (bg && bg[1]) {
      photo = bg[1];
    }

    // вариант 2: обычный img
    if (!photo) {
      const img = postChunk.match(/<img[^>]+src="([^"]+)"/i);
      if (img && img[1]) {
        photo = img[1];
      }
    }

    items.push({
      id,
      text,
      date: Math.floor(Date.now() / 1000),
      photo
    });
  }

  // старые вниз, новые вверх
  const out = items.reverse();

  fs.mkdirSync("content/news", { recursive: true });
  fs.writeFileSync(
    "content/news/feed.json",
    JSON.stringify(out, null, 2)
  );

  console.log("News updated:", out.length);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
