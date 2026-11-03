/**
 * 离线冒烟测试：不启动 DSH，只校验纯函数与语料。
 * 运行：node verify/smoke.mjs
 */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  normaliseConfig,
  validateCorpus,
  validateSutra,
  flattenSegments,
  makeCard,
  isQuietAt,
  quietEnd,
  stripFrontmatter,
} from '../index.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

let failures = 0;
const check = (label, condition, detail = '') => {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

console.log('config');
const cfg = normaliseConfig({});
check('默认开启', cfg.enabled === true);
check('默认 3600s', cfg.everySeconds === 3600);
check('默认免打扰 22-6', JSON.stringify(cfg.quietHours) === '[22,6]');
check('空字符串回退默认值', normaliseConfig({ everySeconds: '' }).everySeconds === 3600);
check('超界值被夹紧', normaliseConfig({ everySeconds: 1 }).everySeconds === 60);
check('关闭可用', normaliseConfig({ enabled: false }).enabled === false);

console.log('quiet hours');
const at = (hour) => { const d = new Date(2026, 0, 1, hour, 30, 0, 0); return d; };
check('23 点在免打扰内', isQuietAt(at(23), [22, 6]) === true);
check('3 点在免打扰内', isQuietAt(at(3), [22, 6]) === true);
check('12 点不在免打扰内', isQuietAt(at(12), [22, 6]) === false);
check('22 点边界算内', isQuietAt(at(22), [22, 6]) === true);
check('6 点边界算外', isQuietAt(at(6), [22, 6]) === false);
check('免打扰结束落在 6 点', quietEnd(at(23), [22, 6]).getHours() === 6);

console.log('corpus');
const manifest = JSON.parse(await readFile(join(root, 'corpus', 'index.json'), 'utf8'));
const manifestErrors = validateCorpus(manifest);
check('经目结构合法', manifestErrors.length === 0, manifestErrors.join('；'));
check('至少 4 部经', manifest.sutras.length >= 4, `实际 ${manifest.sutras.length} 部`);

const sutras = [];
for (const file of manifest.sutras) {
  const doc = JSON.parse(await readFile(join(root, 'corpus', file), 'utf8'));
  const docErrors = validateSutra(doc);
  check(`经文 ${file} 结构合法`, docErrors.length === 0, docErrors.slice(0, 3).join('；'));
  sutras.push(doc);
}
const segments = flattenSegments(sutras);
check('总句数不少于 60', segments.length >= 60, `实际 ${segments.length} 句`);
check('每句都有原文', segments.every((s) => typeof s.text === 'string' && s.text.trim().length > 0));
check('每句都有释义', segments.every((s) => typeof s.gist === 'string' && s.gist.trim().length > 0));
check('每句都有练习', segments.every((s) => typeof s.practice === 'string' && s.practice.trim().length > 0));
check('每句至少一个名相', segments.every((s) => Array.isArray(s.terms) && s.terms.length > 0 && s.terms.every((t) => t.word && t.gloss)));
check('每部经句序从 1 连续', sutras.every((doc) => doc.segments.every((s, i) => Number(s.no) === i + 1)));
check('原文不含空白换行', segments.every((s) => !/\s/.test(s.text)));
check('语言是中文', segments.every((s) => /[\u4e00-\u9fa5]/.test(s.text)));

console.log('card');
const card = makeCard(segments[0], new Date('2026-01-01T00:00:00Z'));
check('卡片有 id', typeof card.id === 'string' && card.id.length > 0);
check('卡片引用带原文', card.cite.text === segments[0].text);
check('卡片默认未读', card.read === false);
check('卡片来源是语料', card.mode === 'corpus');
check('卡片释义与原文分开', card.gist !== card.cite.text);
check('卡片带分名', typeof card.label === 'string');
check('卡片带计量单位', typeof card.unit === 'string' && card.unit.length > 0);
check('卡片不写免责声明', !JSON.stringify(card).includes('非经文原句'));
check('每部经有计量单位', sutras.every((doc) => typeof doc.unit === 'string' && doc.unit.length > 0));

console.log('assets');
for (const file of ['pet-idle.png', 'pet-open.png', 'pet-read.png', 'icon-256.png']) {
  const bytes = await readFile(join(root, 'assets', file));
  check(`${file} 存在且非空`, bytes.length > 1024, `${bytes.length} bytes`);
  check(`${file} 是 PNG`, bytes[0] === 0x89 && bytes[1] === 0x50);
}

console.log('client');
const clientSource = await readFile(join(root, 'client.js'), 'utf8');
check('client 注册到 shell.overlay', clientSource.includes("ctx.slots.inject('shell.overlay'"));
check('client 声明 inject slots', clientSource.includes("inject: ['slots']"));
check('client 声明模块 id', clientSource.includes("id: 'dsh-plugin-fojing-pet'"));
check('client 不硬编码 API 域名', !clientSource.includes('http://127.0.0.1:'));
check('client 有逐句学习视图', clientSource.includes('studyView'));
check('client 会标记单句已读', clientSource.includes('API.segmentRead'));
check('client 有桌面壳开关', clientSource.includes('toggleShell'));
check('client 有经书选择器', clientSource.includes('sutraPicker') && clientSource.includes('fj-chip'));
check('client 显示名相', clientSource.includes('fj-terms'));
check('client 不再写免责声明', !clientSource.includes('非经文原句'));

console.log('skill');
const skillSource = await readFile(join(root, 'skill', 'fojing-vademecum', 'SKILL.md'), 'utf8');
check('SKILL.md 有 frontmatter', skillSource.startsWith('---'));
check('skill 声明了名称', /^name:\s*fojing-vademecum/m.test(skillSource));
const stripped = stripFrontmatter(skillSource);
check('去 frontmatter 后非空', stripped.trim().length > 100);
check('去 frontmatter 后不含 --- 开头', !stripped.startsWith('---'));
check('skill 有逐字引用规则', stripped.includes('逐字'));

console.log('patch');
const patch = await readFile(join(root, 'cordis.patch.yml'), 'utf8');
check('patch 挂载插件行', patch.includes('dsh-plugin-fojing-pet'));
check('patch 有佛经学习 preset', patch.includes('preset-fojing-pet') && patch.includes('id: fojing-pet'));
check('patch 的 preset 引用 skill 工具', patch.includes('dsh-tool-skill'));
check('patch 的 todo 带必填项', patch.includes('allowParallelInProgress'));

console.log('desktop shell');
const shellPath = join(root, 'desktop', 'pet-shell.ps1');
const shellBytes = await readFile(shellPath);
check('悬浮壳脚本存在', shellBytes.length > 2000, `${shellBytes.length} bytes`);
check('悬浮壳带 UTF-8 BOM', shellBytes[0] === 0xef && shellBytes[1] === 0xbb && shellBytes[2] === 0xbf);
const shellSource = shellBytes.toString('utf8');
check('悬浮壳置顶透明', shellSource.includes('Topmost') && shellSource.includes('AllowsTransparency'));
check('悬浮壳走回环公开路由', shellSource.includes('/dsh-fojing-pet/pet.json'));
check('悬浮壳带自定义请求头', shellSource.includes('x-dsh-fojing-pet'));
check('悬浮壳自己算拖动位移', shellSource.includes('Get-DpiScale') && shellSource.includes('CaptureMouse'));
check('悬浮壳拖动按 DPI 缩放换算', shellSource.includes('TransformToDevice'));
check('悬浮壳把窗口夹在工作区内', shellSource.includes('Move-PetTo') && shellSource.includes('WorkArea'));
check('悬浮壳有出屏自愈守卫', shellSource.includes('Test-OnScreen'));
check('悬浮壳有经书选择器', shellSource.includes('New-SutraChip') && shellSource.includes('pickerPanel'));
check('悬浮壳 POST 带 JSON body', shellSource.includes("-ContentType 'application/json'"));
check('悬浮壳不给立绘挂 ToolTip', !shellSource.includes('$petImage.ToolTip'));
check('悬浮壳兜住事件异常', shellSource.includes('Add_UnhandledException'));

console.log('multi-sutra');
const hostSource = await readFile(join(root, 'index.js'), 'utf8');
check('host 支持按经书出卡', hostSource.includes('pickSegment'));
check('next 路由透传请求体', hostSource.includes('handlers.next(request)'));

console.log('');
if (failures) {
  console.log(`失败 ${failures} 项`);
  process.exit(1);
}
console.log('全部通过');
