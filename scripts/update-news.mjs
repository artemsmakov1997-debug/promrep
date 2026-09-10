import fs from "fs";
import path from "path";

const TOKEN = process.env.VK_TOKEN;
const DOMAIN = "promrep";
const API_VERSION = "5.199";

const VK_PAGE_SIZE = 100;
const FEED_SIZE = 30;
const REQUEST_DELAY_MS = 350;

const ROOT = process.cwd();
const NEWS_DIR = path.join(ROOT, "content/news");
const FEED_FILE = path.join(NEWS_DIR, "feed.json");
const INDEX_FILE = path.join(NEWS_DIR, "index.json");
const ARCHIVE_DIR = path.join(NEWS_DIR, "archive");

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
        .sort(
          (a, b) =>
            (a.width || 0) * (a.height || 0) -
            (b.width || 0) * (b.height || 0)
        );

      return sorted[sorted.length - 1]?.url || null;
    }
  }

  return null;
}

function normalizePost(post) {
  if (!post || post.is_pinned) {
    return null;
  }

  const text = cleanText(post.text);

  if (!text) {
    return null;
  }

  return {
    id: post.id,
    text,
    date: post.date || Math.floor(Date.now() / 1000),
    photo: extractPhoto(post),
    url: `https://vk.com/wall${post.owner_id}_${post.id}`
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWallPage(offset) {
  const url =
    `https://api.vk.com/method/wall.get` +
    `?domain=${encodeURIComponent(DOMAIN)}` +
    `&count=${VK_PAGE_SIZE}` +
    `&offset=${offset}` +
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
    throw new Error(
      `VK API error: ${JSON.stringify(data.error)}`
    );
  }

  return {
    count: Number(data?.response?.count || 0),

    items: Array.isArray(data?.response?.items)
      ? data.response.items
      : []
  };
}

function readJson(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) {
      return fallback;
    }

    return JSON.parse(
      fs.readFileSync(filePath, "utf-8")
    );
  } catch (error) {
    console.warn(
      `Cannot read ${filePath}:`,
      error.message
    );

    return fallback;
  }
}

function extractItems(data) {
  if (Array.isArray(data)) {
    return data;
  }

  if (Array.isArray(data?.items)) {
    return data.items;
  }

  if (Array.isArray(data?.posts)) {
    return data.posts;
  }

  if (Array.isArray(data?.response?.items)) {
    return data.response.items;
  }

  return [];
}

function getPostKey(post) {
  const id =
    post?.id ??
    post?.post_id;

  if (
    id !== undefined &&
    id !== null &&
    String(id) !== ""
  ) {
    return `id:${id}`;
  }

  return (
    `fallback:${Number(post?.date || 0)}:` +
    cleanText(
      post?.text ||
      post?.title ||
      ""
    )
  );
}

function sortPosts(posts) {
  return posts
    .slice()
    .sort((a, b) => {
      const dateDiff =
        Number(b?.date || 0) -
        Number(a?.date || 0);

      if (dateDiff !== 0) {
        return dateDiff;
      }

      return (
        Number(b?.id || b?.post_id || 0) -
        Number(a?.id || a?.post_id || 0)
      );
    });
}

function loadExistingArchive() {
  const index =
    readJson(INDEX_FILE, null);

  const files =
    new Set([FEED_FILE]);

  if (Array.isArray(index?.pages)) {
    for (const page of index.pages) {
      if (page?.file) {
        files.add(
          path.join(
            NEWS_DIR,
            page.file
          )
        );
      }
    }
  }

  /*
   * Архивные месяцы читаем напрямую из каталога.
   *
   * Это важно для месяцев, которые могли временно
   * не входить в клиентский index.json из-за того,
   * что целиком помещались в свежий feed.json.
   */
  if (fs.existsSync(ARCHIVE_DIR)) {
    for (
      const name of
      fs.readdirSync(ARCHIVE_DIR)
    ) {
      if (/^\d{4}-\d{2}\.json$/i.test(name)) {
        files.add(
          path.join(
            ARCHIVE_DIR,
            name
          )
        );
      }
    }
  }

  const byKey =
    new Map();

  for (const file of files) {
    const data =
      readJson(file, []);

    for (const post of extractItems(data)) {
      byKey.set(
        getPostKey(post),
        post
      );
    }
  }

  return {
    index,
    posts: sortPosts(
      [...byKey.values()]
    )
  };
}

async function fetchNews(
  existingPosts,
  fullSync
) {
  const existingKeys =
    new Set(
      existingPosts.map(getPostKey)
    );

  const fetched = [];

  let offset = 0;
  let totalCount = 0;
  let reachedExisting = false;

  while (true) {
    const page =
      await fetchWallPage(offset);

    totalCount =
      page.count;

    if (!page.items.length) {
      break;
    }

    let pageHasExisting = false;

    for (const rawPost of page.items) {
      const post =
        normalizePost(rawPost);

      if (!post) {
        continue;
      }

      if (
        existingKeys.has(
          getPostKey(post)
        )
      ) {
        pageHasExisting = true;
      }

      fetched.push(post);
    }

    offset += page.items.length;

    /*
     * При обычном обновлении не нужно каждый раз
     * проходить всю стену VK.
     *
     * Как только встретили уже сохранённую публикацию,
     * значит более старые записи у нас уже есть.
     */
    if (
      !fullSync &&
      pageHasExisting
    ) {
      reachedExisting = true;
      break;
    }

    if (
      offset >= totalCount ||
      page.items.length < VK_PAGE_SIZE
    ) {
      break;
    }

    await sleep(
      REQUEST_DELAY_MS
    );
  }

  return {
    posts: fetched,
    reachedExisting,
    totalCount
  };
}

function mergePosts(
  existingPosts,
  fetchedPosts
) {
  const byKey =
    new Map();

  /*
   * Старые записи сохраняются навсегда,
   * даже если их уже нет в свежей выдаче VK.
   */
  for (const post of existingPosts) {
    byKey.set(
      getPostKey(post),
      post
    );
  }

  /*
   * Свежая версия записи имеет приоритет:
   * так обновляются текст и превью.
   */
  for (const post of fetchedPosts) {
    byKey.set(
      getPostKey(post),
      post
    );
  }

  return sortPosts(
    [...byKey.values()]
  );
}

function pageMeta(
  file,
  items
) {
  return {
    file,
    count: items.length,

    newestDate:
      Number(
        items[0]?.date || 0
      ) || null,

    oldestDate:
      Number(
        items[
          items.length - 1
        ]?.date || 0
      ) || null
  };
}

function monthKey(post) {
  const timestamp =
    Number(post?.date || 0);

  if (!timestamp) {
    return "undated";
  }

  return new Date(
    timestamp * 1000
  )
    .toISOString()
    .slice(0, 7);
}

function writeArchive(
  posts,
  complete
) {
  fs.mkdirSync(
    NEWS_DIR,
    {
      recursive: true
    }
  );

  fs.mkdirSync(
    ARCHIVE_DIR,
    {
      recursive: true
    }
  );

  /*
   * feed.json остаётся маленьким:
   * в нём только самые свежие новости.
   */
  const feed =
    posts.slice(
      0,
      FEED_SIZE
    );

  const feedKeys =
    new Set(
      feed.map(getPostKey)
    );

  fs.writeFileSync(
    FEED_FILE,
    JSON.stringify(
      feed,
      null,
      2
    ),
    "utf-8"
  );

  const pages = [
    pageMeta(
      "feed.json",
      feed
    )
  ];

  /*
   * Полный архив разбиваем по месяцам:
   *
   * archive/2026-09.json
   * archive/2026-08.json
   * archive/2026-07.json
   * ...
   */
  const buckets =
    new Map();

  for (const post of posts) {
    const key =
      monthKey(post);

    if (!buckets.has(key)) {
      buckets.set(
        key,
        []
      );
    }

    buckets
      .get(key)
      .push(post);
  }

  for (
    const [key, items]
    of buckets
  ) {
    const relativeFile =
      `archive/${key}.json`;

    const absoluteFile =
      path.join(
        NEWS_DIR,
        relativeFile
      );

    fs.writeFileSync(
      absoluteFile,
      JSON.stringify(
        items,
        null,
        2
      ),
      "utf-8"
    );

    /*
     * Если весь месяц уже помещается в feed.json,
     * повторно грузить его посетителю не нужно.
     *
     * Сам файл месяца при этом всё равно хранится
     * в репозитории.
     */
    const hasItemsOutsideFeed =
      items.some(
        post =>
          !feedKeys.has(
            getPostKey(post)
          )
      );

    if (hasItemsOutsideFeed) {
      pages.push(
        pageMeta(
          relativeFile,
          items
        )
      );
    }
  }

  /*
   * Удаляем только файлы старой экспериментальной
   * схемы page-N.json.
   *
   * Месячные архивы здесь не удаляются:
   * исторические новости должны оставаться
   * постоянными.
   */
  if (fs.existsSync(ARCHIVE_DIR)) {
    for (
      const name of
      fs.readdirSync(ARCHIVE_DIR)
    ) {
      if (
        /^page-\d+\.json$/i.test(name)
      ) {
        fs.unlinkSync(
          path.join(
            ARCHIVE_DIR,
            name
          )
        );
      }
    }
  }

  const index = {
    version: 2,
    updatedAt:
      new Date().toISOString(),

    total:
      posts.length,

    feedSize:
      FEED_SIZE,

    archiveGrouping:
      "month",

    complete:
      Boolean(complete),

    pages
  };

  fs.writeFileSync(
    INDEX_FILE,
    JSON.stringify(
      index,
      null,
      2
    ),
    "utf-8"
  );

  return index;
}

async function main() {
  if (!TOKEN) {
    throw new Error(
      "VK_TOKEN is missing in environment variables"
    );
  }

  const existing =
    loadExistingArchive();

  /*
   * Если архив ещё не проходил полную синхронизацию,
   * забираем всю доступную историю стены VK.
   */
  const fullSync =
    existing.index?.complete !== true;

  console.log(
    fullSync
      ? "News archive bootstrap: fetching the full VK wall..."
      : (
          `News archive update: ` +
          `${existing.posts.length} stored posts, ` +
          `looking for newer items...`
        )
  );

  const fetched =
    await fetchNews(
      existing.posts,
      fullSync
    );

  const merged =
    mergePosts(
      existing.posts,
      fetched.posts
    );

  /*
   * После полной синхронизации архив считается
   * заполненным.
   *
   * При обычном обновлении он уже был полным,
   * а старые страницы берутся из репозитория.
   */
  const complete =
    fullSync
      ? true
      : existing.index?.complete === true;

  const index =
    writeArchive(
      merged,
      complete
    );

  console.log(
    "News fetched from VK:",
    fetched.posts.length
  );

  console.log(
    "VK wall reports posts:",
    fetched.totalCount
  );

  console.log(
    "Archive total:",
    index.total
  );

  console.log(
    "Archive pages:",
    index.pages.length
  );
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
