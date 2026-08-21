# dsh ui skin — 测试矩阵

对应 DH-TP-SDK §26–§34 的测试规范。当前可自动运行的是 `manifest.test.mjs`（manifest/package.json 字段冒烟 + 源码安全扫描）；其余需在真实 dsh 运行时人工/集成验证。

```bash
npm test          # 或 node --test tests/
```

| 维度 | 测试 | 状态 |
|---|---|---|
| Manifest | `manifest.test.mjs`：manifestVersion/plugin.id/runtime.harness/cordis.apiLevel/permissions/resources/lifecycle/security 字段 | 自动 |
| package.json | `manifest.test.mjs`：name/version/engines.node + exports["."]/["./client"]/["./package.json"] + dsh.client/dsh.bundle | 自动 |
| Bundle 原则 | `manifest.test.mjs`：cordis.patch.yml 仅 insert、不 replace Core row | 自动 |
| 静态安全 | `manifest.test.mjs`：源码不含 globalThis/window 赋值、prototype patch、as any、危险命令、硬编码密钥 | 自动 |
| Lifecycle | load → mount → destroy 可逆，重复 load/unload 无残留背景层/样式/路由 | 集成（dsh 运行时） |
| 可读性 | opacity+blur+mask 默认组合下正文对比度不受影响 | 目检（dsh 运行时） |
| Reduced Motion | 开启后 canvas 循环冻结、video 停到静态帧 | 目检（dsh 运行时） |
| 并发/隔离 | 多会话下背景层为全局唯一层，无跨会话状态 | 集成（dsh 运行时） |

> `dshpd_analyze` 为启发式静态扫描，非权威认证；Bronze/Silver/Gold 为工程化规范等级，非 DeepSeek 官方认证。
