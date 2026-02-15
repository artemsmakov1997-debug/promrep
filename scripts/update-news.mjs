import fs from "fs";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHANNEL = "@promreporter";
const LIMIT = 20;

async function getChatId() {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getChat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: CHANNEL })
  });
  const data = await res.json();
  if (!data.ok) throw new Error("Cannot get chat_id");
  return data.result.id;
}

async function getHistory(chatId) {
  const res = await fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates`
  );
  const data = await res.json();
  if (!data.ok) throw new Error("Cannot get updates");

  const posts = data.result
    .map(u => u.channel_post)
    .filter(Boolean)
    .slice(-LIMIT)
    .map(m => ({
      id: m.message_id,
      text: m.text || "",
      date: m.date
    }))
    .reverse();

  return posts;
}

async function main() {
  const chatId = await getChatId();
  const posts = await getHistory(chatId);

  fs.mkdirSync("content/news", { recursive: true });
  fs.writeFileSync(
    "content/news/feed.json",
    JSON.stringify(posts, null, 2)
  );

  console.log("News updated:", posts.length);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
