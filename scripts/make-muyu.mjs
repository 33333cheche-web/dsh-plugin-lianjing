// 合成一声敲木鱼的「梆」。两种模型：
//
//   node scripts/make-muyu.mjs                  # 默认 classic（随包用的就是这一版）
//   node scripts/make-muyu.mjs --variant deep   # 大木鱼：低、闷
//   node scripts/make-muyu.mjs --variant mid    # 中号
//   node scripts/make-muyu.mjs --variant bright # 小木鱼：清、短
//   node scripts/make-muyu.mjs --variant deep --out 某个路径.wav
//
// 出口 44.1kHz / 单声道 / 16bit。合成而不是扒音频：随包素材的来源得说得清，
// 也不牵扯第三方版权。
//
// 两套模型：
//   classic —— 短促的一记「梆」（618Hz 主体 + 1265Hz 眨眼的高频 + 315Hz 低腔，
//              220ms）。随包 assets/muyu.wav 用的就是它：这是听下来最像那一下的，
//              别默默换掉。
//   wood 三档 —— 更「空心木块」的做法：成对失谐的非整数泛音（打拍子出木头味）、
//              被木头滤过的槌击噪声、敲下去音高先高后落 6%、一记低频闷响。
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const argOf = (name, fallback) => {
  const at = argv.indexOf(`--${name}`);
  return at >= 0 && argv[at + 1] ? argv[at + 1] : fallback;
};

const RATE = 44100;

// deep 大木鱼（殿里那种，低、闷）/ mid 中号 / bright 小木鱼（清脆、短）
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
    attackTau: 0.0035,
    thumpHz: 98,
    thumpAmp: 0.30,
    drop: 0.07,              // 敲下去音高掉的幅度
    dropTau: 0.018,
    drive: 1.15,
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
    attackTau: 0.0035,
    thumpHz: 132,
    thumpAmp: 0.26,
    drop: 0.065,
    dropTau: 0.016,
    drive: 1.15,
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
    attackTau: 0.0035,
    thumpHz: 176,
    thumpAmp: 0.18,
    drop: 0.05,
    dropTau: 0.014,
    drive: 1.15,
    peak: 0.82,
  },
};

// 固定种子：每次生成的文件一模一样，改代码了 diff 才看得出来
let seed = 12345;
const rand = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return (seed / 0x7fffffff) * 2 - 1;
};
const TAU = Math.PI * 2;

// 包成 16bit 单声道 WAV
const toWav = (samples) => {
  const n = samples.length;
  const bytes = n * 2;
  const buf = Buffer.alloc(44 + bytes);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + bytes, 4);
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
  buf.writeUInt32LE(bytes, 40);
  for (let i = 0; i < n; i += 1) buf.writeInt16LE(Math.round(samples[i] * 32767), 44 + i * 2);
  return buf;
};

// 归一 + 末尾淡出，避免爆音
const finish = (out, peakTarget, fadeMs) => {
  let peak = 0;
  for (let i = 0; i < out.length; i += 1) peak = Math.max(peak, Math.abs(out[i]));
  const gain = peak > 0 ? peakTarget / peak : 1;
  const fade = Math.floor(RATE * (fadeMs / 1000));
  for (let i = 0; i < out.length; i += 1) {
    const tail = i > out.length - fade ? (out.length - i) / fade : 1;
    out[i] = Math.max(-1, Math.min(1, out[i] * gain * tail));
  }
  return out;
};

// --- classic：随包用的那一记 ------------------------------------------------
const classic = () => {
  const n = Math.floor(RATE * 0.22);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    const t = i / RATE;
    // 敲击瞬间的一点点噪声：只存在 4ms，给「木质」的起音
    const noise = rand() * Math.exp(-t / 0.004) * 0.55;
    // 主体：两个略微不谐的音分音 + 一个低沉的腔体共鸣
    const body = Math.sin(TAU * 618 * t) * Math.exp(-t / 0.052) * 0.62
      + Math.sin(TAU * 1265 * t) * Math.exp(-t / 0.019) * 0.24
      + Math.sin(TAU * 315 * t) * Math.exp(-t / 0.085) * 0.17;
    out[i] = body + noise;
  }
  for (let i = 0; i < n; i += 1) out[i] = Math.tanh(out[i] * 1.6);
  return finish(out, 0.72, 25);
};

// --- wood：空心木块 ---------------------------------------------------------
const wood = (profile) => {
  const n = Math.floor(RATE * profile.dur);
  const out = new Float64Array(n);

  // 状态变量带通：给起音那段噪声一点「木头」的共振峰，而不是白噪声嘶声
  const f = 2 * Math.sin((Math.PI * profile.attackHz) / RATE);
  const q = 1 / profile.attackQ;
  let low = 0;
  let band = 0;

  for (let i = 0; i < n; i += 1) {
    const t = i / RATE;

    // 1) 起音：木头被槌子撞的那一下，宽频但集中在 1~2.5k
    const high = rand() - low - q * band;
    band += f * high;
    low += f * band;
    const attack = band * Math.exp(-t / profile.attackTau) * profile.attackAmp;

    // 2) 腔体：成对失谐的非整数泛音（互相打拍子 → 木头味）
    let body = 0;
    for (let m = 0; m < profile.ratios.length; m += 1) {
      // 敲下去的瞬间音高偏高，几十毫秒内落回基频
      const bend = 1 + profile.drop * Math.exp(-t / profile.dropTau);
      const freq = profile.base * profile.ratios[m] * bend;
      const decay = Math.exp(-t / profile.decays[m]);
      const pair = 1 + profile.detune * (m + 1) * 0.5;
      body += profile.amps[m] * decay * 0.5 * (
        Math.sin(TAU * freq * t) + Math.sin(TAU * freq * pair * t)
      );
    }

    // 3) 低频那一记闷响：给「梆」一点重量
    const thump = Math.sin(TAU * profile.thumpHz * t) * Math.exp(-t / 0.06) * profile.thumpAmp;

    out[i] = body + attack + thump;
  }

  for (let i = 0; i < n; i += 1) out[i] = Math.tanh(out[i] * profile.drive);
  return finish(out, profile.peak, 30);
};

const variant = argOf('variant', 'classic');
const dest = argOf('out', join(here, '..', 'assets', 'muyu.wav'));

let samples;
if (variant === 'classic') samples = classic();
else if (PROFILES[variant]) samples = wood(PROFILES[variant]);
else {
  console.error(`没有这一档：${variant}（可选 classic / ${Object.keys(PROFILES).join(' / ')}）`);
  process.exit(1);
}

const buf = toWav(samples);
await writeFile(dest, buf);
console.log(`写入 ${dest}  ${buf.length} 字节  档位=${variant}`);
