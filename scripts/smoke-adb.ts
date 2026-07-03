/**
 * ADB 工具冒烟测试：逐项验证 src/adb.ts 的原语在「已连接的模拟器/真机」上是否可用。
 *
 * 用法（需先连上安卓模拟器或 USB 真机并授权调试）：
 *   npx tsx scripts/smoke-adb.ts
 *   ANDROID_SERIAL=emulator-5554 npx tsx scripts/smoke-adb.ts   # 多设备时指定其一
 *   ADB_PATH=/path/to/adb npx tsx scripts/smoke-adb.ts          # 覆盖 adb 路径
 *
 * 行为：逐项打印 ✅/❌；无设备连接则清晰报错并以退出码 1 退出；
 *      全部通过退出码 0，任一失败退出码 1。
 *
 * 注意：本脚本会真实操作设备（拉起设置/浏览器、回桌面、点屏幕中心、上滑），
 *      仅用于开发自测，勿在设备有重要前台任务时运行。
 */
import * as adb from "../src/adb.js";
import { existsSync, statSync } from "node:fs";

interface StepResult {
  name: string;
  ok: boolean;
  note: string;
}

const results: StepResult[] = [];

function record(name: string, ok: boolean, note = ""): void {
  results.push({ name, ok, note });
  console.log(`${ok ? "✅" : "❌"} ${name}${note ? ` — ${note}` : ""}`);
}

/** 跑一个断言步骤：fn 返回字符串作为成功备注；抛错即判失败（错误消息作备注） */
async function step(name: string, fn: () => Promise<string | void>): Promise<void> {
  try {
    const note = await fn();
    record(name, true, typeof note === "string" ? note : "");
  } catch (e) {
    record(name, false, (e as Error).message);
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** 解析 `adb devices`，返回处于 "device"（在线可用）状态的序列号列表 */
async function onlineDevices(): Promise<string[]> {
  const out = await adb.adb(["devices"]);
  return out
    .split("\n")
    .slice(1) // 跳过表头 "List of devices attached"
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.split(/\s+/))
    .filter((parts) => parts[1] === "device") // 排除 offline / unauthorized
    .map((parts) => parts[0]);
}

/** 屏幕尺寸（wm size），解析失败给个保守默认 */
async function screenSize(): Promise<{ w: number; h: number }> {
  try {
    const out = await adb.adb(["shell", "wm", "size"]);
    // 形如 "Physical size: 1080x2400"（可能还有 Override size 行，取最后一个）
    const matches = [...out.matchAll(/(\d+)x(\d+)/g)];
    const last = matches[matches.length - 1];
    if (last) return { w: +last[1], h: +last[2] };
  } catch {
    /* 用默认值兜底 */
  }
  return { w: 1080, h: 1920 };
}

async function main(): Promise<void> {
  console.log("=== ADB 工具冒烟测试 ===");
  if (process.env.ANDROID_SERIAL) console.log(`ANDROID_SERIAL=${process.env.ANDROID_SERIAL}`);
  console.log("");

  // --- 1. 设备在线检测（无设备 → 退出码 1）---
  let devices: string[];
  try {
    devices = await onlineDevices();
  } catch (e) {
    console.error(`❌ 无法执行 adb devices：${(e as Error).message}`);
    console.error("   请确认已安装 platform-tools，或用 ADB_PATH 指定 adb 路径。");
    process.exit(1);
  }

  const serial = process.env.ANDROID_SERIAL;
  if (serial && !devices.includes(serial)) {
    console.error(
      `❌ 无设备连接：ANDROID_SERIAL=${serial} 不在在线设备列表 [${devices.join(", ") || "空"}] 中。`,
    );
    process.exit(1);
  }
  if (!serial && devices.length === 0) {
    console.error("❌ 无设备连接：adb devices 未发现处于 device 状态的设备。");
    console.error("   请先启动安卓模拟器，或用 USB 连接真机并授权调试后重试。");
    process.exit(1);
  }
  if (!serial && devices.length > 1) {
    console.error(
      `❌ 检测到多台设备 [${devices.join(", ")}]，请用 ANDROID_SERIAL 指定其一后重跑。`,
    );
    process.exit(1);
  }
  record("设备在线", true, serial ? `使用 ${serial}` : `在线设备 [${devices.join(", ")}]`);

  // --- 2. currentFocus 能返回当前前台 ---
  await step("currentFocus 返回前台", async () => {
    const focus = await adb.currentFocus();
    if (focus === "unknown") throw new Error("返回 unknown（锁屏 / dumpsys 解析失败）");
    return focus;
  });

  // --- 3. screenshot 生成非空 PNG ---
  await step("screenshot 生成非空 PNG", async () => {
    const { base64, file } = await adb.screenshot();
    if (!existsSync(file)) throw new Error(`文件未生成: ${file}`);
    const size = statSync(file).size;
    if (size <= 0) throw new Error(`文件为空: ${file}`);
    if (!base64) throw new Error("base64 为空");
    return `${file} (${(size / 1024).toFixed(0)} KB)`;
  });

  // --- 4. uiDump 返回非空元素清单 ---
  await step("uiDump 返回元素清单", async () => {
    const dump = await adb.uiDump();
    if (!dump || !dump.trim()) throw new Error("返回空");
    const m = dump.match(/共 (\d+) 个可见元素/);
    return m ? `${m[1]} 个可见元素` : dump.split("\n")[0];
  });

  // --- 5. pressKey("home") 回桌面后 uiDump 验证界面变化 ---
  //     先拉起「设置」制造一个非桌面前台，确保回桌面后能观察到确定的变化（否则若本就在桌面则无从验证）。
  await step("pressKey(home) 回桌面且界面变化", async () => {
    await adb.launchIntent({ action: "android.settings.SETTINGS" });
    await sleep(1500);
    const before = await adb.currentFocus();
    await adb.pressKey("home");
    await sleep(1500);
    const after = await adb.currentFocus();
    const dumpAfter = await adb.uiDump();
    if (!dumpAfter.trim()) throw new Error("回桌面后 uiDump 为空");
    if (before === after) throw new Error(`前台未变化（仍为 ${before}）`);
    return `${before} → ${after}`;
  });

  // --- 6. launchIntent 拉起浏览器（VIEW https://example.com）---
  await step("launchIntent 拉起浏览器（VIEW https://example.com）", async () => {
    const before = await adb.currentFocus();
    await adb.launchIntent({
      action: "android.intent.action.VIEW",
      dataUri: "https://example.com",
    });
    await sleep(3000); // 浏览器冷启动留足时间
    const after = await adb.currentFocus();
    const { file } = await adb.screenshot();
    if (before === after) throw new Error(`前台包名未变化（仍为 ${before}）`);
    const looksBrowser = /chrome|browser|webview|firefox/i.test(after);
    const hint = looksBrowser ? "" : "（前台已变化，但未必是浏览器，请看截图确认）";
    return `${before} → ${after}${hint} | 截图 ${file}`;
  });

  // --- 7. tap（屏幕中心）/ swipe（上滑）各做一次安全操作，仅验证命令不报错 ---
  await step("tap(中心) / swipe(上滑) 命令不报错", async () => {
    const { w, h } = await screenSize();
    const cx = Math.round(w / 2);
    const cy = Math.round(h / 2);
    await adb.tap(cx, cy);
    await sleep(500);
    await adb.swipe(cx, Math.round(h * 0.7), cx, Math.round(h * 0.3), 300);
    return `tap(${cx},${cy}) + 上滑 @屏幕 ${w}x${h}（仅验证命令执行，不校验结果）`;
  });

  // --- 汇总 ---
  const passed = results.filter((r) => r.ok).length;
  const total = results.length;
  console.log(`\n=== 汇总：${passed}/${total} 通过 ===`);
  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    console.log("失败项：");
    for (const r of failed) console.log(`  ❌ ${r.name} — ${r.note}`);
  }
  process.exit(passed === total ? 0 : 1);
}

main().catch((e) => {
  console.error("冒烟测试异常:", e);
  process.exit(1);
});
