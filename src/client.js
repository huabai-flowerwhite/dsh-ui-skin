// dsh-ui-skin — Client half（源码，ESM）
//
// 与 lib/client.js 功能等价；lib/client.js 是此源码经打包后的 factory-form
// bundle（window.__ModuleLoader__.load({ id, factory })，require("react")）。
// dsh-client-modules 实际加载的是 exports["./client"]（lib/client.js），本文件
// 作为可读源码供二次开发与未来构建（esbuild/rollup 打包成 factory-form）。
//
// 背景层注入：ctx.effect 内创建 <div data-dsh-ui-skin="background">，fixed/inset:0/
// z-index:0/pointer-events:none，插入 document.body 首部；disposer 负责 remove。
// 用 theme.overrideTokens 把 DSH 表面 token 烘焙为半透明（毛玻璃）让整个界面透出。
// 只保留「无 / 自定义」两类；自定义支持网络地址或本地文件（图片 data URL、视频 IndexedDB）、
// 拖动裁剪缩放、历史皮肤记录与可拖动悬浮窗。
//
// 安全：S1 / P1。仅用公开 ctx/slots/theme 能力，不修改业务 DOM、不改全局原型。

import React from 'react'

const BUILTIN_SKINS = [
  { id: 'none', name: '无', kind: 'none', description: '不使用背景（原版 UI）' },
  { id: 'custom', name: '自定义', kind: 'custom', description: '自定义壁纸图 / 视频：网络地址或本地文件' },
]

const BUILTIN_DEFAULTS = {
  none: { opacity: 0, blur: 0, mask: 0 },
  custom: { opacity: 0.5, blur: 0, mask: 0.12, customKind: 'wallpaper', customUrl: '', scale: 1.2, offsetX: 0.5, offsetY: 0.5 },
}

const SKIN_TOKENS = {
  '--dsw-alias-bg-base': { light: 'transparent', dark: 'transparent' },
  '--dsw-alias-bg-layer-1': { light: 'rgba(255,255,255,0.72)', dark: 'rgba(35,35,36,0.72)' },
  '--dsw-alias-bg-layer-2': { light: 'rgba(255,255,255,0.62)', dark: 'rgba(44,44,46,0.62)' },
  '--dsw-alias-bg-layer-3': { light: 'rgba(255,255,255,0.62)', dark: 'rgba(53,54,56,0.62)' },
  '--dsw-specific-sidebar-fill': { light: 'rgba(249,250,251,0.6)', dark: 'rgba(27,27,28,0.6)' },
  '--dsw-specific-input-major': { light: 'rgba(255,255,255,0.85)', dark: 'rgba(44,44,46,0.85)' },
  '--dsw-alias-bg-overlay': { light: 'rgba(233,236,242,0.85)', dark: 'rgba(97,102,107,0.85)' },
}

const STORAGE_KEY = 'dsh-ui-skin:config'
const HISTORY_KEY = 'dsh-ui-skin:history'
const IDB_NAME = 'dsh-ui-skin'
const IDB_STORE = 'videos'
const VIDEO_PREFIX = 'video:'
const HISTORY_LIMIT = 30

function defaultConfig() {
  return {
    skin: 'none', opacity: 0.5, blur: 0, mask: 0.12,
    customKind: 'wallpaper', customUrl: '', scale: 1.2, offsetX: 0.5, offsetY: 0.5, reduceMotion: 'auto',
  }
}

function loadConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object') {
        const base = defaultConfig()
        for (const k of Object.keys(base)) if (parsed[k] !== undefined) base[k] = parsed[k]
        return base
      }
    }
  } catch (e) { /* ignore */ }
  return defaultConfig()
}

function saveConfig(cfg) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg)) } catch (e) { /* ignore */ }
}

function clamp(v, lo, hi) {
  const n = Number(v)
  if (Number.isNaN(n)) return lo
  return Math.max(lo, Math.min(hi, n))
}

function nowId(prefix) {
  return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6)
}

function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    if (raw) {
      const arr = JSON.parse(raw)
      if (Array.isArray(arr)) return arr
    }
  } catch (e) { /* ignore */ }
  return []
}

function saveHistory(list) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list)) } catch (e) { /* ignore */ }
}

function addHistory(item) {
  const list = loadHistory()
  for (let i = 0; i < list.length; i++) {
    const same = list[i].kind === item.kind && (item.kind === 'video' ? list[i].id === item.id : list[i].customUrl === item.customUrl)
    if (same) { list.splice(i, 1); break }
  }
  list.unshift(item)
  if (list.length > HISTORY_LIMIT) list.length = HISTORY_LIMIT
  saveHistory(list)
}

function idbOpen() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('no indexedDB')); return }
    const req = indexedDB.open(IDB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function idbPut(key, blob) {
  return idbOpen().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite')
    tx.objectStore(IDB_STORE).put(blob, key)
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => { db.close(); reject(tx.error) }
    tx.onabort = () => { db.close(); reject(tx.error) }
  }))
}

function idbGet(key) {
  return idbOpen().then((db) => new Promise((resolve) => {
    const tx = db.transaction(IDB_STORE, 'readonly')
    const get = tx.objectStore(IDB_STORE).get(key)
    get.onsuccess = () => { db.close(); resolve(get.result || null) }
    get.onerror = () => { db.close(); resolve(null) }
  })).catch(() => null)
}

function createBackgroundEngine(theme) {
  let layer = null
  let content = null
  let maskEl = null
  let tokenDispose = null
  let videoObjectUrl = null
  let videoDispose = null
  let cfg = loadConfig()

  let mq = null
  try { mq = window.matchMedia('(prefers-reduced-motion: reduce)') } catch (e) { mq = null }

  function shouldReduce() {
    if (cfg.reduceMotion === 'on') return true
    if (cfg.reduceMotion === 'off') return false
    return mq ? mq.matches : false
  }

  function applyTokenOverride(on) {
    if (on && theme && typeof theme.overrideTokens === 'function') {
      if (!tokenDispose) tokenDispose = theme.overrideTokens('dsh-ui-skin', SKIN_TOKENS)
    } else if (tokenDispose) {
      tokenDispose()
      tokenDispose = null
    }
  }

  function stopVideo() {
    if (videoDispose) { try { videoDispose() } catch (e) { /* ignore */ } videoDispose = null }
    if (videoObjectUrl) { try { URL.revokeObjectURL(videoObjectUrl) } catch (e) { /* ignore */ } videoObjectUrl = null }
  }

  function clearContent() {
    stopVideo()
    if (content) { content.remove(); content = null }
    if (maskEl) { maskEl.remove(); maskEl = null }
  }

  function mountWallpaper(c) {
    let url = cfg.customUrl || ''
    if (url.indexOf(VIDEO_PREFIX) === 0) url = ''
    const w = document.createElement('div')
    w.style.cssText =
      'position:absolute;inset:0;background-image:url("' + url + '");' +
      'background-size:cover;background-repeat:no-repeat;' +
      'transform:scale(' + clamp(cfg.scale, 1, 4) + ');' +
      'transform-origin:' + (cfg.offsetX * 100).toFixed(1) + '% ' + (cfg.offsetY * 100).toFixed(1) + '%;'
    c.appendChild(w)
  }

  function mountVideo(c) {
    const v = document.createElement('video')
    v.autoplay = true; v.muted = true; v.loop = true; v.playsInline = true
    v.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;' +
      'transform:scale(' + clamp(cfg.scale, 1, 4) + ');' +
      'transform-origin:' + (cfg.offsetX * 100).toFixed(1) + '% ' + (cfg.offsetY * 100).toFixed(1) + '%;'
    c.appendChild(v)

    const src = cfg.customUrl || ''
    if (src.indexOf(VIDEO_PREFIX) === 0) {
      idbGet(src.slice(VIDEO_PREFIX.length)).then((blob) => {
        if (blob) {
          videoObjectUrl = URL.createObjectURL(blob)
          v.src = videoObjectUrl
          if (shouldReduce()) v.pause()
        }
      })
    } else {
      v.src = src
      if (shouldReduce()) v.pause()
    }
    videoDispose = () => { try { v.pause() } catch (e) { /* ignore */ } v.remove() }
  }

  function render() {
    clearContent()
    if (cfg.skin === 'none') return
    content = document.createElement('div')
    content.style.cssText = 'position:absolute;inset:0;overflow:hidden;'
    layer.appendChild(content)

    if (cfg.customKind === 'video') mountVideo(content)
    else mountWallpaper(content)

    maskEl = document.createElement('div')
    maskEl.style.cssText = 'position:absolute;inset:0;background:#000;opacity:' + clamp(cfg.mask, 0, 1).toFixed(3) + ';'
    content.appendChild(maskEl)
  }

  function applySkin(next) {
    const base = defaultConfig()
    for (const k of Object.keys(base)) if (next && next[k] !== undefined) base[k] = next[k]
    cfg = base
    saveConfig(cfg)
    applyTokenOverride(cfg.skin !== 'none')
    if (layer) {
      layer.style.opacity = clamp(cfg.opacity, 0, 1).toFixed(3)
      layer.style.filter = cfg.blur > 0 ? 'blur(' + clamp(cfg.blur, 0, 40) + 'px)' : 'none'
      render()
    }
  }

  function mount() {
    if (layer) return
    layer = document.createElement('div')
    layer.setAttribute('data-dsh-ui-skin', 'background')
    layer.style.cssText =
      'position:fixed;inset:0;z-index:0;pointer-events:none;overflow:hidden;' +
      'opacity:' + clamp(cfg.opacity, 0, 1).toFixed(3) + ';' +
      (cfg.blur > 0 ? 'filter:blur(' + clamp(cfg.blur, 0, 40) + 'px);' : '')
    document.body.insertBefore(layer, document.body.firstChild)
    applyTokenOverride(cfg.skin !== 'none')
    render()
  }

  function destroy() {
    applyTokenOverride(false)
    clearContent()
    if (layer) { layer.remove(); layer = null }
  }

  function getState() { return { ...cfg } }

  return { mount, destroy, applySkin, getState }
}

function h(tag, props, kids) {
  return React.createElement(tag, props, ...(Array.isArray(kids) ? kids : [kids]))
}

const css = {
  panel: { fontFamily: 'inherit', padding: '4px 0', lineHeight: '1.6' },
  h3: { margin: '0 0 6px', fontSize: 15, fontWeight: 600 },
  lead: { opacity: 0.72, fontSize: 13, marginBottom: 10 },
  row: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid rgba(128,128,128,0.18)' },
  label: { flex: '0 0 76px', fontSize: 13, opacity: 0.85 },
  range: { flex: '1 1 auto' },
  value: { flex: '0 0 44px', textAlign: 'right', fontSize: 12, opacity: 0.7, fontVariantNumeric: 'tabular-nums' },
  select: { border: '1px solid #ccc', background: '#fff', color: '#222', borderRadius: 6, padding: '4px 8px', fontSize: 13 },
  input: { flex: '1 1 auto', minWidth: 0, border: '1px solid #ccc', background: '#fff', color: '#222', borderRadius: 6, padding: '5px 8px', fontSize: 13 },
  skinBtn: { border: '1px solid #ccc', background: '#f5f5f5', color: '#222', borderRadius: 999, padding: '5px 14px', cursor: 'pointer', fontSize: 13, whiteSpace: 'nowrap' },
  skinBtnActive: { border: '1px solid #2563eb', background: '#2563eb', color: '#fff', borderRadius: 999, padding: '5px 14px', cursor: 'pointer', fontSize: 13, whiteSpace: 'nowrap' },
  skinWrap: { display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  desc: { fontSize: 12, opacity: 0.65, margin: '2px 0 10px' },
  note: { fontSize: 12, opacity: 0.6, marginTop: 12 },
  btn: { border: '1px solid #ccc', background: '#f5f5f5', color: '#222', borderRadius: 6, padding: '5px 10px', cursor: 'pointer', fontSize: 13, whiteSpace: 'nowrap' },
  preview: { position: 'relative', height: 150, borderRadius: 8, border: '1px solid rgba(128,128,128,0.3)', overflow: 'hidden', cursor: 'grab', background: '#1a1a1a', marginBottom: 4 },
  thumb: { width: 56, height: 40, objectFit: 'cover', borderRadius: 4, border: '1px solid rgba(128,128,128,0.3)', cursor: 'pointer', flex: '0 0 auto' },
  histRow: { display: 'flex', gap: 8, overflowX: 'auto', padding: '4px 0 8px' },
}

function RangeRow(props) {
  return h('div', { style: css.row }, [
    h('span', { style: css.label }, props.label),
    h('input', {
      type: 'range', min: props.min, max: props.max, step: props.step, value: props.value, style: css.range,
      onChange: (e) => props.onChange(Number(e.target.value)),
    }),
    h('span', { style: css.value }, props.value),
  ])
}

function compressImage(file, maxW, callback) {
  const url = URL.createObjectURL(file)
  const img = new Image()
  img.onload = () => {
    try {
      const scale = Math.min(1, maxW / img.width)
      const c = document.createElement('canvas')
      c.width = Math.max(1, Math.round(img.width * scale))
      c.height = Math.max(1, Math.round(img.height * scale))
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
      callback(c.toDataURL('image/jpeg', 0.85))
    } catch (e) { callback(null) }
    URL.revokeObjectURL(url)
  }
  img.onerror = () => { URL.revokeObjectURL(url); callback(null) }
  img.src = url
}

function thumbUrlOf(cfg) {
  const u = cfg.customUrl || ''
  if (u.indexOf(VIDEO_PREFIX) === 0) return null
  if (u.indexOf('data:') === 0 || u.indexOf('http') === 0) return u
  return null
}

function SettingsPanel(props) {
  const engine = props.engine
  const [cfg, setCfg] = React.useState(engine.getState())
  const [history, setHistory] = React.useState(loadHistory())
  const [busy, setBusy] = React.useState(false)
  const cfgRef = React.useRef(cfg)
  const fileInputRef = React.useRef(null)
  const dragRef = React.useRef(null)

  React.useEffect(() => {
    fetch('/dsh-ui-skin/skins').then((r) => r.json()).catch(() => { /* 忽略 */ })
  }, [])

  function update(patch) {
    const next = { ...cfgRef.current, ...patch }
    cfgRef.current = next
    setCfg(next)
    engine.applySkin(next)
  }

  function setSkin(id) {
    const d = BUILTIN_DEFAULTS[id] || {}
    update({ ...d, skin: id })
  }

  function pickLocalFile() {
    if (fileInputRef.current) fileInputRef.current.click()
  }

  function onFileChange(e) {
    const file = e.target.files && e.target.files[0]
    if (!file) return
    const type = file.type || ''
    const name = file.name || ''
    if (type.indexOf('video') === 0) {
      setBusy(true)
      const vid = nowId('vid')
      idbPut(vid, file).then(() => {
        const mark = VIDEO_PREFIX + vid
        update({ customKind: 'video', customUrl: mark })
        addHistory({ id: vid, name, kind: 'video', ts: Date.now(), customUrl: mark })
        setHistory(loadHistory())
        setBusy(false)
      }).catch(() => setBusy(false))
    } else if (type.indexOf('image') === 0) {
      setBusy(true)
      compressImage(file, 1920, (dataUrl) => {
        if (dataUrl) {
          update({ customKind: 'wallpaper', customUrl: dataUrl })
          addHistory({ id: nowId('img'), name, kind: 'image', ts: Date.now(), customUrl: dataUrl })
          setHistory(loadHistory())
        }
        setBusy(false)
      })
    }
    e.target.value = ''
  }

  function applyHistory(item) {
    update({ skin: 'custom', customKind: item.kind === 'video' ? 'video' : 'wallpaper', customUrl: item.customUrl })
  }

  function onPreviewMouseDown(e) {
    const rect = e.currentTarget.getBoundingClientRect()
    const d = { sx: e.clientX, sy: e.clientY, ox: cfgRef.current.offsetX, oy: cfgRef.current.offsetY, w: rect.width || 1, h: rect.height || 1 }
    dragRef.current = d
    function move(ev) {
      const dd = dragRef.current
      if (!dd) return
      const dx = (ev.clientX - dd.sx) / dd.w
      const dy = (ev.clientY - dd.sy) / dd.h
      update({ offsetX: clamp(dd.ox - dx, 0, 1), offsetY: clamp(dd.oy - dy, 0, 1) })
    }
    function up() { dragRef.current = null; window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  function onPreviewWheel(e) {
    const delta = e.deltaY > 0 ? -0.1 : 0.1
    update({ scale: clamp(cfgRef.current.scale + delta, 1, 4) })
  }

  function previewStyle() {
    const url = thumbUrlOf(cfg)
    const bg = url ? 'url("' + url + '")' : 'linear-gradient(135deg,#1a1a2e,#16213e)'
    return {
      position: 'absolute', inset: 0,
      backgroundImage: bg, backgroundSize: 'cover',
      transform: 'scale(' + cfg.scale + ')',
      transformOrigin: (cfg.offsetX * 100).toFixed(1) + '% ' + (cfg.offsetY * 100).toFixed(1) + '%',
    }
  }

  const isCustom = cfg.skin === 'custom'

  return h('div', { style: css.panel }, [
    h('h3', { style: css.h3 }, 'UI 皮肤'),
    h('div', { style: css.lead }, '在 UI 下方注入壁纸 / 视频背景，界面表面半透明（毛玻璃）透出；支持裁剪缩放、历史记录与悬浮窗。'),

    h('div', { style: css.skinWrap }, BUILTIN_SKINS.map((s) =>
      h('button', { key: s.id, style: s.id === cfg.skin ? css.skinBtnActive : css.skinBtn, onClick: () => setSkin(s.id) }, s.name),
    )),

    isCustom
      ? h('div', { style: css.row }, [
          h('span', { style: css.label }, '类型'),
          h('select', { style: css.select, value: cfg.customKind, onChange: (e) => update({ customKind: e.target.value }) }, [
            h('option', { value: 'wallpaper', key: 'w' }, '壁纸图'),
            h('option', { value: 'video', key: 'v' }, '视频'),
          ]),
        ])
      : null,

    isCustom
      ? h('div', { style: css.row }, [
          h('span', { style: css.label }, '网络地址'),
          h('input', {
            style: css.input,
            placeholder: 'https://…/background.webp 或 .mp4/.webm',
            value: cfg.customUrl.indexOf(VIDEO_PREFIX) === 0 ? '' : cfg.customUrl,
            onChange: (e) => update({ customUrl: e.target.value }),
          }),
        ])
      : null,

    isCustom
      ? h('div', { style: css.row }, [
          h('span', { style: css.label }, '本地文件'),
          h('button', { style: css.btn, onClick: pickLocalFile, disabled: busy }, busy ? '处理中…' : '选择图片/视频'),
          h('input', { type: 'file', ref: fileInputRef, accept: 'image/*,video/*', style: { display: 'none' }, onChange: onFileChange }),
          cfg.customUrl.indexOf(VIDEO_PREFIX) === 0 ? h('span', { style: css.value }, '本地视频') : null,
        ])
      : null,

    isCustom
      ? h('div', { style: { padding: '6px 0' } }, [
          h('div', { style: { fontSize: 13, opacity: 0.85, marginBottom: 4 } }, '呈现范围（拖动裁剪位置，滚轮/滑块缩放）'),
          h('div', { style: css.preview, onMouseDown: onPreviewMouseDown, onWheel: onPreviewWheel }, [
            h('div', { style: previewStyle() }),
            h('div', { style: { position: 'absolute', left: 6, bottom: 6, fontSize: 11, background: 'rgba(0,0,0,0.6)', color: '#fff', padding: '1px 6px', borderRadius: 4 } }, '拖动裁剪 · 滚轮缩放'),
          ]),
          h(RangeRow, { label: '缩放', min: 1, max: 4, step: 0.05, value: cfg.scale, onChange: (v) => update({ scale: v }) }),
          h(RangeRow, { label: '横向', min: 0, max: 1, step: 0.01, value: cfg.offsetX, onChange: (v) => update({ offsetX: v }) }),
          h(RangeRow, { label: '纵向', min: 0, max: 1, step: 0.01, value: cfg.offsetY, onChange: (v) => update({ offsetY: v }) }),
        ])
      : null,

    history.length > 0
      ? h('div', { style: { padding: '6px 0' } }, [
          h('div', { style: { fontSize: 13, opacity: 0.85, marginBottom: 4 } }, '历史皮肤（点击切换）'),
          h('div', { style: css.histRow }, history.map((item) =>
            item.kind === 'image'
              ? h('img', { key: item.id, src: item.customUrl, title: item.name, style: css.thumb, onClick: () => applyHistory(item) })
              : h('button', { key: item.id, title: item.name, style: { ...css.thumb, background: '#222', color: '#fff', fontSize: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }, onClick: () => applyHistory(item) }, '▶'),
          )),
        ])
      : null,

    cfg.skin !== 'none' ? h(RangeRow, { label: '透明度', min: 0, max: 1, step: 0.05, value: cfg.opacity, onChange: (v) => update({ opacity: v }) }) : null,
    cfg.skin !== 'none' ? h(RangeRow, { label: '模糊', min: 0, max: 40, step: 1, value: cfg.blur, onChange: (v) => update({ blur: v }) }) : null,
    cfg.skin !== 'none' ? h(RangeRow, { label: '遮罩', min: 0, max: 1, step: 0.05, value: cfg.mask, onChange: (v) => update({ mask: v }) }) : null,

    h('div', { style: css.row }, [
      h('span', { style: css.label }, '减少动效'),
      h('select', { style: css.select, value: cfg.reduceMotion, onChange: (e) => update({ reduceMotion: e.target.value }) }, [
        h('option', { value: 'auto', key: 'a' }, '自动（跟随系统）'),
        h('option', { value: 'on', key: 'on' }, '开启'),
        h('option', { value: 'off', key: 'off' }, '关闭'),
      ]),
    ]),

    h('div', { style: css.row }, [
      h('span', { style: css.label }, '悬浮窗'),
      h('button', { style: css.btn, onClick: () => { if (props.onOpenFloat) props.onOpenFloat() } }, '展开悬浮窗'),
    ]),

    h('div', { style: css.note }, '本地图片压缩后存 localStorage，本地视频存 IndexedDB；配置与历史保存在浏览器，清除站点数据会丢失。'),
  ])
}

function FloatingPanel(props) {
  const engine = props.engine
  const [cfg, setCfg] = React.useState(engine.getState())
  const [pos, setPos] = React.useState({ x: Math.max(20, (typeof window !== 'undefined' ? window.innerWidth : 800) - 300), y: 100 })
  const cfgRef = React.useRef(cfg)
  const dragRef = React.useRef(null)

  function update(patch) {
    const next = { ...cfgRef.current, ...patch }
    cfgRef.current = next
    setCfg(next)
    engine.applySkin(next)
  }

  function setSkin(id) {
    const d = BUILTIN_DEFAULTS[id] || {}
    update({ ...d, skin: id })
  }

  function onHeaderDown(e) {
    const d = { sx: e.clientX, sy: e.clientY, x: pos.x, y: pos.y }
    dragRef.current = d
    function move(ev) { setPos({ x: d.x + (ev.clientX - d.sx), y: d.y + (ev.clientY - d.sy) }) }
    function up() { dragRef.current = null; window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const panelStyle = {
    position: 'fixed', left: pos.x, top: pos.y, zIndex: 1000, width: 260,
    background: 'var(--dsw-alias-bg-layer-2, #fff)', color: 'var(--dsw-alias-label-primary, #222)',
    border: '1px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.1))', borderRadius: 10,
    boxShadow: '0 8px 30px rgba(0,0,0,0.2)', fontSize: 13,
  }
  const headerStyle = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', cursor: 'move', borderBottom: '1px solid rgba(128,128,128,0.2)' }
  const bodyStyle = { padding: '10px' }

  return h('div', { style: panelStyle }, [
    h('div', { style: headerStyle, onMouseDown: onHeaderDown }, [
      h('span', { style: { fontWeight: 600 } }, 'UI 皮肤'),
      h('button', { style: { border: 'none', background: 'transparent', cursor: 'pointer', color: 'inherit', fontSize: 16 }, onClick: props.onClose }, '×'),
    ]),
    h('div', { style: bodyStyle }, [
      h('div', { style: css.skinWrap }, BUILTIN_SKINS.map((s) =>
        h('button', { key: s.id, style: s.id === cfg.skin ? css.skinBtnActive : css.skinBtn, onClick: () => setSkin(s.id) }, s.name),
      )),
      cfg.skin !== 'none' ? h(RangeRow, { label: '透明度', min: 0, max: 1, step: 0.05, value: cfg.opacity, onChange: (v) => update({ opacity: v }) }) : null,
      cfg.skin !== 'none' ? h(RangeRow, { label: '遮罩', min: 0, max: 1, step: 0.05, value: cfg.mask, onChange: (v) => update({ mask: v }) }) : null,
      h('div', { style: css.note }, '拖动标题栏移动；完整设置在「设置 → UI 皮肤」。'),
    ]),
  ])
}

export default {
  inject: ['slots'],

  apply(ctx) {
    const slots = ctx.slots
    const theme = ctx.get('theme')
    const engine = createBackgroundEngine(theme)
    let floatShow = null

    ctx.effect(() => {
      engine.mount()
      return () => engine.destroy()
    })

    slots.inject('shell.overlay', () =>
      slots.register(
        { name: 'shell.overlay', id: 'dsh-ui-skin-float', order: 1000, label: 'UI 皮肤悬浮窗' },
        () => {
          const [open, setOpen] = React.useState(false)
          floatShow = () => setOpen(true)
          if (!open) return null
          return React.createElement(FloatingPanel, { engine, onClose: () => setOpen(false) })
        },
      ),
    )

    slots.inject('settings.section', () =>
      slots.register(
        { name: 'settings.section', id: 'dsh-ui-skin', order: 120, label: 'UI 皮肤' },
        () => React.createElement(SettingsPanel, { engine, onOpenFloat: () => { if (floatShow) floatShow() } }),
      ),
    )
  },
}
