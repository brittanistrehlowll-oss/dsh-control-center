# dsh-jingxi ◊ V1.0.1（Pure Breath）

鲸息（jingxi）是 DeepSeek Harness（DSH）的轻量伴生插件：在宿主侧边栏提供一个
鲸鱼入口，**点击直达呼吸轨迹浮层**——只呈现基础调用事实与呼吸轨迹，别无他物。

## V1.0.1 是什么

一次「纯粹化」发布。两轮剥离：

1. **剥离计费/额度**：quota 适配层、额度面板、余额/套餐素材与图层全部移除；
   界面只剩调用事实（轮次/步数、Token、时长、Cache 命中、速度）与呼吸曲线。
2. **剥离中间面板与快捷操作**：鲸息面板、DSH 更新浮层、侧栏快捷操作行
   （呼吸轨迹/重启/检查更新）与「当前版本」行全部移除；侧栏入口点击
   **直接**打开呼吸轨迹页。

保留的界面：

| 表面 | 内容 |
| --- | --- |
| 侧边栏入口（wide/rail） | 官方 FishLogo 鲸鱼 + 线程状态 + tok/s 速率；rail 收起态仅鲸鱼，选中块跟随浮层开合 |
| 呼吸轨迹浮层 | 五张事实卡、Breath Curve（事件刻度/游标/图例）、Event Rail、最近 5 轮、阶段故事、子代理 Dock |
| 设置区（Settings section） | 版本（插件/设计基线/DSH 宿主/宿主兼容）、运行状态（投影/遥测/DSH 健康）、「诊断与修复」Doctor |

## DSH 更新检查的去向

客户端不再提供更新/重启按钮。DSH 版本检查迁移到**设置区的「诊断与修复」**，
只读呈现：更新可用、更新适配（兼容性未验证时显示已阻止）、检查失败时的
可操作原因（如「找不到 pnpm」）。host 端 `/api/jingxi/update` 与
`/api/jingxi/lifecycle` 端点保留（fail-closed），供未来受控通道复用。

## 安装

见仓库 `skill/jingxi/scripts/install.ps1`（幂等）：将本包部署到
`<DSH home>/profiles/node_modules/dsh-jingxi`，并向 `cordis.patch.yml`
注入 `dsh-jingxi` 插件行（`inject: [webServer]`）。DSH Desktop 的 harness
home 在 `%APPDATA%/dsh-desktop/harness/`，需同步部署。

## 测试

```bash
node --test "test/*.test.mjs"
```

当前基线：**213/213 通过**（Node 22）。

## 目录

```text
lib/            浏览器半（client.js）+ host 半（index.js、telemetry-fold 等）
assets/icons/   本地补充素材（喷水/状态徽标）；鲸鱼主体一律用 DSH 官方 FishLogo
test/           node:test 套件（harness 用 vm 加载 client.js 跑组件级断言）
cordis.patch.yml 插件启用补丁样例
```

设计原则：通用外壳/按钮/遮罩遵循 DSH Native tokens；轨迹与阶段只在有真实
projection 数据时绘制，缺失数据保持空轨道/未知状态（fail-closed，不伪造）。
