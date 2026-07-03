# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working
with code in this repository.

## 项目：手机助手GUI（老人手机管家 · 端侧跨 App GUI Agent）

**一句话**：面向老人的、**端侧**运行的、**跨 App「帮我把它办了」**的安卓 GUI
agent。方言语音输入 → 端侧理解意图 → 通过无障碍(Accessibility)代操作把事办了。
大概率投**黑客松**。

## 锁定的边界（硬约束，勿越界）
- **不碰医疗 / 支付 / 强认证**赛道。
- 执行层走 **Accessibility（无障碍）**，不走 ADB 遥控 / Shizuku（要零配置、
  重启可活、isAccessibilityTool 法律正当性）。
- **方言 ASR 已有方案**，不在本项目重新解决，当成已落地的差异化。

## 护城河（区别于微信小微 / OEM 助手）
- 家人托管（子女远程配置）+ 老人端极简交互。
- isAccessibilityTool 的合规正当性（老人无障碍场景是少数诚实主张之一）。
- 端侧 + 跨 App + 真·代操作，这三件 WeChat/OEM 结构上做不到或不会做。

## 技术选型（当前倾向，未最终拍板）
- **GUI 执行大脑（首选）**：AgentCPM-GUI（清华+面壁，基于 MiniCPM-V，端侧原生、
  中文、为普通安卓机 + ADB 控制而生）。
- **黑客松不指定模型**（2026-06-24 确认）→ 首选 AgentCPM-GUI 成立，无强制切线。
- **Qwen 备选（约束不触发，仅留底）**：GUI-Owl / Mobile-Agent-v3（建在 Qwen2.5-VL 上）。
- **第二顺位 / 不死磕端侧时**：UI-TARS-2（字节，Apache-2.0，综合最强）。
- ⚠️ 唯一待定：端侧路线（MNN 端侧经验见隔壁 scholarflow 项目，可借鉴/复用）。

## 环境
- Apple Silicon Mac（M5 Pro, 48GB），本地推理用 **MPS**；端侧侧重 **MNN**。
- 安卓真机调试需开发者模式 + USB 调试。
- 中国网络：pip 用清华镜像，GPU 训练优先 AutoDL。

## 现状
- **端侧尚未跑通**，本项目还没有应用层代码（2026-06-24）。
- 注：之前说的「端侧跑通」指的是**另一个项目 scholarflow 的 MNN 端侧**，
  不是本项目；其 MNN 经验可借鉴复用。
