/**
 * 拨号白名单策略（防诈骗的代码层硬校验，不依赖模型自觉遵守 prompt 铁律）。
 * 比对口径：号码只比数字（剥掉 +、空格、括号、横杠），完全一致才放行。
 */
import { readFileSync } from "node:fs";
import path from "node:path";

export interface DialCheckResult {
  allowed: boolean;
  reason?: string;
}

/** 剥掉一切非数字字符，得到可比对的数字串 */
function digitsOf(s: string): string {
  return s.replace(/\D/g, "");
}

export function checkDialWhitelist(dataUri: string | undefined, whitelistPhones: string[]): DialCheckResult {
  if (!dataUri) return { allowed: true }; // 没有 dataUri → 不是拨号动作

  let uri = dataUri;
  try {
    uri = decodeURIComponent(dataUri);
  } catch {
    /* 解码失败就按原文比对 */
  }

  if (!/^tel:/i.test(uri)) return { allowed: true }; // 只管 tel:，geo: 等不受限

  const digits = digitsOf(uri.slice("tel:".length));
  if (!digits) {
    return { allowed: false, reason: `tel: URI 里没有可识别的号码：${dataUri}` };
  }
  if (whitelistPhones.some((p) => digitsOf(p) === digits)) {
    return { allowed: true };
  }
  return {
    allowed: false,
    reason: `号码 ${digits} 不在家人白名单内，已拒绝拨打（防诈骗铁律，代码层强制）`,
  };
}

/** 从 config/contacts.json 读出全部白名单号码（与 agent.ts 同样以 cwd 为根） */
export function loadWhitelistPhones(): string[] {
  const file = path.join(process.cwd(), "config", "contacts.json");
  const cfg = JSON.parse(readFileSync(file, "utf8"));
  const contacts: Array<{ phone?: unknown }> = Array.isArray(cfg?.contacts) ? cfg.contacts : [];
  return contacts.map((c) => c.phone).filter((p): p is string => typeof p === "string" && p.trim().length > 0);
}
