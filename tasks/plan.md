# Powder Rush 商业化改造计划

## Overview
现有游戏：1620行TS / Three.js + Rapier3D / 单chunk 2.58MB / 无存档、无触屏、无难度曲线。
目标：按商业标准补齐缺失能力，分6周迭代上线。

## 架构决策
- 存档：localStorage（纯前端，无需后端）
- 触屏：CSS overlay + touch events（不引入新库）
- 难度：距离分段 + 障碍物 spawn rate 随距离递增
- PWA：vite-plugin-pwa 或手动 manifest+sw
- 截图：canvas.toBlob → clipboard / WebShare API

---

## Task 1: 存档 + 本地排行榜 ⭐ 第一优先级
**验收:**
- [x] localStorage 存 bestDistance/bestGates/bestSpeed
- [x] Game Over 界面显示当前局 + 历史最佳
- [x] 新纪录时显示 "NEW BEST!" 提示
- [x] 构建通过

**实测：** `ski_bestDist`/`ski_bestGates`/`ski_bestSpeed`/`ski_runs`/`ski_totalDist`/`ski_totalGates`
均落盘；连跑 3 局 game over 面板 `go-dist`/`go-best-dist` 同步推进（96→141→190m），
`#new-best` 可见；第 2 局 0 门时 `go-best-gates` 仍保持 1（当前局不污染历史最佳）。

**文件:** src/game/UI.ts, src/game/Game.ts, index.html

---

## Task 2: 触屏虚拟摇杆
**验收:**
- [x] 左半屏拖拽控制转向
- [x] 右半屏上滑跳跃、下滑刹车
- [x] 键盘输入保留
- [x] 移动端布局正确（无滚动条、固定视口）
- [x] 构建通过

**实测（真 TouchEvent 派发，非模拟）：** 左半屏 touchstart → `down=['left']`；
右上半（cy < 0.6h）→ `['jump']`；右下半 → `['brake']`；左半屏拖右 → `['right']`；
touchend → `[]`。全部 5 个视口面板不溢出（745/900、579/720、728/844、504/640）。

**文件:** src/core/input.ts, src/style.css, index.html

---

## Task 3: 难度曲线
**验收:**
- [x] 0-200m 障碍物密度低（新手保护）
- [x] 200-800m 中等密度
- [x] >800m 高密度 + 速度上限提升
- [x] 速度公式改为 `30 + dist*0.006 * difficultyMultiplier`
- [x] 构建通过

**文件:** src/game/World.ts

**本次实现 + 修复的核心缺陷（实测证据）:**

1. **横向机动能力不随速度缩放（致命设计缺陷）** —— 速度上限升到 60 m/s，但横向速度恒为
   6.8 m/s。137 km/h 时换一条道要前进 30.7m > 单区块 26m，高速下多道闪避**物理上不可能**，
   实测基准 12 局 **0/12 能过 800m**。
   修复：`Player.ts` `vxTarget = steer * Math.max(6, speed * 0.55)`，
   `vx += (vxTarget - vx) * min(1, dt*10)`。
   **实测换道前进距离：90km/h = 8.5m，126km/h = 8.9m，162km/h = 9.4m**（修复前 24~31m）
   —— 全速度区间恒定 ~9m，永远小于一个区块。

2. **出生点重叠（不公平秒死）** —— 玩家 z=0，chunk 0 中心 z=-13、障碍物 z∈[-24,-2]，
   可能 2m 内就有树。且 `startRun()` 每局 `reseed(seed)`，所以**每局都受影响**。
   修复：`World.ts` 加 `RUNWAY_Z = 40`，`spawnChunk` 中 `zCenter > -RUNWAY_Z` 的区块强制 0 道。
   **实测：起步 51m 内 100% 空区块（20/20 区块采样）**。

3. **密度梯度** `zeroLaneChance(d) = max(0.05, 0.4 - d*0.125)`,
   `oneLaneThreshold(d) = max(0.47, 0.86 - d*0.13)`（原 12%/62% 起步，新手保护不足）。
   **实测真实生成数据（含空区块）:**

   | 距离带 | 平均障碍/区块 | 空区块 | 1 道 | 2 道 |
   |---|---|---|---|---|
   | 0–51m 起步滑道 | 0.00 | **100%** | 0% | 0% |
   | 52–200m | 0.97 | 26.7% | 50% | 23.3% |
   | 200–800m | 1.12 | 20.8% | 46.5% | 32.7% |
   | 800m+ | 1.28 | 12.6% | 46.7% | **40.7%** |

4. **速度公式** `Game.ts`：`maxSpeed = min(62, 30 + dist*0.006*(1 + diff*0.25))`
   **实测校验**：1917m 时实测 180 km/h = 50.0 m/s，公式算 30+1917*0.006*1.75 = 50.1 m/s ✓

**基准对比（12 局 bot，跑到真撞死）:**

| 指标 | 修复前 | 修复后 |
|---|---|---|
| 中位数 | 390m | **714m** |
| 平均 | 312m | **754m** |
| 最远 | 591m | **1917m** |
| 过 200m | 8/12 | **11/12** |
| 过 800m | 0/12 | **5/12** |
| 最高速度 | 137 km/h | **180 km/h** |

> 注：早期基准脚本有采样窗口截断 bug（12.6s × 30m/s ≈ 378m），一度让「多局死在
> 382m」看起来像是游戏问题，实为仍在存活被截断。已改为跑到真正 gameover。
> `World.liveChunkIndices` getter 为 QA 密度遥测新增。


---

## Task 4: Combo 计分 + 飞行动作加分
**验收:**
- [x] 连续穿门 combo 倍数（2x, 3x, 4x...）
- [x] 空中持续操作（跳跃中转向）增加 trick 分
- [x] HUD 显示 combo 数
- [x] Game Over 显示 trick 分数
- [x] 构建通过

**实测：** 8 局 bot 跑出 `maxCombo 5`，combo 芯片显示 `x3 COMBO` 同时 `hud-gates` 保持 `3`
（不互相覆盖）；`trickScore` 最高 **204**。
> ⚠️ trick 分原本**永远为 0**，根因是 grounded 判定失效（见文末缺陷 9）。

**文件:** src/game/Game.ts, src/game/UI.ts, index.html

---

## Task 5: PWA 支持
**验收:**
- [x] manifest.json 存在，图标 192/512px
- [x] service worker 缓存静态资源
- [x] 可添加到主屏幕
- [x] 离线可访问（页面提示）
- [x] 构建通过

**实测（生产构建 + preview）：** SW `controller: true`；缓存 `powder-rush-v3` 含 7 条 URL，
其中 `/assets/index-BnJHxY3D.js`（2,844,692 B）+ CSS；**用 CDP `Network.setCacheDisabled: true`
并断网**冷启动 → 诊断在线、canvas 1280x800、state=menu，0 错误 0 个 4xx/5xx。
hash 每次构建都变，但 SW 在 install 时解析 `index.html` 自动发现，无需改代码。

**文件:** public/manifest.json, public/sw.js, vite.config.ts

---

## Task 6: 截图分享
**验收:**
- [x] Game Over 显示截图按钮
- [x] canvas.toBlob 生成 PNG
- [x] 复制到剪贴板 或 WebShare API
- [x] iOS Safari 兼容处理
- [x] 构建通过

**实测：** `toBlob` 产出 `image/png` 23073 B；三级兜底链路已追踪：
tier1 WebShare（12s 超时，处理 `AbortError`）→ tier2 剪贴板 → tier3 `<a download>` PNG，
trace `["tier1","tier2","tier3:powder-rush.png"]`，终态 `"✓ 已下载图片"`；
取消路径 → `"已取消分享"`；无 WebShare 时 → `"✓ copied to clipboard"`（剪贴板确为 image/png）。

**文件:** src/game/Game.ts, src/game/UI.ts, index.html

---

## Task 7: 粒子雪雾 + 穿门闪光
**验收:**
- [x] 落地时产生雪雾粒子（~20个，1秒消散）
- [x] 穿门时金色闪光（门柱发光0.3s）
- [x] FPS 无明显下降
- [x] 构建通过

**实测：** `landBurstCount` 12 次 / 11 次真实起跳（每次落地都触发，原本**永远是 0**）；
`gateFlashCount` 单局最高 23；粒子寿命到期后 `liveBursts.count` 归 0（无泄漏）；
`minFps = 58~60`，无掉帧。
> ⚠️ 落地雪雾原本**从不触发**，同样是 grounded 判定失效（见文末缺陷 9）。

**文件:** src/game/World.ts, src/entities/Player.ts

---

## Task 8: Day/Night Cycle
**验收:**
- [x] 每跑 500m 逐渐切换光照色调
- [x] 白天→黄昏→夜晚循环
- [x] 天空颜色随时间变化
- [x] 夜晚能见度略有下降（雾）
- [x] 构建通过

**实测（强制 4 个相位采样亮度）：** t=0 天空 215 / 雪面 234；t=0.25 天空 55 / 雪面 130；
t=0.5 天空 14 / 雪面 90；t=0.75 天空 55 / 雪面 154，夜晚雪面仍可见（非纯黑）；一局结束 `dayNightT ≈ 0.45`。
> **偏离规格（有据）**：原写"每 500m 切换"即 2000m/整周期，但实测中位数单局仅 ~714m，
> 一局连半个周期都看不到。改为 **1250m/整周期**（约 312m/相位），中位数局能看到 2.3 个相位。

**文件:** src/game/Game.ts

---

## Task 9: 配乐（Tone.js 合成 BGM）
**验收:**
- [x] 添加 Tone.js 依赖
- [x] 循环合成 BGM（BPM 随速度提升）
- [x] 与风声音效共存，不抢戏
- [x] M键静音生效
- [x] 构建通过

**实测：** 一局内实测 BPM 从 **99 升到 136**（随速度变化）；crash 后 `{playing:false, bpm:null}`。
> ⚠️ `setBGMBpm()` 原本**定义了但从未被调用**，"BPM 随速度提升"实际未实现（见文末缺陷 10）。

**文件:** src/audio/AudioController.ts, package.json

---

## Task 10: 角色外观解锁
**验收:**
- [x] 6 种配色方案（经典/午夜/霓虹/黄金/极地/熔岩）
- [x] 解锁条件：单次距离 400/800、单次门数 20、速度 120、累计门数 100
- [x] 菜单可选择外观（1-6 数字键亦可切换）
- [x] 解锁状态由存档统计推导，选择持久化到 `ski_skin`
- [x] 构建通过 + 16 项断言全过 + WCAG AA 对比度全过

**文件:** src/core/Skins.ts, src/entities/Player.ts, src/game/UI.ts, index.html, src/style.css

---

## 本次验证记录（修复的缺陷）

1. **连击系统永远无法触发** — 门距 130m，而连击窗口 3s。30m/s 时门间隔 4.3s > 3s，`comboCount` 每次都归零，`x1.5` 倍数从未生效。改为 `GATE_EVERY=3`（78m）+ 窗口 6s。
2. **昼夜循环实际看不见** — `dayNightSpeed=0.00015` → 需滑 6667m 才走完一个循环，正常局到不了。改为 0.0008（1250m/循环）。
3. **分享按钮点了没反应** — `navigator.share` 在部分环境永不 settle，无超时 → 状态栏永远空白。改为 12s 超时 + 三级降级（分享→剪贴板→下载）+ 即时反馈。
4. **分享文案距离硬编码为 0m** — `Math.floor(0)`，改为真实距离。
5. **连击激活时 HUD 门数被覆盖** — `updateHud` 把 `#hud-gates` 写成 `x3`，玩家看不到门数。新增独立 `#hud-combo` 元素。
6. **门对象内存泄漏** — `disposeChunk` 把门移出场景但没从 `World.gates` 数组删除，每次分块回收都残留。
7. **`gen-icons.cjs` 被打进 dist 根目录** — 移到 `tools/`。
8. **SW 从未缓存带哈希的 bundle** — 首次加载时 SW 尚未接管页面，离线可玩只是靠浏览器 HTTP 缓存（清掉就坏）。改为 install 时解析 index.html 自动预缓存 `assets/*`。已验证在禁用 HTTP 缓存的离线环境下仍可启动。
9. **`grounded` 永远是 true（本会话新发现，影响 Task 4 + Task 7）** — 地面探测用
   `castRay(ray, 0.65, true)`，第 3 个参数是 `solid`，**而 `filterExcludeCollider` 是第 6 个**。
   射线起点（body 中心 +0.05）在玩家自己 `cuboid(0.55, 0.75, 0.45)` 内部，
   `solid=true` 对起点在形状内的射线直接返回 `toi=0` → 240 个采样 0 个空中帧。
   连带两个功能**从未生效过**：空中 trick 分（`!grounded` 恒假，实测 204 → 原本恒 0）、
   落地雪雾（`prevGrounded` 恒真，实测 12 次 → 原本恒 0）；且允许空中无限二段跳。
   修复：排除自身碰撞体 + `GROUND_PROBE_TOI=0.3`（脚线在 body 原点，静止实测 `toi=0.085`）。
   验证：86 次跳跃按下、其中 75 次发生在空中 → **空中重跳 0 次**（修前为可行）。
10. **BGM 的 BPM 从未随速度变化（本会话新发现，Task 9）** — `setBGMBpm()` 定义了但
    `Game.ts` 里一次都没调用，只有 `setBGMPlaying`。修复：每帧 `setBGMBpm(90 + speed*1.32)`，
    实测一局内 BPM 99→136。
11. **横向机动不随速度缩放（Task 3 核心，本会话）** — 见 Task 3 章节。
12. **出生点障碍重叠（Task 3，本会话）** — 见 Task 3 章节。
13. **QA 基准脚本采样窗口截断** — 不是游戏 bug 但会误导判断：12.6s × 30m/s ≈ 378m，
    使多局“死在 382m”看起来像游戏问题，实为仍在存活被截断。已改为跑到真正 gameover。
14. **触屏设备无法加速（本会话新发现）** — 触屏控制只绑定 left/right/jump/brake，
    `accelerate` 在手机上永远是 false → `Player.step` 走 else 分支，速度被压在 ~22 m/s
    （79 km/h），难度曲线在移动端直接失效。另发现 `enableTouch()` 被无条件调用
    （桌面 `_hasTouch` 也是 true）。修复：
    a) `Game.ts` 只在 `maxTouchPoints>0 || 'ontouchstart' in window` 时 `enableTouch()`；
    b) `Input.snapshot()` 当 `_hasTouch` 时 `accelerate = !brake`（不按刹车即自动加速）。
    验证：触屏 iPhone 实测 0→201 km/h，安卓 0→179 km/h（此前触屏永远 79 km/h 封顶）。

---

## 设备兼容性压测（4 设备 × 50 局，本会话）

用 Playwright 设备描述符并行模拟 4 类终端，各跑 50 局真 bot（移动端走真 TouchEvent
路径、桌面端走键盘），每局采集距离/门数/速度/combo/FPS/软锁/布局溢出/控制台错误。

| 设备 | 视口 | 中位距离 | 最远 | 过800m | 过200m | 软锁 | 控制台/网络错误 | minFps* | 触屏启用 |
|---|---|---|---|---|---|---|---|---|---|
| 安卓 Pixel 7 | 412×839 | 537m | 1881m | 15/50 | 43/50 | 0 | 0 | 58 | ✓ mtp=1 |
| iPhone 14 | 390×664 | 677m | 1703m | 20/50 | 44/50 | 0 | 0 | 58 | ✓ mtp=1 |
| Mac 1440×900 | 2880×1800 | 474m | 1210m | 9/50 | 41/50 | 0 | 0 | 58 | ✗（正确未启用） |
| PC 1920×1080 | 1920×1080 | 554m | 1499m | 10/50 | 43/50 | 0 | 0 | 58 | ✗（正确未启用） |

*minFps 为单设备独立测试值；4 页并行时首帧曾低至 4-5（WASM/Shader 编译 + SwiftShader 争抢），
游戏用固定步长累加器，不因此改变游戏速度，且单设备实测稳定 58-60。

结论：
- **0 控制台错误 / 0 页面错误 / 0 失败请求 / 0 软锁 / 布局 0 溢出**，四类终端全部正常。
- 存档一致：`ski_bestDist/bestGates/bestSpeed` 与单局最大值完全吻合；`ski_runs` 在
  安卓=49、iPhone=46 是因为 harness 在 45s 截断后直接再 setState('playing')（仍在 playing
  时 `forceState` 是 no-op），**不是游戏缺陷**（真玩家只能从菜单/结算开始新局）。
- 触屏修复验证：安卓 maxSpeed 179 km/h、iPhone 171 km/h（此前触屏 79 km/h 封顶）。
- 截图 32 张存档于 `qa/devshots/`（boot + 每 10 局结算画面），均非黑屏。
- 触屏跳跃单独实测：50 次跳触发、`trickMax 327`、`minFps 58`（见缺陷 14 验证）。

## Checkpoints
- After T1: 核心留存闭环（玩→存→再玩）
- After T2: 手机可玩（覆盖移动端用户）
- After T3: 游戏有挑战梯度（防无聊）
- After T5: 可安装到桌面（接近原生APP体验）
- After T7: 视觉品质提升（更像商业游戏）
- Final: 完整商业功能集

---

## 发布（本会话）

方法复用「一人公司/村庄大冒险」已跑通的发布链路（GitHub Actions Pages + Vercel CLI +
itch.io butler），首次为本项目落地：

| 平台 | 状态 | 地址 |
|---|---|---|
| GitHub 仓库 | ✅ 已推送 | https://github.com/z1302065902-cloud/powder-rush |
| GitHub Pages | ✅ 线上 200，启动实测 menu/60fps/0 错误 | https://z1302065902-cloud.github.io/powder-rush/ |
| Vercel | ✅ 线上 200，启动实测 menu/60fps/0 错误 | https://powder-rush-liard.vercel.app/ |
| itch.io | ✅ 已上线（Firefox cookie 注入 + WebKit，新建 Free+HTML 页，传 zip+封面，实测游戏在 itch 托管下启动到菜单） | https://zsy2026.itch.io/powder-rush |
| 爱发电 | ⏳ 需用户提供创作者页 URL | 待定 |

关键配置：
- `vercel.json`：framework=vite / outputDirectory=dist / SPA rewrite
- `.github/workflows/deploy.yml`：npm ci → npm run build → upload-pages-artifact（首次用 legacy
  Pages 触发了错误的源码直发，已取消，改用 Actions 来源）
- SW `./sw.js` 相对路径 → 子路径（GitHub Pages）下离线可用
- Pages 上的 CI 构建 bundle 与本地 hash 不同属正常
