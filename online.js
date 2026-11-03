/**
 * 联网取经：从 fojing.com 抓一部经的正文，切成分段草稿。
 *
 * 这里只有纯函数（抓取与写盘在 index.js 里），方便离线测试。
 *
 * 取回来的只有**原文**：`gist`（释义）、`terms`（名相）、`practice`（练习）
 * 是另写的学习辅助内容，机器抓不来，草稿里统一标成「释义待补」，
 * 不拿机器生成的解释冒充释义。
 */

/** 可取经目。url 全部是 fojing.com 上的正文页，start/end 用来从整页里切出正文。 */
export const IMPORT_CATALOG = [
  {
    id: 'amituo-jing',
    title: '阿弥陀经',
    fullTitle: '佛说阿弥陀经',
    translator: '姚秦 三藏法师 鸠摩罗什 译',
    category: '净土部',
    source: '大正藏 T12 No.366',
    unit: '段',
    url: 'https://fojing.com/%e4%bd%9b%e8%af%b4%e9%98%bf%e5%bc%a5%e9%99%80%e7%bb%8f/',
    start: '如是我闻',
    end: ['皆大欢喜', '作礼而去', '信受奉行'],
    hint: '净土三经之一，篇幅短，适合一次读完。',
  },
  {
    id: 'si-shi-er-zhang-jing',
    title: '四十二章经',
    fullTitle: '佛说四十二章经',
    translator: '后汉 迦叶摩腾 竺法兰 共译',
    category: '经集部',
    source: '大正藏 T17 No.784',
    unit: '章',
    url: 'https://fojing.com/%e4%bd%9b%e8%aa%aa%e5%9b%9b%e5%8d%81%e4%ba%8c%e7%ab%a0%e7%b6%93/',
    start: '佛言',
    end: ['作礼而去', '信受奉行', '皆大欢喜'],
    hint: '四十二段短文，汉地最早的汉译佛经之一；此页为繁体原文。',
  },
  {
    id: 'ba-da-ren-jue-jing',
    title: '八大人觉经',
    fullTitle: '佛说八大人觉经',
    translator: '后汉 安世高 译',
    category: '经集部',
    source: '大正藏 T17 No.779',
    unit: '段',
    url: 'https://fojing.com/%e4%bd%9b%e8%af%b4%e5%85%ab%e5%a4%a7%e4%ba%ba%e8%a7%89%e7%bb%8f/',
    start: '为佛弟子',
    end: ['作礼而去', '信受奉行', '皆大欢喜'],
    hint: '八条修行纲要，常被列为日诵。',
  },
  {
    id: 'jin-gang-jing',
    title: '金刚经',
    fullTitle: '金刚般若波罗蜜经',
    translator: '姚秦 三藏法师 鸠摩罗什 译',
    category: '般若部',
    source: '大正藏 T08 No.235',
    unit: '分',
    url: 'https://fojing.com/%e9%87%91%e5%88%9a%e7%bb%8f/',
    start: '如是我闻',
    end: ['皆大欢喜', '作礼而去', '信受奉行'],
    hint: '已内置。',
  },
  {
    id: 'pu-men-pin',
    title: '普门品',
    fullTitle: '妙法莲华经·观世音菩萨普门品',
    translator: '姚秦 三藏法师 鸠摩罗什 译',
    category: '法华部',
    source: '大正藏 T09 No.262 第二十五品',
    unit: '段',
    url: 'https://fojing.com/%e5%a6%99%e6%b3%95%e8%8e%b2%e5%8d%8e%e7%bb%8f-%e5%8d%b7%e7%ac%ac%e4%b8%83/',
    start: '尔时无尽意菩萨',
    end: ['作礼而去', '信受奉行', '皆大欢喜'],
    hint: '已内置。',
  },
  {
    id: 'ji-xiang-jing',
    title: '吉祥经',
    fullTitle: '吉祥经',
    translator: '近代 法舫 译',
    category: '南传',
    source: '巴利本《小部·吉祥经》',
    unit: '段',
    url: 'https://fojing.com/%e5%90%89%e7%a5%a5%e7%bb%8f/',
    start: '如是我闻',
    end: ['皆大欢喜', '作礼而去', '信受奉行'],
    hint: '已内置。',
  },
];

const UA = 'Mozilla/5.0 (compatible; dsh-plugin-fojing-pet)';

/** 草稿句的释义占位：说清是草稿，不冒充讲解。 */
const DRAFT_GIST = '这一句是联网取回的原文草稿，逐句释义还没整理。可以先自己读原文，意思不确定的地方记下来。';

/** 只允许取 fojing.com 的页面：避免这个功能变成任意 URL 抓取器。 */
export function isAllowedUrl(url) {
  try {
    const parsed = new URL(String(url || ''));
    if (!/^https?:$/.test(parsed.protocol)) return false;
    const host = parsed.hostname.toLowerCase();
    return host === 'fojing.com' || host.endsWith('.fojing.com');
  } catch {
    return false;
  }
}

/** 网页 → 文本行。去掉脚本、样式、标签，只留正文行。 */
export function stripHtmlLines(html) {
  const text = String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h\d|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '\n');
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 1);
}

/** 页面尾巴上的版权、主题、插件署名之类，切正文时会被一起带进来。 */
const JUNK_LINE = /(©|copyright|theme:|license:|\bgpl|really simple|scroll up|^https?:\/\/|^[\x00-\x7F]{1,14}$)/i;

/** 从整页文本里切出正文：[start 行, end 行]。end 可以是多个候选，按顺序取第一个命中的。 */
export function sliceBody(lines, start, end) {
  const list = Array.isArray(lines) ? lines : [];
  const startAt = list.findIndex((line) => line.includes(start));
  if (startAt < 0) return { ok: false, error: `没找到起点「${start}」，页面结构可能变了` };
  const markers = (Array.isArray(end) ? end : [end]).filter(Boolean);
  let endAt = -1;
  for (const marker of markers) {
    for (let i = list.length - 1; i >= startAt; i -= 1) {
      if (list[i].includes(marker)) { endAt = i; break; }
    }
    if (endAt > startAt) break;
  }
  const body = endAt > startAt ? list.slice(startAt, endAt + 1) : list.slice(startAt);
  return { ok: true, lines: body };
}

/**
 * 把一段原文切成 1~N 句，尽量在句号处断，别把一句话拦腰截断。
 * 网页上的段落常常几百字，直接一段一张卡片读起来太长。
 */
export function splitParagraph(text, maxLen = 170) {
  const source = String(text || '').trim();
  if (!source) return [];
  if (source.length <= maxLen) return [source];
  const pieces = source.split(/(?<=[。！？])/).map((part) => part.trim()).filter(Boolean);
  const out = [];
  let buffer = '';
  for (const piece of pieces) {
    if (buffer && buffer.length + piece.length > maxLen) {
      out.push(buffer);
      buffer = piece;
    } else {
      buffer += piece;
    }
  }
  if (buffer) out.push(buffer);
  return out.length ? out : [source];
}

/** 网页标题里常带的站点后缀。 */
export function cleanTitle(raw, fallback) {
  const text = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!text) return fallback || '';
  return text
    .replace(/[_|\-–—]\s*佛经大全.*$/, '')
    .replace(/[_|\-–—]\s*fojing.*$/i, '')
    .replace(/^\s*[【\[]?[^】\]]*[】\]]\s*/, '')
    .trim() || fallback || '';
}

/** 取心正文 → 草稿语料。只放原文，释义/名相/练习留空，等人工补。 */
export function buildDraft(entry, lines) {
  // 1. 去掉页面尾巴（版权/主题/插件署名）和过短的行
  const cleaned = (lines || [])
    .map((line) => String(line).replace(/\s+/g, ' ').trim())
    .filter((line) => line.length >= 4 && !JUNK_LINE.test(line));
  if (!cleaned.length) return { ok: false, error: '切出来是空的，页面结构可能变了' };
  // 2. 网页常把一句一行地排，先并成段落，再按句号切，避免碎成上百段
  const merged = [];
  let buffer = '';
  for (const line of cleaned) {
    buffer += line;
    if (buffer.length >= 90) { merged.push(buffer); buffer = ''; }
  }
  if (buffer) merged.push(buffer);
  // 3. 每段控制在 170 字以内，读起来是一张卡片的量
  const texts = [];
  for (const paragraph of merged) {
    for (const piece of splitParagraph(paragraph, 170)) {
      const text = piece.trim();
      if (text.length >= 4) texts.push(text);
    }
  }
  if (!texts.length) return { ok: false, error: '切出来是空的，页面结构可能变了' };
  const id = entry.id;
  const doc = {
    id,
    title: entry.title,
    fullTitle: entry.fullTitle || entry.title,
    translator: entry.translator || '',
    category: entry.category || '',
    source: entry.source || '',
    intro: entry.intro || `联网取回的原文草稿（${entry.source || '来源页'}）。逐句释义、名相与练习还没补，先只读原文。`,
    unit: entry.unit || '句',
    draft: true,
    sourceUrl: entry.url,
    fetchedAt: new Date().toISOString(),
    segments: texts.map((text, index) => ({
      no: index + 1,
      label: '',
      text,
      gist: DRAFT_GIST,
      terms: [],
      practice: '',
    })),
  };
  return { ok: true, doc };
}

/** 头部抓回来的 HTML 里取 <title>，给自定义 URL 用。 */
export function pageTitle(html) {
  const match = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? match[1] : '';
}

/**
 * 自定义 fojing.com 链接 → 取经条目。
 * id 由路径派生，标题先占位，抓到页面后再用 <title> 覆盖。
 */
export function entryFromUrl(rawUrl) {
  if (!isAllowedUrl(rawUrl)) return null;
  const parsed = new URL(rawUrl);
  const slug = decodeURIComponent(parsed.pathname).replace(/^\/+|\/+$/g, '') || 'page';
  // 文件名只用 ASCII：中文 slug 换成路径哈希，标题仍保留中文
  const ascii = slug.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);
  let hash = 0;
  for (const ch of slug) hash = (hash * 31 + ch.codePointAt(0)) % 0xffffffff;
  const id = ascii || `s${hash.toString(36)}`;
  const title = slug.split(/[-_/]/).filter(Boolean).pop() || '联网经文';
  return {
    id: `web-${id}`,
    title: title.slice(0, 24),
    fullTitle: title,
    translator: '',
    category: '联网取回',
    source: `fojing.com · ${slug}`,
    unit: '段',
    url: parsed.toString(),
    start: '如是我闻',
    end: ['皆大欢喜', '作礼而去', '信受奉行'],
    titleFromPage: true,
  };
}
