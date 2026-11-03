// 合成一声木鱼「梆」：短促、有木头味、不刺耳。
//
//   node scripts/make-muyu.mjs
//
// 出口 assets/muyu.wav（44.1kHz / 单声道 / 16bit / 0.22s，约 19KB）。
// 合成而不是扒音频：随包素材的来源得说得清，也不牵扯第三方版权。
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dest = join(here, '..', 'assets', 'muyu.wav');

const RATE = 44100;
const DUR = 0.22;
const N = Math.floor(RATE * DUR);
const out = new Float64Array(N);

// 固定种子：每次生成的文件一模一样，改代码了 diff 才看得出来
let seed = 12345;
const rand = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return (seed / 0x7fffffff) * 2 - 1;
};

for (let i = 0; i < N; i += 1) {
  const t = i / RATE;
  // 敲击瞬间的一点点噪声：只存在 4ms，给「木质」的起音
  const noise = rand() * Math.exp(-t / 0.004) * 0.55;
  // 主体：两个略微不谐的音分音 + 一个低沉的腔体共鸣
  const body = Math.sin(2 * Math.PI * 618 * t) * Math.exp(-t / 0.052) * 0.62
    + Math.sin(2 * Math.PI * 1265 * t) * Math.exp(-t / 0.019) * 0.24
    + Math.sin(2 * Math.PI * 315 * t) * Math.exp(-t / 0.085) * 0.17;
  out[i] = body + noise;
}

// 软削波，峰值归一到 0.72
let peak = 0;
for (let i = 0; i < N; i += 1) {
  out[i] = Math.tanh(out[i] * 1.6);
  peak = Math.max(peak, Math.abs(out[i]));
}
const gain = peak > 0 ? 0.72 / peak : 1;
// 末尾 25ms 淡出，避免爆音
const fade = Math.floor(RATE * 0.025);
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
console.log(`写入 assets/muyu.wav  ${buf.length} 字节`);
