/**
 * 粤语 TTS 通道（Stage 0.5：宿主 Mac 的 say 命令 + zh_HK 音色 Sinji）。
 * Stage 1 换成端侧粤语 TTS 时只需替换 speakCantonese 的实现。
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

type Plan = { argv: string[] } | { skip: string };

/** 纯决策：要不要说、用什么命令说。NO_TTS=1 用于评估跑批等无人值守场景 */
export function ttsPlan(
  text: string,
  env: Record<string, string | undefined> = process.env,
  platform: string = process.platform,
): Plan {
  if (env.NO_TTS === "1") return { skip: "NO_TTS=1" };
  if (platform !== "darwin") return { skip: `say 仅 macOS 可用（当前 ${platform}）` };
  const trimmed = text.trim();
  if (!trimmed) return { skip: "空文本" };
  return { argv: ["say", "-v", env.TTS_VOICE ?? "Sinji", trimmed] };
}

/** 朗读一句粤语；失败/跳过都不抛错（发不出声不能弄死 agent 流程），返回是否真的说了 */
export async function speakCantonese(text: string): Promise<boolean> {
  const plan = ttsPlan(text);
  if ("skip" in plan) return false;
  try {
    const [bin, ...args] = plan.argv;
    await execFileP(bin, args, { timeout: 30_000 });
    return true;
  } catch {
    return false; // 音色缺失/say 报错时静默降级回纯文字
  }
}
