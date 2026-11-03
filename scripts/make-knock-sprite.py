"""把生成的立绘处理成和三张现有立绘同规格的透明 PNG。

    python scripts/make-knock-sprite.py <输入图> [输出路径]

做四件事：
  1. 白底转透明：从四条边做泛洪（不是简单抠白，白袍、白莲花这些封闭区域不会被挖掉）
  2. 边缘去白边：贴近背景的一圈像素按亮度降一点不透明度，再整体羽化，避免一圈白胡子
  3. 裁到内容框，等比缩放到能塞进 436×446
  4. 底部居中对齐放进 460×479 画布（和三张现有立绘同画布同基线，切换不跳）

用法示例：
    python scripts/make-knock-sprite.py _preview/raw-knock.png assets/pet-knock.png
"""
import sys
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

CANVAS = (460, 479)
CONTENT = (436, 446)   # 现有立绘的内容框：bbox (12, 33, 448, 479)
WHITE_CUT = 240        # 三通道都 >= 这个值，才当背景
SOFT_EDGE = 1.0        # 边缘羽化半径（像素）


def white_to_alpha(img: Image.Image) -> Image.Image:
    """从四边泛洪抠白底；封闭区域里的白色（衣服、花瓣）保持不动。"""
    rgb = img.convert('RGB')
    arr = np.asarray(rgb).astype(np.int16)
    h, w, _ = arr.shape

    is_white = (arr[:, :, 0] >= WHITE_CUT) & (arr[:, :, 1] >= WHITE_CUT) & (arr[:, :, 2] >= WHITE_CUT)
    seen = np.zeros((h, w), dtype=bool)
    queue = deque()

    for x in range(w):
        for y in (0, h - 1):
            if is_white[y, x] and not seen[y, x]:
                seen[y, x] = True
                queue.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if is_white[y, x] and not seen[y, x]:
                seen[y, x] = True
                queue.append((y, x))

    while queue:
        y, x = queue.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and not seen[ny, nx] and is_white[ny, nx]:
                seen[ny, nx] = True
                queue.append((ny, nx))

    alpha = np.where(seen, 0, 255).astype(np.uint8)

    # 贴着背景的一圈：越亮越透，把抗锯齿留下的白边吃掉
    ring = np.zeros_like(seen)
    bg = seen
    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        shifted = np.roll(bg, (dy, dx), axis=(0, 1))
        if dy == 1:
            shifted[0, :] = False
        elif dy == -1:
            shifted[-1, :] = False
        elif dx == 1:
            shifted[:, 0] = False
        else:
            shifted[:, -1] = False
        ring |= shifted
    ring &= ~bg

    lum = arr.mean(axis=2)
    soften = np.clip((lum - 200) / 55.0, 0, 1)      # 200→0, 255→1
    alpha[ring] = (alpha[ring] * (1 - soften[ring])).astype(np.uint8)

    out = img.convert('RGBA')
    out.putalpha(Image.fromarray(alpha))
    if SOFT_EDGE > 0:
        a = out.split()[-1].filter(ImageFilter.GaussianBlur(SOFT_EDGE))
        out.putalpha(a)
    return out


def fit_canvas(img: Image.Image) -> Image.Image:
    """裁内容框 → 等比缩进 436×446 → 底部居中放进 460×479。"""
    bbox = img.split()[-1].getbbox()
    if bbox:
        img = img.crop(bbox)
    limit_w, limit_h = CONTENT
    scale = min(limit_w / img.width, limit_h / img.height)
    size = (max(1, round(img.width * scale)), max(1, round(img.height * scale)))
    img = img.resize(size, Image.LANCZOS)

    canvas = Image.new('RGBA', CANVAS, (0, 0, 0, 0))
    x = (CANVAS[0] - size[0]) // 2
    y = CANVAS[1] - size[1]
    canvas.alpha_composite(img, (x, y))
    return canvas


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    src = Path(sys.argv[1])
    dest = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(__file__).parent.parent / 'assets' / 'pet-knock.png'
    if not src.exists():
        print(f'找不到输入图：{src}')
        return 1

    img = Image.open(src)
    out = fit_canvas(white_to_alpha(img))
    dest.parent.mkdir(parents=True, exist_ok=True)
    out.save(dest, optimize=True)
    bbox = out.split()[-1].getbbox()
    print(f'写入 {dest}  {out.size[0]}x{out.size[1]}  {dest.stat().st_size} 字节  内容框 {bbox}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
