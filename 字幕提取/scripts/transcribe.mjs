#!/usr/bin/env node
// 字幕提取 - 听悟 ASR 转写：本地视频文件 → OSS 中转（Git Bash curl）→ 通义听悟 → 纯文本
// 用法: node transcribe.mjs <本地视频文件路径>
// 配置从准星 skill 的 app/.env 读取（ALIYUN_AK_ID / ALIYUN_AK_SECRET / TINGWU_APP_KEY / TINGWU_BUCKET）
// 进度输出到 stderr，最终文本输出到 stdout——方便 Claude 直接取。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const BASH = process.env.GIT_BASH_PATH || 'C:\\Program Files\\Git\\bin\\bash.exe';
const TINGWU_HOST = 'tingwu.cn-beijing.aliyuncs.com';
const POLL_TIMEOUT_MS = 15 * 60 * 1000;
const ENV_FILE = path.join(os.homedir(), '.claude', 'skills', '准星skill', 'app', '.env');

// ── 读 .env（准星 app/.env，零依赖手工解析，不暴露密钥到日志） ─────────
function loadEnv(file) {
  const env = {};
  try {
    const raw = fs.readFileSync(file, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !line.trimStart().startsWith('#') && m[1] !== 'PORT') env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
  } catch {
    // 读取失败走环境变量兜底
  }
  return env;
}

const fileEnv = loadEnv(ENV_FILE);
const akId = process.env.ALIYUN_AK_ID || fileEnv.ALIYUN_AK_ID;
const akSecret = process.env.ALIYUN_AK_SECRET || fileEnv.ALIYUN_AK_SECRET;
const appKey = process.env.TINGWU_APP_KEY || fileEnv.TINGWU_APP_KEY;
const bucket = process.env.TINGWU_BUCKET || fileEnv.TINGWU_BUCKET || 'obsidian-shaobo';

function progress(msg) { process.stderr.write(`[转写] ${msg}\n`); }
function percentEncode(s) { return encodeURIComponent(s).replace(/\+/g, '%20').replace(/%7E/g, '~'); }

/* ── 听悟 ROA 签名（与准星 tingwu.js 一致） ── */
function roaSign(method, path, query, headers, body, secret) {
  const canonHeaders = Object.keys(headers)
    .filter(k => k.toLowerCase().startsWith('x-acs-'))
    .sort()
    .map(k => `${k.toLowerCase()}:${String(headers[k]).trim()}\n`)
    .join('');
  let canonResource = path;
  if (query && Object.keys(query).length) {
    const qs = Object.keys(query).sort().map(k => `${percentEncode(k)}=${percentEncode(query[k])}`).join('&');
    canonResource += '?' + qs;
  }
  const sts = [method, headers.Accept || 'application/json', '', headers['Content-Type'] || '', headers.Date || '', canonHeaders + canonResource].join('\n');
  return crypto.createHmac('sha1', secret).update(sts).digest('base64');
}

async function tingwuCall(method, path, query, bodyObj, akId, akSecret) {
  const body = bodyObj ? JSON.stringify(bodyObj) : null;
  const headers = {
    Accept: 'application/json',
    Date: new Date().toUTCString(),
    'x-acs-signature-nonce': crypto.randomUUID(),
    'x-acs-signature-version': '1.0',
  };
  if (body) headers['Content-Type'] = 'application/json';
  headers.Authorization = `acs ${akId}:${roaSign(method, path, query, headers, body, akSecret)}`;
  const qs = Object.entries(query || {}).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  const url = `https://${TINGWU_HOST}${path}${qs ? '?' + qs : ''}`;
  const r = await fetch(url, { method, headers, ...(body ? { body } : {}), signal: AbortSignal.timeout(30000) });
  return r.json();
}

/* ── OSS 签名上传/删除（必须走 Git Bash curl，fetch 会重写 Date 头导致签名失效） ── */
function ossSign(method, resource, headers, secret) {
  const canon = `${method}\n${headers['Content-MD5'] || ''}\n${headers['Content-Type'] || ''}\n${headers.Date}\n${resource}`;
  return crypto.createHmac('sha1', secret).update(canon).digest('base64');
}

function ossSignedGetUrl(bucket, key, akId, akSecret, ttlSeconds = 7200) {
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
  const resource = `/${bucket}/${key}`;
  const sig = crypto.createHmac('sha1', akSecret).update(`GET\n\n\n${expires}\n${resource}`).digest('base64');
  return `https://${bucket}.oss-cn-hangzhou.aliyuncs.com/${key}?Expires=${expires}&OSSAccessKeyId=${akId}&Signature=${encodeURIComponent(sig)}`;
}

function uploadViaCurl(localPath, bucket, key, akId, akSecret) {
  const date = new Date().toUTCString();
  const resource = `/${bucket}/${key}`;
  const sig = ossSign('PUT', resource, { Date: date, 'Content-Type': 'video/mp4' }, akSecret);
  const gnuPath = localPath.replace(/^([A-Za-z]):/, '/$1').replace(/\\/g, '/');
  const cmd = [
    'curl -s -X PUT',
    `-H "Date: ${date}"`,
    '-H "Content-Type: video/mp4"',
    `-H "Authorization: OSS ${akId}:${sig}"`,
    `--data-binary "@${gnuPath}"`,
    `"https://${bucket}.oss-cn-hangzhou.aliyuncs.com/${key}"`,
    '-w "\\nHTTP %{http_code}"',
  ].join(' ');
  const out = execFileSync(BASH, ['-lc', cmd], { timeout: 300000, encoding: 'utf8' });
  if (!out.includes('HTTP 200')) throw new Error(`OSS 上传失败: ${out.slice(0, 200)}`);
}

function deleteViaCurl(bucket, key, akId, akSecret) {
  const date = new Date().toUTCString();
  const resource = `/${bucket}/${key}`;
  const sig = ossSign('DELETE', resource, { Date: date }, akSecret);
  const cmd = [
    'curl -s -X DELETE',
    `-H "Date: ${date}"`,
    `-H "Authorization: OSS ${akId}:${sig}"`,
    `"https://${bucket}.oss-cn-hangzhou.aliyuncs.com/${key}"`,
    '-w "\\nHTTP %{http_code}"',
  ].join(' ');
  try { execFileSync(BASH, ['-lc', cmd], { timeout: 60000, encoding: 'utf8' }); } catch { /* 删除失败不影响主流程 */ }
}

/* ── 定位 ffprobe：yt-dlp 同目录（硬链接）→ WinGet 包 → PATH ── */
function locateFfprobe() {
  const packages = path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'WinGet', 'Packages');
  try {
    for (const d of fs.readdirSync(packages).sort()) {
      const dir = path.join(packages, d);
      if (d.startsWith('yt-dlp.yt-dlp')) {
        const p = path.join(dir, 'ffprobe.exe');
        if (fs.existsSync(p)) return p;
      }
    }
  } catch { }
  return 'ffprobe'; // 回退 PATH
}

/* ── 时长检查（ffprobe，成本保护：30 分钟上限） ── */
function checkDuration(file) {
  try {
    const fp = locateFfprobe().replace(/\\/g, '/');
    const out = execFileSync(BASH, ['-lc', `"${fp}" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${file.replace(/\\/g, '/')}" 2>/dev/null | head -1`], { timeout: 30000, encoding: 'utf8' });
    const sec = parseFloat(String(out).trim());
    if (!Number.isNaN(sec)) return sec;
  } catch { }
  return null;
}

/* ── 主流程 ── */
async function main() {
  const videoPath = process.argv[2];
  if (!videoPath) {
    process.stderr.write('用法: node transcribe.mjs <视频文件路径>\n');
    process.exit(2);
  }
  if (!fs.existsSync(videoPath)) {
    process.stderr.write(`文件不存在: ${videoPath}\n`);
    process.exit(2);
  }
  if (!akId || !akSecret || !appKey) {
    process.stderr.write('未配置通义听悟（ALIYUN_AK_ID / ALIYUN_AK_SECRET / TINGWU_APP_KEY），请确认准星 app/.env 正常\n');
    process.exit(2);
  }

  const duration = checkDuration(videoPath);
  if (duration !== null && duration > 30 * 60) {
    process.stderr.write(`视频 ${Math.round(duration / 60)} 分钟，超过 30 分钟转写上限（听悟按分钟计费），已取消。若确需转写请先剪辑。\n`);
    process.exit(2);
  }

  const cacheKey = crypto.createHash('md5').update(videoPath + Date.now()).digest('hex');
  const ossKey = `subtitle-extract/${cacheKey}.mp4`;

  progress('上传 OSS 中转…');
  uploadViaCurl(videoPath, bucket, ossKey, akId, akSecret);

  let taskId = null;
  try {
    const ossUrl = ossSignedGetUrl(bucket, ossKey, akId, akSecret);
    progress('提交听悟任务…');
    const task = await tingwuCall('PUT', '/openapi/tingwu/v2/tasks', { type: 'offline', operation: 'start' }, {
      AppKey: appKey,
      Input: { FileUrl: ossUrl, SourceLanguage: 'cn' },
      Parameters: { Transcription: { DiarizationEnabled: false } },
    }, akId, akSecret);
    taskId = task.Data?.TaskId;
    if (!taskId) throw new Error(`听悟任务创建失败: ${JSON.stringify(task).slice(0, 200)}`);

    progress('转写中，轮询…');
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    let info = null;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 15000));
      info = await tingwuCall('GET', `/openapi/tingwu/v2/tasks/${taskId}`, null, null, akId, akSecret);
      const st = info.Data?.TaskStatus;
      if (st === 'COMPLETED') break;
      if (st === 'FAILED' || st === 'ERROR') throw new Error(`听悟转写失败: ${info.Data?.ErrorMessage || st}`);
    }
    if (!info || info.Data?.TaskStatus !== 'COMPLETED') throw new Error('听悟转写超时（15 分钟）');

    const transUrl = info.Data?.Result?.Transcription;
    if (!transUrl) throw new Error('转写完成但无结果文件');
    progress('拉取转写结果…');
    const tj = await (await fetch(transUrl, { signal: AbortSignal.timeout(60000) })).json();
    const paras = tj.Transcription?.Paragraphs || [];
    const text = paras.map(p => (p.Words || []).map(w => w.Text).join('')).join('\n').trim();
    if (!text) throw new Error('转写结果为空');

    process.stdout.write(text + '\n');
    progress('完成');
  } finally {
    if (taskId) deleteViaCurl(bucket, ossKey, akId, akSecret);
  }
}

main().catch(e => { process.stderr.write(`[转写] 错误: ${e.message}\n`); process.exit(1); });
