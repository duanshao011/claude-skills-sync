#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith('--')) continue;
    const key = item.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
    } else if (args[key]) {
      args[key] = Array.isArray(args[key]) ? [...args[key], next] : [args[key], next];
      i += 1;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function sanitizeBaseUrl(baseUrl) {
  return baseUrl.replace(/\/+$/, '');
}

function safeMessage(error) {
  const message = error?.message || String(error);
  return message.replace(/sk-[A-Za-z0-9_-]+/g, 'sk-***');
}

function mimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  return 'image/png';
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

async function loadEnvFile(filePath) {
  try {
    const content = await readFile(filePath, 'utf8');
    const values = {};
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const index = trimmed.indexOf('=');
      if (index === -1) continue;
      const key = trimmed.slice(0, index).trim();
      const rawValue = trimmed.slice(index + 1).trim();
      values[key] = rawValue.replace(/^['\"]|['\"]$/g, '');
    }
    return values;
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    throw error;
  }
}

const args = parseArgs(process.argv.slice(2));
const prompt = args.prompt;

if (!prompt) {
  console.error('Missing required --prompt');
  process.exit(2);
}

const envFile = args['env-file'] || process.env.SHENGTU_ENV_FILE || path.join(os.homedir(), '.claude', 'secrets', 'shengtu.env');
const fileEnv = await loadEnvFile(envFile);
const apiKey = args['api-key'] || process.env.OPENAI_API_KEY || fileEnv.OPENAI_API_KEY;
const configuredBaseUrl = args['base-url'] || process.env.OPENAI_BASE_URL || fileEnv.OPENAI_BASE_URL;

if (!apiKey) {
  console.error(`Missing OPENAI_API_KEY. Set it in the shell environment, pass --api-key, or add it to ${envFile}.`);
  process.exit(2);
}

if (!configuredBaseUrl) {
  console.error(`Missing OPENAI_BASE_URL. Set it to your company OpenAI-compatible /v1 endpoint, pass --base-url, or add it to ${envFile}.`);
  process.exit(2);
}

const baseUrl = sanitizeBaseUrl(configuredBaseUrl);

const model = args.model || process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2';
const size = args.size || '1024x1024';
const quality = args.quality;
const background = args.background;
const outputFormat = args.format || 'png';
const out = args.out || path.join('generated-images', `image-${Date.now()}.${outputFormat}`);
const referenceImages = asArray(args.image || args['ref-image'] || args['reference-image']);

try {
  let response;
  if (referenceImages.length) {
    const form = new FormData();
    form.set('model', model);
    form.set('prompt', prompt);
    form.set('size', size);
    if (quality) form.set('quality', quality);
    if (background) form.set('background', background);
    if (outputFormat) form.set('output_format', outputFormat);

    for (const imagePath of referenceImages) {
      const bytes = await readFile(imagePath);
      form.append('image', new Blob([bytes], { type: mimeType(imagePath) }), path.basename(imagePath));
    }

    response = await fetch(`${baseUrl}/images/edits`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
  } else {
    const body = { model, prompt, size };
    if (quality) body.quality = quality;
    if (background) body.background = background;
    if (outputFormat) body.output_format = outputFormat;

    response = await fetch(`${baseUrl}/images/generations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  }

  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = { raw: text };
  }

  if (!response.ok) {
    const err = payload?.error?.message || payload?.message || payload?.raw || `HTTP ${response.status}`;
    throw new Error(err);
  }

  const image = payload?.data?.[0];
  const b64 = image?.b64_json;
  const url = image?.url;

  await mkdir(path.dirname(out), { recursive: true });

  if (b64) {
    await writeFile(out, Buffer.from(b64, 'base64'));
    console.log(JSON.stringify({ ok: true, out, model, baseUrl, source: 'b64_json' }, null, 2));
    process.exit(0);
  }

  if (url) {
    const imageResponse = await fetch(url);
    if (!imageResponse.ok) throw new Error(`Image download failed: HTTP ${imageResponse.status}`);
    const bytes = Buffer.from(await imageResponse.arrayBuffer());
    await writeFile(out, bytes);
    console.log(JSON.stringify({ ok: true, out, model, baseUrl, source: 'url' }, null, 2));
    process.exit(0);
  }

  throw new Error('No image data returned. Expected data[0].b64_json or data[0].url.');
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: safeMessage(error) }, null, 2));
  process.exit(1);
}
