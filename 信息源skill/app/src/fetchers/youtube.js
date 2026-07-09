import Parser from 'rss-parser';

const parser = new Parser();

export async function fetch(channelId) {
  const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
  const feed = await parser.parseURL(feedUrl);

  return feed.items.map(item => ({
    title: item.title || '',
    url: item.link || '',
    summary: extractSummary(item),
    thumbnail: extractThumbnail(item, feedUrl),
    published_at: item.pubDate || item.isoDate || null,
  }));
}

function extractSummary(item) {
  if (item.contentSnippet) return item.contentSnippet;
  if (item.content) return stripHtml(String(item.content)).slice(0, 500);
  return '';
}

function extractThumbnail(item, feedUrl) {
  // Try to extract video ID from the link
  const match = (item.link || item.id || '').match(/(?:v=|youtu\.be\/|embed\/)([\w-]{11})/);
  if (match) {
    return `https://i.ytimg.com/vi/${match[1]}/hqdefault.jpg`;
  }
  // Fallback: try media:thumbnail
  if (item.media && item.media.thumbnail) {
    const t = Array.isArray(item.media.thumbnail)
      ? item.media.thumbnail[0]
      : item.media.thumbnail;
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

  // Treat as channel ID or handle attempt
  return { type: 'unknown', value: trimmed };
}

// Convert a @handle to channel_id by fetching the page HTML
export async function resolveHandle(handle) {
  const url = `https://www.youtube.com/@${handle}`;
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
    });
    const html = await resp.text();

    // Extract channel ID from canonical URL
    const match = html.match(/https:\/\/www\.youtube\.com\/channel\/(UC[\w-]+)/);
    if (match) return match[1];

    // Try externalId in ytInitialData
    const extMatch = html.match(/"externalId"\s*:\s*"(UC[\w-]+)"/);
    if (extMatch) return extMatch[1];

    return null;
  } catch {
    return null;
  }
}
