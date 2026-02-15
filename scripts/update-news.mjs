import fs from "fs";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

async function main() {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates`;
  const res = await fetch(url);
  const data = await res.json();

  if (!data.ok) {
    console.error("Telegram error:", data);
    process.exit(1);
  }

  const posts = data.result
    .map(u => u.channel_post)
    .filter(Boolean)
    .map(m => ({
      id: m.message_id,
      text: m.text || "",
      date: m.date
    }))
    .slice(-20)
    .reverse();

  fs.mkdirSync("content/news", { recursive: true });
  fs.writeFileSync(
    "content/news/feed.json",
    JSON.stringify(posts, null, 2)
  );

  console.log("News updated:", posts.length);
}

main();
