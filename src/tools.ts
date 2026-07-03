/**
 * Agent 工具集：把 ADB 操作 + 老人交互通道封装成 SDK MCP 工具。
 * 老人侧只有两个通道：speak_to_elder（说）与 confirm_with_elder（问一句、答系/唔系）。
 */
import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import readline from "node:readline";
import * as adb from "./adb.js";

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

async function askTerminal(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => rl.question(question, resolve));
  rl.close();
  return answer.trim();
}

const screenshotTool = tool(
  "screenshot",
  "截取手机当前屏幕（视觉确认用，优先用 ui_dump 定位元素）",
  {},
  async () => {
    const { base64, file } = await adb.screenshot();
    return {
      content: [
        { type: "image" as const, data: base64, mimeType: "image/png" },
        { type: "text" as const, text: `已截屏: ${file}` },
      ],
    };
  },
);

const uiDumpTool = tool(
  "ui_dump",
  "读取当前屏幕的可交互元素清单（含中心坐标），是定位点击目标的首选方式",
  {},
  async () => textResult(await adb.uiDump()),
);

const tapTool = tool(
  "tap",
  "点击屏幕坐标（坐标来自 ui_dump 的 @(x,y)）",
  { x: z.number(), y: z.number() },
  async ({ x, y }) => {
    await adb.tap(x, y);
    return textResult(`已点击 (${x},${y})`);
  },
);

const swipeTool = tool(
  "swipe",
  "滑动屏幕（如向下滚动列表）",
  {
    x1: z.number(),
    y1: z.number(),
    x2: z.number(),
    y2: z.number(),
    durationMs: z.number().optional().describe("默认300"),
  },
  async ({ x1, y1, x2, y2, durationMs }) => {
    await adb.swipe(x1, y1, x2, y2, durationMs ?? 300);
    return textResult("已滑动");
  },
);

const pressKeyTool = tool(
  "press_key",
  "按系统键",
  { key: z.enum(["home", "back", "enter", "delete"]) },
  async ({ key }) => {
    await adb.pressKey(key);
    return textResult(`已按 ${key}`);
  },
);

const typeTextTool = tool(
  "type_text",
  "向当前聚焦的输入框输入文本（支持中文）",
  { text: z.string() },
  async ({ text }) => textResult(await adb.typeText(text)),
);

const launchIntentTool = tool(
  "launch_intent",
  "用 Android Intent 直达（优先于 GUI 点击）。例：拨号 action=android.intent.action.CALL dataUri=tel:+16465550123；地图 action=android.intent.action.VIEW dataUri=geo:0,0?q=Chinatown+Manhattan",
  {
    action: z.string().optional(),
    dataUri: z.string().optional(),
    pkg: z.string().optional().describe("限定目标包名，如 com.google.android.apps.maps"),
  },
  async (opts) => textResult(await adb.launchIntent(opts)),
);

const speakTool = tool(
  "speak_to_elder",
  "用粤语对老人说话（原型中打印到终端；正式版走 TTS）。所有对老人的输出必须走这里",
  { cantonese_text: z.string().describe("地道粤语口语，短句") },
  async ({ cantonese_text }) => {
    console.log(`\n🔊 [对阿婆讲] ${cantonese_text}\n`);
    return textResult("已播报");
  },
);

const confirmTool = tool(
  "confirm_with_elder",
  "确认门：执行拨号/开始导航等动作前，必须用粤语复述一句并等老人答『系/唔系』。原型中由终端输入 y/n 模拟",
  { cantonese_question: z.string().describe("如：系咪打畀阿女呀？") },
  async ({ cantonese_question }) => {
    console.log(`\n🔊 [问阿婆] ${cantonese_question}`);
    const ans = await askTerminal("👵 阿婆答 (y=系 / n=唔系): ");
    return textResult(ans.toLowerCase().startsWith("y") ? "老人答：系" : "老人答：唔系");
  },
);

export const phoneServer = createSdkMcpServer({
  name: "phone",
  version: "0.1.0",
  tools: [
    screenshotTool,
    uiDumpTool,
    tapTool,
    swipeTool,
    pressKeyTool,
    typeTextTool,
    launchIntentTool,
    speakTool,
    confirmTool,
  ],
});
