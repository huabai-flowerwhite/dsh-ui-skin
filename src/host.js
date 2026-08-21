// dsh-ui-skin — Host half
//
// 提供：
//   - `skin_list` 工具（只读，列出内置皮肤清单与默认配置）
//   - `/dsh-ui-skin/skins` 本地路由（Client 设置页 fetch 皮肤清单）
//
// 本文件是纯 ESM 模块（无 bundler）。使用 ctx.tools.register 的 raw ToolDefinition，
// 不 import '@deepseek-ai/dsh-tools'（工作区目录无法解析 harness 内部依赖）。
//
// 安全：S1 / P1。不读不写文件、不发外部网络、不跑 shell，不含任何密钥。

// 内置皮肤清单（与 Client 半体共享；Client 也可 fetch 本路由获取同一份数据）。
const SKINS = [
  { id: 'none', name: '无', kind: 'none', description: '不使用背景（原版 UI）' },
  { id: 'custom', name: '自定义', kind: 'custom', description: '自定义壁纸图 / 视频：网络地址或本地文件' },
]

// 每种皮肤的默认配置。
const SKIN_DEFAULTS = {
  none: { opacity: 0, blur: 0, mask: 0 },
  custom: { opacity: 0.5, blur: 0, mask: 0.12, customKind: 'wallpaper', customUrl: '', scale: 1.2, offsetX: 0.5, offsetY: 0.5 },
}

function renderText(_args, value) {
  return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
}

export default {
  inject: ['tools', 'webServer'],

  apply(ctx) {
    const tools = ctx.tools
    const webServer = ctx.webServer

    function reg(name, description, properties, required, execute) {
      const parameters = { type: 'object', properties }
      if (required && required.length > 0) parameters.required = required
      tools.register({
        name,
        description,
        parameters,
        output: {
          schema: { type: 'object' },
          render: renderText,
        },
        async execute(args, exec) {
          try {
            return await execute(args, exec)
          } catch (e) {
            return { error: String(e && e.message ? e.message : e) }
          }
        },
      })
    }

    // ---- skin_list 工具（只读）----
    reg(
      'skin_list',
      'List the built-in UI skin presets of the dsh-ui-skin plugin and their default parameters. Read-only; returns the same catalog the Client settings panel uses.',
      {},
      [],
      async () => ({ skins: SKINS, defaults: SKIN_DEFAULTS }),
    )

    // ---- /dsh-ui-skin/skins 本地路由（Client 设置页读取皮肤清单）----
    ctx.effect(() =>
      webServer.register({
        kind: 'exact',
        path: '/dsh-ui-skin/skins',
        handler: async (req, res) => {
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ skins: SKINS, defaults: SKIN_DEFAULTS }))
        },
      }),
    )
  },
}
