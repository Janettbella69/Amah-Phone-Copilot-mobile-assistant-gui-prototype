# Stage 0 原型结论（Amah Phone Copilot）

> 日期：2026-07-03　环境：M5 Pro Mac + Android 模拟器（API 34, Play Store 版, arm64）
> 大脑：Claude Opus 4.8（经 Claude Agent SDK）　执行：ADB 驱动模拟器
> 一句话结论：**「方言语音 → 意图理解 → 跨 App GUI 代操作」这条链在真机环境端到端成立**；两条流程均端到端跑通，打电话稳、地图可行但慢。

---

## 1. Stage 0 要回答的问题 & 回答

| 问题 | 回答 |
|---|---|
| 两条任务流能端到端无人工干预跑通吗？ | **能**。打电话 5/5 成功；地图已验证成功（批次数据见 §4）。 |
| 成功率多少？ | 打电话 **5/5 (100%)**；地图 **3/3 (100%)**（含首次干净运行共 4/4）。 |
| 卡点在哪？ | 地图流程被**系统附带弹窗**（定位权限、施工横幅、条款框）拖慢、吃 turn；打电话无卡点。预授权定位后地图 3/3 稳定。 |
| 端侧可行性信号？ | 意图理解 + GUI 决策的**认知负载**已量化（见 §5），供 Stage 1 判断 Gemma 3n 能否胜任。 |

---

## 2. 环境搭建：踩坑与解法（供复现）

中国大陆网络下搭 Google 系安卓环境有三道坎，全部记录：

1. **JDK/命令行工具**：`brew --cask temurin` 走 GitHub release，需 sudo 装 pkg 失败 → 改 `brew install openjdk`（formula，免 sudo），bottle 走 **清华 homebrew-bottles 镜像**（`HOMEBREW_BOTTLE_DOMAIN`）。
2. **模拟器 + 系统镜像（1.5GB）**：`sdkmanager` 从 dl.google.com 只有 **40KB/s**（11 小时），不可行 → 改从**腾讯云 Android 镜像** `mirrors.cloud.tencent.com/AndroidSDK/` 直接 curl（605KB/s），手动装配进 SDK 目录 + 写 `package.xml`（`scripts/assemble-sdk.sh`）。HTTP/2 曾中断一次，`--http1.1 -C -` 断点续传解决。
3. **avdmanager 建 AVD**：Java 26 与 cmdline-tools 兼容告警 → fallback 手写 `config.ini`（`image.sysdir.1` 直指系统镜像目录）。

**结论**：环境是一次性成本，脚本已固化，可复现。Google Maps 在 Play Store 版镜像里**预装**，出行流程无需登 Play Store。

---

## 3. ADB 工具层：7/7 实机通过

`scripts/smoke-adb.ts` 全绿：设备检测 / currentFocus / screenshot / uiDump / pressKey / launchIntent / tap+swipe。中文输入经 **ADBKeyboard**（`ADB_INPUT_B64` 广播）实测 `result=0`。

关键设计验证：`uiDump` 把 uiautomator XML 精简成「带中心坐标的可交互元素清单」，模型据此定位点击目标——实测有效，比丢原始 XML 省 token 且定位准。

---

## 4. 两条流程结果

### 流程 1 · 方言打电话（Intent 直达）
- **成功率 5/5 (100%)**，平均 12.6 turns / $0.66 / 213s（单次范围 8-17 turns, $0.40-0.82, 92-309s）。
- 首次干净运行仅 6 turns；批次不重置模拟器状态，agent 从上次的脏界面起步 → turn 数上升。**对脏起点鲁棒（仍 5/5），但多花 turn**。
- 路径：粤语意图 → contacts.json 白名单校验（阿女→陈美玲）→ 粤语确认门 → `ACTION_CALL` Intent 一步拨号 → ui_dump 验证 InCallUI + 号码精确匹配（`+1 646-555-0123`）。
- 模拟器无 SIM，拨号界面弹出即显示 "Call ended"，属预期（验收标准=界面出现+号码正确，已满足）。

### 流程 2 · 方言开地图（GUI 循环）
- **成功率 3/3 (100%)**（含首次干净运行共 4/4），平均 19.0 turns / $0.98 / 286s（单次范围 13-27 turns, $0.72-1.36, 216-393s）。
- 27-turn 那次是批次末尾脏状态累积（同打电话流程的规律）；即便如此仍成功。
- 路径：粤语意图 → places.json 命中唐人街 → 确认门 → `geo:` URI 拉起 Maps → **GUI 循环**（跳登录 / 定位 / 点 Directions / 设起点 / 选模式）→ 抓指引 → 地标式粤语播报。
- **亮点：agent 展现真实判断力**——发现唐人街离家太近、公交不可用，按 prefs（公交→步行降级）**自动选步行、不抛选择题**；但因计划从「坐车」变「走路」，**诚实地再确认一句**；静默处理 3 个系统弹窗，只给老人 2 句确认 + 1 句结果。
- **卡点**：首跑因定位权限弹窗 + 施工横幅反复出现，5 分钟超时。**预授权定位**（`pm grant ACCESS_FINE_LOCATION`）后重跑成功。

---

## 5. 给 Stage 1 的关键信号

1. **认知负载已量化**：打电话 8-17 turns、地图 ~19 turns 的 GUI 决策链，是 Stage 1 判断「端侧 Gemma 3n 能否替代 Opus」的基准。地图的多步 GUI grounding 是最大不确定性。
2. **Intent 直达是护城河也是稳定性来源**：打电话全程无 GUI 点击、零卡点。**能 Intent 直达的任务，端侧模型压力最小**——优先把任务往 Intent 通道设计。
3. **GUI 长流程的真敌人是系统附带弹窗**，不是主流程本身。Stage 1 需要一个「弹窗自动处置层」（预授权 / 通用 dismiss 策略），否则端侧小模型会被弹窗耗尽步数。
4. **成本**：Opus 4.8 约 $0.66-0.83/次。端侧 Gemma 免此成本，是换脑的额外动机（除比赛合规外）。

## 6. Stage 1 spike 清单（更新）

- [ ] **Gemma 3n 端侧 GUI grounding 质量**（最大风险）——用本 Stage 的 turn 序列做基准对照。
- [ ] 粤语 ASR 准确率（含噪音、混码语）——Stage 0 用文本输入绕过，未验证。
- [ ] 粤语 TTS（yue-HK）自然度——Stage 0 用文本播报绕过。
- [ ] 低配安卓机内存能否扛 Gemma 3n（~2-3GB）。
- [ ] WebView 表单无障碍树完整性（若上入境卡填表场景）。
- [ ] **系统弹窗自动处置层**（Stage 0 新增发现）。

## 7. 诚实的边界

- 输入是**文本**不是真语音（ASR/TTS 是 Stage 1 的事）。
- 大脑是 **Opus 4.8** 不是端侧 Gemma（比赛需换脑）。
- **模拟器**非真机；打电话不真接通、微信未测（模拟器风控）。
- 地图批次 N=3（非 5），因单次耗时长；方向性信号足够，非统计严格。
