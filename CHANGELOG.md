# 更新日志

## 未发布

- 加桌面快捷方式：`desktop/install-shortcut.ps1` 在桌面生成「莲鲸桌宠」，双击跑
  `desktop/open-pet.ps1`。后者每次现扫本机在监听的 DeepSeek Harness，确认
  `/dsh-lianjing/pet.json` 在线，再按那个端口拉壳，所以端口变了不用重做快捷方式；
  已经在跑的那只不会被开成第二只；找不到宿主或插件没加载会弹窗说明原因。
  图标是 `assets/lianjing.ico`（16–256 共 7 个尺寸，从 `icon-256.png` 生成）。
- README 安装段对齐事实：npm 上没有这个包，改成「安装包 / 索引源 / 源码」三条路，
  npm 徽章换成 Release。

## 2.0.2

对外发布前的收口版本：安全、桌面壳卡顿、发布元数据与文档。

**安全**

- 回环路由（`/dsh-lianjing/*`）不再无条件放行：Host 必须是 `127.0.0.1` / `localhost`
  （挡 DNS rebinding）、所有方法都要求 `x-dsh-lianjing: 1` 自定义头（跨站页面发不出来）、
  POST 仍要求 `application/json`。此前 `work.json` 的会话标题、cwd、todo、token 用量
  可被任意本机进程或恶意网页（rebinding）免鉴权读走。
- 心跳不再接受请求体里的 `pid`，宿主也不再据此 `process.kill()`。此前本机任意进程都能
  借宿主杀掉任意 PID。外部壳改为「连续多次心跳失败就自行退出」，不再依赖宿主收尸。
- 语料与状态写入改为「唯一临时文件 + rename」的原子写，崩在写盘中间不会留下半截 JSON。

**桌面壳（`desktop/pet-shell.ps1`）**

- 卡片动作（翻页 / 取经 / 刷新 / 标已读 / 心跳）全部移到后台 runspace，UI 线程每 600ms
  统一收尾。此前这些 HTTP 在 UI 线程同步执行（超时 20–50 秒），宿主卡住或断网时窗口
  拖不动、点不动，看起来像死机。
- 音效改用随包的 `assets/muyu.wav`，不再每次启动都从宿主下载到 `%TEMP%`
  （离线白等 6 秒、临时文件落盘也是杀软敏感模式）。
- 心跳连续失败会提示「DSH 未连接」，约 100 秒后自行退出，不在桌上留一只永远静默的壳。
- 经目在子菜单展开时带 4 秒超时并缓存，宿主挂了也不会让右键菜单卡住。
- `next` 返回 `202 {running:true, card:null}`（宿主正在出卡）时提示「正在出卡」，
  不再当成成功但看不到变化。

**宿主（`index.js`）**

- `sessionQuery.observeSession()` 的 lease 用完即释放（此前每读一次提一个，会话缓存无法淘汰）。
- 插件卸载/停用时把宿主拉起的桌面壳一起收掉。

**发布与文档**

- `package.json` 补 `author` / `engines` / `publishConfig` / `prepublishOnly` / `dsh.manifestVersion`。
- LICENSE 恢复为标准 MIT（追加的中文说明移到 `NOTICE`，GitHub 不再识别成 NOASSERTION）。
- README / SKILL / preset 描述的语料口径统一为「六部 129 句」，标注阿弥陀经、四十二章经
  是原文草稿。
- 重新打包 tgz / zip，与仓库内容逐文件一致。
- 新增 `market/index.json`：格式 1 的插件市场索引（`git` 源，固定到提交），
  npm 上不了架时也能在 DSH 的「发现 → 添加索引源」里一键装。

## 2.0.1

- 联网取经按「第X章」切段：四十二章经 42 章对得上，不再把章标题切到上一段尾巴上。
- 取回的原文草稿不再塞占位释义，卡片显示「原文草稿 · 释义待补」。
- 桌面壳右键菜单补回「取经（贴链接）…」；经目里 404 的八大人觉经换成佛顶尊胜陀罗尼经。
- 语料清单补录四十二章经（此前装完只看到 5 部）。
- README 安装方式一改为从 Releases 下载安装包。

## 2.0.0

- 改名：`dsh-plugin-fojing-pet` → `dsh-plugin-lianjing`，产品名「莲鲸」。
- 旧状态文件自动迁移，「已积功德」不清零。
- 网页浮层与 Windows 桌面悬浮壳两套界面；尺寸三档（100% / 80% / 62%）。
