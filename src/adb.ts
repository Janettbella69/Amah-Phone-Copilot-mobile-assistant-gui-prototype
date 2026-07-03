/**
 * ADB 工具层：对安卓模拟器/真机的最小操作集。
 * 全部经由 `adb` 命令行；设备通过 ANDROID_SERIAL 指定（默认取唯一在线设备）。
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const execFileP = promisify(execFile);

const ADB_CANDIDATES = [
  process.env.ADB_PATH,
  "adb",
  path.join(homedir(), "Library/Android/sdk/platform-tools/adb"),
  "/opt/homebrew/share/android-commandlinetools/platform-tools/adb",
].filter(Boolean) as string[];

let adbBin: string | null = null;

async function resolveAdb(): Promise<string> {
  if (adbBin) return adbBin;
  for (const cand of ADB_CANDIDATES) {
    try {
      await execFileP(cand, ["version"]);
      adbBin = cand;
      return cand;
    } catch {
      /* try next */
    }
  }
  throw new Error("找不到 adb，请安装 platform-tools 或设置 ADB_PATH");
}

export async function adb(args: string[], opts: { timeoutMs?: number } = {}): Promise<string> {
  const bin = await resolveAdb();
  const finalArgs = process.env.ANDROID_SERIAL ? ["-s", process.env.ANDROID_SERIAL, ...args] : args;
  const { stdout } = await execFileP(bin, finalArgs, {
    timeout: opts.timeoutMs ?? 20_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  return stdout;
}

async function adbRaw(args: string[]): Promise<Buffer> {
  const bin = await resolveAdb();
  const finalArgs = process.env.ANDROID_SERIAL ? ["-s", process.env.ANDROID_SERIAL, ...args] : args;
  const { stdout } = await execFileP(bin, finalArgs, {
    encoding: "buffer",
    timeout: 20_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  return stdout as unknown as Buffer;
}

const RUNS_DIR = path.join(process.cwd(), "runs");
let shotCounter = 0;

/** 截屏 → 保存到 runs/ 并返回 base64（供模型视觉输入） */
export async function screenshot(): Promise<{ base64: string; file: string }> {
  const png = await adbRaw(["exec-out", "screencap", "-p"]);
  if (!existsSync(RUNS_DIR)) mkdirSync(RUNS_DIR, { recursive: true });
  const file = path.join(RUNS_DIR, `shot-${Date.now()}-${++shotCounter}.png`);
  writeFileSync(file, png);
  return { base64: png.toString("base64"), file };
}

/** 当前前台窗口（帮模型确认在哪个 App 里） */
export async function currentFocus(): Promise<string> {
  try {
    const out = await adb(["shell", "dumpsys", "window"]);
    const m = out.match(/mCurrentFocus=.*?\{(.+?)\}/);
    return m ? m[1].split(" ").pop() ?? "unknown" : "unknown";
  } catch {
    return "unknown";
  }
}

interface UiNode {
  cls: string;
  text: string;
  desc: string;
  id: string;
  clickable: boolean;
  cx: number;
  cy: number;
}

/** uiautomator dump → 精简为可交互元素清单（省 token、利于定位） */
export async function uiDump(): Promise<string> {
  await adb(["shell", "uiautomator", "dump", "/sdcard/window_dump.xml"]);
  const xml = await adb(["exec-out", "cat", "/sdcard/window_dump.xml"]);
  const nodes: UiNode[] = [];
  const nodeRe = /<node[^>]*>/g;
  const attr = (s: string, name: string) => {
    const m = s.match(new RegExp(`${name}="([^"]*)"`));
    return m ? m[1] : "";
  };
  for (const m of xml.match(nodeRe) ?? []) {
    const text = attr(m, "text");
    const desc = attr(m, "content-desc");
    const clickable = attr(m, "clickable") === "true";
    const cls = (attr(m, "class").split(".").pop() ?? "").trim();
    const isEdit = cls.includes("EditText");
    if (!text && !desc && !clickable && !isEdit) continue;
    const b = attr(m, "bounds").match(/\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/);
    if (!b) continue;
    const [l, t, r, bo] = [+b[1], +b[2], +b[3], +b[4]];
    nodes.push({
      cls,
      text,
      desc,
      id: attr(m, "resource-id").split("/").pop() ?? "",
      clickable,
      cx: Math.round((l + r) / 2),
      cy: Math.round((t + bo) / 2),
    });
  }
  const focus = await currentFocus();
  const lines = nodes.map(
    (n, i) =>
      `${i}. ${n.cls}${n.id ? `#${n.id}` : ""}${n.text ? ` text="${n.text}"` : ""}${
        n.desc ? ` desc="${n.desc}"` : ""
      }${n.clickable ? " [可点]" : ""} @(${n.cx},${n.cy})`,
  );
  return `前台: ${focus}\n共 ${nodes.length} 个可见元素:\n${lines.join("\n")}`;
}

export async function tap(x: number, y: number): Promise<void> {
  await adb(["shell", "input", "tap", String(x), String(y)]);
}

export async function swipe(x1: number, y1: number, x2: number, y2: number, ms = 300): Promise<void> {
  await adb(["shell", "input", "swipe", String(x1), String(y1), String(x2), String(y2), String(ms)]);
}

const KEYCODES: Record<string, string> = {
  home: "KEYCODE_HOME",
  back: "KEYCODE_BACK",
  enter: "KEYCODE_ENTER",
  delete: "KEYCODE_DEL",
};

export async function pressKey(key: keyof typeof KEYCODES): Promise<void> {
  await adb(["shell", "input", "keyevent", KEYCODES[key]]);
}

/**
 * 文本输入。中文走 ADBKeyBoard（Base64 广播）；纯 ASCII 回退到 input text。
 * 需要先: adb install ADBKeyboard.apk && adb shell ime set com.android.adbkeyboard/.AdbIME
 */
export async function typeText(text: string): Promise<string> {
  if (/^[\x20-\x7e]*$/.test(text)) {
    await adb(["shell", "input", "text", text.replace(/ /g, "%s")]);
    return "ok(input text)";
  }
  const b64 = Buffer.from(text, "utf8").toString("base64");
  const out = await adb(["shell", "am", "broadcast", "-a", "ADB_INPUT_B64", "--es", "msg", b64]);
  if (!out.includes("result=-1")) {
    return "警告: ADBKeyBoard 可能未激活（先 adb shell ime set com.android.adbkeyboard/.AdbIME）";
  }
  return "ok(ADBKeyBoard)";
}

/** Intent 直达通道：能不点 GUI 就不点 */
export async function launchIntent(opts: { action?: string; dataUri?: string; pkg?: string }): Promise<string> {
  const args = ["shell", "am", "start"];
  if (opts.action) args.push("-a", opts.action);
  if (opts.dataUri) args.push("-d", `'${opts.dataUri}'`);
  if (opts.pkg) args.push(opts.pkg);
  // -d 的 URI 里可能有 & 等字符，经 shell 需引号；execFile 不走 shell，
  // 但 adb shell 那一端仍是 shell，所以上面手动加了单引号。
  return await adb(args);
}
