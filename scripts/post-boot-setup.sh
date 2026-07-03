#!/usr/bin/env bash
# 模拟器启动并 boot 完成后运行：装中文输入法、设模拟定位、验证 Google 服务。
# 前置：emulator -avd stage0 已启动且 `adb devices` 能看到设备。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export ANDROID_HOME="$HOME/Library/Android/sdk"
ADB="$ANDROID_HOME/platform-tools/adb"

echo "▶ 等待设备 boot 完成..."
"$ADB" wait-for-device
# 轮询 sys.boot_completed，最多等 180 秒
for i in $(seq 1 90); do
  if [ "$("$ADB" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; then
    echo "  ✅ 系统已 boot"
    break
  fi
  sleep 2
  [ "$i" = "90" ] && { echo "  ❌ 等待 boot 超时"; exit 1; }
done

echo "▶ 安装 ADBKeyboard（中文输入）..."
if "$ADB" shell pm list packages | grep -q com.android.adbkeyboard; then
  echo "  已安装，跳过"
else
  "$ADB" install -r "$ROOT/vendor/ADBKeyboard.apk"
fi
"$ADB" shell ime enable com.android.adbkeyboard/.AdbIME
"$ADB" shell ime set com.android.adbkeyboard/.AdbIME
echo "  ✅ 输入法已激活（中文经 ADB_INPUT_B64 广播输入）"

echo "▶ 设定模拟定位到纽约曼哈顿唐人街（出行场景需要）..."
# 需要先授予定位权限给 emulator 的 mock provider；用 geo fix（经度 纬度）
# 唐人街 Confucius Plaza ≈ 40.7156, -73.9970
"$ADB" emu geo fix -73.9970 40.7156 2>/dev/null || \
  echo "  ⚠ 'adb emu geo fix' 需要 telnet 端口，可改用 emulator 扩展控件手动设；出行 demo 起点也可手输"
echo "  （提示：也可在模拟器 Extended controls → Location 手动设 NYC）"

echo "▶ 验证 Google 服务与 Maps..."
if "$ADB" shell pm list packages | grep -q com.google.android.apps.maps; then
  echo "  ✅ Google Maps 已预装"
else
  echo "  ⚠ Maps 未预装——需在模拟器内打开 Play Store 登录 Google 账号后安装"
  echo "     （Play Store 版镜像自带 Store；首次需 Google 账号）"
fi
if "$ADB" shell pm list packages | grep -q com.google.android.gms; then
  echo "  ✅ GMS（Play 服务）在位"
fi

echo ""
echo "════════════════════════════════════════════"
echo "环境就绪。下一步可跑："
echo "  cd $ROOT"
echo "  npx tsx scripts/smoke-adb.ts          # 验证 7 个 ADB 工具"
echo '  npx tsx src/agent.ts "帮我打畀阿女"     # 跑打电话流程'
echo "════════════════════════════════════════════"
