/**
 * Web half of `dsh-plugin-fojing-pet`.
 *
 * 在 Harness 的 shell overlay 里渲染「莲鲸」：右下角一只打坐的鲸鱼娘。
 * 点开是"浅杏古书"卡片——一句经文原文、一段现代小注、一个当天能做的练习；
 * 再点「逐句读」进入整部经的逐句学习视图，带进度与已读标记。
 *
 * 所有内容来自宿主路由，客户端不做内容生成，也不把现代解释伪装成经文原句。
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-fojing-pet',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useLayoutEffect, useRef, useCallback } = React;

    const API = {
      state: '/api/dsh-fojing-pet.state',
      next: '/api/dsh-fojing-pet.next',
      read: '/api/dsh-fojing-pet.read',
      sutra: '/api/dsh-fojing-pet.sutra',
      segmentRead: '/api/dsh-fojing-pet.segment-read',
      shell: '/api/dsh-fojing-pet.shell',
      catalog: '/api/dsh-fojing-pet.catalog',
      import: '/api/dsh-fojing-pet.import',
    };
    const POLL_MS = 20000;
    const POS_KEY = 'dsh-fojing-pet.pos';
    const PET_H = 196;

    const CSS = `
      [data-fojing-pet]{position:fixed;z-index:86;width:220px;font-family:"Microsoft YaHei",Inter,ui-sans-serif,system-ui,"PingFang SC",sans-serif;color:#33555a;font-size:13px;line-height:1.65}
      [data-fojing-pet] *{box-sizing:border-box}
      .fj-anchor{position:relative;display:flex;flex-direction:column;align-items:center;width:100%}
      .fj-pet{position:relative;z-index:1;flex:0 0 auto;display:flex;flex-direction:column;align-items:center;width:100%;cursor:grab;user-select:none;transition:transform .3s cubic-bezier(.22,.61,.36,1)}
      .fj-pet:active{cursor:grabbing}
      .fj-pet:hover{transform:translateY(-4px)}
      .fj-img{display:block;height:${PET_H}px;width:auto;max-width:220px;object-fit:contain;filter:drop-shadow(0 12px 18px rgba(60,90,88,.28));animation:fj-breathe 5.2s ease-in-out infinite}
      .fj-img[data-talking="on"]{animation:fj-bob 2.4s ease-in-out infinite}
      .fj-tag{margin-top:-4px;font-size:10px;font-weight:700;letter-spacing:.08em;color:#3f5f5c;background:rgba(255,251,242,.94);border:1px solid rgba(190,170,135,.5);border-radius:999px;padding:2px 9px;white-space:nowrap;backdrop-filter:blur(8px);box-shadow:0 4px 10px rgba(90,110,100,.14)}
      .fj-dot{display:inline-block;width:6px;height:6px;border-radius:50%;margin-right:5px;background:#8cb7a4;box-shadow:0 0 6px rgba(140,183,164,.8);vertical-align:1px}
      .fj-dot[data-off="off"]{background:#d99b8f;box-shadow:0 0 6px rgba(217,155,143,.8)}
      /* ---- 古书卡片 ---- */
      /* 卡片浮在立绘上方，不参与排版：否则它会把整个浮层撑到视口那么宽 */
      .fj-card{position:absolute;z-index:2;left:50%;bottom:calc(100% + 9px);
        width:min(392px,calc(100vw - 24px));max-height:min(62vh,560px);
        overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;
        transform:translateX(calc(-50% + var(--fj-shift,0px)));
        scrollbar-width:thin;scrollbar-color:#c9b78f #f3e8d2;
        border:1px solid #e7d8ba;border-radius:22px;
        background:linear-gradient(158deg,#fffaf0 0%,#fff7e9 58%,#f8edd8 100%);
        box-shadow:0 22px 48px rgba(90,80,55,.22),0 2px 0 rgba(255,255,255,.9) inset;
        padding:0 0 2px;animation:fj-in .18s ease-out}
      .fj-pet[data-drop="down"] .fj-card{bottom:auto;top:calc(100% + 9px)}
      .fj-card::-webkit-scrollbar{width:8px}
      .fj-card::-webkit-scrollbar-track{background:#f3e8d2;border-radius:8px}
      .fj-card::-webkit-scrollbar-thumb{background:linear-gradient(180deg,#dcca9f,#c2ab7d);border-radius:8px}
      .fj-card::before{content:"";position:absolute;left:0;top:0;bottom:0;width:6px;border-radius:21px 0 0 21px;
        background:linear-gradient(180deg,#f2e2bf,#dcc79c 45%,#cbb283);opacity:.95}
      .fj-tail{position:absolute;z-index:1;left:50%;margin-left:-5px;bottom:calc(100% + 4px);width:10px;height:10px;background:#f8edd8;border-right:1px solid #e7d8ba;border-bottom:1px solid #e7d8ba;transform:rotate(45deg);border-radius:2px}
      .fj-pet[data-drop="down"] .fj-tail{bottom:auto;top:calc(100% + 4px);border:0;border-left:1px solid #e7d8ba;border-top:1px solid #e7d8ba}
      /* 顶部 */
      .fj-head{display:flex;align-items:center;gap:6px;padding:13px 12px 9px 18px}

      .fj-eyebrow{flex:1;min-width:0;font-size:10px;font-weight:800;letter-spacing:.24em;color:#a08a68;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .fj-nav{border:0;background:none;color:#8d7a5c;font-size:15px;line-height:1;padding:1px 5px;cursor:pointer;border-radius:5px}
      .fj-nav:hover:not(:disabled){color:#4a3f2d;background:rgba(200,180,140,.18)}
      .fj-nav:disabled{opacity:.28;cursor:default}
      .fj-nav:focus-visible{outline:2px solid #a9c8bf;outline-offset:2px}
      .fj-close{border:0;background:none;color:#8d7a5c;font-size:15px;line-height:1;padding:2px 5px;cursor:pointer;border-radius:5px}
      .fj-close:hover{color:#4a3f2d;background:rgba(200,180,140,.18)}
      .fj-close:focus-visible{outline:2px solid #a9c8bf;outline-offset:2px}
      /* 正文 */
      .fj-body{padding:2px 18px 14px 20px}
      .fj-title{margin:0 0 4px;font-family:"KaiTi","STKaiti","Noto Serif SC",serif;font-size:24px;font-weight:400;color:#33555a;letter-spacing:.04em}
      .fj-meta{display:flex;align-items:center;gap:7px;margin:0 0 12px;font-size:10.5px;color:#a08a68;flex-wrap:wrap}
      .fj-meta b{font-weight:700;color:#8a7350}
      .fj-rule{height:1px;margin:0 0 12px;background:linear-gradient(90deg,#d9c6a4,#efe3cc 70%,transparent)}
      .fj-rule i{display:block;height:3px;width:64px;background:#8cb7af;border-radius:2px;transform:translateY(-1px)}
      .fj-label{margin:0 0 5px;font-size:10px;font-weight:800;letter-spacing:.16em;color:#8ba59c}
      .fj-cite{margin:0 0 14px;font-family:"KaiTi","STKaiti","Noto Serif SC",serif;font-size:17.5px;line-height:1.95;color:#43584f;white-space:pre-wrap;word-break:break-word}
      .fj-note{margin:0 0 12px;padding:11px 12px;border-radius:13px;background:#f1f6ee;border:1px solid #dbe7db}
      .fj-note p{margin:0;font-size:12.5px;line-height:1.75;color:#485c58;white-space:pre-wrap;word-break:break-word}
      .fj-note small{display:block;margin-top:6px;font-size:9.5px;color:#9aad9f;letter-spacing:.04em}
      .fj-practice{margin:0 0 4px;padding-left:11px;border-left:2px solid #8cb7af;font-size:12.5px;line-height:1.75;color:#3f5f5c;white-space:pre-wrap}
      .fj-keywords{display:flex;flex-wrap:wrap;gap:5px;margin:10px 0 0}
      .fj-kw{font-size:9.5px;font-weight:700;letter-spacing:.06em;color:#6e8f86;background:#eaf2ee;border:1px solid #d6e5dd;border-radius:5px;padding:1px 6px}
      /* 页脚 */
      .fj-foot{display:flex;align-items:center;gap:9px;margin-top:14px;padding-top:10px;border-top:1px solid #eadcc2;flex-wrap:wrap}
      .fj-src{flex:1;min-width:90px;font-size:9.5px;color:#b09b7a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .fj-btn{border:0;background:none;padding:2px 3px;color:#7a8f88;font:inherit;font-size:11.5px;font-weight:650;cursor:pointer;white-space:nowrap;text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:3px;text-decoration-color:rgba(140,183,175,.45)}
      .fj-btn:hover:not(:disabled){color:#33555a;text-decoration-color:#8cb7af}
      .fj-btn:disabled{opacity:.5;cursor:default}
      .fj-btn:focus-visible{outline:2px solid #a9c8bf;outline-offset:2px;border-radius:5px}
      .fj-btn[data-primary="on"]{color:#456d64;font-weight:800;text-decoration-color:#8cb7af}
      .fj-empty{margin:0 0 10px;color:#7a8f88;font-size:12.5px}
      .fj-warn{margin:8px 0 0;font-size:10px;color:#c07d6f}
      .fj-badge{position:absolute;z-index:3;top:2px;right:2px;min-width:18px;height:18px;border-radius:9px;background:#8cb7af;color:#fffdf5;font-size:10px;font-weight:800;line-height:18px;text-align:center;padding:0 4px;box-shadow:0 4px 10px rgba(70,100,95,.35)}
      /* ---- 逐句学习 ---- */
      .fj-progress{display:flex;align-items:center;gap:8px;margin:0 0 12px;font-size:10px;color:#a08a68}
      .fj-bar{flex:1;height:4px;border-radius:2px;background:#eadcc2;overflow:hidden}
      .fj-bar i{display:block;height:100%;border-radius:2px;background:linear-gradient(90deg,#a9c8bf,#7fa79c);transition:width .3s ease}
      .fj-list{display:flex;flex-direction:column;gap:5px;margin:0 0 4px}
      .fj-item{display:flex;gap:8px;align-items:flex-start;width:100%;text-align:left;border:1px solid transparent;border-radius:11px;background:rgba(255,255,255,.5);padding:7px 9px;cursor:pointer;font:inherit;color:#43584f}
      .fj-item:hover{background:#fffdf7;border-color:#e9dcc0}
      .fj-item:focus-visible{outline:2px solid #a9c8bf;outline-offset:1px}
      .fj-item[data-active="on"]{background:#fffdf7;border-color:#cfe0d8;box-shadow:0 2px 8px rgba(120,140,130,.1)}
      .fj-no{flex:0 0 auto;width:17px;height:17px;border-radius:50%;background:#eaf2ee;color:#6e8f86;font-size:9.5px;font-weight:800;line-height:17px;text-align:center;margin-top:1px}
      .fj-item[data-read="on"] .fj-no{background:#8cb7af;color:#fffdf5}
      .fj-txt{flex:1;min-width:0;font-family:"KaiTi","STKaiti","Noto Serif SC",serif;font-size:13.5px;line-height:1.6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .fj-item[data-active="on"] .fj-txt{white-space:normal;font-size:15px;line-height:1.85}
      .fj-detail{margin:8px 0 2px;padding:11px 12px;border-radius:13px;background:#f6f9f2;border:1px solid #e0e9dc}
      .fj-detail p{margin:0 0 8px;font-size:12px;line-height:1.75;color:#485c58;white-space:pre-wrap}
      .fj-detail p:last-child{margin-bottom:0}
      .fj-detail small{display:block;margin-top:5px;font-size:9px;color:#9aad9f}
      .fj-seg-practice{border-left:2px solid #8cb7af;padding-left:10px;color:#3f5f5c}
      /* ---- 经书选择与名相 ---- */
      .fj-picker{display:flex;flex-wrap:wrap;gap:5px;margin:0 0 12px}
      .fj-chip{border:1px solid #e2d3b6;background:rgba(255,255,255,.6);color:#7a6a4e;font:inherit;font-size:11px;font-weight:700;letter-spacing:.02em;padding:3px 9px;border-radius:999px;cursor:pointer;transition:background .15s,border-color .15s,color .15s}
      .fj-chip:hover{background:#fffdf7;border-color:#cbb894;color:#33555a}
      .fj-chip[data-on="on"]{background:#8cb7af;border-color:#8cb7af;color:#fffdf5;box-shadow:0 2px 6px rgba(90,130,120,.25)}
      .fj-chip:focus-visible{outline:2px solid #a9c8bf;outline-offset:2px}
      .fj-intro{margin:0 0 10px;font-size:12px;line-height:1.7;color:#7d8f88;white-space:pre-wrap}
      .fj-cite-label{margin:-8px 0 12px;font-size:10px;letter-spacing:.06em;color:#a8926c}
      .fj-item-label{display:block;margin-bottom:1px;font-family:"Microsoft YaHei",sans-serif;font-size:9.5px;font-style:normal;font-weight:700;letter-spacing:.08em;color:#a8926c}
      .fj-terms{margin:2px 0 9px;padding:0}
      .fj-terms dt{margin:6px 0 1px;font-size:11.5px;font-weight:800;color:#5d7d72;letter-spacing:.02em}
      .fj-terms dd{margin:0;font-size:11.5px;line-height:1.7;color:#63776f}
      .fj-note .fj-terms dt{color:#4f7368}
      .fj-note .fj-terms dd{color:#5c7168}
      .fj-chip-add{background:transparent;border-style:dashed;color:#8a7a5c}
      .fj-chip-add:hover{background:rgba(140,183,175,.14);border-style:solid}
      .fj-chip-dot{display:inline-block;width:4px;height:4px;margin-left:4px;border-radius:50%;background:#c9a24a;vertical-align:2px}
      .fj-fetch-list{display:flex;flex-direction:column;gap:8px;margin:2px 0 12px}
      .fj-fetch-row{display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid rgba(200,180,145,.5);border-radius:10px;background:rgba(255,253,247,.8)}
      .fj-fetch-main{display:flex;flex-direction:column;gap:1px;min-width:0;flex:1}
      .fj-fetch-main b{font-size:13px;color:#33555a}
      .fj-fetch-meta{font-size:10px;color:#a8926c;letter-spacing:.04em}
      .fj-fetch-hint{font-size:10.5px;color:#7b8b83;line-height:1.55}
      .fj-fetch-row .fj-btn{flex:0 0 auto}
      .fj-fetch-custom{display:flex;gap:8px;margin-bottom:10px}
      .fj-input{flex:1;min-width:0;padding:6px 10px;border:1px solid rgba(200,180,145,.65);border-radius:9px;background:#fffdf7;color:#33555a;font:12px/1.5 "Microsoft YaHei",sans-serif}
      .fj-input:focus{outline:none;border-color:#8cb7af;box-shadow:0 0 0 2px rgba(140,183,175,.18)}
      .fj-fetch-msg{margin:0 0 10px;padding:8px 10px;border-radius:9px;background:rgba(140,183,175,.13);color:#3f5f5c;font-size:11.5px;line-height:1.6}
      /* 只动 opacity：transform 被 .fj-card 拿去定位了，动画里再写会把居中覆盖掉 */
      @keyframes fj-in{from{opacity:0}to{opacity:1}}
      @keyframes fj-breathe{0%,100%{transform:translateY(0) scale(1)}50%{transform:translateY(-3px) scale(1.006)}}
      @keyframes fj-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}
      @media (prefers-reduced-motion: reduce){
        [data-fojing-pet] *{animation:none!important;transition:none!important}
        .fj-pet:hover{transform:none}
      }
      @media (max-width:560px){
        .fj-card{width:calc(100vw - 20px);border-radius:18px}
        .fj-body{padding:2px 14px 12px 16px}
        .fj-title{font-size:21px}
        .fj-cite{font-size:16.5px}
      }
    `;

    // --- 位置 ----------------------------------------------------------------
    const readPos = () => {
      try {
        const saved = JSON.parse(window.localStorage.getItem(POS_KEY) || 'null');
        if (!saved || !Number.isFinite(saved.x) || !Number.isFinite(saved.y)) return null;
        return { x: saved.x, y: saved.y };
      } catch { return null; }
    };
    const writePos = (pos) => {
      try { window.localStorage.setItem(POS_KEY, JSON.stringify(pos)); } catch { /* 位置只是尽力而为 */ }
    };
    // 只夹立绘本身（220×约 224），卡片会自动找地方站，超出视口时再自己挪
    const clampPos = (pos) => ({
      x: Math.max(8, Math.min(pos.x, Math.max(8, window.innerWidth - 228))),
      y: Math.max(8, Math.min(pos.y, Math.max(8, window.innerHeight - 240))),
    });

    const getJson = async (url) => {
      const sep = url.includes('?') ? '&' : '?';
      const response = await fetch(`${url}${sep}t=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`${url} ${response.status}`);
      return response.json();
    };
    const post = async (url, body) => {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body || {}),
      });
      let payload = null;
      try { payload = await response.json(); } catch { payload = null; }
      if (!response.ok && !payload?.running) {
        throw new Error(payload?.error || `${url} ${response.status}`);
      }
      return payload;
    };

    const mmss = (delta) => {
      if (!Number.isFinite(delta)) return '';
      const total = Math.max(0, Math.round(delta / 1000));
      const hours = Math.floor(total / 3600);
      const minutes = Math.floor((total % 3600) / 60);
      return hours > 0 ? `${hours}h${String(minutes).padStart(2, '0')}m` : `${minutes}m`;
    };

    function Pet() {
      const [data, setData] = useState(null);
      const [error, setError] = useState(null);
      const [busy, setBusy] = useState(false);
      const [open, setOpen] = useState(false);
      const [view, setView] = useState('card');
      const [sutra, setSutra] = useState(null);
      const [studyNo, setStudyNo] = useState(null);
      const [shell, setShell] = useState(null);
      const [shellBusy, setShellBusy] = useState(false);
      const [catalog, setCatalog] = useState(null);
      const [importBusy, setImportBusy] = useState('');
      const [importMsg, setImportMsg] = useState('');
      const [customUrl, setCustomUrl] = useState('');
      const [pos, setPos] = useState(readPos);
      const [spriteBroken, setSpriteBroken] = useState(false);
      const [cardMax, setCardMax] = useState(0);
      const [drop, setDrop] = useState('up');
      const [shift, setShift] = useState(0);
      const cardEl = useRef(null);
      const petEl = useRef(null);
      const drag = useRef(null);
      const suppress = useRef(false);
      const pinned = useRef(null);
      const marked = useRef(new Set());
      const [, setClock] = useState(0);

      const history = (data?.cards || []).filter((c) => c && c.cite);
      const current = (pinned.current && history.find((c) => c.id === pinned.current)) || history[0] || null;
      const index = current ? history.findIndex((c) => c.id === current.id) : -1;
      const older = index >= 0 && index < history.length - 1;
      const newer = index > 0;
      const running = !!(data?.running || busy);
      const unread = Number(data?.unread || 0);
      const online = !error;
      const countdown = data?.nextRunAt ? Date.parse(data.nextRunAt) - Date.now() : NaN;

      const refresh = useCallback(async () => {
        try {
          const [next, shellState] = await Promise.all([
            getJson(API.state),
            getJson(API.shell).catch(() => null),
          ]);
          setData(next);
          setShell(shellState);
          setError(null);
          return next;
        } catch (failure) {
          setError(String(failure?.message || failure));
          return null;
        }
      }, []);

      useEffect(() => {
        let cancelled = false;
        let handle = null;
        const loop = async () => {
          if (cancelled) return;
          if (!document.hidden) await refresh();
          handle = window.setTimeout(loop, running ? 4000 : POLL_MS);
        };
        void loop();
        const onVisible = () => { if (!document.hidden) void refresh(); };
        document.addEventListener('visibilitychange', onVisible);
        return () => {
          cancelled = true;
          if (handle) window.clearTimeout(handle);
          document.removeEventListener('visibilitychange', onVisible);
        };
      }, [refresh, running]);

      useEffect(() => {
        if (!open) return undefined;
        const handle = window.setInterval(() => setClock((n) => n + 1), 1000);
        return () => window.clearInterval(handle);
      }, [open]);

      // 打开卡片即已读
      useEffect(() => {
        if (!open || view !== 'card' || !current || current.read || marked.current.has(current.id)) return;
        marked.current.add(current.id);
        void post(API.read, { id: current.id }).then(() => refresh()).catch(() => { /* 下次轮询会补上 */ });
      }, [open, view, current, refresh]);

      const sprite = () => {
        const sprites = data?.pet?.sprites;
        if (!sprites || spriteBroken) return '';
        if (view === 'study' || view === 'fetch' || (open && current)) return sprites.read || sprites.idle;
        if (unread > 0) return sprites.open || sprites.idle;
        return sprites.idle || '';
      };

      const startDrag = (event) => {
        if (event.button !== 0) return;
        const rect = event.currentTarget.closest('[data-fojing-pet]')?.getBoundingClientRect();
        if (!rect) return;
        drag.current = { dx: event.clientX - rect.left, dy: event.clientY - rect.top, moved: false };
        event.currentTarget.setPointerCapture?.(event.pointerId);
      };
      const onDrag = (event) => {
        if (!drag.current) return;
        const nextX = event.clientX - drag.current.dx;
        const nextY = event.clientY - drag.current.dy;
        if (Math.abs(nextX - (pos?.x ?? nextX)) > 3 || Math.abs(nextY - (pos?.y ?? nextY)) > 3) drag.current.moved = true;
        setPos(clampPos({ x: nextX, y: nextY }));
      };
      const endDrag = () => {
        if (!drag.current) return;
        suppress.current = drag.current.moved;
        drag.current = null;
        if (pos) writePos(pos);
      };

      const close = () => {
        setOpen(false);
        setView('card');
        pinned.current = null;
      };

      const regenerate = async () => {
        if (running) return;
        setBusy(true);
        try {
          await post(API.next);
          pinned.current = null;
          setView('card');
          await refresh();
        } catch (failure) {
          setError(String(failure?.message || failure));
        } finally {
          setBusy(false);
        }
      };

      const navigate = (delta) => {
        const target = history[index + delta];
        if (!target) return;
        pinned.current = target.id;
        setClock((n) => n + 1);
      };

      // 在卡片上直接换经书：让服务端从那部经的第一句未读重新出一张
      const switchCardSutra = async (sutraId) => {
        if (!sutraId || current?.sutraId === sutraId || running) return;
        setBusy(true);
        try {
          await post(API.next, { sutraId });
          pinned.current = null;
          setView('card');
          await refresh();
        } catch (failure) {
          setError(String(failure?.message || failure));
        } finally {
          setBusy(false);
        }
      };

      const loadSutra = async (sutraId) => {
        const url = sutraId ? `${API.sutra}?id=${encodeURIComponent(sutraId)}` : API.sutra;
        const payload = await getJson(url);
        setSutra(payload);
        return payload;
      };

      const openStudy = async () => {
        try {
          const payload = await loadSutra(current?.sutraId || '');
          const startNo = current?.no && payload.id === current.sutraId && payload.segments.some((s) => s.no === current.no)
            ? current.no
            : (payload.segments.find((s) => !s.read)?.no || payload.segments[0]?.no || 1);
          setStudyNo(startNo);
          setView('study');
        } catch (failure) {
          setError(String(failure?.message || failure));
        }
      };

      const switchSutra = async (sutraId) => {
        if (sutra && sutra.id === sutraId) return;
        try {
          const payload = await loadSutra(sutraId);
          setStudyNo(payload.segments.find((s) => !s.read)?.no || payload.segments[0]?.no || 1);
        } catch (failure) {
          setError(String(failure?.message || failure));
        }
      };

      const markSegment = async (no) => {
        setStudyNo(no);
        if (!sutra) return;
        const existing = sutra.segments.find((s) => s.no === no);
        if (!existing || existing.read) return;
        try {
          const result = await post(API.segmentRead, { sutraId: sutra.id, no });
          setSutra((prev) => prev ? {
            ...prev,
            progress: result.progress || prev.progress,
            segments: prev.segments.map((s) => (s.no === no ? { ...s, read: true } : s)),
          } : prev);
        } catch { /* 学一句不因为写状态失败而中断 */ }
      };

      // --- 联网取经 ----------------------------------------------------------
      const openFetch = async () => {
        setView('fetch');
        setImportMsg('');
        try {
          const payload = await getJson(API.catalog);
          setCatalog(payload?.items || []);
        } catch (failure) {
          setImportMsg(String(failure?.message || failure));
        }
      };

      const runImport = async (payload) => {
        const key = payload.catalogId || payload.url || 'custom';
        if (importBusy) return;
        setImportBusy(key);
        setImportMsg('正在联网取原文…');
        try {
          const result = await post(API.import, payload);
          if (result?.ok) {
            setImportMsg(`已取回《${result.title}》· ${result.count} 段 / ${result.chars} 字。原文进来了，释义与名相还空着，先读原文。`);
            setCustomUrl('');
            const next = await getJson(API.catalog).catch(() => null);
            if (next?.items) setCatalog(next.items);
            await refresh();
          } else {
            setImportMsg(result?.error || '取经失败');
          }
        } catch (failure) {
          setImportMsg(String(failure?.message || failure));
        } finally {
          setImportBusy('');
        }
      };

      const toggleShell = async () => {
        if (shellBusy) return;
        setShellBusy(true);
        try {
          const action = shell?.running ? 'quit' : 'launch';
          const result = await post(API.shell, { action, origin: window.location.origin });
          setShell(result);
        } catch (failure) {
          setShell((prev) => ({ ...(prev || {}), error: String(failure?.message || failure) }));
        } finally {
          setShellBusy(false);
        }
      };

      // --- 卡片定位 ----------------------------------------------------------
      // 卡片是绝对定位浮在立绘上方的，所以「放不放得下」得自己量：
      // 上面不够高就往下开，左右贴边就用 translateX 推回来。
      const measureCard = useCallback(() => {
        const pet = petEl.current;
        if (!pet) return;
        const rect = pet.getBoundingClientRect();
        const spaceUp = Math.max(0, rect.top - 14);
        const spaceDown = Math.max(0, window.innerHeight - rect.bottom - 14);
        const down = spaceUp < 300 && spaceDown > spaceUp;
        setDrop(down ? 'down' : 'up');
        setCardMax(Math.max(180, Math.min(560, down ? spaceDown : spaceUp)));
      }, []);

      useLayoutEffect(() => {
        if (!open) { setShift(0); setCardMax(0); return; }
        measureCard();
        const card = cardEl.current;
        if (!card) return;
        const rect = card.getBoundingClientRect();
        if (rect.left < 8) setShift((s) => s + Math.round(8 - rect.left));
        else if (rect.right > window.innerWidth - 8) {
          setShift((s) => s + Math.round(window.innerWidth - 8 - rect.right));
        }
      }, [open, view, current, sutra, pos, measureCard, shift]);

      useEffect(() => {
        if (!open) return undefined;
        const onResize = () => { setShift(0); measureCard(); };
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
      }, [open, measureCard]);

      // --- 逐句学习视图 ------------------------------------------------------
      const termList = (terms, key) => (Array.isArray(terms) && terms.length
        ? h('dl', { className: 'fj-terms', key },
          terms.map((term, i) => h(React.Fragment, { key: `${term.word}-${i}` },
            h('dt', null, term.word),
            h('dd', null, term.gloss))))
        : null);

      const sutraPicker = () => {
        const list = data?.corpus?.sutras || [];
        if (list.length < 2) return null;
        return h('div', { className: 'fj-picker', role: 'tablist', 'aria-label': '选择经书' },
          list.map((item) => h('button', {
            key: item.id,
            type: 'button',
            role: 'tab',
            className: 'fj-chip',
            'data-on': sutra && sutra.id === item.id ? 'on' : 'off',
            'aria-selected': sutra && sutra.id === item.id ? 'true' : 'false',
            onClick: () => { void switchSutra(item.id); },
            title: `${item.fullTitle} · ${item.count} ${item.unit || '句'}${item.draft ? '（原文草稿）' : ''}`,
          }, item.title,
          item.draft ? h('i', { className: 'fj-chip-dot', 'aria-hidden': true }) : null)),
          h('button', {
            key: '__fetch',
            type: 'button',
            className: 'fj-chip fj-chip-add',
            'data-on': 'off',
            onClick: () => { void openFetch(); },
            title: '从 fojing.com 再取一部经的原文',
          }, '＋ 取经'));
      };

      const studyView = () => {
        if (!sutra) return h('div', { className: 'fj-body' }, h('p', { className: 'fj-empty' }, '正在展开经文…'));
        const active = sutra.segments.find((s) => s.no === studyNo) || null;
        const percent = sutra.progress.total ? Math.round((sutra.progress.read / sutra.progress.total) * 100) : 0;
        return h(React.Fragment, null,
          h('div', { className: 'fj-head' },
            h('span', { className: 'fj-eyebrow' }, '逐句读'),
            h('button', { className: 'fj-close', type: 'button', onClick: () => setView('card'), 'aria-label': '回到今日卡片' }, '×')),
          h('div', { className: 'fj-body' },
            sutraPicker(),
            h('h3', { className: 'fj-title' }, sutra.fullTitle),
            sutra.intro ? h('p', { className: 'fj-intro' }, sutra.intro) : null,
            h('div', { className: 'fj-meta' },
              h('b', null, sutra.category || sutra.title),
              h('span', null, `已读 ${sutra.progress.read} / ${sutra.progress.total} ${sutra.unit || '句'}`),
              sutra.translator ? h('span', null, sutra.translator) : null),
            h('div', { className: 'fj-progress' },
              h('div', { className: 'fj-bar', 'aria-hidden': true }, h('i', { style: { width: `${percent}%` } })),
              h('span', null, `${percent}%`)),
            h('div', { className: 'fj-list', role: 'list' },
              sutra.segments.map((seg) => h(React.Fragment, { key: seg.no },
                h('button', {
                  type: 'button',
                  className: 'fj-item',
                  'data-active': seg.no === studyNo ? 'on' : 'off',
                  'data-read': seg.read ? 'on' : 'off',
                  onClick: () => { void markSegment(seg.no); },
                  'aria-label': `第 ${seg.no} 句${seg.label ? '·' + seg.label : ''}${seg.read ? '（已读）' : ''}`,
                },
                h('span', { className: 'fj-no' }, String(seg.no)),
                h('span', { className: 'fj-txt' },
                  seg.label ? h('em', { className: 'fj-item-label' }, seg.label) : null,
                  seg.text)),
                seg.no === studyNo
                  ? h('div', { className: 'fj-detail' },
                    h('p', { className: 'fj-label' }, '释义'),
                    h('p', null, seg.gist),
                    termList(seg.terms, 'terms'),
                    seg.practice ? h('p', { className: 'fj-seg-practice' }, '今日练习：' + seg.practice) : null)
                  : null))),
            active && active.label
              ? h('p', { className: 'fj-src' }, `本句出处：${sutra.fullTitle} · 第 ${active.no} ${sutra.unit || '句'} · ${active.label}`)
              : null,
            h('div', { className: 'fj-foot' },
              h('span', { className: 'fj-src' }, sutra.source || sutra.edition || '内置语料'),
              h('button', { className: 'fj-btn', type: 'button', onClick: () => setView('card') }, '回到卡片'))));
      };

      // --- 取经（联网） ------------------------------------------------------
      const fetchView = () => h(React.Fragment, null,
        h('div', { className: 'fj-head' },
          h('span', { className: 'fj-eyebrow' }, '取经 · 联网'),
          h('button', { className: 'fj-close', type: 'button', onClick: () => setView('study'), 'aria-label': '回到逐句读' }, '×')),
        h('div', { className: 'fj-body' },
          h('p', { className: 'fj-intro' },
            '从 fojing.com 取一部经的原文，存进本地语料。取回来的只有原文——释义、名相、练习是另写的，机器抓不来，会留空待补。'),
          catalog === null
            ? h('p', { className: 'fj-empty' }, '正在取经目…')
            : h('div', { className: 'fj-fetch-list', role: 'list' },
              catalog.map((item) => h('div', { key: item.id, className: 'fj-fetch-row', role: 'listitem' },
                h('div', { className: 'fj-fetch-main' },
                  h('b', null, item.title),
                  h('span', { className: 'fj-fetch-meta' }, `${item.source || 'fojing.com'} · ${item.unit || '句'}`),
                  item.hint ? h('span', { className: 'fj-fetch-hint' }, item.hint) : null),
                h('button', {
                  type: 'button',
                  className: 'fj-btn',
                  disabled: item.installed || Boolean(importBusy),
                  onClick: () => { void runImport({ catalogId: item.id }); },
                }, item.installed ? '已收录' : importBusy === item.id ? '取回中…' : '取这部')))),
          h('div', { className: 'fj-fetch-custom' },
            h('input', {
              type: 'url',
              className: 'fj-input',
              placeholder: '也可以贴一个 fojing.com 的经文页链接',
              value: customUrl,
              onChange: (event) => setCustomUrl(event.target.value),
            }),
            h('button', {
              type: 'button',
              className: 'fj-btn',
              disabled: Boolean(importBusy) || !customUrl.trim(),
              onClick: () => { void runImport({ url: customUrl.trim() }); },
            }, importBusy ? '取回中…' : '取链接')),
          importMsg ? h('p', { className: 'fj-fetch-msg' }, importMsg) : null,
          h('div', { className: 'fj-foot' },
            h('button', { className: 'fj-btn', type: 'button', onClick: () => setView('study') }, '回到逐句读'))));

      // --- 今日卡片 ----------------------------------------------------------
      const cardView = () => (current
        ? h('div', null,
          h('div', { className: 'fj-head' },
            h('span', { className: 'fj-eyebrow' }, '莲鲸手记 · 今日读经'),
            h('button', { className: 'fj-nav', type: 'button', disabled: !older, onClick: () => navigate(1), 'aria-label': '更早一条' }, '‹'),
            h('button', { className: 'fj-nav', type: 'button', disabled: !newer, onClick: () => navigate(-1), 'aria-label': '更新一条' }, '›'),
            h('button', { className: 'fj-close', type: 'button', onClick: close, 'aria-label': '收起卡片' }, '×')),
          h('div', { className: 'fj-body' },
            h('h3', { className: 'fj-title' }, current.fullTitle || current.sutraTitle),
            h('div', { className: 'fj-meta' },
              h('b', null, current.sutraTitle),
              h('span', null, `第 ${current.no} ${current.unit || '句'} / 共 ${current.total} ${current.unit || '句'}`),
              current.translator ? h('span', null, current.translator) : null),
            (data?.corpus?.sutras?.length || 0) > 1
              ? h('div', { className: 'fj-picker', role: 'tablist', 'aria-label': '换一部经' },
                data.corpus.sutras.map((item) => h('button', {
                  key: item.id,
                  type: 'button',
                  role: 'tab',
                  className: 'fj-chip',
                  'data-on': current.sutraId === item.id ? 'on' : 'off',
                  'aria-selected': current.sutraId === item.id ? 'true' : 'false',
                  disabled: running,
                  onClick: () => { void switchCardSutra(item.id); },
                  title: `${item.fullTitle} · ${item.count} ${item.unit || '句'}`,
                }, item.title)))
              : null,
            h('div', { className: 'fj-rule' }, h('i')),
            h('p', { className: 'fj-label' }, '经文原文'),
            h('p', { className: 'fj-cite' }, current.cite.text),
            current.label ? h('p', { className: 'fj-cite-label' }, `第 ${current.no} ${current.unit || '句'} · ${current.label}`) : null,
            current.gist
              ? h('div', { className: 'fj-note' },
                h('p', { className: 'fj-label' }, '释义'),
                h('p', null, current.gist),
                termList(current.terms, 'card-terms'))
              : null,
            current.practice
              ? h(React.Fragment, null,
                h('p', { className: 'fj-label' }, '今日练习'),
                h('p', { className: 'fj-practice' }, current.practice))
              : null,
            h('div', { className: 'fj-foot' },
              h('span', { className: 'fj-src' }, data?.corpus?.edition || '内置语料'),
              h('button', { className: 'fj-btn', type: 'button', onClick: () => { void openStudy(); }, 'aria-label': '逐句读这部经' }, '逐句读'),
              shell?.supported
                ? h('button', {
                  className: 'fj-btn', type: 'button', disabled: shellBusy, onClick: () => { void toggleShell(); },
                  title: shell?.running ? '收回桌面上的莲鲸' : '让她作为一个独立窗口站到桌面上，关掉 DSH 也还在',
                }, shellBusy ? '开关中…' : shell?.running ? '收回桌宠' : '放她到桌面')
                : null,
              h('button', { className: 'fj-btn', type: 'button', onClick: close, 'aria-label': '收起这页' }, '收起'),
              h('button', {
                className: 'fj-btn', type: 'button', 'data-primary': 'on',
                disabled: running, onClick: () => { void regenerate(); }, 'aria-label': '再读一句',
              }, running ? '翻页中…' : '再读一句'))))
        : h('div', { className: 'fj-body' },
          h('p', { className: 'fj-empty' }, running ? '莲鲸正在翻经…' : '还没有读过的经文。'),
          h('button', {
            className: 'fj-btn', type: 'button', 'data-primary': 'on',
            disabled: running, onClick: () => { void regenerate(); },
          }, running ? '翻页中…' : '现在读一句')));

      const card = h('div', {
        className: 'fj-card',
        ref: cardEl,
        role: 'dialog',
        'aria-label': view === 'study' ? '逐句读' : view === 'fetch' ? '取经' : '今日读经',
        // 卡片在立绘的 div 里：不拦一下，点卡片里任何地方都会冒泡到立绘上，被当成「收起」
        onClick: (event) => event.stopPropagation(),
        onPointerDown: (event) => event.stopPropagation(),
        onPointerUp: (event) => event.stopPropagation(),
        style: {
          '--fj-shift': `${shift}px`,
          maxHeight: cardMax ? `${cardMax}px` : undefined,
        },
      },
        view === 'fetch' ? fetchView() : view === 'study' ? studyView() : cardView(),
        error ? h('p', { className: 'fj-warn', style: { margin: '0 20px 12px' } }, '连接中断，重试中…') : null,
        shell?.error ? h('p', { className: 'fj-warn', style: { margin: '0 20px 12px' } }, `桌宠壳：${String(shell.error).slice(0, 90)}`) : null);

      const style = pos ? { left: pos.x, top: pos.y } : { right: 20, bottom: 96 };

      // 桌面壳站着的时候，界面里的那只就隐身，只留一枚收回按钮
      if (shell?.running) {
        return h('button', {
          type: 'button', onClick: () => { void toggleShell(); },
          title: '收回桌面上的莲鲸',
          style: {
            position: 'fixed', right: 16, bottom: 16, zIndex: 2147483000,
            display: 'flex', alignItems: 'center', gap: 5,
            border: '1px solid rgba(190,170,135,.6)', borderRadius: 999, cursor: 'pointer',
            padding: '3px 9px 3px 6px', font: '11px/1.4 "Microsoft YaHei", sans-serif',
            color: '#3f5f5c', background: 'rgba(255,251,242,.96)',
            boxShadow: '0 2px 8px rgba(90,110,100,.2)',
          },
          'aria-label': '收回桌面上的莲鲸',
        }, shellBusy ? '收回中…' : '收回桌宠');
      }

      return h('div', { style, 'data-fojing-pet': true },
        h('style', { dangerouslySetInnerHTML: { __html: CSS } }),
        h('div', { className: 'fj-anchor' },
          h('div', {
            className: 'fj-pet',
            ref: petEl,
            'data-drop': drop,
            onPointerDown: startDrag,
            onPointerMove: onDrag,
            onPointerUp: endDrag,
            onClick: () => {
              if (suppress.current) { suppress.current = false; return; }
              if (open) { close(); return; }
              pinned.current = history[0]?.id || null;
              setOpen(true);
            },
            role: 'button',
            tabIndex: 0,
            onKeyDown: (event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              if (open) { close(); return; }
              pinned.current = history[0]?.id || null;
              setOpen(true);
            },
            'aria-label': `莲鲸，${unread ? `${unread} 条未读经文` : '没有新经文'}，点开或收起`,
          },
          sprite()
            ? h('img', {
              className: 'fj-img',
              'data-talking': open ? 'on' : 'off',
              src: sprite(), alt: '莲鲸', draggable: false,
              onError: () => setSpriteBroken(true),
            })
            : h('div', { className: 'fj-img', 'aria-hidden': true }),
          unread > 0 ? h('span', { className: 'fj-badge', 'aria-hidden': true }, unread > 9 ? '9+' : String(unread)) : null,
          h('span', { className: 'fj-tag' },
            h('i', { className: 'fj-dot', 'data-off': online ? 'on' : 'off' }),
            running ? '翻经中' : Number.isFinite(countdown) && countdown > 0 ? `${mmss(countdown)} 后再读` : '静坐中')),
          open ? card : null,
          open ? h('span', { className: 'fj-tail', 'aria-hidden': true }) : null));
    }

    function apply(ctx) {
      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay', id: 'dsh-fojing-pet', order: 88,
      }, Pet));
    }

    return { apply, inject: ['slots'] };
  },
});
