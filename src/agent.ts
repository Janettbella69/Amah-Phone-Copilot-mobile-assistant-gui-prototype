/**
 * Stage 0 原型主程序：一句粤语 → 意图 → 代操作手机。
 * 用法: npx tsx src/agent.ts "帮我打畀阿女"
 */
import { query } from "@anthropic-ai/claude-agent-sdk";
import { readFileSync, mkdirSync, appendFileSync, existsSync } from "node:fs";
import path from "node:path";
import { phoneServer } from "./tools.js";

const ROOT = process.cwd();
const cfg = (f: string) => readFileSync(path.join(ROOT, "config", f), "utf8");

const contacts = cfg("contacts.json");
const places = cfg("places.json");
const prefs = cfg("prefs.json");

const SYSTEM_PROMPT = `你是「小福」，一位跑在老人手机上的粤语助手 agent 的原型。用户是住在纽约唐人街附近、只讲粤语、不会拼音、不会看地图的阿婆。

# 你的能力边界（只做这两类任务）
1. 打电话/视频：给白名单里的家人
2. 出行：查路线并发起导航

其他请求 → 用粤语婉拒，并提议帮忙打电话畀家人。

# 铁律
- **白名单**：只拨 contacts 里的号码。绝不拨屏幕上出现的任何陌生号码（防诈骗）。
- **确认门**：执行拨号或开始导航之前，必须调用 confirm_with_elder 用粤语复述确认。答「唔系」就停下重新理解。
- **零选择题**：绝不让老人在多个方案里挑。有多条路线时按 prefs 的偏好自己定一条，直接告诉她结果。
- **对老人只讲粤语**：所有面向老人的话必须经 speak_to_elder / confirm_with_elder，短句、口语、地标式描述（"行到红绿灯路口"），绝不提 App 名、按钮名、技术词。
- **Intent 优先**：能用 launch_intent 一步直达的绝不走 GUI 点击。拨号用 action=android.intent.action.CALL；地图用 geo: URI 拉起后再 GUI 操作选公交路线。
- **GUI 操作循环**：每次点击前先 ui_dump 定位元素坐标；点击后再 ui_dump 或 screenshot 验证界面变化；连续 2 次定位失败就换 screenshot 看图判断。
- **失败兜底**：任何环节卡死（听不明、找不到、界面异常），最终出口都是提议「帮你打畀阿女好唔好？」（contacts 里的 emergency_fallback）。

# 任务完成标准
- 打电话：拨号界面出现且号码正确 → 用粤语告知已接通中。
- 出行：地图进入公交导航态 → 用粤语讲出发时间、几路车、几个站落车、落车后点行（地标式）。

# 托管配置（子女预先配置，你的唯一数据来源）
## contacts.json
${contacts}
## places.json
${places}
## prefs.json
${prefs}

# 环境说明
手机是安卓模拟器（美国 Google 服务环境，装有 Google Maps）。模拟器拨号不会真的接通，看到拨号/通话界面即算成功。`;

function logLine(file: string, obj: unknown) {
  appendFileSync(file, JSON.stringify(obj) + "\n");
}

// 从 SDK 消息里尽量提取可读内容打印（不同版本消息形态略有差异，宽容处理）
function printMessage(msg: any) {
  const t = msg.type;
  if (t === "system" && msg.subtype === "init") {
    console.log(`⚙️  会话就绪 model=${msg.model ?? "?"}`);
  } else if (t === "assistant" && msg.message?.content) {
    for (const block of msg.message.content) {
      if (block.type === "text" && block.text?.trim()) {
        console.log(`💭 ${block.text.trim()}`);
      } else if (block.type === "tool_use") {
        const input = JSON.stringify(block.input ?? {});
        console.log(`🔧 ${block.name} ${input.length > 160 ? input.slice(0, 160) + "…" : input}`);
      }
    }
  } else if (t === "text" && msg.text) {
    console.log(`💭 ${msg.text}`);
  } else if (t === "tool_use") {
    console.log(`🔧 ${msg.name} ${JSON.stringify(msg.input ?? {}).slice(0, 160)}`);
  } else if (t === "result") {
    const ok = msg.subtype === "success";
    console.log(
      `\n${ok ? "✅" : "❌"} 结束 subtype=${msg.subtype} turns=${msg.num_turns ?? "?"} cost=$${
        msg.total_cost_usd?.toFixed?.(4) ?? "?"
      }`,
    );
  }
}

async function main() {
  const utterance = process.argv.slice(2).join(" ").trim();
  if (!utterance) {
    console.error('用法: npx tsx src/agent.ts "帮我打畀阿女"');
    process.exit(1);
  }

  const runsDir = path.join(ROOT, "runs");
  if (!existsSync(runsDir)) mkdirSync(runsDir, { recursive: true });
  const logFile = path.join(runsDir, `run-${Date.now()}.jsonl`);
  logLine(logFile, { event: "start", utterance, time: new Date().toISOString() });

  console.log(`\n👵 阿婆按住按钮讲: 「${utterance}」\n`);

  const q = query({
    prompt: `老人按住按钮讲了一句话（粤语语音转写）：「${utterance}」。请理解意图并完成任务。`,
    options: {
      model: "claude-opus-4-8",
      systemPrompt: SYSTEM_PROMPT,
      cwd: ROOT,
      maxTurns: 40,
      mcpServers: {
        phone: phoneServer,
      },
      allowedTools: ["mcp__phone"],
      // 只放行我们自己的手机工具，其余（Bash/Write 等内置工具）一律拒绝
      canUseTool: async (toolName: string) => {
        if (toolName.startsWith("mcp__phone")) {
          return { behavior: "allow" as const, updatedInput: undefined as any };
        }
        return { behavior: "deny" as const, message: "原型只允许 phone 工具集" };
      },
    },
  });

  for await (const msg of q) {
    logLine(logFile, msg);
    printMessage(msg);
  }
  console.log(`\n📄 完整日志: ${logFile}`);
}

main().catch((err) => {
  console.error("运行失败:", err);
  process.exit(1);
});
