# 手机助手GUI · Stage 0 原型实施计划

## Context（为什么做这件事）

**项目**：老人手机管家——方言语音 → 端侧理解 → 跨 App 代操作（`~/phone-gui-assistant`，目前只有 CLAUDE.md，无代码）。

**本次 scope 已在 brainstorm 中拍板**：两个功能——**方言自助打电话**、**方言自助打开地图导航**；老人侧路径压到最短（按一下 + 说一句 + 答一声；零打字、零阅读、零地图、零选择题）。

**决策链**：
- 目标赛事 Vibe-a-thon（7/15 提交截止）硬性要求 Google AI 栈 → 最终 runtime 必须是 Gemma 3n / Gemini；
- 用户拍板用 **Claude Agent SDK 作为底层**，定位为 **Stage 0 原型骨架**：在 Mac 上跑 agent loop，经 ADB 驱动安卓模拟器，最快验证「一句话 → 意图 → GUI 代操作」全链路；
- Stage 0 跑通后再做 Stage 1（换脑 Gemma、上真机 Accessibility），本计划**只覆盖 Stage 0**。

**Stage 0 要回答的问题**：两条任务流能否端到端无人工干预跑通？成功率多少？卡点在哪？——产出喂给 Stage 1 和投赛决策。

## 环境事实（2026-07-03 检查）

- ❌ 无 adb / emulator / Android Studio → 环境搭建是第一块真实工作量
- ❌ **用户无安卓真机（只有 iPhone）→ 模拟器是 Stage 0 唯一路径**；真机采购（二手 Pixel）推迟到 Stage 1 按需决定（进 Top 6 现场演示 / 赛后爸爸版才需要）
- ✅ Node v26；❌ Python 3.9（claude-agent-sdk Python 版需 3.10+）→ **选 TypeScript SDK**（`@anthropic-ai/claude-agent-sdk`）
- 网络：中国大陆——Android SDK/AVD 镜像下载慢（预留时间/用代理）；模拟器内 Google Maps 联网需给模拟器配代理；Claude API 走用户既有代理

## 交付物

1. 可运行的 agent 原型（TS + Claude Agent SDK + ADB 工具集）
2. 两条任务流在模拟器上端到端跑通的**录屏 + 运行日志**（每条跑 5 次）
3. `docs/stage0-findings.md`：成功率、失败模式、Stage 1 建议

## 架构

```
粤语文本输入(终端) → Claude(意图解析+任务规划+GUI决策)
                        │ 读: contacts.json / places.json / prefs.json（托管配置，写死）
                        ▼
              ADB 工具集(自定义 tools)
   screenshot / ui_dump / tap / set_text / swipe / launch_intent / key
                        ▼
              安卓模拟器(AVD + Play Store 镜像, Google Maps)
```

- **确认门**：拨号/导航前，agent 输出复述文本（模拟方言播报），终端输入「系」才执行——对应产品的确认环节
- **Intent 优先原则**：打电话用 `am start ACTION_CALL`（一步直达）；地图用 `geo:` URI 拉起后走 GUI 操作选公交路线
- Stage 0 明确不做：真 ASR/TTS（输入输出都是文本）、微信/WhatsApp（模拟器有账号风控，留真机阶段）、安卓端 Accessibility 实现、子女端 App

## 任务拆解

### T1 · 环境搭建（~0.5-1 天，下载受网络影响）
1. `brew install --cask android-studio`（或官网直装）；SDK Manager 装 platform-tools + emulator
2. 建 AVD：**arm64 + Play Store 镜像**（Pixel 7 profile，API 34+）——Play 镜像才自带 Google Maps
3. adb 加入 PATH；模拟器代理：`emulator -http-proxy` 指向 Mac 代理端口，验证 Maps 能加载海外城市地图
4. 装 **ADBKeyBoard.apk**（`adb shell input text` 不支持中文，中文输入走 ADB_INPUT_TEXT broadcast——这是已知坑，提前解）

### T2 · 项目骨架（~0.5 天）
1. `~/phone-gui-assistant` 初始化 git + npm 项目，装 `@anthropic-ai/claude-agent-sdk`
2. **动手前先加载 `claude-api` skill** 核对 SDK 当前用法（模型 id、custom tools 定义方式），不凭记忆写
3. 托管配置三件套：`config/contacts.json`（"阿女"→号码+微信备注名）、`config/places.json`（"菜市场"→地址）、`config/prefs.json`（出行偏好：少走路）

### T3 · ADB 工具层（~0.5 天）
`src/tools/adb.ts`：七个工具各自独立可测——
- `screenshot`（`exec-out screencap`→返回图给模型）、`ui_dump`（`uiautomator dump`→XML 节点树）
- `tap(x,y)`、`swipe`、`key(back/home/enter)`、`set_text`（ADBKeyBoard broadcast）、`launch_intent(uri/action)`
- 每个工具写完即对模拟器手动验证一次（如 tap 打开设置页）

### T4 · 流程 1：方言打电话（~0.5 天）
输入示例：「帮我打畀阿女」
1. Claude 解析意图 → 白名单匹配（不在 contacts.json 内→拒绝并提示，防诈边界）
2. 复述确认门 → `launch_intent(ACTION_CALL, tel:...)` → 截屏验证进入拨号界面（模拟器不真接通，界面态即验收）

### T5 · 流程 2：方言开地图（~1 天，风险最高）
输入示例：「我想去唐人街」（配合模拟定位到海外城市，或起点手输）
1. 意图 → places.json 解析目的地 → `geo:` URI 拉起 Google Maps
2. GUI 循环：screenshot+ui_dump → Claude 决策下一步 → tap（路线→公交 tab→按 prefs 选方案→开始）
3. 从 ui_dump 抓导航指引文本 → Claude 转译成**地标式粤语口头指令**输出（文本形式，代表 Stage 1 的 TTS 播报）

### T6 · 评估与结论（~0.5 天）
1. 每条流程连跑 5 次（`adb screenrecord` 留证），记录：成功率、平均步数、失败模式分类
2. 写 `docs/stage0-findings.md`：结论 + Stage 1 spike 清单更新（Gemma GUI grounding / 粤语 ASR·TTS / 低配机内存 / WebView a11y / 户外噪音）

## 验收标准（verification）

- **流程 1**：从一句粤语文本输入到拨号界面出现，全程无人工干预（确认门的「系」除外），5 次 ≥4 成
- **流程 2**：从一句输入到 Google Maps 进入公交导航态 + 输出粤语指引文本，5 次 ≥3 成（GUI 长流程允许更低，如实记录）
- 所有成功/失败都有录屏与日志可查，findings 文档如实报数——**不粉饰**

## 风险与预案

| 风险 | 预案 |
|---|---|
| AVD/SDK 下载慢（大陆） | 代理 + 预留时间；T1 与 T2 可并行 |
| 模拟器内 Maps 不联网 | `-http-proxy` 参数；不行则 Wi-Fi 代理法 |
| `input text` 中文乱码 | ADBKeyBoard（T1 预装） |
| Maps 界面 A/B 版式差异导致 GUI 步骤不稳 | ui_dump 节点语义定位为主、坐标为辅；prompt 里给容错指引 |
| Claude API 网络抖动 | 用户日常代理已稳定；重试即可 |

## 不在本计划（Stage 1 预告）

换脑 Gemma 3n（AI Edge/LiteRT）+ 安卓端 Accessibility Service + 真机（需带 GMS 设备）+ 粤语 ASR/TTS + 比赛叙事物料（小红书作品）。Stage 0 结论出来后另立计划。
