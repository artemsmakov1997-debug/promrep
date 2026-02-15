import fs from "fs";

const CHANNEL = "promreporter"; // без @
const LIMIT = 30;

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
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  const html = await res.text();

  // Находим посты в публичной ленте
  const re = /data-post="[^"]*\/(\d+)"[\s\S]*?tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/g;

  const items = [];
  let m;

  while ((m = re.exec(html)) && items.length < LIMIT) {
    const id = Number(m[1]);
    const textHtml = m[2];
    const text = stripHtml(textHtml).trim();
    if (!text) continue;

  let photoUrl = null;

// если у поста есть фото
if (msg.photo && msg.photo.length) {
  try {
    const best = msg.photo[msg.photo.length - 1];

    const file = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${best.file_id}`
    ).then(r => r.json());

    const path = file.result.file_path;
    photoUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${path}`;
  } catch (e) {
    console.log("Photo load error:", e);
  }
}

items.push({
  id,
  text,
  date: msg.date || Math.floor(Date.now() / 1000),
  photo: photoUrl
});

  }

  // старые внизу, новые сверху
  const out = items.reverse();

  fs.mkdirSync("content/news", { recursive: true });
  fs.writeFileSync("content/news/feed.json", JSON.stringify(out, null, 2));
  console.log("News updated:", out.length);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
