# Jingxi Icon Library

按 `manifest.json` 的语义分组使用，不按文件名猜测状态。V1.0.1（Pure Breath）的原则是：

> DSH 官方 FishLogo 负责鲸鱼主体；Jingxi 负责水波、喷气和状态补充。计费/额度（quota）相关图层与素材已整体移除。

| 层 | 用途 | 当前实现 |
| --- | --- | --- |
| Brand Icon | 鲸息页面标题、Breath/Share 视觉 | `brand/` PNG；保留既有兼容素材 |
| Runtime Mark V1.5 | 侧边栏鲸息入口、面板内生命周期状态 | `lib/client.js:JingxiRuntimeMark`；官方 FishLogo + 本地装饰，不复制官方 path |
| State Visual | Breath、运行状态 | `breath/`、`status/`、`v15/status/`、`v15/spout/` |
| Share Visual | Perfect Breath 高光展示 | V5.4 预留 |

目录说明：

| 目录 | 内容 |
| --- | --- |
| `brand/` | 既有 Brand/Share 参考素材；不作为 DSH Runtime 主体 |
| `runtime/` | 历史重启与更新复合素材；legacy/reference-only，不得新增引用 |
| `v15/status/` | 成功、失败、信息徽标 |
| `v15/spout/` | idle/light/stable 喷水装饰，可叠加在官方 FishLogo 上 |
| `breath/` | BreathCurve 阶段参考 |
| `utility/` | 数据、分享、主题、设置、关于、帮助 |

V1.0.1 已删除：`quota/`、`balance/`、`v15/provider/`（DeepSeek 额度鲸鱼、钱包、Go 套餐图标）及其 manifest 图层，随计费功能一并下线。

当前侧边栏只保留一个入口，**点击直达呼吸轨迹浮层**（V1.0.1 起无中间面板、
无快捷操作行、无版本行）：

```text
🐳 鲸息
```

侧边栏鲸息入口的主体必须来自 DSH 官方 `FishLogo`：

- `默认/完成`：官方 FishLogo，无常驻文字。
- `活跃`：官方 FishLogo + `v15/spout/` 喷水。
- `异常`：官方 FishLogo + 红色失败徽标。

DSH 更新检查已迁至**设置区的「诊断与修复」（Doctor）**：只读呈现更新可用 /
更新适配 / 检查失败原因，客户端不再提供更新/重启按钮（`DshActionGlyph` 与
更新浮层已随面板一并移除）；host `/api/jingxi/{update,lifecycle}` 端点保留。

新的重启参考图中非官方轮廓只保存在 `local/evidence/assets/v15/reference-runtime-crops/`，不进入发布包。所有本地生产 PNG 为透明 128×128；官方 FishLogo 不复制入包。根目录 `whale-default.png`、`restart-idle.png` 等旧别名保留用于回滚/兼容，不覆盖、不删除。
