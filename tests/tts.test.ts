/**
 * 粤语 TTS 通道的单元测试。
 * ttsPlan 是纯函数：决定「要不要说、用什么命令说」，不真正发声。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ttsPlan } from "../src/tts.js";

test("darwin 默认用 say -v Sinji 朗读", () => {
  const plan = ttsPlan("阿婆，打紧畀阿女喇", {}, "darwin");
  assert.deepEqual(plan, { argv: ["say", "-v", "Sinji", "阿婆，打紧畀阿女喇"] });
});

test("NO_TTS=1 时跳过发声", () => {
  const plan = ttsPlan("你好", { NO_TTS: "1" }, "darwin");
  assert.ok("skip" in plan);
});

test("非 macOS 平台跳过发声（say 是 mac 专属）", () => {
  const plan = ttsPlan("你好", {}, "linux");
  assert.ok("skip" in plan);
});

test("TTS_VOICE 可覆盖音色", () => {
  const plan = ttsPlan("你好", { TTS_VOICE: "Tingting" }, "darwin");
  assert.deepEqual(plan, { argv: ["say", "-v", "Tingting", "你好"] });
});

test("空文本跳过发声", () => {
  const plan = ttsPlan("   ", {}, "darwin");
  assert.ok("skip" in plan);
});
