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
};

/** 独立桌面壳用的免鉴权回环路由（只读 + 带自定义头的 POST）。 */
export const SHELL_ROUTES = {
  state: '/dsh-fojing-pet/pet.json',
  asset: '/dsh-fojing-pet/asset.png',
  next: '/dsh-fojing-pet/next',
  read: '/dsh-fojing-pet/read',
  sutra: '/dsh-fojing-pet/sutra.json',
  segmentRead: '/dsh-fojing-pet/segment-read',
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
          segments: s.segments.length,
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
      return json({ ok: false, error: 'action 必须是 launch 或 quit' }, 400);
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

  const shellStatus = () => ({
    supported: process.platform === 'win32',
    running: !!shellChild,
    platform: process.platform,
    error: shellError,
  });

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
