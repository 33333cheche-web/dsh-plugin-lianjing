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
      work: '/api/dsh-fojing-pet.work',
      // 这两条之前漏了：new Audio(undefined) / POST undefined，木鱼一直没声
      sound: '/api/dsh-fojing-pet.sound',
      muyu: '/api/dsh-fojing-pet.muyu',
    };
    const POLL_MS = 20000;
    const POS_KEY = 'dsh-fojing-pet.pos';
    const PET_H = 196;
    // 三档尺寸：只缩立绘（含飘字），卡片与状态条不动——字得照样读得清。
    const SIZE_KEY = 'dsh-fojing-pet.size';
    const MUTE_KEY = 'dsh-fojing-pet.muted';
    const SIZES = [
      { id: 'lg', label: '大', scale: 1 },
      { id: 'md', label: '中', scale: 0.8 },
      { id: 'sm', label: '小', scale: 0.62 },
    ];

    const CSS = `
      [data-fojing-pet]{position:fixed;z-index:86;width:220px;font-family:"Microsoft YaHei",Inter,ui-sans-serif,system-ui,"PingFang SC",sans-serif;color:#33555a;font-size:13px;line-height:1.65}
      [data-fojing-pet] *{box-sizing:border-box}
      .fj-anchor{position:relative;display:flex;flex-direction:column;align-items:center;width:100%}
      .fj-pet{position:relative;z-index:1;flex:0 0 auto;display:flex;flex-direction:column;align-items:center;width:100%;cursor:grab;user-select:none;transition:transform .3s cubic-bezier(.22,.61,.36,1)}
      .fj-pet:active{cursor:grabbing}
      .fj-pet:hover{transform:translateY(-4px)}
      /* 档位缩放只动这一层：卡片、标签、光点都留在原尺寸 */
      .fj-fit{position:relative;display:flex;justify-content:center;width:100%;transform:scale(var(--fj-scale,1));transform-origin:bottom center}
      .fj-img{display:block;height:${PET_H}px;width:auto;max-width:220px;object-fit:contain;filter:drop-shadow(0 12px 18px rgba(60,90,88,.28));animation:fj-breathe 5.2s ease-in-out infinite}
      .fj-img[data-talking="on"]{animation:fj-bob 2.4s ease-in-out infinite}
      .fj-chips{display:flex;align-items:center;gap:6px;margin-top:-4px}
      .fj-tag{margin-top:0;font-size:10px;font-weight:700;letter-spacing:.08em;color:#3f5f5c;background:rgba(255,251,242,.94);border:1px solid rgba(190,170,135,.5);border-radius:5px;padding:2px 9px;white-space:nowrap;backdrop-filter:blur(8px);box-shadow:0 4px 10px rgba(90,110,100,.14)}
      /* 右边这枚是和桌面壳一致的「已积功德」：一直显示，没敲过就是 0 */
      .fj-merit{font-size:10px;font-weight:800;letter-spacing:.04em;color:#7a6a4e;background:rgba(255,251,242,.94);border:1px solid rgba(190,170,135,.5);border-radius:5px;padding:2px 9px;white-space:nowrap;backdrop-filter:blur(8px);box-shadow:0 4px 10px rgba(90,110,100,.14)}
      .fj-dot{display:inline-block;width:6px;height:6px;border-radius:50%;margin-right:5px;background:#8cb7a4;box-shadow:0 0 6px rgba(140,183,164,.8);vertical-align:1px}
      .fj-dot[data-off="off"]{background:#d99b8f;box-shadow:0 0 6px rgba(217,155,143,.8)}
      /* ---- 古书卡片 ---- */
      /* 卡片浮在立绘上方，不参与排版：否则它会把整个浮层撑到视口那么宽 */
      .fj-card{position:absolute;z-index:2;left:50%;bottom:calc(100% + 9px - var(--fj-lift,0px));
        width:min(392px,calc(100vw - 24px));max-height:min(62vh,560px);
        overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;
        transform:translateX(calc(-50% + var(--fj-shift,0px)));
        scrollbar-width:thin;scrollbar-color:#c9b78f #f3e8d2;
        border:1px solid #e7d8ba;border-radius:22px;
        background:linear-gradient(158deg,#fffaf0 0%,#fff7e9 58%,#f8edd8 100%);
        box-shadow:0 22px 48px rgba(90,80,55,.22),0 2px 0 rgba(255,255,255,.9) inset;
        padding:0 0 2px;animation:fj-in .18s ease-out}
      .fj-pet[data-drop="down"] .fj-card{bottom:auto;top:calc(100% + 9px)}
      .fj-card[data-view="work"]{max-height:min(76vh,660px)}
      .fj-card::-webkit-scrollbar{width:8px}
      .fj-card::-webkit-scrollbar-track{background:#f3e8d2;border-radius:8px}
      .fj-card::-webkit-scrollbar-thumb{background:linear-gradient(180deg,#dcca9f,#c2ab7d);border-radius:8px}
      .fj-card::before{content:"";position:absolute;left:0;top:0;bottom:0;width:6px;border-radius:21px 0 0 21px;
        background:linear-gradient(180deg,#f2e2bf,#dcc79c 45%,#cbb283);opacity:.95}
      .fj-tail{position:absolute;z-index:1;left:50%;margin-left:-5px;bottom:calc(100% + 4px - var(--fj-lift,0px));width:10px;height:10px;background:#f8edd8;border-right:1px solid #e7d8ba;border-bottom:1px solid #e7d8ba;transform:rotate(45deg);border-radius:2px}
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
      .fj-foot{display:flex;align-items:center;gap:7px;margin-top:14px;padding-top:10px;border-top:1px solid #eadcc2;flex-wrap:wrap}
      .fj-src{flex:1;min-width:64px;font-size:9.5px;color:#b09b7a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .fj-btn{border:0;background:none;padding:2px 3px;color:#7a8f88;font:inherit;font-size:11.5px;font-weight:650;cursor:pointer;white-space:nowrap;text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:3px;text-decoration-color:rgba(140,183,175,.45)}
      .fj-btn:hover:not(:disabled){color:#33555a;text-decoration-color:#8cb7af}
      .fj-btn:disabled{opacity:.5;cursor:default}
      .fj-btn:focus-visible{outline:2px solid #a9c8bf;outline-offset:2px;border-radius:5px}
      .fj-btn[data-primary="on"]{color:#456d64;font-weight:800;text-decoration-color:#8cb7af}
      .fj-empty{margin:0 0 10px;color:#7a8f88;font-size:12.5px}
      .fj-warn{margin:8px 0 0;font-size:10px;color:#c07d6f}
      /* ---- 灵感光点：不写数字，只呼吸；有未读亮一点，没有也留着（入口不能藏） ---- */
      /* 一颗软光点：没有描边、没有外圈，只靠明暗呼吸让人注意到 */
      .fj-spark{position:absolute;z-index:4;top:46px;right:46px;width:12px;height:12px;padding:0;margin:0;border:0;background:none;
        transform:scale(var(--fj-inv,1));transform-origin:center;line-height:0;cursor:pointer;-webkit-appearance:none;appearance:none}
      .fj-spark i{position:relative;display:block;width:12px;height:12px;border-radius:50%;
        background:radial-gradient(circle at 36% 32%,#fffef8 0%,#ffeec0 30%,#eebb64 66%,rgba(198,154,78,.55) 100%);
        box-shadow:0 0 10px 3px rgba(232,190,104,.55),0 0 22px 9px rgba(226,176,84,.22);
        animation:fj-spark-breathe 2.2s ease-in-out infinite}
      .fj-spark[data-lit="off"] i{opacity:.58;filter:saturate(.55);animation-duration:2.4s}
      .fj-spark:hover i{animation-duration:1.4s;box-shadow:0 0 12px 4px rgba(232,190,104,.7),0 0 26px 11px rgba(226,176,84,.28)}
      .fj-spark:focus-visible{outline:2px solid #a9c8bf;outline-offset:3px;border-radius:50%}
      @keyframes fj-spark-breathe{
        0%,100%{transform:scale(.95);box-shadow:0 0 8px 2px rgba(232,190,104,.42),0 0 18px 7px rgba(226,176,84,.16)}
        50%{transform:scale(1.04);box-shadow:0 0 12px 4px rgba(236,198,116,.66),0 0 26px 12px rgba(226,176,84,.30)}}
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
      .fj-chip{border:1px solid #e2d3b6;background:rgba(255,255,255,.6);color:#7a6a4e;font:inherit;font-size:11px;font-weight:700;letter-spacing:.02em;padding:3px 9px;border-radius:6px;cursor:pointer;transition:background .15s,border-color .15s,color .15s}
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
      /* 页头的「取经」小钮：不抢眼，但得一眼找得到 */
      .fj-head-fetch{border:1px solid #e2d3b6;background:rgba(255,255,255,.62);color:#8a7452;font:inherit;font-size:10px;font-weight:800;
        letter-spacing:.04em;padding:2px 8px;border-radius:6px;cursor:pointer;white-space:nowrap;transition:background .15s,border-color .15s,color .15s}
      .fj-head-fetch:hover{background:#fffdf7;border-color:#cbb894;color:#33555a}
      .fj-head-fetch:focus-visible{outline:2px solid #a9c8bf;outline-offset:2px}
      /* 卡片底部那一排：三档大小 + 声音 */
      .fj-size{display:inline-flex;align-items:center;gap:1px;padding:1px;border:1px solid rgba(226,211,182,.9);border-radius:7px;background:rgba(255,253,247,.6)}
      .fj-size button{border:0;background:none;font:inherit;font-size:10px;font-weight:700;color:#9b866a;line-height:1.5;padding:1px 4px;border-radius:5px;cursor:pointer}
      .fj-size button:hover{color:#33555a;background:rgba(200,180,140,.16)}
      .fj-size button[data-on="on"]{background:#8cb7af;color:#fffdf5;box-shadow:0 1px 4px rgba(90,130,120,.24)}
      .fj-size button:focus-visible{outline:2px solid #a9c8bf;outline-offset:1px}
      .fj-sound{border:1px solid rgba(226,211,182,.9);background:rgba(255,253,247,.6);color:#9b866a;font:inherit;font-size:9.5px;font-weight:700;
        padding:1px 6px;border-radius:6px;cursor:pointer;line-height:1.5}
      .fj-sound:hover{color:#33555a;background:#fffdf7}
      .fj-sound[data-on="off"]{color:#b98d80;border-color:rgba(219,184,172,.75)}
      .fj-sound:focus-visible{outline:2px solid #a9c8bf;outline-offset:2px}
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
      /* ---- 佛光：有活在跑时立绘背后那一圈缓慢转动的光 ---- */
      .fj-halo{position:absolute;left:50%;top:104px;z-index:0;width:206px;height:206px;margin:-103px 0 0 -103px;
        border-radius:50%;pointer-events:none;
        background:conic-gradient(from 0deg,rgba(217,161,60,0) 0deg,rgba(226,176,84,.55) 55deg,rgba(255,238,190,.18) 110deg,rgba(217,161,60,0) 185deg,rgba(226,176,84,.42) 292deg,rgba(217,161,60,0) 360deg);
        -webkit-mask:radial-gradient(circle,transparent 55%,#000 60%,#000 79%,transparent 83%);
        mask:radial-gradient(circle,transparent 55%,#000 60%,#000 79%,transparent 83%);
        animation:fj-halo-spin 9s linear infinite;opacity:.92}
      .fj-halo[data-state="busy"]{animation-duration:5.5s;opacity:1}
      .fj-halo[data-state="done"]{background:conic-gradient(from 0deg,rgba(150,178,140,0) 0deg,rgba(150,178,140,.45) 80deg,rgba(150,178,140,0) 190deg,rgba(150,178,140,.32) 300deg,rgba(150,178,140,0) 360deg)}
      /* 有素材时直接用和桌面壳同一张 halo.png，再糊一层：要的是柔光，不是一圈硬边的细环 */
      .fj-halo[data-img="on"]{background:transparent;mask:none;-webkit-mask:none;
        background-size:100% 100%;background-repeat:no-repeat;background-position:center;
        filter:blur(7px)}
      .fj-halo[data-img="on"][data-state="done"]{filter:blur(7px) hue-rotate(-38deg)}
      @keyframes fj-halo-spin{to{transform:rotate(360deg)}}
      .fj-img{position:relative;z-index:1}
      /* ---- 敲木鱼：点她中间，飘一句彩头 ---- */
      .fj-knocks{position:absolute;left:0;right:0;top:0;z-index:3;pointer-events:none;height:0}
      .fj-knock{position:absolute;left:50%;top:2px;white-space:nowrap;font-size:13px;font-weight:800;letter-spacing:.04em;
        color:#c69a4e;background:none;border:0;padding:0;
        animation:fj-knock-float 1.05s cubic-bezier(.2,.7,.3,1) forwards}
      .fj-knock b{margin-left:1px;color:inherit;font-weight:800}
      @keyframes fj-knock-float{
        0%{opacity:0;transform:translate(-50%,8px) scale(.86)}
        18%{opacity:1;transform:translate(-50%,-2px) scale(1.06)}
        100%{opacity:0;transform:translate(-50%,-52px) scale(1)}}
      .fj-img[data-knock="on"]{animation:fj-knock-bounce .34s ease-out}
      @keyframes fj-knock-bounce{
        0%{transform:translateY(0) scale(1)}
        30%{transform:translateY(4px) scale(.984)}
        100%{transform:translateY(0) scale(1)}}
      .fj-tabs{flex:1;min-width:0;display:flex;gap:2px;background:rgba(190,170,135,.18);border-radius:8px;padding:2px}
      .fj-tab{flex:0 0 auto;border:0;cursor:pointer;font:inherit;font-size:10px;font-weight:800;letter-spacing:.06em;
        color:#8a7452;background:transparent;border-radius:6px;padding:2px 9px;transition:background .18s,color .18s}
      .fj-tab[data-on="on"]{background:#fffdf6;color:#6a5333;box-shadow:0 1px 3px rgba(120,100,70,.2)}
      .fj-tab[data-run="on"]::after{content:"";display:inline-block;width:5px;height:5px;border-radius:50%;
        background:#d9a13c;margin-left:4px;vertical-align:1px;animation:fj-pulse 1.5s ease-in-out infinite}
      .fj-tab:disabled{cursor:default;opacity:.65}
      @keyframes fj-pulse{0%,100%{opacity:.3}50%{opacity:1}}
      .fj-work-sum{display:flex;align-items:baseline;gap:8px;margin:0 0 7px;font-size:10px;color:#9b866a}
      .fj-work-sum b{color:#6a5333;font-size:11px}
      .fj-work-list{display:flex;flex-direction:column;gap:5px}
      .fj-work-row{display:block;width:100%;text-align:left;border:1px solid rgba(190,170,135,.42);border-radius:10px;
        background:rgba(255,253,246,.6);padding:7px 9px;cursor:pointer;font:inherit;color:inherit;transition:background .18s,border-color .18s}
      .fj-work-row:hover{background:#fffdf6;border-color:rgba(170,140,95,.6)}
      .fj-work-row[data-open="on"]{background:#fffdf6;border-color:rgba(170,140,95,.75)}
      .fj-work-row[data-run="on"]{border-color:rgba(217,161,60,.6);box-shadow:0 0 0 1px rgba(217,161,60,.16)}
      .fj-work-top{display:flex;align-items:center;gap:6px}
      .fj-work-dot{flex:0 0 auto;width:6px;height:6px;border-radius:50%;background:#c9bda6}
      .fj-work-dot[data-run="on"]{background:#d9a13c;animation:fj-pulse 1.5s ease-in-out infinite}
      .fj-work-title{flex:1;min-width:0;font-size:10px;color:#8a7452;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .fj-work-meta{display:flex;align-items:center;gap:8px;margin-top:4px;font-size:10px;color:#9b866a}
      .fj-work-bar{flex:0 1 58px;min-width:22px;height:3px;border-radius:2px;background:rgba(190,170,135,.3);overflow:hidden}
      .fj-work-bar i{display:block;height:100%;border-radius:2px;background:linear-gradient(90deg,#b7c3a4,#7f9a7a)}
      .fj-work-num{font-variant-numeric:tabular-nums;white-space:nowrap}
      .fj-work-open{margin-top:7px;padding-top:7px;border-top:1px dashed rgba(190,170,135,.55)}
      .fj-work-sec{font-size:9.5px;font-weight:800;letter-spacing:.16em;color:#a8926d;margin:0 0 4px}
      .fj-todo{display:flex;gap:5px;align-items:flex-start;font-size:10.5px;line-height:1.5;color:#6f6250;padding:1px 0}
      .fj-todo em{flex:0 0 auto;font-style:normal;width:11px;color:#a8926d}
      .fj-todo[data-s="completed"]{color:#a5977f;text-decoration:line-through}
      .fj-todo[data-s="in_progress"]{color:#41634a;font-weight:700}
      .fj-todo[data-s="in_progress"] em{color:#7f9a7a}
      .fj-work-nums{display:grid;grid-template-columns:1fr 1fr;gap:3px 10px;margin-top:7px;font-size:10px;color:#8a7452}
      .fj-work-nums b{color:#5f4c30;font-weight:800;font-variant-numeric:tabular-nums}
      .fj-work-kids{margin-top:7px;display:flex;flex-direction:column;gap:2px;font-size:10px;color:#8a7452}
      .fj-work-kid{display:flex;align-items:center;gap:5px}
      .fj-work-kid span{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .fj-work-empty{margin:2px 0 4px;padding:12px 0;text-align:center;font-size:11px;color:#a08d70}
      /* ---- 按项目收成树：项目行是一层，会话行缩进挂在一条竖线下 ---- */
      .fj-proj{display:flex;flex-direction:column;margin-top:1px}
      .fj-proj-row{display:flex;align-items:center;gap:6px;width:100%;height:26px;padding:0 3px;
        border:0;border-radius:7px;background:none;text-align:left;font:inherit;color:#6a5333;cursor:pointer;transition:background .15s}
      .fj-proj-row:hover{background:rgba(255,253,246,.9)}
      .fj-proj-row:focus-visible{outline:2px solid #a9c8bf;outline-offset:1px}
      .fj-proj-dot{flex:0 0 auto;width:6px;height:6px;border-radius:50%;background:#c9bda6}
      .fj-proj-dot[data-run="on"]{background:#d9a13c;animation:fj-pulse 1.5s ease-in-out infinite}
      .fj-proj-name{flex:0 1 auto;min-width:0;max-width:148px;font-size:11px;font-weight:800;color:#6a5333;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .fj-proj-count{flex:0 0 auto;font-size:10px;color:#9b866a}
      .fj-proj-run{flex:0 0 auto;font-size:10px;color:#5f8a6a}
      .fj-proj-sum{flex:0 0 auto;margin-left:auto;font-size:10px;color:#9b866a;font-variant-numeric:tabular-nums;white-space:nowrap}
      .fj-proj-ago{flex:0 0 auto;margin-left:8px;font-size:10px;color:#9b866a;font-variant-numeric:tabular-nums;white-space:nowrap}
      .fj-proj-caret{flex:0 0 9px;width:9px;font-style:normal;font-size:9px;line-height:1;color:#b9a98c;text-align:right}
      /* 竖线按「行」画：每行自己带一段，最后一行只画到横枝，这里不用遮罩去盖背景 */
      .fj-spine{display:flex;flex-direction:column;gap:5px;margin:1px 0 3px 16px}
      .fj-spine-item{position:relative;padding-left:13px}
      .fj-spine-item::before{content:'';position:absolute;left:0;top:-5px;bottom:-5px;width:1px;background:rgba(190,170,135,.55)}
      .fj-spine-item:first-child::before{top:0}
      .fj-spine-item:last-child::before{bottom:auto;height:20px}
      /* 一组只有一个会话时，竖线 0 起 15 落，正好和横枝接上，不留尾巴 */
      .fj-spine-item:first-child:last-child::before{top:0;height:15px}
      .fj-spine-item::after{content:'';position:absolute;left:0;top:15px;width:6px;height:1px;background:rgba(190,170,135,.55)}
      /* 详情区底下那颗「去 DSH 里打开」——是链接不是按钮（外层行本身是个 button，别嵌套） */
      .fj-work-jump{display:inline-flex;align-items:center;gap:5px;margin-top:8px;padding:3px 9px;border:1px solid rgba(140,183,175,.55);
        border-radius:6px;background:rgba(140,183,175,.1);color:#4c7069;font-size:10px;font-weight:800;letter-spacing:.02em;cursor:pointer}
      .fj-work-jump:hover{background:rgba(140,183,175,.18);border-color:#8cb7af;color:#33555a}
      .fj-work-jump:focus-visible{outline:2px solid #a9c8bf;outline-offset:2px}
      .fj-work-jumpmsg{margin-left:6px;font-style:normal;font-weight:400;font-size:9.5px;color:#a8926c}
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

    const readSize = () => {
      try {
        const saved = window.localStorage.getItem(SIZE_KEY);
        return SIZES.some((item) => item.id === saved) ? saved : 'lg';
      } catch { return 'lg'; }
    };
    const readMuted = () => {
      try { return window.localStorage.getItem(MUTE_KEY) === '1'; } catch { return false; }
    };

    // 宿主的 uiWorkspace：Cordis 服务可能在 apply 之后才注册，所以点击时再取，不缓存。
    let hostCtx = null;
    const getWorkspace = (ctx) => {
      if (!ctx) return null;
      try { return ctx.get?.('uiWorkspace') ?? ctx.uiWorkspace ?? null; } catch { return null; }
    };
    // 只返回 { ok, message }：成功 / 没服务 / 抛错 三种都给一句人话，界面照原样显示。
    const openHostSession = (ctx, sessionId) => {
      const id = String(sessionId || '');
      if (!id) return { ok: false, message: '这个会话没有 id，跳不过去' };
      const workspace = getWorkspace(ctx);
      if (!workspace || typeof workspace.openSession !== 'function') {
        return { ok: false, message: '当前窗口不支持跳转（没拿到 uiWorkspace）' };
      }
      try {
        workspace.openSession(id);
        return { ok: true, message: '已交给 DSH 打开' };
      } catch (failure) {
        return { ok: false, message: `跳转失败：${String(failure?.message || failure).slice(0, 60)}` };
      }
    };

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

    // 多久之后再来一句：说人话，别摆 437:01 这种让人读成 400 多小时的数字
    const untilText = (delta) => {
      if (!Number.isFinite(delta) || delta <= 0) return '';
      const total = Math.round(delta / 1000);
      if (total < 60) return '1 分钟内再读';
      const minutes = Math.floor(total / 60);
      if (minutes < 60) return `${minutes} 分钟后再读`;
      const hours = Math.floor(minutes / 60);
      const rest = minutes % 60;
      if (hours < 24) return rest ? `${hours} 小时 ${rest} 分后再读` : `${hours} 小时后再读`;
      const days = Math.floor(hours / 24);
      return days === 1 ? '明天再读' : `${days} 天后再读`;
    };

    // 功课页的数字口径：token 只报全会话累计（用户要的就是「这个项目一共烧了多少」）。
    const fmtTokens = (value) => {
      const n = Number(value || 0);
      if (!Number.isFinite(n) || n <= 0) return '0';
      if (n >= 1e8) return `${(n / 1e8).toFixed(2)} 亿`;
      if (n >= 1e4) return `${(n / 1e4).toFixed(1)} 万`;
      return String(Math.round(n));
    };
    const fmtWork = (ms) => {
      const total = Math.max(0, Math.round(Number(ms || 0) / 1000));
      if (total < 60) return `${total} 秒`;
      const hours = Math.floor(total / 3600);
      const minutes = Math.floor((total % 3600) / 60);
      return hours > 0 ? `${hours} 小时 ${minutes} 分` : `${minutes} 分`;
    };
    const fmtAgo = (ms) => {
      const total = Math.max(0, Math.round(Number(ms || 0) / 1000));
      if (total < 60) return '刚刚';
      if (total < 3600) return `${Math.floor(total / 60)} 分钟前`;
      if (total < 86400) return `${Math.floor(total / 3600)} 小时前`;
      return `${Math.floor(total / 86400)} 天前`;
    };

    function Pet() {
      const [data, setData] = useState(null);
      const [error, setError] = useState(null);
      const [busy, setBusy] = useState(false);
      const [open, setOpen] = useState(false);
      const [view, setView] = useState('work');
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
      const [work, setWork] = useState(null);
      const [workError, setWorkError] = useState(false);
      const [workOpen, setWorkOpen] = useState('');
      const [projClosed, setProjClosed] = useState({});   // {项目名: true} = 这一组收起，默认全展开
      const [knocks, setKnocks] = useState([]);
      const [knocking, setKnocking] = useState(false);
      const [meritCount, setMeritCount] = useState(0);
      const [size, setSize] = useState(readSize);
      const [mutedUi, setMutedUi] = useState(readMuted);
      const [fetchFrom, setFetchFrom] = useState('card');
      const [jumpMsg, setJumpMsg] = useState(null);
      const audioRef = useRef(null);
      const audioCtx = useRef(null);
      const audioWarm = useRef(false);
      const muted = useRef(readMuted());
      const knockSlot = useRef(0);   // 连敲时的位置槽：第一下正中
      const seenOpen = useRef(0);    // 桌面壳请求「打开某个会话」的 at，处理过的就不再理
      const cardEl = useRef(null);
      const petEl = useRef(null);
      const drag = useRef(null);
      const suppress = useRef(false);
      const pinned = useRef(null);
      const marked = useRef(new Set());
      const [, setClock] = useState(0);
      // 「抬眼」是一次性的：闭眼入定 / 垂目看经 / 睁眼看你，三种眼神三种注意力朝向。
      // 只有跟人发生关系的那一拍才睁眼（点开、收起、读完、被拖动），到期自动落回去。
      const [lookUntil, setLookUntil] = useState(0);
      const look = useCallback((ms) => setLookUntil(Date.now() + ms), []);

      // --- 敲木鱼 -----------------------------------------------------------
      // 点她中间那块（身体）敲一下：出个声、飘一句彩头、她在原地轻轻一沉。
      // 彩头由宿主随机（网页和桌面壳看到的是同一份累计），拿不到就本地随便挑一个。
      const MERIT_LABELS = ['功德', '财富', '桃花运', '好运', '健康'];
      // 素材是随包的 assets/muyu.wav（宿主 /api/dsh-fojing-pet.sound 直出）。
      // 网页端「没声」多半不是文件的事：没交互过、被自动播放策略拦、还没解码完，play() 都会 reject。
      // 所以两条腿走路：先放 wav；放不出来就现场用 WebAudio 合成一记「梆」。录音只用于排查。
      const SOUND_LOG = [];
      const traceSound = (event, detail) => {
        SOUND_LOG.push({ at: Date.now(), event, detail: detail || '' });
        if (SOUND_LOG.length > 40) SOUND_LOG.shift();
        try { window.__fjSoundLog = SOUND_LOG; } catch { /* 自测用，失败无所谓 */ }
        // 放成功只在 __fjSoundLog 里留一条；失败才进 console，免得每敲一下刷屏
        if (event === 'played') return;
        try { window.console?.info?.('[莲鲸·木鱼]', event, detail || ''); } catch { /* 没 console 就算了 */ }
      };

      // 一记「梆」：和随包的 assets/muyu.wav 同一套配方——
      // 618Hz 主体（52ms）、1265Hz 眨眼的高频（19ms）、315Hz 低腔（85ms），
      // 外加 4ms 噪声当木槌。只在 wav 放不出来时才走到这里。
      const synthKnock = (reason) => {
        if (muted.current) { traceSound('muted', reason); return 'muted'; }
        try {
          const Ctor = window.AudioContext || window.webkitAudioContext;
          if (!Ctor) { traceSound('synth-no-ctx', reason); return 'noctx'; }
          if (!audioCtx.current) audioCtx.current = new Ctor();
          const context = audioCtx.current;
          if (context.state === 'suspended') void context.resume?.().catch(() => {});
          const t0 = context.currentTime + 0.002;
          const parts = [
            { type: 'sine', hz: 618, gain: 0.24, decay: 0.052 },
            { type: 'sine', hz: 1265, gain: 0.09, decay: 0.019 },
            { type: 'sine', hz: 315, gain: 0.07, decay: 0.085 },
          ];
          for (const part of parts) {
            const osc = context.createOscillator();
            const gain = context.createGain();
            osc.type = part.type;
            osc.frequency.setValueAtTime(part.hz, t0);
            gain.gain.setValueAtTime(0.0001, t0);
            gain.gain.exponentialRampToValueAtTime(part.gain, t0 + 0.004);
            gain.gain.exponentialRampToValueAtTime(0.0001, t0 + part.decay);
            osc.connect(gain).connect(context.destination);
            osc.start(t0);
            osc.stop(t0 + part.decay + 0.02);
          }
          const length = Math.max(1, Math.floor(context.sampleRate * 0.004));
          const buffer = context.createBuffer(1, length, context.sampleRate);
          const data = buffer.getChannelData(0);
          for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 2;
          const noise = context.createBufferSource();
          const noiseGain = context.createGain();
          noiseGain.gain.value = 0.12;
          noise.buffer = buffer;
          noise.connect(noiseGain).connect(context.destination);
          noise.start(t0);
          traceSound('synth', reason);
          return 'synth';
        } catch (failure) {
          traceSound('synth-failed', String(failure?.message || failure));
          return 'failed';
        }
      };

      // 首次交互先把素材 load 一下：否则第一下敲常敲在「还没解码」上。
      const primeSound = () => {
        if (muted.current) return;
        try {
          if (!audioRef.current) {
            const sound = new Audio(API.sound);
            sound.preload = 'auto';
            sound.volume = 0.7;
            sound.addEventListener?.('error', () => traceSound('wav-error', API.sound));
            audioRef.current = sound;
          }
          if (!audioWarm.current) {
            audioWarm.current = true;
            audioRef.current.load?.();
            traceSound('warm', API.sound);
          }
        } catch (failure) {
          traceSound('warm-failed', String(failure?.message || failure));
        }
      };

      const knockSound = () => {
        if (muted.current) return;
        primeSound();
        const sound = audioRef.current;
        if (!sound) { synthKnock('no-audio'); return; }
        try { sound.currentTime = 0; } catch { /* metadata 还没到，置位会抛；照放 */ }
        let played;
        try {
          played = sound.play?.();
        } catch (failure) {
          traceSound('play-threw', String(failure?.message || failure));
          synthKnock('play-threw');
          return;
        }
        if (!played || typeof played.then !== 'function') { traceSound('played', 'no-promise'); return; }
        played.then(() => traceSound('played', 'wav')).catch((failure) => {
          traceSound('play-blocked', String(failure?.name || failure?.message || failure));
          synthKnock('play-blocked');
        });
      };

      const knock = () => {
        knockSound();
        look(500);           // 敲的时候抬眼看你一下
        setKnocking(true);
        window.setTimeout(() => setKnocking(false), 460);
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const label = MERIT_LABELS[Math.floor(Math.random() * MERIT_LABELS.length)];
        const slot = knockSlot.current++ % 5;
        const drift = ['0px', '-58px', '58px', '-29px', '29px'][slot];
        setKnocks((list) => [...list.slice(-5), { id, label, drift }]);
        window.setTimeout(() => {
          setKnocks((list) => list.filter((item) => item.id !== id));
        }, 1100);
        void post(API.muyu, {}).then((payload) => {
          if (!payload?.ok) return;
          setKnocks((list) => list.map((item) => (item.id === id ? { ...item, label: payload.label } : item)));
          setMeritCount(Number(payload.count) || 0);
        }).catch(() => { /* 宿主没连上也要能敲 */ });
      };

      // --- 大小与声音开关 ---------------------------------------------------
      // 三档只缩立绘，卡片/标签/光点保持可读；档位与静音记在本地，刷新还在。
      const pickSize = (id) => {
        if (id === size) return;
        setSize(id);
        try { window.localStorage.setItem(SIZE_KEY, id); } catch { /* 记不住就记不住，功能照用 */ }
        look(400);
      };

      const scale = SIZES.find((item) => item.id === size)?.scale || 1;

      const toggleMute = () => {
        const next = !muted.current;
        muted.current = next;
        setMutedUi(next);
        try { window.localStorage.setItem(MUTE_KEY, next ? '1' : '0'); } catch { /* 同上 */ }
        if (!next) { primeSound(); traceSound('unmuted', ''); }
      };

      // 命中区：只认立绘中间那块椭圆，四周留给「展开卡片」
      const knockHit = (event) => {
        const rect = petEl.current?.querySelector('.fj-img')?.getBoundingClientRect?.();
        if (!rect || !rect.width || !rect.height) return false;
        const dx = (event.clientX - (rect.left + rect.width / 2)) / (rect.width * 0.30);
        const dy = (event.clientY - (rect.top + rect.height * 0.58)) / (rect.height * 0.26);
        return (dx * dx) + (dy * dy) <= 1;
      };

      const history = (data?.cards || []).filter((c) => c && c.cite);
      const current = (pinned.current && history.find((c) => c.id === pinned.current)) || history[0] || null;
      const index = current ? history.findIndex((c) => c.id === current.id) : -1;
      const older = index >= 0 && index < history.length - 1;
      const newer = index > 0;
      const running = !!(data?.running || busy);
      const unread = Number(data?.unread || 0);
      const online = !error;
      // 「站起来了」以心跳为准：running 只说明进程起来了，窗口还没画出来（冷启动约 2 秒）
      const shellUp = !!(shell?.running && shell?.external);
      const shellStarting = !!(shell?.running && !shell?.external);
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
          // 桌面壳点了「在 DSH 里打开这个对话」：壳够不到 uiWorkspace，
          // 只能靠这条本地轮询把请求接力过来（at 是宿主的毫秒时间戳，去重靠它）。
          const pending = next?.pendingOpen;
          if (pending?.id && pending?.at && pending.at !== seenOpen.current) {
            seenOpen.current = pending.at;
            const relayed = openHostSession(hostCtx, pending.id);
            if (relayed.ok) console.info('[莲鲸·壳] 接力打开会话', pending.id);
            else console.info('[莲鲸·壳] 接力失败', pending.id, relayed.message);
          }
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
          // 桌面壳开着的时候勤一点：壳里点功课行要靠这一拍把「打开某个会话」接力过来
          handle = window.setTimeout(loop, running ? 4000 : shellUp ? 2500 : POLL_MS);
        };
        void loop();
        const onVisible = () => { if (!document.hidden) void refresh(); };
        document.addEventListener('visibilitychange', onVisible);
        return () => {
          cancelled = true;
          if (handle) window.clearTimeout(handle);
          document.removeEventListener('visibilitychange', onVisible);
        };
      }, [refresh, running, shellUp]);

      useEffect(() => {
        if (!open) return undefined;
        const handle = window.setInterval(() => setClock((n) => n + 1), 1000);
        return () => window.clearInterval(handle);
      }, [open]);

      // --- 功课数据 ---------------------------------------------------------
      // 看功课页时勤一点；其余时间只为佛光和角标，慢一点就够（宿主那边还有 2.5s 快照缓存）。
      const workCadence = open && view === 'work' ? 5000 : 12000;
      useEffect(() => {
        let cancelled = false;
        let handle = null;
        const loop = async () => {
          if (cancelled) return;
          if (!document.hidden) {
            try {
              const payload = await getJson(API.work);
              if (payload?.ok) { setWork(payload); setWorkError(false); } else setWorkError(true);
            } catch { setWorkError(true); }
          }
          handle = window.setTimeout(loop, workCadence);
        };
        void loop();
        return () => {
          cancelled = true;
          if (handle) window.clearTimeout(handle);
        };
      }, [workCadence]);

      const workRunning = Number(work?.runningCount || 0);
      const muyuTotal = Math.max(meritCount, Number(data?.muyuCount || 0));
      // 开工睁眼、收工睁眼：只在这两拍，跑任务的过程中她一直是闭眼的
      const seenWork = useRef(null);
      useEffect(() => {
        const before = seenWork.current;
        seenWork.current = workRunning;
        if (before === null) return;
        if (before === 0 && workRunning > 0) look(900);
        else if (before > 0 && workRunning === 0) look(1500);
      }, [workRunning, look]);

      // 打开卡片即已读
      useEffect(() => {
        if (!open || view !== 'card' || !current || current.read || marked.current.has(current.id)) return;
        marked.current.add(current.id);
        void post(API.read, { id: current.id }).then(() => refresh()).catch(() => { /* 下次轮询会补上 */ });
      }, [open, view, current, refresh]);

      // 这一部读完了：抬眼久一点，是「合经」的那一拍
      const doneRead = Number(current?.progress?.read || 0);
      const doneTotal = Number(current?.progress?.total || 0);
      useEffect(() => {
        if (doneRead > 0 && doneRead >= doneTotal) look(1500);
        // 只在「刚读完」那一刻触发：read 涨到 total 时依赖才变
      }, [doneRead, doneTotal, look]);

      const sprite = () => {
        const sprites = data?.pet?.sprites;
        if (!sprites || spriteBroken) return '';
        // 0. 敲木鱼这一拍：她手上得有槌子和木鱼（没有这张素材就照旧）
        if (knocking && sprites.knock) return sprites.knock;
        const now = Date.now();
        // 1. 抬眼看你：点开/收起/读完/被拖动之后的短暂一拍
        if (now < lookUntil) return sprites.open || sprites.idle;
        // 2. 卡片开着就是在读，垂目
        if (view === 'study' || view === 'fetch' || (open && current)) return sprites.read || sprites.idle;
        // 2.5 看功课的时候她只是陪着，闭眼入定，不盯着屏幕
        if (view === 'work' && open) return sprites.idle || '';
        // 3. 有未读：不常亮睁眼（那是干瞪眼），每 20 秒抬眼看你一下就走
        if (unread > 0 && (now % 20000) < 2600) return sprites.open || sprites.idle;
        // 4. 其余时间闭眼入定
        return sprites.idle || '';
      };

      const startDrag = (event) => {
        if (event.button !== 0) return;
        primeSound(); // 第一次交互就把木鱼素材叫醒
        const rect = event.currentTarget.closest('[data-fojing-pet]')?.getBoundingClientRect();
        if (!rect) return;
        drag.current = { dx: event.clientX - rect.left, dy: event.clientY - rect.top, moved: false };
        look(120000); // 被搬着的时候睁眼
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
        look(400); // 放下来，看还看不看你
      };

      const close = () => {
        setOpen(false);
        setView('work');
        pinned.current = null;
        look(600); // 合卷，抬眼看你一下
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
      const openFetch = async (from) => {
        // 记一下从哪儿来：从「今日读经」进来，回退就该回读经页（此时 study 里还没载经）
        setFetchFrom(from === 'study' ? 'study' : 'card');
        setView('fetch');
        setImportMsg('');
        try {
          const payload = await getJson(API.catalog);
          setCatalog(payload?.items || []);
        } catch (failure) {
          setImportMsg(String(failure?.message || failure));
        }
      };

      const backFromFetch = () => {
        setImportMsg('');
        setView(fetchFrom === 'study' && sutra ? 'study' : 'card');
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
        const action = shellUp ? 'quit' : 'launch';
        try {
          const result = await post(API.shell, { action, origin: window.location.origin });
          setShell(result);
        } catch (failure) {
          setShell((prev) => ({ ...(prev || {}), error: String(failure?.message || failure) }));
          setShellBusy(false);
          return;
        }
        setShellBusy(false);
        if (action !== 'launch') return;
        // 桌面壳是独立进程，冷启动得一两秒才把窗口画出来。
        // 这期间界面里这只先别急着隐身，不然就是「点了放她到桌面，人没了」。
        const deadline = Date.now() + 15000;
        while (Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 350));
          const next = await getJson(API.shell).catch(() => null);
          if (!next) continue;
          setShell(next);
          if (next.external || !next.running) {
            if (!next.external && !next.running) {
              setShell((prev) => ({ ...(prev || {}), error: '桌面壳没起来，再点一次试试（或看看 PowerShell 是否被拦）' }));
            }
            break;
          }
        }
      };

      // --- 卡片定位 ----------------------------------------------------------
      // 卡片是绝对定位浮在立绘上方的，所以「放不放得下」得自己量：
      // 上面不够高就往下开，左右贴边就用 translateX 推回来。
      const measureCard = useCallback(() => {
        const pet = petEl.current;
        if (!pet) return;
        // 立绘缩过之后外层外框比画大：量 img 的真实 rect，卡片才贴着画走
        const img = pet.querySelector('.fj-img');
        const target = img && img.getBoundingClientRect().height > 0 ? img : pet;
        const rect = target.getBoundingClientRect();
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
      }, [open, view, current, sutra, pos, measureCard, shift, size]);

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
        if (!list.length) return null;
        return h('div', { className: 'fj-picker', role: 'tablist', 'aria-label': '选择经书' },
          list.length > 1 ? list.map((item) => h('button', {
            key: item.id,
            type: 'button',
            role: 'tab',
            className: 'fj-chip',
            'data-on': sutra && sutra.id === item.id ? 'on' : 'off',
            'aria-selected': sutra && sutra.id === item.id ? 'true' : 'false',
            onClick: () => { void switchSutra(item.id); },
            title: `${item.fullTitle} · ${item.count} ${item.unit || '句'}${item.draft ? '（原文草稿）' : ''}`,
          }, item.title,
          item.draft ? h('i', { className: 'fj-chip-dot', 'aria-hidden': true }) : null))
            : null,
          h('button', {
            key: '__fetch',
            type: 'button',
            className: 'fj-chip fj-chip-add',
            'data-on': 'off',
            onClick: () => { void openFetch('study'); },
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
          h('button', { className: 'fj-close', type: 'button', onClick: backFromFetch, 'aria-label': '返回读经' }, '×')),
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
            h('span', { className: 'fj-src' }, '原文来自 fojing.com，存本地'),
            h('button', { className: 'fj-btn', type: 'button', onClick: backFromFetch },
              fetchFrom === 'study' ? '回到逐句读' : '回到读经页'))));

      // --- 卡片顶部的两个 tab（功课默认在左） ----------------------------------
      const tabs = (active) => h('div', { className: 'fj-tabs', role: 'tablist', 'aria-label': '卡片页' },
        h('button', {
          type: 'button', role: 'tab', className: 'fj-tab',
          'data-on': active === 'work' ? 'on' : 'off',
          'data-run': workRunning > 0 ? 'on' : 'off',
          'aria-selected': active === 'work' ? 'true' : 'false',
          title: workRunning > 0 ? `${workRunning} 个会话在跑` : '今天干了什么',
          onClick: () => setView('work'),
        }, '功课'),
        h('button', {
          type: 'button', role: 'tab', className: 'fj-tab',
          'data-on': active === 'card' ? 'on' : 'off',
          'aria-selected': active === 'card' ? 'true' : 'false',
          onClick: () => setView('card'),
        }, '今日读经'));

      // 卡片底部那一排：大小三档 + 声音开关
      const sizeSwitch = () => h(React.Fragment, null,
        h('span', { className: 'fj-size', role: 'group', 'aria-label': '莲鲸大小' },
          SIZES.map((item) => h('button', {
            key: item.id,
            type: 'button',
            'data-on': size === item.id ? 'on' : 'off',
            'aria-pressed': size === item.id ? 'true' : 'false',
            onClick: () => pickSize(item.id),
            title: `${item.label}号 · ${Math.round(item.scale * 100)}%`,
          }, item.label))),
        h('button', {
          type: 'button',
          className: 'fj-sound',
          'data-on': mutedUi ? 'off' : 'on',
          'aria-pressed': mutedUi ? 'true' : 'false',
          onClick: toggleMute,
          title: mutedUi ? '现在没有声音，点一下打开' : '点一下静音（会记住）',
        }, mutedUi ? '静音' : '有声'));

      const jumpToSession = (item) => {
        const result = openHostSession(hostCtx, item?.id);
        try {
          window.console?.info?.('[莲鲸·功课]', result.ok ? 'openSession 成功' : 'openSession 未跳转', item?.id || '', result.message);
        } catch { /* 没 console 就算了 */ }
        setJumpMsg({ id: String(item?.id || ''), text: result.message });
      };

      // --- 功课页 -----------------------------------------------------------
      const workDetail = (item) => h('div', { className: 'fj-work-open' },
        item.todos.items.length > 0
          ? h('div', null,
            h('p', { className: 'fj-work-sec' }, '子任务'),
            item.todos.items.map((todo, index) => h('div', {
              key: `todo-${index}`,
              className: 'fj-todo',
              'data-s': todo.status,
            },
            h('em', null, todo.status === 'completed' ? '✓' : todo.status === 'in_progress' ? '◔' : '○'),
            h('span', null, todo.content))))
          : h('p', { className: 'fj-work-sec', style: { margin: 0 } }, '这个会话没有登记子任务'),
        h('div', { className: 'fj-work-nums' },
          h('span', null, 'token ', h('b', null, fmtTokens(item.tokens.total))),
          h('span', null, '轮次 ', h('b', null, String(item.stats.turns))),
          h('span', null, 'LLM ', h('b', null, fmtWork(item.stats.llmMs))),
          h('span', null, '工具 ', h('b', null, fmtWork(item.stats.toolMs)))),
        item.children.length > 0
          ? h('div', { className: 'fj-work-kids' },
            h('p', { className: 'fj-work-sec', style: { margin: '7px 0 3px' } }, `子 agent · ${item.childCount}`),
            item.children.map((kid) => h('div', { key: kid.id, className: 'fj-work-kid' },
              h('i', { className: 'fj-work-dot', 'data-run': kid.running ? 'on' : 'off' }),
              h('span', null, kid.title || kid.short),
              h('b', { className: 'fj-work-num' }, fmtTokens(kid.tokens.total)))))
          : null,
        h('span', {
          className: 'fj-work-jump',
          role: 'button',
          tabIndex: 0,
          title: item.id ? `session ${item.id}` : '这个会话没有 id',
          onClick: (event) => { event.stopPropagation(); jumpToSession(item); },
          onKeyDown: (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.stopPropagation();
            event.preventDefault();
            jumpToSession(item);
          },
        }, '在 DSH 里打开这个对话 →',
        jumpMsg && jumpMsg.id === String(item.id || '') ? h('em', { className: 'fj-work-jumpmsg' }, jumpMsg.text) : null));

      const workRow = (item) => {
        const expanded = workOpen === item.id;
        const ratio = item.todos.total > 0 ? Math.round((item.todos.done / item.todos.total) * 100) : 0;
        return h('div', { key: item.id },
          h('button', {
            type: 'button',
            className: 'fj-work-row',
            'data-run': item.running ? 'on' : 'off',
            'data-open': expanded ? 'on' : 'off',
            'aria-expanded': expanded ? 'true' : 'false',
            onClick: () => setWorkOpen(expanded ? '' : item.id),
          },
          h('div', { className: 'fj-work-top' },
            h('i', { className: 'fj-work-dot', 'data-run': item.running ? 'on' : 'off' }),
            h('span', { className: 'fj-work-title' }, item.title || '（没有标题）')),
          h('div', { className: 'fj-work-meta' },
            item.todos.total > 0 ? h('span', { className: 'fj-work-num' }, `${item.todos.done}/${item.todos.total}`) : null,
            item.todos.total > 0 ? h('span', { className: 'fj-work-bar' }, h('i', { style: { width: `${ratio}%` } })) : null,
            h('span', { className: 'fj-work-num', style: { marginLeft: 'auto' } }, `${fmtTokens(item.tokens.total)} tok`),
            h('span', { className: 'fj-work-num' },
              item.running ? fmtWork(item.durationMs) : fmtAgo(item.idleMs)))),
          expanded ? workDetail(item) : null);
      };

      // 客户端分组：宿主只给扁平的 sessions，project 就是 cwd 目录名。
      // 组内：在跑的排前，再按 lastPromptAt 倒序；组间：有在跑的组优先，再按组内最近活动倒序。
      const groupSessions = (sessions) => {
        const buckets = new Map();
        for (const item of sessions) {
          const key = String(item.project || item.short || '未归类').trim() || '未归类';
          if (!buckets.has(key)) buckets.set(key, []);
          buckets.get(key).push(item);
        }
        const stamp = (item) => Number(item.lastPromptAt) || 0;
        const groups = [];
        for (const [key, items] of buckets) {
          const ordered = items.slice().sort((a, b) => (b.running ? 1 : 0) - (a.running ? 1 : 0) || stamp(b) - stamp(a));
          groups.push({
            key,
            items: ordered,
            running: ordered.filter((item) => item.running).length,
            tokens: ordered.reduce((sum, item) => sum + (Number(item.tokens?.total) || 0), 0),
            latest: Math.max(0, ...ordered.map(stamp)),
            // 时间兜底：老会话可能没有 lastPromptAt，就退回组内最小 idleMs（缺字段的不算 0）
            idle: (() => { const list = ordered.map((item) => Number(item.idleMs)).filter((value) => Number.isFinite(value) && value >= 0); return list.length ? Math.min(...list) : 0; })(),
          });
        }
        groups.sort((a, b) => (b.running > 0 ? 1 : 0) - (a.running > 0 ? 1 : 0) || b.latest - a.latest);
        return groups;
      };

      const projRow = (group) => {
        const closed = Boolean(projClosed[group.key]);
        // 时间取组内最近的一次活动：有 lastPromptAt 就按它算，没有就退回最小的 idleMs
        const ago = group.latest > 0 ? Math.max(0, Date.now() - group.latest) : group.idle;
        return h('div', { key: group.key, className: 'fj-proj' },
          h('button', {
            type: 'button',
            className: 'fj-proj-row',
            'data-closed': closed ? 'on' : 'off',
            'aria-expanded': closed ? 'false' : 'true',
            title: closed ? `展开「${group.key}」的 ${group.items.length} 个会话` : `收起「${group.key}」`,
            onClick: () => setProjClosed((prev) => ({ ...prev, [group.key]: !prev[group.key] })),
          },
          h('i', { className: 'fj-proj-dot', 'data-run': group.running > 0 ? 'on' : 'off' }),
          h('span', { className: 'fj-proj-name' }, group.key),
          h('span', { className: 'fj-proj-count' }, `${group.items.length} 个`),
          group.running > 0 ? h('span', { className: 'fj-proj-run' }, `· ${group.running} 个在跑`) : null,
          h('span', { className: 'fj-proj-sum' }, `合计 ${fmtTokens(group.tokens)}`),
          h('span', { className: 'fj-proj-ago' }, fmtAgo(ago)),
          h('i', { className: 'fj-proj-caret', 'aria-hidden': true }, closed ? '▸' : '▾')),
          closed ? null : h('div', { className: 'fj-spine' }, group.items.map((item) => h('div', {
            key: item.id,
            className: 'fj-spine-item',
          }, workRow(item)))));
      };

      const workView = () => {
        const sessions = work?.sessions || [];
        return h('div', null,
          h('div', { className: 'fj-head' },
            tabs('work'),
            h('button', { className: 'fj-close', type: 'button', onClick: close, 'aria-label': '收起卡片' }, '×')),
          h('div', { className: 'fj-body' },
            h('div', { className: 'fj-work-sum' },
              h('b', null, workError
                ? '读不到'
                : `${workRunning} 个在跑`),
              h('span', null, work?.totalSessions ? `共 ${Number(work.totalSessions)} 个会话` : ''),
              h('span', { style: { marginLeft: 'auto' } }, workError ? '宿主没连上' : '刚刚')),
            sessions.length > 0
              ? h('div', { className: 'fj-work-list' }, groupSessions(sessions).map(projRow))
              : h('p', { className: 'fj-work-empty' },
                workError ? '读不到功课，宿主那边可能还没重开' : '今日无功课'),
            h('div', { className: 'fj-foot' },
              h('span', { className: 'fj-src' }, muyuTotal > 0 ? `已积功德 ${muyuTotal}` : '数字来自 DSH 会话日志'),
              h('button', { className: 'fj-btn', type: 'button', onClick: close }, '收起'),
              sizeSwitch())));
      };

      // --- 今日卡片 ----------------------------------------------------------
      const cardView = () => (current
        ? h('div', null,
          h('div', { className: 'fj-head' },
            tabs('card'),
            h('button', { className: 'fj-nav', type: 'button', disabled: !older, onClick: () => navigate(1), 'aria-label': '更早一条' }, '‹'),
            h('button', { className: 'fj-nav', type: 'button', disabled: !newer, onClick: () => navigate(-1), 'aria-label': '更新一条' }, '›'),
            h('button', {
              className: 'fj-head-fetch', type: 'button',
              onClick: () => { void openFetch('card'); },
              title: '从 fojing.com 再取一部经的原文',
            }, '取经'),
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
                  className: 'fj-btn', type: 'button', disabled: shellBusy || shellStarting, onClick: () => { void toggleShell(); },
                  title: shellUp ? '收回桌面上的莲鲸' : shellStarting ? '正在叫她出来，窗口一两秒就出来' : '让她作为一个独立窗口站到桌面上，浮在所有窗口最上层，关掉 DSH 也还在',
                }, shellBusy ? '开关中…' : shellStarting ? '叫她出来中…' : shellUp ? '收回桌宠' : '放她到桌面')
                : null,
              h('button', { className: 'fj-btn', type: 'button', onClick: close, 'aria-label': '收起这页' }, '收起'),
              sizeSwitch(),
              h('button', {
                className: 'fj-btn', type: 'button', 'data-primary': 'on',
                disabled: running, onClick: () => { void regenerate(); }, 'aria-label': '再读一句',
              }, running ? '翻页中…' : '再读一句'))))
        : h('div', { className: 'fj-body' },
          h('div', { className: 'fj-head' },
            tabs('card'),
            h('button', {
              className: 'fj-head-fetch', type: 'button',
              onClick: () => { void openFetch('card'); },
              title: '从 fojing.com 再取一部经的原文',
            }, '取经'),
            h('button', { className: 'fj-close', type: 'button', onClick: close, 'aria-label': '收起卡片' }, '×')),
          h('p', { className: 'fj-empty' }, running ? '莲鲸正在翻经…' : '还没有读过的经文。'),
          h('button', {
            className: 'fj-btn', type: 'button', 'data-primary': 'on',
            disabled: running, onClick: () => { void regenerate(); },
          }, running ? '翻页中…' : '现在读一句'),
          h('div', { className: 'fj-foot' },
            h('span', { className: 'fj-src' }, '还没有经文'),
            sizeSwitch())));

      const card = h('div', {
        className: 'fj-card',
        ref: cardEl,
        role: 'dialog',
        'data-view': view,
        'aria-label': view === 'study' ? '逐句读' : view === 'fetch' ? '取经' : view === 'work' ? '功课' : '今日读经',
        // 卡片在立绘的 div 里：不拦一下，点卡片里任何地方都会冒泡到立绘上，被当成「收起」
        onClick: (event) => event.stopPropagation(),
        onPointerDown: (event) => event.stopPropagation(),
        onPointerUp: (event) => event.stopPropagation(),
        style: {
          '--fj-shift': `${shift}px`,
          maxHeight: cardMax ? `${cardMax}px` : undefined,
        },
      },
        view === 'fetch' ? fetchView() : view === 'study' ? studyView() : view === 'work' ? workView() : cardView(),
        error ? h('p', { className: 'fj-warn', style: { margin: '0 20px 12px' } }, '连接中断，重试中…') : null,
        shell?.error ? h('p', { className: 'fj-warn', style: { margin: '0 20px 12px' } }, `桌宠壳：${String(shell.error).slice(0, 90)}`) : null);

      const style = pos ? { left: pos.x, top: pos.y } : { right: 20, bottom: 96 };

      // 桌面壳站着的时候，界面里的那只就隐身，只留一枚收回按钮
      if (shellUp) {
        return h('button', {
          type: 'button', onClick: () => { void toggleShell(); },
          title: '收回桌面上的莲鲸',
          style: {
            position: 'fixed', right: 16, bottom: 16, zIndex: 2147483000,
            display: 'flex', alignItems: 'center', gap: 5,
            border: '1px solid rgba(190,170,135,.6)', borderRadius: 7, cursor: 'pointer',
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
            'data-size': size,
            style: {
              '--fj-scale': scale,
              '--fj-inv': 1 / scale,
              '--fj-lift': `${Math.round((1 - scale) * PET_H)}px`,
            },
            onPointerDown: startDrag,
            onPointerMove: onDrag,
            onPointerUp: endDrag,
            onClick: (event) => {
              if (suppress.current) { suppress.current = false; return; }
              if (open) { close(); return; }
              if (knockHit(event)) { knock(); return; }
              pinned.current = history[0]?.id || null;
              look(400); // 先抬眼「哦，是你」，再低头捧经
              setOpen(true);
            },
            role: 'button',
            tabIndex: 0,
            onKeyDown: (event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              if (open) { close(); return; }
              pinned.current = history[0]?.id || null;
              look(400); // 先抬眼「哦，是你」，再低头捧经
              setOpen(true);
            },
            'aria-label': `莲鲸，${unread ? `${unread} 条未读经文` : '没有新经文'}，点中间敲木鱼，点四周看功课`,
          },
          h('div', { className: 'fj-fit' },
            workRunning > 0 ? h('i', {
              className: 'fj-halo',
              'data-state': 'busy',
              'data-img': data?.pet?.sprites?.halo ? 'on' : 'off',
              style: data?.pet?.sprites?.halo ? { backgroundImage: `url("${data.pet.sprites.halo}")` } : undefined,
              'aria-hidden': true,
            }) : null,
            sprite()
              ? h('img', {
                className: 'fj-img',
                'data-talking': open ? 'on' : 'off',
                'data-knock': knocking ? 'on' : 'off',
                src: sprite(), alt: '莲鲸', draggable: false,
                title: '点她中间敲木鱼',
                onError: () => setSpriteBroken(true),
              })
              : h('div', { className: 'fj-img', 'aria-hidden': true }),
            knocks.length > 0
              ? h('div', { className: 'fj-knocks', 'aria-hidden': true },
                knocks.map((item) => h('span', {
                  key: item.id, className: 'fj-knock', style: { marginLeft: item.drift },
                }, item.label, h('b', null, '+1'))))
              : null,
            // 灵感光点：不写数字，呼吸发光；有未读亮一点，没有也留着——入口不能藏起来
            h('button', {
              type: 'button',
              className: 'fj-spark',
              'data-lit': unread > 0 ? 'on' : 'off',
              'aria-label': unread > 0 ? `展开功课面板，有 ${unread} 条未读经文` : '展开功课面板',
              title: unread > 0 ? `${unread} 条未读经文 · 展开功课面板` : '展开功课面板',
              onPointerDown: (event) => event.stopPropagation(),
              onClick: (event) => {
                event.stopPropagation();
                if (open) { close(); return; }
                pinned.current = history[0]?.id || null;
                look(400);
                setOpen(true);
              },
            }, h('i', { 'aria-hidden': true }))),
          h('div', { className: 'fj-chips' },
            h('span', { className: 'fj-tag' },
              h('i', { className: 'fj-dot', 'data-off': online ? 'on' : 'off' }),
              running
                ? '翻经中'
                : workRunning > 0
                  ? `${workRunning} 个功课进行中`
                  : Number.isFinite(countdown) && countdown > 0 ? untilText(countdown) : '静坐中'),
            h('span', { className: 'fj-merit' }, `已积功德 ${Number(muyuTotal) || 0}`))),
          open ? card : null,
          open ? h('span', { className: 'fj-tail', 'aria-hidden': true }) : null));
    }

    function apply(ctx) {
      hostCtx = ctx; // 功课页的「打开这个对话」要用它取 uiWorkspace
      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay', id: 'dsh-fojing-pet', order: 88,
      }, Pet));
    }

    return { apply, inject: ['slots'] };
  },
});
