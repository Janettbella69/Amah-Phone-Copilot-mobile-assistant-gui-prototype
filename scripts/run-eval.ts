/**
 * 流程评估跑批：对一句 utterance 反复跑 agent.ts N 次，汇总成功率 / turns / cost。
 *
 * 用法：
 *   npx tsx scripts/run-eval.ts "帮我打畀阿女"        # N 默认 5
 *   npx tsx scripts/run-eval.ts "帮我打畀阿女" 10      # 跑 10 次
 *
 * 机制：用子进程起 `npx tsx src/agent.ts "<utterance>"`，注入 AUTO_CONFIRM=1，
 *      让 src/tools.ts 的确认门自动答「系」（见该文件的最小改动），实现无人值守跑批。
 *      每次从 agent 写出的 runs/run-<ts>.jsonl 里读取 type=result 消息，
 *      取 subtype(success / error_max_turns / …)、num_turns、total_cost_usd。
 *      汇总表打印到终端，结构化结果 append 到 runs/eval-summary.jsonl。
 *
 * 前置：需要有效的 Claude 凭证（ANTHROPIC_API_KEY 或已登录 Claude Code）+ 连着设备；
 *      本脚本只负责编排跑批，不校验设备连通（那是 smoke-adb 的活）。
 */
import { spawn } from "node:child_process";
import { readFileSync, appendFileSync, existsSync, readdirSync, statSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, ".."); // 项目根：scripts/ 的上一级
const RUNS_DIR = path.join(ROOT, "runs");

interface ParsedResult {
  success: boolean;
  subtype: string;
  turns: number | null;
  cost: number | null;
}

interface RunResult extends ParsedResult {
  run: number;
  durationMs: number;
  logFile: string | null;
  exitCode: number | null;
}

function parseArgs(): { utterance: string; n: number } {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('用法: npx tsx scripts/run-eval.ts "帮我打畀阿女" [N=5]');
    process.exit(1);
  }
  let n = 5;
  let uttParts = args;
  const last = args[args.length - 1];
  // 末位是纯数字且不止一个参数 → 当作 N（兼容 utterance 未加引号被拆成多段的情况）
  if (args.length > 1 && /^\d+$/.test(last)) {
    n = parseInt(last, 10);
    uttParts = args.slice(0, -1);
  }
  const utterance = uttParts.join(" ").trim();
  if (!utterance) {
    console.error("utterance 不能为空");
    process.exit(1);
  }
  return { utterance, n: Math.max(1, n) };
}

/** 从 agent 的 stdout 里解析日志路径；解析不到则回退到 runs/ 下最新的 run-*.jsonl */
function findLogFile(stdout: string, since: number): string | null {
  const m = stdout.match(/完整日志:\s*(.+\.jsonl)\s*$/m);
  if (m && existsSync(m[1].trim())) return m[1].trim();
  try {
    const cands = readdirSync(RUNS_DIR)
      .filter((f) => /^run-\d+\.jsonl$/.test(f))
      .map((f) => path.join(RUNS_DIR, f))
      .map((p) => ({ p, mtime: statSync(p).mtimeMs }))
      .filter((x) => x.mtime >= since - 2000) // 留 2s 容差
      .sort((a, b) => b.mtime - a.mtime);
    return cands.length ? cands[0].p : null;
  } catch {
    return null;
  }
}

/** 从 run-*.jsonl 里找 type=result 的那条，取 subtype / num_turns / total_cost_usd */
function parseResult(logFile: string | null): ParsedResult | null {
  if (!logFile || !existsSync(logFile)) return null;
  let text: string;
  try {
    text = readFileSync(logFile, "utf8");
  } catch {
    return null;
  }
  for (const line of text.split("\n")) {
    const s = line.trim();
    if (!s) continue;
    let obj: any;
    try {
      obj = JSON.parse(s);
    } catch {
      continue;
    }
    if (obj && obj.type === "result") {
      return {
        success: obj.subtype === "success",
        subtype: typeof obj.subtype === "string" ? obj.subtype : "unknown",
        turns: typeof obj.num_turns === "number" ? obj.num_turns : null,
        cost: typeof obj.total_cost_usd === "number" ? obj.total_cost_usd : null,
      };
    }
  }
  return null;
}

/** 起一个 agent 子进程跑一次，返回结构化结果 */
function runOnce(utterance: string, runIndex: number): Promise<RunResult> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    let stdout = "";
    let stderr = "";
    const child = spawn("npx", ["tsx", "src/agent.ts", utterance], {
      cwd: ROOT,
      env: { ...process.env, AUTO_CONFIRM: "1", NO_TTS: "1" }, // 跑批不发声
      // stdin 忽略：AUTO_CONFIRM 已让确认门不读 stdin，不会挂起等输入
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout?.on("data", (d) => (stdout += d.toString()));
    child.stderr?.on("data", (d) => (stderr += d.toString()));

    child.on("error", (err) => {
      console.error(`  第 ${runIndex} 次：子进程启动失败 — ${err.message}`);
      resolve({
        run: runIndex,
        success: false,
        subtype: "spawn_error",
        turns: null,
        cost: null,
        durationMs: Date.now() - t0,
        logFile: null,
        exitCode: null,
      });
    });

    child.on("close", (code) => {
      const durationMs = Date.now() - t0;
      const logFile = findLogFile(stdout, t0);
      let parsed = parseResult(logFile);
      if (!parsed) {
        const tail = stderr.trim().split("\n").slice(-3).join(" | ");
        if (tail) console.error(`  第 ${runIndex} 次无 result（exit=${code}）：${tail}`);
        parsed = {
          success: false,
          subtype: code === 0 ? "no_result" : `exit_${code}`,
          turns: null,
          cost: null,
        };
      }
      resolve({ ...parsed, run: runIndex, durationMs, logFile, exitCode: code });
    });
  });
}

function pad(s: string, w: number): string {
  return s + " ".repeat(Math.max(0, w - s.length));
}

function printTable(runs: RunResult[]): void {
  const header = ["#", "result", "subtype", "turns", "cost", "dur"];
  const rows = runs.map((r) => [
    String(r.run),
    r.success ? "PASS" : "FAIL",
    r.subtype,
    r.turns != null ? String(r.turns) : "-",
    r.cost != null ? "$" + r.cost.toFixed(4) : "-",
    (r.durationMs / 1000).toFixed(1) + "s",
  ]);
  const all = [header, ...rows];
  const widths = header.map((_, c) => Math.max(...all.map((row) => row[c].length)));
  const line = (row: string[]) => row.map((cell, i) => pad(cell, widths[i])).join("  ");
  console.log("\n" + line(header));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const row of rows) console.log(line(row));
}

async function main(): Promise<void> {
  const { utterance, n } = parseArgs();
  if (!existsSync(RUNS_DIR)) mkdirSync(RUNS_DIR, { recursive: true });

  console.log("=== 流程评估跑批 ===");
  console.log(`utterance: 「${utterance}」  N=${n}`);
  console.log("（AUTO_CONFIRM=1 自动过确认门；每次起一个 agent 子进程串行跑）\n");

  const runs: RunResult[] = [];
  for (let i = 1; i <= n; i++) {
    process.stdout.write(`▶ 第 ${i}/${n} 次运行… `);
    const r = await runOnce(utterance, i);
    runs.push(r);
    console.log(
      `${r.success ? "✅" : "❌"} subtype=${r.subtype} turns=${r.turns ?? "-"} cost=$${
        r.cost != null ? r.cost.toFixed(4) : "-"
      } ${(r.durationMs / 1000).toFixed(1)}s`,
    );
  }

  // 汇总统计
  const successCount = runs.filter((r) => r.success).length;
  const withTurns = runs.filter((r) => r.turns != null);
  const withCost = runs.filter((r) => r.cost != null);
  const avgTurns = withTurns.length
    ? withTurns.reduce((a, r) => a + (r.turns as number), 0) / withTurns.length
    : null;
  const avgCost = withCost.length
    ? withCost.reduce((a, r) => a + (r.cost as number), 0) / withCost.length
    : null;
  const avgDurationMs = runs.length ? runs.reduce((a, r) => a + r.durationMs, 0) / runs.length : 0;

  printTable(runs);
  console.log(
    `\n成功率: ${successCount}/${n} (${((successCount / n) * 100).toFixed(0)}%)` +
      `  平均 turns: ${avgTurns != null ? avgTurns.toFixed(1) : "-"}` +
      `  平均 cost: ${avgCost != null ? "$" + avgCost.toFixed(4) : "-"}` +
      `  平均耗时: ${(avgDurationMs / 1000).toFixed(1)}s`,
  );

  // 结构化结果 append 到 runs/eval-summary.jsonl（一次跑批一行）
  const summary = {
    event: "eval_summary",
    time: new Date().toISOString(),
    utterance,
    n,
    successCount,
    successRate: successCount / n,
    avgTurns,
    avgCost,
    avgDurationMs,
    runs: runs.map((r) => ({
      run: r.run,
      success: r.success,
      subtype: r.subtype,
      turns: r.turns,
      cost: r.cost,
      durationMs: r.durationMs,
      logFile: r.logFile,
      exitCode: r.exitCode,
    })),
  };
  const summaryFile = path.join(RUNS_DIR, "eval-summary.jsonl");
  appendFileSync(summaryFile, JSON.stringify(summary) + "\n");
  console.log(`\n📄 汇总已追加: ${summaryFile}`);
}

main().catch((err) => {
  console.error("跑批异常:", err);
  process.exit(1);
});
