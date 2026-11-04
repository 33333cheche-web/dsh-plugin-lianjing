// 合成一声木鱼「梆」：空心木头、干脆的起音、尾巴自然收。
//
//   node scripts/make-muyu.mjs                 # 默认档（中号木鱼）→ assets/muyu.wav
//   node scripts/make-muyu.mjs --variant deep  # 大木鱼（更低更闷）
//   node scripts/make-muyu.mjs --variant bright --out 某个路径.wav
//
// 出口 44.1kHz / 单声道 / 16bit。合成而不是扒音频：随包素材的来源得说得清，
// 也不牵扯第三方版权。
//
// 为什么不是「正弦 + 指数衰减」了：那样出来的是钟/铃（音高纯、泛音是整数倍）。
// 木鱼是空心木块被槌子敲，声音有三件事要还原：
//   1. 起音是一小段被木头滤过的噪声（0~5ms），不是干净的咔哒；
//   2. 泛音是**非整数倍**、而且成对微微失谐（互相打拍子），这是「木头味」；
//   3. 敲下去的瞬间音高会往下掉一点点（张力释放），大概 5~8%。
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const argOf = (name, fallback) => {
  const at = argv.indexOf(`--${name}`);
  return at >= 0 && argv[at + 1] ? argv[at + 1] : fallback;
};

// 三档：deep 大木鱼（殿里那种，低、闷、尾巴长一点）
//       mid  中号（默认，最像常见录音）
//       bright 小木鱼（清脆、短，适合连敲）
const PROFILES = {
  deep: {
    dur: 0.42,
    base: 196,               // G3
    ratios: [1, 1.47, 2.09, 2.76, 3.61],
    amps: [0.92, 0.42, 0.24, 0.12, 0.06],
    decays: [0.22, 0.14, 0.08, 0.05, 0.030],
    detune: 0.004,           // 成对失谐，出打拍子的木味
    attackHz: 1500,
    attackQ: 1.1,
    attackAmp: 0.62,
    thumpHz: 98,
    thumpAmp: 0.30,
    drop: 0.07,              // 敲下去音高掉的幅度
    dropTau: 0.018,
    peak: 0.78,
  },
  mid: {
    dur: 0.34,
    base: 294,               // D4
    ratios: [1, 1.58, 2.41, 3.20, 4.10],
    amps: [0.88, 0.40, 0.22, 0.11, 0.05],
    decays: [0.17, 0.11, 0.065, 0.040, 0.025],
    detune: 0.005,
    attackHz: 1900,
    attackQ: 1.2,
    attackAmp: 0.66,
    thumpHz: 132,
    thumpAmp: 0.26,
    drop: 0.065,
    dropTau: 0.016,
    peak: 0.80,
  },
  bright: {
    dur: 0.24,
    base: 440,               // A4
    ratios: [1, 1.63, 2.50, 3.40, 4.35],
    amps: [0.84, 0.38, 0.20, 0.10, 0.05],
    decays: [0.11, 0.075, 0.045, 0.030, 0.020],
    detune: 0.006,
    attackHz: 2400,
    attackQ: 1.35,
    attackAmp: 0.72,
    thumpHz: 176,
    thumpAmp: 0.18,
    drop: 0.05,
    dropTau: 0.014,
    peak: 0.82,
  },
};

const variant = argOf('variant', 'mid');
const profile = PROFILES[variant];
if (!profile) {
  console.error(`没有这一档：${variant}（可选 ${Object.keys(PROFILES).join(' / ')}）`);
  process.exit(1);
}
const dest = argOf('out', join(here, '..', 'assets', 'muyu.wav'));

const RATE = 44100;
const N = Math.floor(RATE * profile.dur);
const out = new Float64Array(N);

// 固定种子：每次生成的文件一模一样，改代码了 diff 才看得出来
let seed = 12345;
const rand = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return (seed / 0x7fffffff) * 2 - 1;
};

// 状态变量带通：给起音那段噪声一点「木头」的共振峰，而不是白噪声嘶声
const f = 2 * Math.sin((Math.PI * profile.attackHz) / RATE);
const q = 1 / profile.attackQ;
let low = 0;
let band = 0;

const TAU = Math.PI * 2;
for (let i = 0; i < N; i += 1) {
  const t = i / RATE;

  // 1) 起音：木头被槌子撞的那一下，宽频但集中在 1~2.5k
  const excite = rand();
  const high = excite - low - q * band;
  band += f * high;
  low += f * band;
  const attack = band * Math.exp(-t / 0.0035) * profile.attackAmp;

  // 2) 腔体：成对失谐的非整数泛音（互相打拍子 → 木头味）
  let body = 0;
  for (let m = 0; m < profile.ratios.length; m += 1) {
    const ratio = profile.ratios[m];
    // 敲下去的瞬间音高偏高，几十毫秒内落回基频
    const bend = 1 + profile.drop * Math.exp(-t / profile.dropTau);
    const freq = profile.base * ratio * bend;
    const decay = Math.exp(-t / profile.decays[m]);
    // 一对差一点点音高的分音，拍频约 1~3Hz，听起来像空心木头在「嗡」
    const pair = 1 + profile.detune * (m + 1) * 0.5;
    body += profile.amps[m] * decay * 0.5 * (
      Math.sin(TAU * freq * t)
      + Math.sin(TAU * freq * pair * t)
    );
  }

  // 3) 低频那一记闷响：给「梆」一点重量，没有它听起来像敲桌子
  const thump = Math.sin(TAU * profile.thumpHz * t) * Math.exp(-t / 0.06) * profile.thumpAmp;

  out[i] = body + attack + thump;
}

// 轻饱和（只压最尖的那点），峰值归一
let peak = 0;
for (let i = 0; i < N; i += 1) {
  out[i] = Math.tanh(out[i] * 1.15);
  peak = Math.max(peak, Math.abs(out[i]));
}
const gain = peak > 0 ? profile.peak / peak : 1;
// 末尾 30ms 淡出，避免爆音
const fade = Math.floor(RATE * 0.03);
for (let i = 0; i < N; i += 1) {
  const tail = i > N - fade ? (N - i) / fade : 1;
  out[i] = Math.max(-1, Math.min(1, out[i] * gain * tail));
}

const dataBytes = N * 2;
const buf = Buffer.alloc(44 + dataBytes);
buf.write('RIFF', 0);
buf.writeUInt32LE(36 + dataBytes, 4);
buf.write('WAVE', 8);
buf.write('fmt ', 12);
buf.writeUInt32LE(16, 16);
buf.writeUInt16LE(1, 20);          // PCM
buf.writeUInt16LE(1, 22);          // 单声道
buf.writeUInt32LE(RATE, 24);
buf.writeUInt32LE(RATE * 2, 28);   // byte rate
buf.writeUInt16LE(2, 32);          // block align
buf.writeUInt16LE(16, 34);         // bits
buf.write('data', 36);
buf.writeUInt32LE(dataBytes, 40);
for (let i = 0; i < N; i += 1) {
  buf.writeInt16LE(Math.round(out[i] * 32767), 44 + i * 2);
}

await writeFile(dest, buf);
console.log(`写入 ${dest}  ${buf.length} 字节  档位=${variant}`);
