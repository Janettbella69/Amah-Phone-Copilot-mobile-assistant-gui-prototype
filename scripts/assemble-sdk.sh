#!/usr/bin/env bash
# =============================================================================
# assemble-sdk.sh — 手动装配 Android SDK 并创建 AVD（幂等脚本）
# -----------------------------------------------------------------------------
# 背景：中国大陆网络无法用 sdkmanager 从 dl.google.com 拉模拟器组件（40KB/s），
#       已改从腾讯镜像手动下载两个 zip 到 $ANDROID_HOME/.dl/。
#       本脚本把这两个 zip 装配成「sdkmanager 装出来那样」的目录结构，
#       补上 avdmanager 识别系统镜像所必需的 package.xml，再建好名为 stage0 的 AVD。
#
# 幂等：可反复执行。每一步先探测「是否已就位」，已就位就跳过，不会重复解压/覆盖坏数据。
#
# 重要：本脚本【不】启动模拟器（下载可能没完 + 启动是长任务）。
#       结尾只打印启动命令，供你手动执行。
#
# 用法：  bash ~/phone-gui-assistant/scripts/assemble-sdk.sh
# =============================================================================

set -uo pipefail
# 说明：不用 set -e。avdmanager 那步需要「失败→走 fallback」的可控流程，
#       用显式的 if / || die 处理错误，避免 set -e 在预期的非零返回上误退出。

# -------- 小工具函数 --------
die()  { echo ""; echo "❌ 错误：$*" >&2; exit 1; }
step() { echo ""; echo "==================================================================="; echo "▶ $*"; echo "==================================================================="; }
info() { echo "   · $*"; }

# =============================================================================
# 0) 环境变量：ANDROID_HOME / JAVA_HOME / PATH
# =============================================================================
step "0/7  设置环境变量（ANDROID_HOME / JAVA_HOME / PATH）"

export ANDROID_HOME="$HOME/Library/Android/sdk"
# ANDROID_SDK_ROOT 是旧名，部分工具（尤其是 emulator 解析 image.sysdir.1 时）仍会读它，
# 一并 export，指向同一目录，纯属兜底、无副作用。
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export JAVA_HOME="/opt/homebrew/opt/openjdk"

# 把模拟器、platform-tools(adb)、JDK 的 bin 挂到 PATH 最前面
export PATH="$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools:$JAVA_HOME/bin:$PATH"

info "ANDROID_HOME  = $ANDROID_HOME"
info "JAVA_HOME     = $JAVA_HOME"
[ -d "$ANDROID_HOME" ] || die "找不到 $ANDROID_HOME，SDK 根目录不存在"
[ -x "$JAVA_HOME/bin/java" ] || die "找不到 $JAVA_HOME/bin/java，JDK 未就位"

# 解析 avdmanager 路径：优先 PATH 上的，找不到就用 Homebrew 的绝对路径兜底
AVDMANAGER="$(command -v avdmanager || true)"
[ -z "$AVDMANAGER" ] && AVDMANAGER="/opt/homebrew/bin/avdmanager"
[ -x "$AVDMANAGER" ] || info "⚠ 未找到可执行的 avdmanager（$AVDMANAGER），第 6 步会直接走手写 config fallback"

# =============================================================================
# 常量：下载目录、两个 zip、系统镜像的目标路径与包坐标
# =============================================================================
DL_DIR="$ANDROID_HOME/.dl"
EMU_ZIP="$DL_DIR/emulator.zip"
SYS_ZIP="$DL_DIR/sysimg.zip"

# sysimg.zip 下载完整时的期望大小（字节）。小于它 = 还没下完。
SYS_ZIP_EXPECT=1548905381

# 系统镜像的 sdkmanager 包坐标（分号分隔），avdmanager -k 用的就是它
PKG_PATH="system-images;android-34;google_apis_playstore;arm64-v8a"

# 系统镜像最终落地目录：.../google_apis_playstore/ 下面是解压出来的 arm64-v8a/
SYS_PARENT="$ANDROID_HOME/system-images/android-34/google_apis_playstore"
SYS_DIR="$SYS_PARENT/arm64-v8a"

# AVD 相关路径
AVD_NAME="stage0"
AVD_HOME="$HOME/.android/avd"
AVD_INI="$AVD_HOME/$AVD_NAME.ini"
AVD_DIR="$AVD_HOME/$AVD_NAME.avd"
# image.sysdir.1 用「相对 $ANDROID_HOME 的路径」，末尾带斜杠是约定写法
SYSDIR_REL="system-images/android-34/google_apis_playstore/arm64-v8a/"

# =============================================================================
# 1) 校验两个 zip 是否存在且下载完整
# =============================================================================
step "1/7  校验下载文件完整性"

[ -d "$DL_DIR" ]  || die "下载目录不存在：$DL_DIR"
[ -f "$EMU_ZIP" ] || die "找不到 $EMU_ZIP"
[ -f "$SYS_ZIP" ] || die "找不到 $SYS_ZIP"

# 1a. sysimg.zip 用大小做「下载未完成」的快速闸门
SYS_SZ="$(stat -f%z "$SYS_ZIP")"
info "sysimg.zip 当前大小 = $SYS_SZ 字节（期望 ≥ $SYS_ZIP_EXPECT）"
if [ "$SYS_SZ" -lt "$SYS_ZIP_EXPECT" ]; then
  die "下载未完成：sysimg.zip 只有 $SYS_SZ 字节，还没下到 $SYS_ZIP_EXPECT。请等后台下载跑完再执行。"
fi

# 1b. 用 unzip -l 读中央目录(EOCD 在文件末尾)——文件被截断/没下完时这里会失败。
#     这是「秒级」的完整性判定；如需逐条 CRC 深度校验可自行改成 `unzip -t`（1.5G 约几十秒）。
info "校验 sysimg.zip 结构（unzip -l 读中央目录）..."
unzip -l "$SYS_ZIP" >/dev/null 2>&1 || die "下载未完成或已损坏：sysimg.zip 中央目录不可读"
info "校验 emulator.zip 结构 ..."
unzip -l "$EMU_ZIP" >/dev/null 2>&1 || die "下载未完成或已损坏：emulator.zip 中央目录不可读"
info "✓ 两个 zip 均完整可读"

# =============================================================================
# 2) 解压 emulator.zip -> $ANDROID_HOME/emulator/
#    （zip 内顶层就是 emulator/ 目录，直接解到 $ANDROID_HOME 即可）
# =============================================================================
step "2/7  装配模拟器（emulator）"

EMU_BIN="$ANDROID_HOME/emulator/emulator"
if [ -x "$EMU_BIN" ]; then
  info "已存在 $EMU_BIN，跳过解压（幂等）"
else
  info "解压 emulator.zip -> $ANDROID_HOME/ ..."
  unzip -oq "$EMU_ZIP" -d "$ANDROID_HOME" || die "解压 emulator.zip 失败"
  [ -x "$EMU_BIN" ] || die "解压后仍找不到可执行的 $EMU_BIN"
  info "✓ 模拟器就位：$EMU_BIN"
fi

# =============================================================================
# 3) 解压 sysimg.zip -> $ANDROID_HOME/system-images/android-34/google_apis_playstore/
#    （zip 内顶层是 arm64-v8a/，解到 .../google_apis_playstore/ 下就得到 .../arm64-v8a/）
# =============================================================================
step "3/7  装配系统镜像（system image）"

if [ -f "$SYS_DIR/build.prop" ]; then
  info "已存在 $SYS_DIR/build.prop，跳过解压（幂等）"
else
  info "创建目标目录：$SYS_PARENT"
  mkdir -p "$SYS_PARENT" || die "创建 $SYS_PARENT 失败"
  info "解压 sysimg.zip -> $SYS_PARENT/ （约 1.5G，请稍候）..."
  unzip -oq "$SYS_ZIP" -d "$SYS_PARENT" || die "解压 sysimg.zip 失败"
  [ -f "$SYS_DIR/build.prop" ] || die "解压后在 $SYS_DIR 里找不到 build.prop，zip 内部结构可能不是预期的 arm64-v8a/"
  info "✓ 系统镜像就位：$SYS_DIR"
fi

# =============================================================================
# 4) 写 package.xml —— 手动装配最容易翻车的一步
# -----------------------------------------------------------------------------
# 为什么需要它：avdmanager / sdkmanager 用「repository v2」协议，靠每个包目录下的
#   package.xml(localPackage 形态) 来识别这是什么包。缺了它，avdmanager 用 -k 坐标
#   就找不到这个系统镜像。
#
# schema 依据（已联网查证，不是凭记忆）：
#   · 外层 <repository> 根元素 + 全套命名空间 —— 直接照抄本机已装好、能被工具正确解析的
#     $ANDROID_HOME/platform-tools/package.xml（common/02 为主命名空间 ns2，
#     并声明了 sys-img2 的 /01~/04 = ns15~ns12）。
#   · <type-details> 的 xsi:type = sysImgDetailsType（属于 sys-img2 命名空间）；
#     其子元素顺序 api-level → tag(id/display) → vendor(id/display) → abi，
#     来自 Google 官方 sys-img2 仓库 XML（android.googlesource.com 的
#     device/generic/car/tools/aaos-sys-img2-1.xml，确认为 sys-img:sysImgDetailsType）。
#   · 这里用 ns13 = http://schemas.android.com/sdk/android/repo/sys-img2/03
#     （android-34 时代实际分发用的版本；sysImgDetailsType 在 /01~/04 都有定义，工具全支持）。
#   · api-level=34、tag id=google_apis_playstore(display=Google Play)、
#     vendor id=google、abi=arm64-v8a、revision major=14 —— 与包坐标一一对应。
#
# 幂等：每次都重写（内容固定），保证即使上次写歪了也会被纠正。
# =============================================================================
step "4/7  写系统镜像 package.xml（让 avdmanager 能识别）"

PKG_XML="$SYS_DIR/package.xml"
cat > "$PKG_XML" <<'PKGXML'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<ns2:repository xmlns:ns2="http://schemas.android.com/repository/android/common/02" xmlns:ns3="http://schemas.android.com/repository/android/common/01" xmlns:ns4="http://schemas.android.com/repository/android/generic/01" xmlns:ns5="http://schemas.android.com/repository/android/generic/02" xmlns:ns6="http://schemas.android.com/sdk/android/repo/repository2/01" xmlns:ns7="http://schemas.android.com/sdk/android/repo/repository2/02" xmlns:ns8="http://schemas.android.com/sdk/android/repo/repository2/03" xmlns:ns9="http://schemas.android.com/sdk/android/repo/addon2/01" xmlns:ns10="http://schemas.android.com/sdk/android/repo/addon2/02" xmlns:ns11="http://schemas.android.com/sdk/android/repo/addon2/03" xmlns:ns12="http://schemas.android.com/sdk/android/repo/sys-img2/04" xmlns:ns13="http://schemas.android.com/sdk/android/repo/sys-img2/03" xmlns:ns14="http://schemas.android.com/sdk/android/repo/sys-img2/02" xmlns:ns15="http://schemas.android.com/sdk/android/repo/sys-img2/01">
  <license id="license-android-sdk" type="text">Android SDK License. Accepted for local manual assembly.</license>
  <localPackage path="system-images;android-34;google_apis_playstore;arm64-v8a" obsolete="false">
    <type-details xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="ns13:sysImgDetailsType">
      <api-level>34</api-level>
      <tag>
        <id>google_apis_playstore</id>
        <display>Google Play</display>
      </tag>
      <vendor>
        <id>google</id>
        <display>Google Inc.</display>
      </vendor>
      <abi>arm64-v8a</abi>
    </type-details>
    <revision>
      <major>14</major>
    </revision>
    <display-name>Google Play ARM 64 v8a System Image</display-name>
    <uses-license ref="license-android-sdk"/>
  </localPackage>
</ns2:repository>
PKGXML
[ -s "$PKG_XML" ] || die "写 package.xml 失败：$PKG_XML"
info "✓ 已写入 $PKG_XML"

# =============================================================================
# 5) 清除 macOS 隔离属性（quarantine）
#    从镜像下载的二进制可能被 Gatekeeper 标记「无法验证开发者」，提前解除，非致命。
# =============================================================================
step "5/7  解除 macOS quarantine 隔离（非致命）"
xattr -dr com.apple.quarantine "$ANDROID_HOME/emulator" 2>/dev/null && info "已清 emulator/ 的 quarantine" || info "emulator/ 无需处理"
xattr -dr com.apple.quarantine "$SYS_DIR" 2>/dev/null && info "已清系统镜像的 quarantine" || info "系统镜像无需处理"

# =============================================================================
# 6) 创建 AVD：stage0（Pixel 7）
#    先试 avdmanager；识别不了就 fallback 手写 config.ini + stage0.ini。
# =============================================================================
step "6/7  创建 AVD：$AVD_NAME（Pixel 7 · $PKG_PATH）"

if [ -f "$AVD_INI" ] && [ -d "$AVD_DIR" ]; then
  info "AVD「$AVD_NAME」已存在（$AVD_INI），跳过创建（幂等）"
else
  mkdir -p "$AVD_HOME"
  AVD_LOG="${TMPDIR:-/tmp}/assemble-sdk-avdmanager.log"
  CREATED_OK=0

  if [ -x "$AVDMANAGER" ]; then
    info "尝试用 avdmanager 创建（license 提示用 echo no 喂入）..."
    # echo no：回答「是否创建自定义硬件 profile? [no]」等交互提示
    if echo "no" | "$AVDMANAGER" create avd -n "$AVD_NAME" -k "$PKG_PATH" -d pixel_7 --force >"$AVD_LOG" 2>&1; then
      # avdmanager 返回 0 还不够，要确认真的生成了 .ini + config.ini 且指到系统镜像
      if [ -f "$AVD_INI" ] && [ -f "$AVD_DIR/config.ini" ]; then
        CREATED_OK=1
        info "✓ avdmanager 创建成功"
      else
        info "⚠ avdmanager 返回 0 但没生成预期文件，转 fallback"
      fi
    else
      info "⚠ avdmanager 创建失败（多半是没认出系统镜像），转 fallback"
      info "  （avdmanager 日志见：$AVD_LOG）"
    fi
  else
    info "⚠ 无可用 avdmanager，直接走 fallback"
  fi

  # ---------- Fallback：手写 config.ini + stage0.ini ----------
  if [ "$CREATED_OK" -eq 0 ]; then
    step "6b/7  Fallback：手写 AVD 配置（绕开 avdmanager）"
    info "关键点：config.ini 里的 image.sysdir.1 直接指到系统镜像目录（相对 \$ANDROID_HOME）"
    mkdir -p "$AVD_DIR" || die "创建 $AVD_DIR 失败"

    # stage0.ini —— avd 管理器/模拟器据此找到 .avd 目录
    cat > "$AVD_INI" <<INI
avd.ini.encoding=UTF-8
path=$AVD_DIR
path.rel=avd/$AVD_NAME.avd
target=android-34
INI

    # config.ini —— 模拟器启动的实际配置。image.sysdir.1 是最要命的字段。
    cat > "$AVD_DIR/config.ini" <<INI
avd.ini.encoding=UTF-8
AvdId=$AVD_NAME
avd.ini.displayname=$AVD_NAME
abi.type=arm64-v8a
hw.cpu.arch=arm64
hw.cpu.ncore=4
image.sysdir.1=$SYSDIR_REL
image.androidVersion.api=34
tag.id=google_apis_playstore
tag.ids=google_apis_playstore
tag.display=Google Play
PlayStore.enabled=true
hw.device.manufacturer=Google
hw.device.name=pixel_7
hw.ramSize=2048
vm.heapSize=256
disk.dataPartition.size=6442450944
hw.gpu.enabled=yes
hw.gpu.mode=auto
hw.keyboard=yes
hw.lcd.density=420
hw.lcd.width=1080
hw.lcd.height=2400
skin.dynamic=yes
showDeviceFrame=no
fastboot.forceColdBoot=no
runtime.network.latency=none
runtime.network.speed=full
sdcard.size=512M
INI
    [ -s "$AVD_DIR/config.ini" ] || die "写 config.ini 失败"
    info "✓ fallback 配置就位："
    info "  $AVD_INI"
    info "  $AVD_DIR/config.ini  (image.sysdir.1=$SYSDIR_REL)"
  fi
fi

# =============================================================================
# 7) 完成：打印启动命令（不自动启动！）
# =============================================================================
step "7/7  装配完成 —— 下面是【手动】启动命令（本脚本不自动启动）"

cat <<TIP

装配完成 ✅   已就位：
  · 模拟器      : $ANDROID_HOME/emulator/
  · 系统镜像    : $SYS_DIR/
  · package.xml : $SYS_DIR/package.xml
  · AVD         : $AVD_NAME  ($AVD_DIR)

── 先在当前 shell 里导出环境变量（这样 emulator/adb 才在 PATH 上）──
  export ANDROID_HOME="$HOME/Library/Android/sdk"
  export ANDROID_SDK_ROOT="\$ANDROID_HOME"
  export JAVA_HOME="/opt/homebrew/opt/openjdk"
  export PATH="\$ANDROID_HOME/emulator:\$ANDROID_HOME/platform-tools:\$JAVA_HOME/bin:\$PATH"

── 然后启动模拟器（Google 服务走 127.0.0.1:1082 代理）──
  emulator -avd $AVD_NAME -no-snapshot -no-boot-anim -http-proxy 127.0.0.1:1082 &

── 起来后可用 adb 确认 ──
  adb devices
  adb wait-for-device

TIP
