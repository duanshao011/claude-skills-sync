import Parser from 'rss-parser';

const parser = new Parser({
  customFields: {
    item: [
      ['media:group', 'mediaGroup'],
    ],
  },
});

export async function fetchChannel(channelId) {
  const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
  const feed = await parser.parseURL(feedUrl);

  return feed.items.map(item => ({
    title: item.title || '',
    url: item.link || '',
    summary: extractSummary(item),
    thumbnail: extractThumbnail(item),
    published_at: item.pubDate || item.isoDate || null,
  }));
}

function extractSummary(item) {
  // YouTube puts description in media:group > media:description
  if (item.mediaGroup) {
    const desc = item.mediaGroup['media:description'];
    if (desc) {
      const text = Array.isArray(desc) ? desc[0] : String(desc);
      return text.slice(0, 200);
    }
  }
  if (item.contentSnippet) return item.contentSnippet;
  if (item.content) return stripHtml(String(item.content)).slice(0, 200);
  return '';
}

function extractThumbnail(item) {
  // Try to extract video ID from the link
  const match = (item.link || item.id || '').match(/(?:v=|youtu\.be\/|embed\/)([\w-]{11})/);
  if (match) {
    return `https://i.ytimg.com/vi/${match[1]}/hqdefault.jpg`;
  }
  if (item.mediaGroup && item.mediaGroup['media:thumbnail']) {
    const t = Array.isArray(item.mediaGroup['media:thumbnail'])
      ? item.mediaGroup['media:thumbnail'][0]
      : item.mediaGroup['media:thumbnail'];
    if (t && t.url) return t.url;
  }
  return '';
}

function stripHtml(str) {
  return str.replace(/<[^>]*>/g, '');
}

// Validate a YouTube channel by trying to fetch its RSS
export async function validate(channelId) {
  const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
  const feed = await parser.parseURL(feedUrl);
  return {
    valid: true,
    channel_name: feed.title || '',
  };
}

// Parse YouTube URL to extract channel ID
export function parseChannelUrl(input) {
  const trimmed = input.trim();

  // Detect non-channel URLs
  if (/youtube\.com\/results/.test(trimmed)) {
    return { type: 'error', reason: '这是搜索结果链接，不是频道链接。请粘贴频道的 @Handle 链接（如 https://www.youtube.com/@dankoe）或频道 ID（UC开头的字符串）。' };
  }
  if (/youtube\.com\/watch/.test(trimmed)) {
    return { type: 'error', reason: '这是视频链接，不是频道链接。请先进入频道主页复制链接（如 https://www.youtube.com/@Marques）。' };
  }
  if (/youtube\.com\/playlist/.test(trimmed)) {
    return { type: 'error', reason: '这是播放列表链接，不是频道链接。请粘贴频道的 @Handle 链接。' };
  }

  // If it's already a channel ID (UC...)
  if (/^UC[\w-]{20,}$/.test(trimmed)) {
    return { type: 'channel_id', value: trimmed };
  }

  // Full channel URL: youtube.com/channel/UCxxx
  const channelMatch = trimmed.match(/youtube\.com\/channel\/(UC[\w-]+)/);
  if (channelMatch) {
    return { type: 'channel_id', value: channelMatch[1] };
  }

  // @handle URL: youtube.com/@handle
  const handleMatch = trimmed.match(/youtube\.com\/@([\w.-]+)/);
  if (handleMatch) {
    return { type: 'handle', value: handleMatch[1] };
  }

  // Bare @handle
  if (/^@[\w.-]+$/.test(trimmed)) {
    return { type: 'handle', value: trimmed.slice(1) };
  }

  // Unknown format
  return { type: 'unknown', value: trimmed, reason: '无法识别输入格式。请粘贴 YouTube 频道链接（如 https://www.youtube.com/@频道名）或频道 ID（UC开头的字符串）。' };
}

// Convert a @handle to channel_id by fetching the page HTML
export async function resolveHandle(handle) {
  const url = `https://www.youtube.com/@${handle}`;
  try {
    const resp = await fetch(url, {
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    const html = await resp.text();

    // Pattern 1: browseId in JSON (most reliable)
    let match = html.match(/"browseId"\s*:\s*"(UC[\w-]+)"/);
    if (match) return match[1];

    // Pattern 2: canonical channel URL
    match = html.match(/https?:\/\/www\.youtube\.com\/channel\/(UC[\w-]+)/);
    if (match) return match[1];

    // Pattern 3: channelId in JSON
    match = html.match(/"channelId"\s*:\s*"(UC[\w-]+)"/);
    if (match) return match[1];

    // Pattern 4: externalId in JSON
    match = html.match(/"externalId"\s*:\s*"(UC[\w-]+)"/);
    if (match) return match[1];

    return null;
  } catch {
    return null;
  }
}

// Extract channel avatar from channel page HTML
export async function extractAvatar(channelId) {
  const url = `https://www.youtube.com/channel/${channelId}`;
  try {
    const resp = await fetch(url, {
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    const html = await resp.text();
    // Match both old (ggpht.com) and new (googleusercontent.com) CDN patterns
    let match = html.match(/(yt3\.ggpht\.com\/[^"=\s]+)/);
    if (!match) match = html.match(/(googleusercontent\.com\/[^"=\s]+)/);
    if (match) {
      const base = match[1];
      return `https://${base}=s88-c-k-c0x00ffffff-no-rj`;
    }
    return null;
  } catch {
    return null;
  }
}
