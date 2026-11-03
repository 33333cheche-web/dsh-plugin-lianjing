/**
 * Host half of `dsh-plugin-fojing-pet`.
 *
 * 职责：
 *   - 定期从内置语料里取一句经文，做成一张"古书卡片"（原文 + 现代白话 + 今日练习）；
 *   - 把卡片历史、已读状态、下次时间持久化到 `$DSH_HOME/storages/dsh-fojing-pet.json`；
 *   - 通过同源路由把状态和立绘素材交给 Web 客户端。
 *
 * 本阶段不做模型调用：卡片内容全部来自随包语料，离线可用、可离线校验。
 * 只 import Node 内置模块，保证能从 profile 的 node_modules 直接加载。
 */
import { readFile, writeFile, rename, mkdir, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import {
  IMPORT_CATALOG, buildDraft, cleanTitle, entryFromUrl, isAllowedUrl,
  pageTitle, sliceBody, stripHtmlLines,
} from './online.js';

export const name = 'dsh-fojing-pet';
export const inject = ['connection', 'timer'];

export const ROUTES = {
  state: '/api/dsh-fojing-pet.state',
  next: '/api/dsh-fojing-pet.next',
  read: '/api/dsh-fojing-pet.read',
  asset: '/api/dsh-fojing-pet.asset',
  corpus: '/api/dsh-fojing-pet.corpus',
  sutra: '/api/dsh-fojing-pet.sutra',
  segmentRead: '/api/dsh-fojing-pet.segment-read',
  shell: '/api/dsh-fojing-pet.shell',
  catalog: '/api/dsh-fojing-pet.catalog',
  work: '/api/dsh-fojing-pet.work',
  import: '/api/dsh-fojing-pet.import',
};

/** 独立桌面壳用的免鉴权回环路由（只读 + 带自定义头的 POST）。 */
export const SHELL_ROUTES = {
  state: '/dsh-fojing-pet/pet.json',
  asset: '/dsh-fojing-pet/asset.png',
  next: '/dsh-fojing-pet/next',
  read: '/dsh-fojing-pet/read',
  sutra: '/dsh-fojing-pet/sutra.json',
  segmentRead: '/dsh-fojing-pet/segment-read',
  catalog: '/dsh-fojing-pet/catalog.json',
  import: '/dsh-fojing-pet/import',
  heartbeat: '/dsh-fojing-pet/heartbeat',
  work: '/dsh-fojing-pet/work.json',
};

const SPRITES = {
  idle: 'pet-idle.png',
  open: 'pet-open.png',
  read: 'pet-read.png',
};

const PET_NAME = '莲鲸';
const SKILL_NAME = 'fojing-vademecum';
const DAY = 86400000;

export class FojingPetError extends Error {}

/** 去掉 SKILL.md 的 YAML frontmatter。 */
export function stripFrontmatter(text) {
  const source = String(text ?? '');
  if (!source.startsWith('---')) return source;
  const end = source.indexOf('\n---', 3);
  if (end === -1) return source;
  const after = source.indexOf('\n', end + 4);
  return after === -1 ? '' : source.slice(after + 1);
}

// ---------------------------------------------------------------------------
// 纯函数（导出以便离线测试）
// ---------------------------------------------------------------------------

export function normaliseConfig(config) {
  const raw = config && typeof config === 'object' ? config : {};
  const int = (value, fallback, min, max) => {
    if (value === null || value === undefined || value === '') return fallback;
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
  };
  const quiet = Array.isArray(raw.quietHours) && raw.quietHours.length === 2
    ? [int(raw.quietHours[0], 22, 0, 23), int(raw.quietHours[1], 6, 0, 23)]
    : [22, 6];
  return {
    enabled: raw.enabled !== false,
    everySeconds: int(raw.everySeconds, 3600, 60, 7 * 24 * 3600),
    firstDelaySeconds: int(raw.firstDelaySeconds, 60, 1, 3600),
    quietHours: quiet,
    maxCards: int(raw.maxCards, 60, 1, 500),
    dailyLimit: int(raw.dailyLimit, 12, 0, 500),
    publicRoutes: raw.publicRoutes !== false,
  };
}

export function resolveDshHome(env = process.env) {
  if (env.DSH_HOME && env.DSH_HOME.trim()) return env.DSH_HOME.trim();
  return join(env.HOME || homedir() || process.cwd(), '.dsh');
}

export function resolveStatePath(env = process.env) {
  return join(resolveDshHome(env), 'storages', 'dsh-fojing-pet.json');
}

/** 本地时间处于免打扰区间（支持跨午夜，如 [22, 6]）。 */
export function isQuietAt(date, quietHours) {
  const hour = date.getHours();
  const [from, to] = quietHours;
  if (from === to) return false;
  if (from < to) return hour >= from && hour < to;
  return hour >= from || hour < to;
}

/** 免打扰结束的时刻。 */
export function quietEnd(date, quietHours) {
  const [, to] = quietHours;
  const next = new Date(date);
  next.setHours(to, 0, 0, 0);
  if (next <= date) next.setTime(next.getTime() + DAY);
  return next;
}

export function startOfLocalDay(date) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  return start.getTime();
}

/** 校验单部经的语料结构；返回错误数组，空数组 = 通过。 */
export function validateSutra(doc) {
  const errors = [];
  if (!doc || typeof doc !== 'object') return ['经文文件不是对象'];
  if (typeof doc.id !== 'string' || !doc.id) errors.push('缺 id');
  if (typeof doc.title !== 'string' || !doc.title) errors.push(`经 ${doc?.id} 缺 title`);
  const segments = doc?.segments;
  if (!Array.isArray(segments) || !segments.length) {
    errors.push(`经 ${doc?.id} 没有 segments`);
    return errors;
  }
  const seen = new Set();
  for (const seg of segments) {
    const no = Number(seg?.no);
    if (!Number.isFinite(no)) errors.push(`经 ${doc.id} 有段落缺 no`);
    if (seen.has(no)) errors.push(`经 ${doc.id} 的段落 ${no} 重复`);
    seen.add(no);
    if (typeof seg?.text !== 'string' || !seg.text.trim()) errors.push(`经 ${doc.id} 段落 ${no} 缺 text`);
    if (typeof seg?.gist !== 'string' || !seg.gist.trim()) errors.push(`经 ${doc.id} 段落 ${no} 缺释义`);
    if (!Array.isArray(seg?.terms)) errors.push(`经 ${doc.id} 段落 ${no} 的 terms 不是数组`);
  }
  return errors;
}

/** 校验经目清单。 */
export function validateCorpus(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object') return ['经目不是对象'];
  const list = manifest.sutras;
  if (!Array.isArray(list) || !list.length) errors.push('经目里没有 sutras');
  for (const item of list || []) {
    if (typeof item !== 'string' || !item) errors.push('经目里有非法文件名');
    else if (!item.endsWith('.json')) errors.push(`经目 ${item} 不是 .json`);
  }
  return errors;
}

/** 把多部经摊平成可轮转的句子列表。 */
export function flattenSegments(sutras) {
  const out = [];
  for (const sutra of sutras || []) {
    const total = sutra.segments.length;
    for (const seg of sutra.segments) {
      out.push({
        sutraId: sutra.id,
        sutraTitle: sutra.title,
        fullTitle: sutra.fullTitle || sutra.title,
        translator: sutra.translator || '',
        category: sutra.category || '',
        unit: sutra.unit || '句',
        no: Number(seg.no),
        total,
        label: seg.label || '',
        text: seg.text,
        gist: seg.gist || '',
        terms: Array.isArray(seg.terms) ? seg.terms : [],
        practice: seg.practice || '',
      });
    }
  }
  return out;
}

/** 生成一张卡片。纯数据，不碰文件系统。 */
export function makeCard(segment, at = new Date()) {
  const id = `${segment.sutraId}-${segment.no}-${at.getTime().toString(36)}`;
  return {
    id,
    at: at.toISOString(),
    sutraId: segment.sutraId,
    sutraTitle: segment.sutraTitle,
    fullTitle: segment.fullTitle,
    translator: segment.translator,
    category: segment.category,
    no: segment.no,
    total: segment.total,
    unit: segment.unit || '句',
    label: segment.label,
    cite: { kind: 'sutra', label: '经文', text: segment.text },
    gist: segment.gist,
    terms: segment.terms,
    practice: segment.practice,
    mode: 'corpus',
    read: false,
  };
}

// ---------------------------------------------------------------------------
// 插件主体
// ---------------------------------------------------------------------------

export function apply(ctx, config) {
  const cfg = normaliseConfig(config);
  const here = dirname(fileURLToPath(import.meta.url));
  const assetsDir = join(here, 'assets');
  const corpusDir = join(here, 'corpus');
  const corpusPath = join(corpusDir, 'index.json');
  const skillPath = join(here, 'skill', SKILL_NAME, 'SKILL.md');
  const statePath = resolveStatePath();

  const log = (level, message) => {
    try {
      const logger = ctx.logger;
      if (logger && typeof logger[level] === 'function') logger[level](`[fojing-pet] ${message}`);
    } catch { /* 日志不能影响桌宠 */ }
  };

  const state = {
    version: 1,
    cursor: 0,
    cards: [],
    readSegments: {},
    lastSegment: null,
    lastRunAt: null,
    nextRunAt: null,
    lastError: null,
  };
  let saveChain = Promise.resolve();
  let pendingTimer = null;
  let running = false;
  let corpus = { sutras: [], edition: '', segments: [] };
  let corpusError = null;

  // --- 状态读写 -----------------------------------------------------------
  const persist = () => {
    saveChain = saveChain.then(async () => {
      try {
        const payload = JSON.stringify({
          version: 1,
          cursor: state.cursor,
          cards: state.cards,
          readSegments: state.readSegments,
          lastSegment: state.lastSegment,
          lastRunAt: state.lastRunAt,
          nextRunAt: state.nextRunAt,
          lastError: state.lastError,
        });
        const dir = dirname(statePath);
        await mkdir(dir, { recursive: true });
        const tmp = `${statePath}.tmp`;
        await writeFile(tmp, payload, 'utf8');
        await rename(tmp, statePath);
      } catch (error) {
        log('warn', `状态写入失败：${error?.message ?? error}`);
      }
    }).catch(() => { /* 保持链不断 */ });
    return saveChain;
  };

  const loadState = async () => {
    try {
      const saved = JSON.parse(await readFile(statePath, 'utf8'));
      state.cursor = Number.isFinite(Number(saved?.cursor)) ? Number(saved.cursor) : 0;
      state.lastRunAt = typeof saved?.lastRunAt === 'string' ? saved.lastRunAt : null;
      state.nextRunAt = typeof saved?.nextRunAt === 'string' ? saved.nextRunAt : null;
      state.lastError = saved?.lastError && typeof saved.lastError === 'object' ? saved.lastError : null;
      state.cards = Array.isArray(saved?.cards)
        // 旧版卡片没有 gist/terms，直接丢弃，避免界面拿到半截数据
        ? saved.cards.filter((c) => c && typeof c.id === 'string' && c.cite
          && typeof c.cite.text === 'string' && typeof c.gist === 'string' && Array.isArray(c.terms))
        : [];
      state.readSegments = saved?.readSegments && typeof saved.readSegments === 'object' && !Array.isArray(saved.readSegments)
        ? Object.fromEntries(Object.entries(saved.readSegments)
          .filter(([, list]) => Array.isArray(list))
          .map(([id, list]) => [id, list.map(Number).filter((n) => Number.isFinite(n) && n > 0)]))
        : {};
      state.lastSegment = saved?.lastSegment && typeof saved.lastSegment === 'object'
        && typeof saved.lastSegment.sutraId === 'string' && Number.isFinite(Number(saved.lastSegment.no))
        ? { sutraId: saved.lastSegment.sutraId, no: Number(saved.lastSegment.no) }
        : null;
      trim();
    } catch { /* 首次运行：空状态 */ }
  };

  const loadCorpus = async () => {
    try {
      const manifest = JSON.parse(await readFile(corpusPath, 'utf8'));
      const manifestErrors = validateCorpus(manifest);
      if (manifestErrors.length) throw new FojingPetError(manifestErrors.slice(0, 3).join('；'));
      const sutras = [];
      for (const file of manifest.sutras) {
        const doc = JSON.parse(await readFile(join(corpusDir, file), 'utf8'));
        const errors = validateSutra(doc);
        if (errors.length) throw new FojingPetError(errors.slice(0, 3).join('；'));
        sutras.push(doc);
      }
      corpus = {
        sutras,
        edition: typeof manifest.edition === 'string' ? manifest.edition : '',
        segments: flattenSegments(sutras),
      };
      corpusError = null;
      log('info', `已载入 ${sutras.length} 部经，共 ${corpus.segments.length} 句`);
    } catch (error) {
      corpus = { sutras: [], edition: '', segments: [] };
      corpusError = String(error?.message ?? error).slice(0, 300);
      log('warn', `语料加载失败：${corpusError}`);
    }
  };

  const trim = () => {
    state.cards.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    if (state.cards.length > cfg.maxCards) state.cards.length = cfg.maxCards;
  };

  const ready = Promise.all([loadState(), loadCorpus()]).catch((error) => {
    log('warn', `初始化失败：${error?.message ?? error}`);
  });

  // --- 联网取经 -------------------------------------------------------------
  // 只从 fojing.com 抓正文；抓回来的是**原文草稿**，释义/名相/练习留空待补。
  let importing = false;

  const catalogState = () => IMPORT_CATALOG.map((entry) => ({
    id: entry.id,
    title: entry.title,
    fullTitle: entry.fullTitle,
    translator: entry.translator || '',
    category: entry.category || '',
    source: entry.source || '',
    unit: entry.unit || '句',
    hint: entry.hint || '',
    installed: corpus.sutras.some((s) => s.id === entry.id),
  }));

  const fetchPage = async (url) => {
    if (!isAllowedUrl(url)) throw new FojingPetError('只支持 fojing.com 的经文页');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(url, {
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; dsh-plugin-fojing-pet)' },
        signal: controller.signal,
        redirect: 'follow',
      });
      if (!response.ok) throw new FojingPetError(`抓取失败：HTTP ${response.status}`);
      const html = await response.text();
      if (html.length > 4000000) throw new FojingPetError('页面太大了，不像是经文页');
      return html;
    } finally {
      clearTimeout(timer);
    }
  };

  const importSutra = async (payload = {}) => {
    await ready;
    if (importing) return { ok: false, error: '正在取经，稍等一下' };
    let entry = null;
    if (typeof payload.catalogId === 'string' && payload.catalogId) {
      entry = IMPORT_CATALOG.find((item) => item.id === payload.catalogId) || null;
      if (!entry) throw new FojingPetError(`没有这个经目：${payload.catalogId}`);
    } else if (typeof payload.url === 'string' && payload.url.trim()) {
      entry = entryFromUrl(payload.url.trim());
      if (!entry) throw new FojingPetError('只支持 fojing.com 的经文页');
    } else {
      throw new FojingPetError('需要 catalogId 或 url');
    }
    entry = { ...entry };
    if (corpus.sutras.some((s) => s.id === entry.id)) {
      throw new FojingPetError(`《${entry.title}》已经在语料里了`);
    }
    importing = true;
    try {
      const html = await fetchPage(entry.url);
      if (entry.titleFromPage) {
        const title = cleanTitle(pageTitle(html), entry.title);
        if (title) { entry.title = title.slice(0, 24); entry.fullTitle = title; }
      }
      const sliced = sliceBody(stripHtmlLines(html), entry.start, entry.end);
      if (!sliced.ok) throw new FojingPetError(sliced.error);
      const built = buildDraft(entry, sliced.lines);
      if (!built.ok) throw new FojingPetError(built.error);
      await writeFile(join(corpusDir, `${entry.id}.json`), JSON.stringify(built.doc, null, 2) + '\n', 'utf8');
      const manifest = JSON.parse(await readFile(corpusPath, 'utf8'));
      const files = Array.isArray(manifest.sutras) ? manifest.sutras : [];
      if (!files.includes(`${entry.id}.json`)) files.push(`${entry.id}.json`);
      manifest.sutras = files;
      await writeFile(corpusPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
      await loadCorpus();
      const chars = built.doc.segments.reduce((sum, seg) => sum + seg.text.length, 0);
      log('info', `取经完成：${entry.fullTitle}（${built.doc.segments.length} 段 / ${chars} 字）`);
      return {
        ok: true,
        id: entry.id,
        title: entry.title,
        count: built.doc.segments.length,
        chars,
        total: corpus.sutras.length,
      };
    } finally {
      importing = false;
    }
  };

  // --- 出卡 ---------------------------------------------------------------
  /**
   * 挑下一句：指定 sutraId 时取那部经的第一句未读，否则顺着语料顺序走。
   * 「第一句未读」由逐句面板的已读记录决定，不依赖卡片历史。
   */
  const pickSegment = (sutraId) => {
    if (!sutraId) return corpus.segments[state.cursor % corpus.segments.length] || null;
    const sutra = corpus.sutras.find((s) => s.id === sutraId);
    if (!sutra) return null;
    const done = new Set(state.readSegments[sutra.id] || []);
    const target = sutra.segments.find((seg) => !done.has(Number(seg.no))) || sutra.segments[0];
    return corpus.segments.find((seg) => seg.sutraId === sutra.id && seg.no === Number(target.no)) || null;
  };

  const runOnce = async (reason = 'manual', sutraId = '') => {
    await ready;
    if (running) return { ok: true, running: true, card: null };
    if (!corpus.segments.length) {
      const message = corpusError || '语料为空';
      state.lastError = { at: new Date().toISOString(), message };
      await persist();
      return { ok: false, running: false, card: null, error: message };
    }
    running = true;
    try {
      const segment = pickSegment(sutraId);
      if (!segment) throw new Error(`没有找到经书 ${sutraId}`);
      state.cursor = (corpus.segments.indexOf(segment) + 1) % corpus.segments.length;
      const card = makeCard(segment);
      state.cards.unshift(card);
      trim();
      state.lastRunAt = card.at;
      state.lastError = null;
      await persist();
      log('info', `已出卡（${reason} · ${card.sutraTitle} 第${card.no}句）`);
      return { ok: true, running: false, card };
    } catch (error) {
      state.lastError = { at: new Date().toISOString(), message: String(error?.message ?? error).slice(0, 300) };
      await persist().catch(() => {});
      return { ok: false, running: false, card: null, error: String(error?.message ?? error) };
    } finally {
      running = false;
    }
  };

  /** 某部经的已读进度。 */
  const progressOf = (sutraId) => {
    const sutra = corpus.sutras.find((s) => s.id === sutraId);
    if (!sutra) return { read: 0, total: 0 };
    const done = new Set(state.readSegments[sutraId] || []);
    return { read: sutra.segments.filter((seg) => done.has(Number(seg.no))).length, total: sutra.segments.length };
  };

  /** 整部经 + 每句已读标记，供逐句学习视图使用。 */
  const sutraPayload = (sutraId) => {
    const sutra = corpus.sutras.find((s) => s.id === sutraId) || corpus.sutras[0];
    if (!sutra) return null;
    const done = new Set(state.readSegments[sutra.id] || []);
    return {
      id: sutra.id,
      title: sutra.title,
      fullTitle: sutra.fullTitle || sutra.title,
      translator: sutra.translator || '',
      category: sutra.category || '',
      source: sutra.source || '',
      intro: sutra.intro || '',
      unit: sutra.unit || '句',
      edition: corpus.edition,
      draft: Boolean(sutra.draft),
      progress: progressOf(sutra.id),
      segments: sutra.segments.map((seg) => ({
        no: Number(seg.no),
        label: seg.label || '',
        text: seg.text,
        gist: seg.gist || '',
        terms: Array.isArray(seg.terms) ? seg.terms : [],
        practice: seg.practice || '',
        read: done.has(Number(seg.no)),
      })),
    };
  };

  const snapshot = () => {
    const now = new Date();
    const unread = state.cards.filter((c) => !c.read);
    const todayRuns = state.cards.filter((c) => {
      const at = Date.parse(c.at);
      return Number.isFinite(at) && at >= startOfLocalDay(now);
    }).length;
    return {
      version: 1,
      enabled: cfg.enabled,
      running,
      mode: 'corpus',
      everySeconds: cfg.everySeconds,
      now: now.toISOString(),
      lastRunAt: state.lastRunAt,
      nextRunAt: state.nextRunAt,
      lastError: state.lastError,
      unread: unread.length,
      todayRuns,
      dailyLimit: cfg.dailyLimit,
      current: unread.length ? unread[0] : (state.cards[0] || null),
      cards: state.cards,
      lastSegment: state.lastSegment,
      progress: Object.fromEntries(corpus.sutras.map((s) => [s.id, progressOf(s.id)])),
      corpus: {
        edition: corpus.edition,
        sutras: corpus.sutras.map((s) => ({
          id: s.id,
          title: s.title,
          fullTitle: s.fullTitle || s.title,
          translator: s.translator || '',
          category: s.category || '',
          intro: s.intro || '',
          unit: s.unit || '句',
          draft: Boolean(s.draft),
          segments: s.segments.length,
          count: s.segments.length,
        })),
        count: corpus.segments.length,
        error: corpusError,
      },
      pet: {
        name: PET_NAME,
        sprites: Object.fromEntries(Object.keys(SPRITES).map((key) => [key, `${ROUTES.asset}?name=${key}`])),
      },
    };
  };

  // --- 调度 ---------------------------------------------------------------
  const later = (fn, ms) => {
    if (typeof ctx.timeout === 'function') return ctx.timeout(fn, ms);
    const handle = setTimeout(fn, ms);
    handle.unref?.();
    return () => clearTimeout(handle);
  };

  const clearPending = () => {
    if (typeof pendingTimer === 'function') {
      try { pendingTimer(); } catch { /* 已释放 */ }
    }
    pendingTimer = null;
  };

  const arm = () => {
    clearPending();
    if (!cfg.enabled) { state.nextRunAt = null; return; }
    const now = Date.now();
    let target = state.nextRunAt ? Date.parse(state.nextRunAt) : NaN;
    if (!Number.isFinite(target)) {
      target = now + cfg.firstDelaySeconds * 1000;
    } else if (target <= now) {
      target = now + Math.min(cfg.firstDelaySeconds, 20) * 1000;
    }
    state.nextRunAt = new Date(target).toISOString();
    pendingTimer = later(() => { void tick(); }, Math.max(0, target - Date.now()));
  };

  const tick = async () => {
    pendingTimer = null;
    const now = new Date();
    if (isQuietAt(now, cfg.quietHours)) {
      state.nextRunAt = quietEnd(now, cfg.quietHours).toISOString();
      await persist();
      arm();
      return;
    }
    const runsToday = state.cards.filter((c) => {
      const at = Date.parse(c.at);
      return Number.isFinite(at) && at >= startOfLocalDay(now);
    }).length;
    if (cfg.dailyLimit > 0 && runsToday >= cfg.dailyLimit) {
      state.nextRunAt = new Date(Math.max(now.getTime() + 60000, startOfLocalDay(now) + DAY)).toISOString();
      await persist();
      arm();
      return;
    }
    await runOnce('schedule');
    state.nextRunAt = new Date(Date.now() + cfg.everySeconds * 1000).toISOString();
    await persist();
    arm();
  };

  ctx.effect(() => () => { clearPending(); }, 'fojing-pet.timer');

  // --- HTTP ---------------------------------------------------------------
  const json = (body, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
  const text = (body, status = 200) => new Response(body, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });

  const readBody = async (request) => {
    try {
      const raw = await request.text();
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  };

  // --- 功课：读 DSH 自己的工作状态 -------------------------------------------
  // 会话列表 / todos / token / 时长都在宿主这边折叠好，Web 和桌面壳读同一份 JSON：
  // 两边不用各写一套，也不去解析会话日志（那是几百 MB 的 zstd）。
  let sessionQuery = null;
  let agentRegistry = null;
  ctx.inject?.(['sessionQuery'], (scope) => { sessionQuery = scope.sessionQuery; });
  ctx.inject?.(['agents'], (scope) => { agentRegistry = scope.agents; });

  const WORK = {
    roots: 6,        // 面板最多列几个「项目」
    children: 3,     // 每个项目最多带几个子 agent
    todos: 12,       // 每个项目最多带几条子任务
    ttl: 2500,       // 整份快照的缓存时长（客户端约 5s 拉一次）
    obsIdle: 20000,  // 空闲会话的投影缓存时长
    obsBusy: 3000,   // 在跑会话的投影缓存时长
  };

  const obsCache = new Map();

  const observeValues = async (id, ttl) => {
    const now = Date.now();
    const hit = obsCache.get(id);
    if (hit !== undefined && now - hit.at < ttl) return hit.values;
    let values = {};
    try {
      const observation = await sessionQuery.observeSession(id);
      values = observation?.projections?.values || {};
    } catch { values = {}; }   // 冷会话读失败就当没有，不往面板里塞报错
    obsCache.set(id, { at: now, values });
    if (obsCache.size > 240) {
      for (const key of obsCache.keys()) {
        if (obsCache.size <= 200) break;
        obsCache.delete(key);
      }
    }
    return values;
  };

  const isRunning = (id) => {
    try { return agentRegistry?.get?.(id)?.status === 'running'; } catch { return false; }
  };

  const tokenTotal = (usage) => (usage
    ? (usage.uncachedInputTokens || 0) + (usage.outputTokens || 0)
      + (usage.cacheReadTokens || 0) + (usage.cacheWriteTokens || 0)
    : 0);

  const projectNameOf = (cwd) => {
    const text = String(cwd || '').replace(/[\\/]+$/, '');
    const cut = Math.max(text.lastIndexOf('\\'), text.lastIndexOf('/'));
    return cut >= 0 ? text.slice(cut + 1) : text;
  };

  const workItem = async (record, now) => {
    const header = record?.header || {};
    const id = String(header.id || '');
    const running = isRunning(id);
    const values = await observeValues(id, running ? WORK.obsBusy : WORK.obsIdle);
    const todos = Array.isArray(values.todos) ? values.todos : [];
    const usage = values.tokenUsage || null;
    const stats = values.sessionStats || null;
    const createdAt = Number(header.createdAt || 0);
    const lastPromptAt = Number(values.sessionListMetadata?.lastPromptAt || 0);
    return {
      id,
      short: id.replace(/^session-/, '').slice(0, 8),
      title: typeof values.title === 'string' && values.title ? values.title : projectNameOf(header.cwd),
      project: projectNameOf(header.cwd),
      cwd: header.cwd || '',
      origin: header.origin === 'subagent' ? 'subagent' : 'root',
      parentId: header.parentSession || '',
      preset: header.agentPreset || '',
      running,
      live: record?.live === true,
      createdAt,
      lastPromptAt,
      durationMs: createdAt > 0 ? now - createdAt : 0,
      idleMs: lastPromptAt > 0 ? now - lastPromptAt : 0,
      todos: {
        total: todos.length,
        done: todos.filter((item) => item.status === 'completed').length,
        active: todos.filter((item) => item.status === 'in_progress').length,
        items: todos.slice(0, WORK.todos).map((item) => ({
          content: String(item?.content || '').slice(0, 120),
          status: item?.status === 'completed' || item?.status === 'in_progress' ? item.status : 'pending',
        })),
      },
      tokens: {
        input: usage?.uncachedInputTokens || 0,
        output: usage?.outputTokens || 0,
        cacheRead: usage?.cacheReadTokens || 0,
        cacheWrite: usage?.cacheWriteTokens || 0,
        total: tokenTotal(usage),
      },
      stats: {
        turns: stats?.turns || 0,
        steps: stats?.steps || 0,
        llmMs: stats?.llmMs || 0,
        toolMs: stats?.toolMs || 0,
      },
    };
  };

  // 会话列表按活动时间倒序（宿主已经排好）：根会话取前几个，子 agent 挂在父会话下。
  const workPayload = async () => {
    if (!sessionQuery) return { ok: false, error: '这个组合里没有 sessionQuery，读不到会话' };
    const now = Date.now();
    const records = await sessionQuery.listSessions();
    const roots = [];
    const kids = new Map();
    for (const record of records) {
      const parent = record?.header?.parentSession;
      if (parent) {
        const bucket = kids.get(parent);
        if (bucket === undefined) kids.set(parent, [record]);
        else bucket.push(record);
      } else if (record?.header?.id) {
        roots.push(record);
      }
    }
    const sessions = [];
    for (const root of roots.slice(0, WORK.roots)) {
      const item = await workItem(root, now);
      const bucket = kids.get(item.id) || [];
      const children = [];
      for (const child of bucket.slice(0, WORK.children)) children.push(await workItem(child, now));
      item.children = children;
      item.childCount = bucket.length;
      sessions.push(item);
    }
    sessions.sort((left, right) => (Number(right.running) - Number(left.running))
      || (right.lastPromptAt - left.lastPromptAt));
    const running = sessions.filter((item) => item.running
      || item.children.some((child) => child.running));
    const doneToday = sessions.filter((item) => item.todos.total > 0
      && item.todos.done === item.todos.total).length;
    return {
      ok: true,
      now,
      totalSessions: records.length,
      runningCount: running.length,
      doneCount: doneToday,
      sessions,
    };
  };

  let workCache = { at: 0, value: null };
  const workSnapshot = async () => {
    const now = Date.now();
    if (workCache.value !== null && now - workCache.at < WORK.ttl) return workCache.value;
    const value = await workPayload();
    workCache = { at: Date.now(), value };
    return value;
  };

  const handlers = {
    state: async () => { await ready; return json(snapshot()); },
    corpus: async () => {
      await ready;
      return json({
        edition: corpus.edition,
        error: corpusError,
        sutras: corpus.sutras.map((s) => ({
          id: s.id,
          title: s.title,
          fullTitle: s.fullTitle || s.title,
          translator: s.translator || '',
          category: s.category || '',
          source: s.source || '',
          intro: s.intro || '',
          unit: s.unit || '句',
          draft: Boolean(s.draft),
          count: s.segments.length,
          progress: progressOf(s.id),
        })),
      });
    },
    next: async (request) => {
      await ready;
      const body = request ? await readBody(request).catch(() => ({})) : {};
      const sutraId = typeof body?.sutraId === 'string' ? body.sutraId : '';
      if (running) return json({ ok: true, running: true, card: null }, 202);
      const result = await runOnce('manual', sutraId);
      return json(result, result.ok ? 200 : 500);
    },
    read: async (request) => {
      await ready;
      const body = await readBody(request);
      const target = typeof body.id === 'string' && body.id
        ? state.cards.find((c) => c.id === body.id)
        : state.cards.find((c) => !c.read);
      if (target && !target.read) {
        target.read = true;
        await persist();
      }
      return json({ ok: true, unread: state.cards.filter((c) => !c.read).length });
    },
    sutra: async (request) => {
      await ready;
      let id = '';
      try { id = new URL(request.url, 'http://127.0.0.1').searchParams.get('id') || ''; } catch { /* 默认第一部 */ }
      const payload = sutraPayload(id);
      return payload ? json(payload) : json({ error: '语料未就绪', detail: corpusError }, 500);
    },
    segmentRead: async (request) => {
      await ready;
      const body = await readBody(request);
      const sutraId = typeof body.sutraId === 'string' && body.sutraId ? body.sutraId : (corpus.sutras[0]?.id || '');
      const no = Number(body.no);
      if (!Number.isFinite(no) || no <= 0) return json({ ok: false, error: 'no 必须是正整数' }, 400);
      const list = new Set(state.readSegments[sutraId] || []);
      list.add(no);
      state.readSegments[sutraId] = [...list].sort((a, b) => a - b);
      state.lastSegment = { sutraId, no };
      await persist();
      return json({ ok: true, progress: progressOf(sutraId), read: state.readSegments[sutraId] });
    },
    asset: async (request) => {
      let sprite = 'idle';
      try { sprite = new URL(request.url, 'http://127.0.0.1').searchParams.get('name') || 'idle'; } catch { /* 默认 */ }
      const file = SPRITES[sprite] || SPRITES.idle;
      const full = join(assetsDir, file);
      try {
        const [bytes, info] = await Promise.all([readFile(full), stat(full)]);
        if (!info.size) throw new FojingPetError('空文件');
        return new Response(bytes, {
          headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=3600' },
        });
      } catch {
        return text(`缺少素材：assets/${file}`, 404);
      }
    },
    shell: async (request) => {
      if (request.method !== 'POST') return json(shellStatus());
      const body = await readBody(request);
      const action = String(body.action || '');
      if (action === 'launch') return json(await launchShell(body.origin));
      if (action === 'quit') return json(quitShell());
      if (action === 'heartbeat') return json(shellHeartbeat(body));
      return json({ ok: false, error: 'action 必须是 launch 或 quit' }, 400);
    },
    catalog: async () => {
      await ready;
      return json({ ok: true, importing, items: catalogState() });
    },
    work: async () => {
      await ready;
      try {
        return json(await workSnapshot());
      } catch (error) {
        return json({ ok: false, error: String(error?.message || error).slice(0, 160) });
      }
    },
    import: async (request) => {
      const body = await readBody(request);
      try {
        const result = await importSutra(body);
        return json(result, result.ok ? 200 : 409);
      } catch (error) {
        const message = String(error?.message ?? error).slice(0, 200);
        log('warn', `取经失败：${message}`);
        return json({ ok: false, error: message }, 400);
      }
    },
  };

  ctx.inject?.(['connection'], (scope) => {
    const routes = [
      { path: ROUTES.state, methods: ['GET'], requestBody: 'buffered', fetch: () => handlers.state() },
      { path: ROUTES.corpus, methods: ['GET'], requestBody: 'buffered', fetch: () => handlers.corpus() },
      { path: ROUTES.sutra, methods: ['GET'], requestBody: 'buffered', fetch: (request) => handlers.sutra(request) },
      { path: ROUTES.next, methods: ['POST'], requestBody: 'buffered', fetch: (request) => handlers.next(request) },
      { path: ROUTES.read, methods: ['POST'], requestBody: 'buffered', fetch: (request) => handlers.read(request) },
      { path: ROUTES.segmentRead, methods: ['POST'], requestBody: 'buffered', fetch: (request) => handlers.segmentRead(request) },
      { path: ROUTES.asset, methods: ['GET'], requestBody: 'buffered', fetch: (request) => handlers.asset(request) },
      { path: ROUTES.shell, methods: ['GET', 'POST'], requestBody: 'buffered', fetch: (request) => handlers.shell(request) },
      { path: ROUTES.catalog, methods: ['GET'], requestBody: 'buffered', fetch: () => handlers.catalog() },
      { path: ROUTES.work, methods: ['GET'], requestBody: 'buffered', fetch: () => handlers.work() },
      { path: ROUTES.import, methods: ['POST'], requestBody: 'buffered', fetch: (request) => handlers.import(request) },
    ];
    const disposers = routes.map((route) => scope.connection.fetch.register(route));
    scope.effect(() => () => {
      for (const dispose of disposers) {
        try { dispose?.(); } catch { /* 已释放 */ }
      }
    }, 'fojing-pet.routes');
  });

  // --- skill：把随包语料与引用规则交给 agent 预设 --------------------------
  ctx.inject?.(['skills'], (scope) => {
    const install = async () => {
      let body = '';
      try {
        body = stripFrontmatter(await readFile(skillPath, 'utf8'));
      } catch {
        body = '';
      }
      const index = corpus.sutras
        .map((s) => `- ${s.id}：${s.fullTitle || s.title}（${s.segments.length} 句${s.translator ? `，${s.translator}` : ''}）`)
        .join('\n');
      const content = [
        body || '# 佛经学习 vademecum\n\n按问题检索内置经文语料，引用时逐字、给出经名与句序。',
        '',
        '## 运行时信息（由插件注入）',
        '',
        `- 语料文件：${corpusPath}`,
        `- 版本：${corpus.edition || '未知'}`,
        `- 句子数：${corpus.segments.length}`,
        '',
        '## 经文索引',
        '',
        index || '（语料尚未就绪）',
        '',
        '## 使用规则',
        '',
        '1. 先读语料文件，按 `sutras[].segments[].no` 定位到具体句子，再用引号逐字引用。',
        '2. 引号里只能出现 `text` 字段的原文，一个字都不能改；`gist` 是逐句释义，`terms` 是名相解释，`practice` 是当天的观察练习。',
        '3. 回答结构：落在哪部经第几句 → 逐字原文 → 释义（可展开名相）→ 今天能做的观察练习。',
        '4. 释义是学习辅助，不要把它说成经文原句，也不要冒充某位古德的原话去引用。',
        '5. 不判定修行境界，不承诺消灾、治病、开悟、转运，不做宗派高下之判，不替代医疗/法律/投资建议。',
        '6. 核不到原文就写「未核到原文」，不要凭记忆补全。',
      ].join('\n');
      const dispose = scope.skills.register({
        name: SKILL_NAME,
        description: `内置 ${corpus.sutras.length} 部汉传佛经的逐句语料（原文 + 释义 + 名相 + 练习）：先索引后原文，逐字引用，再落到当下的观察练习。`,
        whenToUse: '用户问佛经内容、某句经文是什么意思，或需要经文原文支撑时',
        content,
        source: 'bundled',
        resourceBase: { kind: 'directory', path: corpusDir },
        invocation: { modelInvocable: true, userInvocable: true },
      });
      scope.effect(() => () => { try { dispose?.(); } catch { /* 已释放 */ } }, 'fojing-pet.skill');
    };
    void ready.then(install).catch((error) => log('warn', `skill 注册失败：${error?.message ?? error}`));
  });

  // --- 桌面壳：独立进程 + 免鉴权回环路由 -----------------------------------
  let shellChild = null;
  let shellError = null;
  // 手动启动的壳（桌面快捷方式、脚本）Host 是不知道的，靠它自己报到：
  // 否则网页里会再画一只，桌上就站着两只莲鲸。
  let shellBeatAt = 0;
  let shellBeatPid = 0;
  const SHELL_BEAT_TTL = 45000;

  const externalShellAlive = () => {
    if (!shellBeatAt || Date.now() - shellBeatAt > SHELL_BEAT_TTL) return false;
    if (!shellBeatPid) return true;
    try { process.kill(shellBeatPid, 0); return true; } catch { return false; }
  };

  // 「站起来了」以壳自己的心跳为准：进程起来了不等于窗口画出来了（冷启动约 2 秒），
  // 这期间网页里那只不能先隐身，否则就是「点了放她到桌面，人不见了」。
  const shellStatus = () => {
    const beat = externalShellAlive();
    return {
      supported: process.platform === 'win32',
      running: !!shellChild || beat,
      // external = 窗口真的在了（心跳从 Loaded 里发出来），跟谁启动的无关
      external: beat,
      starting: !!shellChild && !beat,
      platform: process.platform,
      error: shellError,
    };
  };

  const launchShell = async (origin) => {
    if (process.platform !== 'win32') {
      return { ok: false, ...shellStatus(), error: '当前只有 Windows 悬浮壳实现' };
    }
    if (shellChild) return { ok: true, ...shellStatus() };
    const script = join(here, 'desktop', 'pet-shell.ps1');
    // 只接受回环来源，避免把任意 URL 塞给壳
    const safeOrigin = (() => {
      try {
        const url = new URL(String(origin || ''));
        if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return url.origin;
      } catch { /* 落到默认 */ }
      return 'http://127.0.0.1:10567';
    })();
    try {
      shellError = null;
      shellChild = spawn('powershell.exe', [
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
        '-File', script, '-Origin', safeOrigin, '-AssetDir', assetsDir,
      ], { detached: true, stdio: 'ignore', cwd: here });
      shellChild.on('exit', () => { shellChild = null; });
      shellChild.unref();
      return { ok: true, ...shellStatus() };
    } catch (error) {
      shellError = String(error?.message || error);
      return { ok: false, ...shellStatus(), error: shellError };
    }
  };

  const quitShell = () => {
    if (shellChild) {
      try { shellChild.kill(); } catch { /* 已退出 */ }
      shellChild = null;
    }
    // 自己报到的壳也要能收回来
    if (externalShellAlive() && shellBeatPid) {
      try { process.kill(shellBeatPid); } catch { /* 已退出 */ }
    }
    shellBeatAt = 0;
    shellBeatPid = 0;
    return { ok: true, ...shellStatus() };
  };

  const shellHeartbeat = (body) => {
    const pid = Number(body?.pid);
    shellBeatPid = Number.isInteger(pid) && pid > 0 ? pid : 0;
    shellBeatAt = Date.now();
    return { ok: true, ...shellStatus() };
  };

  if (cfg.publicRoutes) {
    ctx.inject?.(['webServer'], (webCtx) => {
      const server = webCtx?.webServer;
      if (typeof server?.register !== 'function') {
        log('debug', '公开路由不可用（宿主无 webServer）');
        return;
      }
      const register = (path, methods, handler) => server.register({
        kind: 'exact',
        path,
        handler: async (req, res) => {
          if (!methods.includes(req.method)) {
            res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
            res.end('method not allowed');
            return;
          }
          if (req.method === 'POST') {
            const type = String(req.headers['content-type'] || '');
            if (!type.includes('application/json') || req.headers['x-dsh-fojing-pet'] !== '1') {
              res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
              res.end('forbidden');
              return;
            }
          }
          try {
            const chunks = [];
            for await (const chunk of req) chunks.push(chunk);
            const body = chunks.length ? Buffer.concat(chunks).toString('utf8') : '';
            const request = new Request(`http://127.0.0.1${req.url || path}`, {
              method: req.method,
              headers: req.headers,
              body: body || undefined,
            });
            const response = await handler(request);
            res.writeHead(response.status, Object.fromEntries(response.headers));
            res.end(Buffer.from(await response.arrayBuffer()));
          } catch (error) {
            res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
            res.end(String(error?.message || error));
          }
        },
      });
      const disposers = [
        register(SHELL_ROUTES.state, ['GET'], () => handlers.state()),
        register(SHELL_ROUTES.asset, ['GET'], (request) => handlers.asset(request)),
        register(SHELL_ROUTES.sutra, ['GET'], (request) => handlers.sutra(request)),
        register(SHELL_ROUTES.next, ['POST'], (request) => handlers.next(request)),
        register(SHELL_ROUTES.read, ['POST'], (request) => handlers.read(request)),
        register(SHELL_ROUTES.segmentRead, ['POST'], (request) => handlers.segmentRead(request)),
        register(SHELL_ROUTES.catalog, ['GET'], () => handlers.catalog()),
        register(SHELL_ROUTES.import, ['POST'], (request) => handlers.import(request)),
        register(SHELL_ROUTES.heartbeat, ['GET', 'POST'], (request) => handlers.shell(request)),
        register(SHELL_ROUTES.work, ['GET'], () => handlers.work()),
      ];
      webCtx.effect(() => () => {
        for (const dispose of disposers) {
          try { dispose?.(); } catch { /* 已释放 */ }
        }
      }, 'fojing-pet.shell-routes');
    });
  }

  void ready.then(() => {
    if (!cfg.enabled) return;
    arm();
  });

  return { snapshot, runOnce, config: cfg, statePath, corpusPath };
}

export default { name, inject, apply };
