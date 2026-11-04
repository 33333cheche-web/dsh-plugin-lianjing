/**
 * 从 fojing.com 抓几部经的正文，存到 _raw/ 供人工校对后编入语料。
 * 只取正文，去掉仪轨、页眉页脚、脚本样式。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '_raw');
mkdirSync(OUT, { recursive: true });

const TARGETS = [
  { id: 'jingang', name: '金刚般若波罗蜜经', url: 'https://fojing.com/%e9%87%91%e5%88%9a%e7%bb%8f/', start: '如是我闻', end: '皆大欢喜' },
  { id: 'sishierzhang', name: '佛说四十二章经', url: 'https://fojing.com/%e4%bd%9b%e8%aa%aa%e5%9b%9b%e5%8d%81%e4%ba%8c%e7%ab%a0%e7%b6%93/', start: '佛言', end: '作礼而去' },
  { id: 'jixiang', name: '吉祥经', url: 'https://fojing.com/%e5%90%89%e7%a5%a5%e7%bb%8f/', start: '如是我闻', end: '皆大欢喜' },
  { id: 'pumen', name: '妙法莲华经观世音菩萨普门品', url: 'https://fojing.com/%e5%a6%99%e6%b3%95%e8%8e%b2%e5%8d%8e%e7%bb%8f-%e5%8d%b7%e7%ac%ac%e4%b8%83/', start: '尔时无尽意菩萨', end: '作礼而去' },
  { id: 'amituo', name: '佛说阿弥陀经', url: 'https://fojing.com/%e4%bd%9b%e8%af%b4%e9%98%bf%e5%bc%a5%e9%99%80%e7%bb%8f/', start: '如是我闻', end: '皆大欢喜' },
  { id: 'bada', name: '佛说八大人觉经', url: 'https://fojing.com/%e4%bd%9b%e8%af%b4%e5%85%ab%e5%a4%a7%e4%ba%ba%e8%a7%89%e7%bb%8f/', start: '为佛弟子', end: '作礼而去' },
];

const strip = (html) => {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '\n');
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#\d+;/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 1);
};

for (const target of TARGETS) {
  try {
    const response = await fetch(target.url, { headers: { 'user-agent': 'Mozilla/5.0' } });
    if (!response.ok) { console.log(`${target.id}: HTTP ${response.status}`); continue; }
    const lines = strip(await response.text());
    const startAt = lines.findIndex((line) => line.includes(target.start));
    const endAt = lines.reduce((acc, line, index) => (line.includes(target.end) ? index : acc), -1);
    if (startAt < 0) { console.log(`${target.id}: 未找到起点`); continue; }
    const body = (endAt > startAt ? lines.slice(startAt, endAt + 1) : lines.slice(startAt));
    writeFileSync(join(OUT, `${target.id}.txt`), body.join('\n'), 'utf8');
    console.log(`${target.id}: ${body.length} 行, 首行「${body[0].slice(0, 20)}」末行「${(body.at(-1) || '').slice(0, 20)}」`);
  } catch (error) {
    console.log(`${target.id}: 失败 ${String(error?.message || error).slice(0, 80)}`);
  }
}
