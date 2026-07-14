/**
 * 白名单拨号策略的单元测试（node:test，经 `npx tsx --test` 运行）。
 * 核心主张：防诈骗白名单必须是代码层硬校验，不依赖模型自觉。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkDialWhitelist, loadWhitelistPhones } from "../src/policy.js";

const WHITELIST = ["+16465550123", "+16465550188", "+16465550166"];

test("放行白名单内的号码（完全一致）", () => {
  const r = checkDialWhitelist("tel:+16465550123", WHITELIST);
  assert.equal(r.allowed, true);
});

test("拒绝白名单外的号码", () => {
  const r = checkDialWhitelist("tel:+18005551234", WHITELIST);
  assert.equal(r.allowed, false);
  assert.ok(r.reason, "拒绝时必须给出原因");
});

test("放行格式不同但数字相同的号码（空格/括号/横杠）", () => {
  const r = checkDialWhitelist("tel:+1 (646) 555-0123", WHITELIST);
  assert.equal(r.allowed, true);
});

test("放行 URL 编码的白名单号码（%2B = +）", () => {
  const r = checkDialWhitelist("tel:%2B16465550123", WHITELIST);
  assert.equal(r.allowed, true);
});

test("tel: 大小写不敏感", () => {
  const r = checkDialWhitelist("TEL:+16465550123", WHITELIST);
  assert.equal(r.allowed, true);
});

test("非 tel: 的 URI 不受白名单限制（如 geo:）", () => {
  const r = checkDialWhitelist("geo:0,0?q=Chinatown+Manhattan", WHITELIST);
  assert.equal(r.allowed, true);
});

test("没有 dataUri 时放行（不是拨号动作）", () => {
  const r = checkDialWhitelist(undefined, WHITELIST);
  assert.equal(r.allowed, true);
});

test("tel: 里没有任何数字 → 拒绝", () => {
  const r = checkDialWhitelist("tel:abc", WHITELIST);
  assert.equal(r.allowed, false);
});

test("空白名单时一切拨号都拒绝", () => {
  const r = checkDialWhitelist("tel:+16465550123", []);
  assert.equal(r.allowed, false);
});

test("loadWhitelistPhones 能从 config/contacts.json 读出全部号码", () => {
  const phones = loadWhitelistPhones();
  assert.ok(phones.length >= 1, "至少要有一个白名单号码");
  for (const p of phones) {
    assert.equal(typeof p, "string");
    assert.ok(p.trim().length > 0);
  }
});
