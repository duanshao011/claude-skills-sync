#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const OSS = require('C:/Users/duansb/.openclaw-autoclaw/agents/ob/workspace/node_modules/ali-oss');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const val = argv[i + 1];
    if (val && !val.startsWith('--')) {
      args[key] = val;
      i++;
    } else {
      args[key] = true;
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const { image, title, content, source, topic } = args;

if (!image || !topic) {
  console.error('Usage: --image <path> --topic <keyword> [--title <title>] [--content <text>] [--source <url>]');
  process.exit(2);
}

const configRaw = await readFile('C:/Users/duansb/.openclaw-autoclaw/agents/ob/workspace/ob-oss-config.json', 'utf8');
const config = JSON.parse(configRaw);

const client = new OSS({
  region: 'oss-cn-hangzhou',
  accessKeyId: config.oss.accessKeyId,
  accessKeySecret: config.oss.accessKeySecret,
  bucket: config.oss.bucket
});

const imgName = `知识卡片-${topic}.png`;
const mdName = `知识卡片-${topic}.md`;
const imgOssPath = `06_Archive/Attachment/${imgName}`;
const mdOssPath = `05_Knowledge/${mdName}`;

try {
  const listResult = await client.list({ prefix: '05_Knowledge/', delimiter: '/', 'max-keys': 5 });
  if (!listResult.prefixes || !listResult.prefixes.some(p => p.includes('05_Knowledge/'))) {
    console.error('05_Knowledge/ not found on OSS');
    process.exit(1);
  }

  const imgBuffer = await readFile(image);
  await client.put(imgOssPath, imgBuffer);
  console.log(`Image uploaded: ${imgOssPath}`);

  const today = new Date().toISOString().slice(0, 10);
  const mdContent = `# ${title || topic}

![知识卡片](../06_Archive/Attachment/${imgName})

---

## 结晶

${content || ''}

---

> 来源：${source || '无'}
> 结晶时间：${today}
`;

  const mdBuffer = Buffer.from(mdContent, 'utf8');
  await client.put(mdOssPath, mdBuffer);
  console.log(`Note uploaded: ${mdOssPath}`);

  console.log(JSON.stringify({
    ok: true,
    image_path: imgOssPath,
    note_path: mdOssPath
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exit(1);
}
