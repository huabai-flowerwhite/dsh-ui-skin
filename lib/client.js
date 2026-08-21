window.__ModuleLoader__.load({
  id: "dsh-ui-skin",
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    var React = require("react");

    // ------------------------------------------------------------------
    // 皮肤模型：只保留「无」与「自定义」两类。
    // ------------------------------------------------------------------
    var BUILTIN_SKINS = [
      { id: "none", name: "无", kind: "none", description: "不使用背景（原版 UI）" },
      { id: "custom", name: "自定义", kind: "custom", description: "自定义壁纸图 / 视频：网络地址或本地文件" },
    ];
    var BUILTIN_DEFAULTS = {
      none: { opacity: 0, blur: 0, mask: 0 },
      custom: { opacity: 0.5, blur: 0, mask: 0.12, customKind: "wallpaper", customUrl: "", scale: 1.2, offsetX: 0.5, offsetY: 0.5 },
    };

    // ------------------------------------------------------------------
    // 毛玻璃 token 覆盖：把 DSH 表面烘焙为半透明，让整个界面（含侧栏）透出背景。
    // ------------------------------------------------------------------
    var SKIN_TOKENS = {
      "--dsw-alias-bg-base": { light: "transparent", dark: "transparent" },
      "--dsw-alias-bg-layer-1": { light: "rgba(255,255,255,0.72)", dark: "rgba(35,35,36,0.72)" },
      "--dsw-alias-bg-layer-2": { light: "rgba(255,255,255,0.62)", dark: "rgba(44,44,46,0.62)" },
      "--dsw-alias-bg-layer-3": { light: "rgba(255,255,255,0.62)", dark: "rgba(53,54,56,0.62)" },
      "--dsw-specific-sidebar-fill": { light: "rgba(249,250,251,0.6)", dark: "rgba(27,27,28,0.6)" },
      "--dsw-specific-input-major": { light: "rgba(255,255,255,0.85)", dark: "rgba(44,44,46,0.85)" },
      "--dsw-alias-bg-overlay": { light: "rgba(233,236,242,0.85)", dark: "rgba(97,102,107,0.85)" },
    };

    var STORAGE_KEY = "dsh-ui-skin:config";
    var HISTORY_KEY = "dsh-ui-skin:history";
    var IDB_NAME = "dsh-ui-skin";
    var IDB_STORE = "videos";
    var VIDEO_PREFIX = "video:";
    var HISTORY_LIMIT = 30;

    function defaultConfig() {
      return {
        skin: "none",
        opacity: 0.5,
        blur: 0,
        mask: 0.12,
        customKind: "wallpaper",
        customUrl: "",
        scale: 1.2,
        offsetX: 0.5,
        offsetY: 0.5,
        reduceMotion: "auto",
      };
    }

    function loadConfig() {
      try {
        var raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          var parsed = JSON.parse(raw);
          if (parsed && typeof parsed === "object") {
            var base = defaultConfig();
            for (var k in base) if (parsed[k] !== undefined) base[k] = parsed[k];
            return base;
          }
        }
      } catch (e) { /* ignore */ }
      return defaultConfig();
    }

    function saveConfig(cfg) {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg)); } catch (e) { /* ignore */ }
    }

    function clamp(v, lo, hi) {
      var n = Number(v);
      if (isNaN(n)) return lo;
      return Math.max(lo, Math.min(hi, n));
    }

    function nowId(prefix) {
      return prefix + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6);
    }

    // ------------------------------------------------------------------
    // 历史记录（图片 data URL 存 localStorage；视频 Blob 存 IndexedDB）
    // ------------------------------------------------------------------
    function loadHistory() {
      try {
        var raw = localStorage.getItem(HISTORY_KEY);
        if (raw) {
          var arr = JSON.parse(raw);
          if (Array.isArray(arr)) return arr;
        }
      } catch (e) { /* ignore */ }
      return [];
    }

    function saveHistory(list) {
      try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list)); } catch (e) { /* ignore */ }
    }

    function addHistory(item) {
      var list = loadHistory();
      for (var i = 0; i < list.length; i++) {
        var same = list[i].kind === item.kind &&
          (item.kind === "video" ? list[i].id === item.id : list[i].customUrl === item.customUrl);
        if (same) { list.splice(i, 1); break; }
      }
      list.unshift(item);
      if (list.length > HISTORY_LIMIT) list.length = HISTORY_LIMIT;
      saveHistory(list);
    }

    // 从 config 提取皮肤设定快照（供历史记录保存）
    function snapshotOf(cfg) {
      return {
        scale: cfg.scale, offsetX: cfg.offsetX, offsetY: cfg.offsetY,
        opacity: cfg.opacity, blur: cfg.blur, mask: cfg.mask, customKind: cfg.customKind,
      };
    }

    // 同步当前活动历史条目的设定快照（用户调整设定后自动记住，300ms 防抖避免高频写）
    function syncHistorySnapshot(cfg) {
      if (!cfg || cfg.skin !== "custom" || !cfg.customUrl) return;
      var list = loadHistory();
      var changed = false;
      for (var i = 0; i < list.length; i++) {
        if (list[i].customUrl === cfg.customUrl) {
          list[i].scale = cfg.scale;
          list[i].offsetX = cfg.offsetX;
          list[i].offsetY = cfg.offsetY;
          list[i].opacity = cfg.opacity;
          list[i].blur = cfg.blur;
          list[i].mask = cfg.mask;
          list[i].customKind = cfg.customKind;
          changed = true;
          break;
        }
      }
      if (changed) saveHistory(list);
    }

    var syncTimer = null;
    function scheduleHistorySync(cfg) {
      if (syncTimer) clearTimeout(syncTimer);
      syncTimer = setTimeout(function () { syncHistorySnapshot(cfg); }, 300);
    }

    function idbOpen() {
      return new Promise(function (resolve, reject) {
        if (typeof indexedDB === "undefined") { reject(new Error("no indexedDB")); return; }
        var req = indexedDB.open(IDB_NAME, 1);
        req.onupgradeneeded = function () {
          var db = req.result;
          if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
        };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      });
    }

    function idbPut(key, blob) {
      return idbOpen().then(function (db) {
        return new Promise(function (resolve, reject) {
          var tx = db.transaction(IDB_STORE, "readwrite");
          tx.objectStore(IDB_STORE).put(blob, key);
          tx.oncomplete = function () { db.close(); resolve(); };
          tx.onerror = function () { db.close(); reject(tx.error); };
          tx.onabort = function () { db.close(); reject(tx.error); };
        });
      });
    }

    function idbGet(key) {
      return idbOpen().then(function (db) {
        return new Promise(function (resolve) {
          var tx = db.transaction(IDB_STORE, "readonly");
          var get = tx.objectStore(IDB_STORE).get(key);
          get.onsuccess = function () { db.close(); resolve(get.result || null); };
          get.onerror = function () { db.close(); resolve(null); };
        });
      }).catch(function () { return null; });
    }

    // ------------------------------------------------------------------
    // BackgroundEngine：固定背景层 + 裁剪缩放 + token override
    // ------------------------------------------------------------------
    function createBackgroundEngine(theme) {
      var layer = null;
      var content = null;
      var maskEl = null;
      var tokenDispose = null;
      var videoObjectUrl = null;
      var videoDispose = null;
      var cfg = loadConfig();

      var mq = null;
      try { mq = window.matchMedia("(prefers-reduced-motion: reduce)"); } catch (e) { mq = null; }

      function shouldReduce() {
        if (cfg.reduceMotion === "on") return true;
        if (cfg.reduceMotion === "off") return false;
        return mq ? mq.matches : false;
      }

      function applyTokenOverride(on) {
        if (on && theme && typeof theme.overrideTokens === "function") {
          if (!tokenDispose) tokenDispose = theme.overrideTokens("dsh-ui-skin", SKIN_TOKENS);
        } else if (tokenDispose) {
          tokenDispose();
          tokenDispose = null;
        }
      }

      function stopVideo() {
        if (videoDispose) { try { videoDispose(); } catch (e) { /* ignore */ } videoDispose = null; }
        if (videoObjectUrl) { try { URL.revokeObjectURL(videoObjectUrl); } catch (e) { /* ignore */ } videoObjectUrl = null; }
      }

      function clearContent() {
        stopVideo();
        if (content) { content.remove(); content = null; }
        if (maskEl) { maskEl.remove(); maskEl = null; }
      }

      function mountWallpaper(c) {
        var url = cfg.customUrl || "";
        if (url.indexOf(VIDEO_PREFIX) === 0) url = "";
        var w = document.createElement("div");
        w.style.cssText =
          "position:absolute;inset:0;" +
          "background-image:url('" + url + "');" +
          "background-size:cover;background-repeat:no-repeat;" +
          "transform:scale(" + clamp(cfg.scale, 1, 4) + ");" +
          "transform-origin:" + (cfg.offsetX * 100).toFixed(1) + "% " + (cfg.offsetY * 100).toFixed(1) + "%;";
        c.appendChild(w);
      }

      function mountVideo(c) {
        var v = document.createElement("video");
        v.autoplay = true;
        v.muted = true;
        v.loop = true;
        v.playsInline = true;
        v.style.cssText =
          "position:absolute;inset:0;width:100%;height:100%;object-fit:cover;" +
          "transform:scale(" + clamp(cfg.scale, 1, 4) + ");" +
          "transform-origin:" + (cfg.offsetX * 100).toFixed(1) + "% " + (cfg.offsetY * 100).toFixed(1) + "%;";
        c.appendChild(v);

        var src = cfg.customUrl || "";
        if (src.indexOf(VIDEO_PREFIX) === 0) {
          idbGet(src.slice(VIDEO_PREFIX.length)).then(function (blob) {
            if (blob) {
              videoObjectUrl = URL.createObjectURL(blob);
              v.src = videoObjectUrl;
              if (shouldReduce()) v.pause();
            }
          });
        } else {
          v.src = src;
          if (shouldReduce()) v.pause();
        }
        videoDispose = function () { try { v.pause(); } catch (e) { /* ignore */ } v.remove(); };
      }

      function render() {
        clearContent();
        if (cfg.skin === "none") return;
        content = document.createElement("div");
        content.style.cssText = "position:absolute;inset:0;overflow:hidden;";
        layer.appendChild(content);

        if (cfg.customKind === "video") {
          mountVideo(content);
        } else {
          mountWallpaper(content);
        }

        maskEl = document.createElement("div");
        maskEl.style.cssText = "position:absolute;inset:0;background:#000;opacity:" + clamp(cfg.mask, 0, 1).toFixed(3) + ";";
        content.appendChild(maskEl);
      }

      function applySkin(next) {
        var base = defaultConfig();
        for (var k in base) if (next && next[k] !== undefined) base[k] = next[k];
        cfg = base;
        saveConfig(cfg);
        scheduleHistorySync(cfg);
        applyTokenOverride(cfg.skin !== "none");
        if (layer) {
          layer.style.opacity = clamp(cfg.opacity, 0, 1).toFixed(3);
          layer.style.filter = cfg.blur > 0 ? "blur(" + clamp(cfg.blur, 0, 40) + "px)" : "none";
          render();
        }
      }

      function mount() {
        if (layer) return;
        layer = document.createElement("div");
        layer.setAttribute("data-dsh-ui-skin", "background");
        layer.style.cssText =
          "position:fixed;inset:0;z-index:0;pointer-events:none;overflow:hidden;" +
          "opacity:" + clamp(cfg.opacity, 0, 1).toFixed(3) + ";" +
          (cfg.blur > 0 ? "filter:blur(" + clamp(cfg.blur, 0, 40) + "px);" : "");
        document.body.insertBefore(layer, document.body.firstChild);
        applyTokenOverride(cfg.skin !== "none");
        render();
      }

      function destroy() {
        applyTokenOverride(false);
        clearContent();
        if (layer) { layer.remove(); layer = null; }
      }

      function getState() {
        var out = {};
        for (var k in cfg) out[k] = cfg[k];
        return out;
      }

      return { mount: mount, destroy: destroy, applySkin: applySkin, getState: getState };
    }

    // ------------------------------------------------------------------
    // 共用工具（React 渲染 + 文件处理）
    // ------------------------------------------------------------------
    function h(tag, props, kids) {
      return React.createElement(tag, props, ...(Array.isArray(kids) ? kids : [kids]));
    }

    var css = {
      panel: { fontFamily: "inherit", padding: "4px 0", lineHeight: "1.6" },
      h3: { margin: "0 0 6px", fontSize: 15, fontWeight: 600 },
      lead: { opacity: 0.72, fontSize: 13, marginBottom: 10 },
      row: { display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid rgba(128,128,128,0.18)" },
      label: { flex: "0 0 76px", fontSize: 13, opacity: 0.85 },
      range: { flex: "1 1 auto" },
      value: { flex: "0 0 44px", textAlign: "right", fontSize: 12, opacity: 0.7, fontVariantNumeric: "tabular-nums" },
      select: { border: "1px solid #ccc", background: "#fff", color: "#222", borderRadius: 6, padding: "4px 8px", fontSize: 13 },
      input: { flex: "1 1 auto", minWidth: 0, border: "1px solid #ccc", background: "#fff", color: "#222", borderRadius: 6, padding: "5px 8px", fontSize: 13 },
      skinBtn: { border: "1px solid #ccc", background: "#f5f5f5", color: "#222", borderRadius: 999, padding: "5px 14px", cursor: "pointer", fontSize: 13, whiteSpace: "nowrap" },
      skinBtnActive: { border: "1px solid #2563eb", background: "#2563eb", color: "#fff", borderRadius: 999, padding: "5px 14px", cursor: "pointer", fontSize: 13, whiteSpace: "nowrap" },
      skinWrap: { display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 },
      desc: { fontSize: 12, opacity: 0.65, margin: "2px 0 10px" },
      note: { fontSize: 12, opacity: 0.6, marginTop: 12 },
      btn: { border: "1px solid #ccc", background: "#f5f5f5", color: "#222", borderRadius: 6, padding: "5px 10px", cursor: "pointer", fontSize: 13, whiteSpace: "nowrap" },
      preview: { position: "relative", height: 150, borderRadius: 8, border: "1px solid rgba(128,128,128,0.3)", overflow: "hidden", cursor: "grab", background: "#1a1a1a", marginBottom: 4 },
      thumb: { width: 56, height: 40, objectFit: "cover", borderRadius: 4, border: "1px solid rgba(128,128,128,0.3)", cursor: "pointer", flex: "0 0 auto" },
      histRow: { display: "flex", gap: 8, overflowX: "auto", padding: "4px 0 8px" },
    };

    function RangeRow(props) {
      return h("div", { style: css.row }, [
        h("span", { style: css.label }, props.label),
        h("input", {
          type: "range", min: props.min, max: props.max, step: props.step, value: props.value, style: css.range,
          onChange: function (e) { props.onChange(Number(e.target.value)); },
        }),
        h("span", { style: css.value }, props.value),
      ]);
    }

    function compressImage(file, maxW, callback) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        try {
          var scale = Math.min(1, maxW / img.width);
          var c = document.createElement("canvas");
          c.width = Math.max(1, Math.round(img.width * scale));
          c.height = Math.max(1, Math.round(img.height * scale));
          c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
          callback(c.toDataURL("image/jpeg", 0.85));
        } catch (e) { callback(null); }
        URL.revokeObjectURL(url);
      };
      img.onerror = function () { URL.revokeObjectURL(url); callback(null); };
      img.src = url;
    }

    function thumbUrlOf(cfg) {
      var u = cfg.customUrl || "";
      if (u.indexOf(VIDEO_PREFIX) === 0) return null;
      if (u.indexOf("data:") === 0 || u.indexOf("http") === 0) return u;
      return null;
    }

    // ------------------------------------------------------------------
    // SettingsPanel
    // ------------------------------------------------------------------
    function SettingsPanel(props) {
      var engine = props.engine;
      var [cfg, setCfg] = React.useState(engine.getState());
      var [history, setHistory] = React.useState(loadHistory());
      var [busy, setBusy] = React.useState(false);
      var cfgRef = React.useRef(cfg);
      var fileInputRef = React.useRef(null);
      var dragRef = React.useRef(null);

      React.useEffect(function () {
        fetch("/dsh-ui-skin/skins").then(function (r) { return r.json(); }).catch(function () { /* 忽略 */ });
      }, []);

      function update(patch) {
        var next = {};
        for (var k in cfgRef.current) next[k] = cfgRef.current[k];
        for (var k2 in patch) next[k2] = patch[k2];
        cfgRef.current = next;
        setCfg(next);
        engine.applySkin(next);
      }

      function setSkin(id) {
        var d = BUILTIN_DEFAULTS[id] || {};
        var patch = { skin: id };
        for (var k in d) patch[k] = d[k];
        update(patch);
      }

      function pickLocalFile() {
        if (fileInputRef.current) fileInputRef.current.click();
      }

      function onFileChange(e) {
        var file = e.target.files && e.target.files[0];
        if (!file) return;
        var type = file.type || "";
        var name = file.name || "";
        if (type.indexOf("video") === 0) {
          setBusy(true);
          var vid = nowId("vid");
          idbPut(vid, file).then(function () {
            var mark = VIDEO_PREFIX + vid;
            update({ customKind: "video", customUrl: mark });
            addHistory(Object.assign({ id: vid, name: name, kind: "video", ts: Date.now(), customUrl: mark }, snapshotOf(cfgRef.current)));
            setHistory(loadHistory());
            setBusy(false);
          }).catch(function () { setBusy(false); });
        } else if (type.indexOf("image") === 0) {
          setBusy(true);
          compressImage(file, 1920, function (dataUrl) {
            if (dataUrl) {
              update({ customKind: "wallpaper", customUrl: dataUrl });
              addHistory(Object.assign({ id: nowId("img"), name: name, kind: "image", ts: Date.now(), customUrl: dataUrl }, snapshotOf(cfgRef.current)));
              setHistory(loadHistory());
            }
            setBusy(false);
          });
        }
        e.target.value = "";
      }

      function applyHistory(item) {
        var patch = {
          skin: "custom",
          customKind: item.customKind || (item.kind === "video" ? "video" : "wallpaper"),
          customUrl: item.customUrl,
        };
        if (item.scale !== undefined) patch.scale = item.scale;
        if (item.offsetX !== undefined) patch.offsetX = item.offsetX;
        if (item.offsetY !== undefined) patch.offsetY = item.offsetY;
        if (item.opacity !== undefined) patch.opacity = item.opacity;
        if (item.blur !== undefined) patch.blur = item.blur;
        if (item.mask !== undefined) patch.mask = item.mask;
        update(patch);
      }

      function onPreviewMouseDown(e) {
        var rect = e.currentTarget.getBoundingClientRect();
        var d = { sx: e.clientX, sy: e.clientY, ox: cfgRef.current.offsetX, oy: cfgRef.current.offsetY, w: rect.width || 1, h: rect.height || 1 };
        dragRef.current = d;
        function move(ev) {
          var dd = dragRef.current;
          if (!dd) return;
          var dx = (ev.clientX - dd.sx) / dd.w;
          var dy = (ev.clientY - dd.sy) / dd.h;
          update({ offsetX: clamp(dd.ox - dx, 0, 1), offsetY: clamp(dd.oy - dy, 0, 1) });
        }
        function up() { dragRef.current = null; window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); }
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
      }

      function onPreviewWheel(e) {
        var delta = e.deltaY > 0 ? -0.1 : 0.1;
        update({ scale: clamp(cfgRef.current.scale + delta, 1, 4) });
      }

      function previewStyle() {
        var url = thumbUrlOf(cfg);
        var bg = url ? "url('" + url + "')" : "linear-gradient(135deg,#1a1a2e,#16213e)";
        return {
          position: "absolute", inset: 0,
          backgroundImage: bg, backgroundSize: "cover",
          transform: "scale(" + cfg.scale + ")",
          transformOrigin: (cfg.offsetX * 100).toFixed(1) + "% " + (cfg.offsetY * 100).toFixed(1) + "%",
        };
      }

      var isCustom = cfg.skin === "custom";

      return h("div", { style: css.panel }, [
        h("h3", { style: css.h3 }, "UI 皮肤"),
        h("div", { style: css.lead }, "在 UI 下方注入壁纸 / 视频背景，界面表面半透明（毛玻璃）透出；支持裁剪缩放、历史记录与悬浮窗。"),

        h("div", { style: css.skinWrap }, BUILTIN_SKINS.map(function (s) {
          return h("button", { key: s.id, style: s.id === cfg.skin ? css.skinBtnActive : css.skinBtn, onClick: function () { setSkin(s.id); } }, s.name);
        })),

        isCustom
          ? h("div", { style: css.row }, [
              h("span", { style: css.label }, "类型"),
              h("select", { style: css.select, value: cfg.customKind, onChange: function (e) { update({ customKind: e.target.value }); } }, [
                h("option", { value: "wallpaper", key: "w" }, "壁纸图"),
                h("option", { value: "video", key: "v" }, "视频"),
              ]),
            ])
          : null,

        isCustom
          ? h("div", { style: css.row }, [
              h("span", { style: css.label }, "网络地址"),
              h("input", {
                style: css.input,
                placeholder: "https://…/background.webp 或 .mp4/.webm",
                value: cfg.customUrl.indexOf(VIDEO_PREFIX) === 0 ? "" : cfg.customUrl,
                onChange: function (e) { update({ customUrl: e.target.value }); },
              }),
            ])
          : null,

        isCustom
          ? h("div", { style: css.row }, [
              h("span", { style: css.label }, "本地文件"),
              h("button", { style: css.btn, onClick: pickLocalFile, disabled: busy }, busy ? "处理中…" : "选择图片/视频"),
              h("input", { type: "file", ref: fileInputRef, accept: "image/*,video/*", style: { display: "none" }, onChange: onFileChange }),
              cfg.customUrl.indexOf(VIDEO_PREFIX) === 0 ? h("span", { style: css.value }, "本地视频") : null,
            ])
          : null,

        isCustom
          ? h("div", { style: { padding: "6px 0" } }, [
              h("div", { style: { fontSize: 13, opacity: 0.85, marginBottom: 4 } }, "呈现范围（拖动裁剪位置，滚轮/滑块缩放）"),
              h("div", { style: css.preview, onMouseDown: onPreviewMouseDown, onWheel: onPreviewWheel }, [
                h("div", { style: previewStyle() }),
                h("div", { style: { position: "absolute", left: 6, bottom: 6, fontSize: 11, background: "rgba(0,0,0,0.6)", color: "#fff", padding: "1px 6px", borderRadius: 4 } }, "拖动裁剪 · 滚轮缩放"),
              ]),
              h(RangeRow, { label: "缩放", min: 1, max: 4, step: 0.05, value: cfg.scale, onChange: function (v) { update({ scale: v }); } }),
              h(RangeRow, { label: "横向", min: 0, max: 1, step: 0.01, value: cfg.offsetX, onChange: function (v) { update({ offsetX: v }); } }),
              h(RangeRow, { label: "纵向", min: 0, max: 1, step: 0.01, value: cfg.offsetY, onChange: function (v) { update({ offsetY: v }); } }),
            ])
          : null,

        history.length > 0
          ? h("div", { style: { padding: "6px 0" } }, [
              h("div", { style: { fontSize: 13, opacity: 0.85, marginBottom: 4 } }, "历史皮肤（点击切换）"),
              h("div", { style: css.histRow }, history.map(function (item) {
                if (item.kind === "image") {
                  return h("img", { key: item.id, src: item.customUrl, title: item.name, style: css.thumb, onClick: function () { applyHistory(item); } });
                }
                return h("button", { key: item.id, title: item.name, style: Object.assign({}, css.thumb, { background: "#222", color: "#fff", fontSize: 9, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }), onClick: function () { applyHistory(item); } }, "▶");
              })),
            ])
          : null,

        cfg.skin !== "none" ? h(RangeRow, { label: "透明度", min: 0, max: 1, step: 0.05, value: cfg.opacity, onChange: function (v) { update({ opacity: v }); } }) : null,
        cfg.skin !== "none" ? h(RangeRow, { label: "模糊", min: 0, max: 40, step: 1, value: cfg.blur, onChange: function (v) { update({ blur: v }); } }) : null,
        cfg.skin !== "none" ? h(RangeRow, { label: "遮罩", min: 0, max: 1, step: 0.05, value: cfg.mask, onChange: function (v) { update({ mask: v }); } }) : null,

        h("div", { style: css.row }, [
          h("span", { style: css.label }, "减少动效"),
          h("select", { style: css.select, value: cfg.reduceMotion, onChange: function (e) { update({ reduceMotion: e.target.value }); } }, [
            h("option", { value: "auto", key: "a" }, "自动（跟随系统）"),
            h("option", { value: "on", key: "on" }, "开启"),
            h("option", { value: "off", key: "off" }, "关闭"),
          ]),
        ]),

        h("div", { style: css.row }, [
          h("span", { style: css.label }, "悬浮窗"),
          h("button", { style: css.btn, onClick: function () { if (props.onOpenFloat) props.onOpenFloat(); } }, "展开悬浮窗"),
        ]),

        h("div", { style: css.note }, "本地图片压缩后存 localStorage，本地视频存 IndexedDB；配置与历史保存在浏览器，清除站点数据会丢失。"),
      ]);
    }

    // ------------------------------------------------------------------
    // FloatingPanel：可拖动悬浮窗，复现「无 / 自定义」核心控件
    // ------------------------------------------------------------------
    function FloatingPanel(props) {
      var engine = props.engine;
      var [cfg, setCfg] = React.useState(engine.getState());
      var [pos, setPos] = React.useState({ x: Math.max(20, (typeof window !== "undefined" ? window.innerWidth : 800) - 300), y: 100 });
      var cfgRef = React.useRef(cfg);
      var dragRef = React.useRef(null);

      function update(patch) {
        var next = {};
        for (var k in cfgRef.current) next[k] = cfgRef.current[k];
        for (var k2 in patch) next[k2] = patch[k2];
        cfgRef.current = next;
        setCfg(next);
        engine.applySkin(next);
      }

      function setSkin(id) {
        var d = BUILTIN_DEFAULTS[id] || {};
        var patch = { skin: id };
        for (var k in d) patch[k] = d[k];
        update(patch);
      }

      function onHeaderDown(e) {
        var d = { sx: e.clientX, sy: e.clientY, x: pos.x, y: pos.y };
        dragRef.current = d;
        function move(ev) { setPos({ x: d.x + (ev.clientX - d.sx), y: d.y + (ev.clientY - d.sy) }); }
        function up() { dragRef.current = null; window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); }
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
      }

      var panelStyle = {
        position: "fixed", left: pos.x, top: pos.y, zIndex: 1000, width: 260,
        background: "var(--dsw-alias-bg-layer-2, #fff)", color: "var(--dsw-alias-label-primary, #222)",
        border: "1px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.1))", borderRadius: 10,
        boxShadow: "0 8px 30px rgba(0,0,0,0.2)", fontSize: 13,
      };
      var headerStyle = { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 10px", cursor: "move", borderBottom: "1px solid rgba(128,128,128,0.2)" };
      var bodyStyle = { padding: "10px" };

      return h("div", { style: panelStyle }, [
        h("div", { style: headerStyle, onMouseDown: onHeaderDown }, [
          h("span", { style: { fontWeight: 600 } }, "UI 皮肤"),
          h("button", { style: { border: "none", background: "transparent", cursor: "pointer", color: "inherit", fontSize: 16 }, onClick: props.onClose }, "×"),
        ]),
        h("div", { style: bodyStyle }, [
          h("div", { style: css.skinWrap }, BUILTIN_SKINS.map(function (s) {
            return h("button", { key: s.id, style: s.id === cfg.skin ? css.skinBtnActive : css.skinBtn, onClick: function () { setSkin(s.id); } }, s.name);
          })),
          cfg.skin !== "none" ? h(RangeRow, { label: "透明度", min: 0, max: 1, step: 0.05, value: cfg.opacity, onChange: function (v) { update({ opacity: v }); } }) : null,
          cfg.skin !== "none" ? h(RangeRow, { label: "遮罩", min: 0, max: 1, step: 0.05, value: cfg.mask, onChange: function (v) { update({ mask: v }); } }) : null,
          h("div", { style: css.note }, "拖动标题栏移动；完整设置在「设置 → UI 皮肤」。"),
        ]),
      ]);
    }

    // ------------------------------------------------------------------
    function apply(ctx) {
      var slots = ctx.slots;
      var theme = ctx.get("theme");
      var engine = createBackgroundEngine(theme);
      var floatShow = null;

      ctx.effect(function () {
        engine.mount();
        return function () { engine.destroy(); };
      });

      slots.inject("shell.overlay", function () {
        return slots.register(
          { name: "shell.overlay", id: "dsh-ui-skin-float", order: 1000, label: "UI 皮肤悬浮窗" },
          function () {
            var [open, setOpen] = React.useState(false);
            floatShow = function () { setOpen(true); };
            if (!open) return null;
            return React.createElement(FloatingPanel, { engine: engine, onClose: function () { setOpen(false); } });
          },
        );
      });

      slots.inject("settings.section", function () {
        return slots.register(
          { name: "settings.section", id: "dsh-ui-skin", order: 120, label: "UI 皮肤" },
          function () {
            return React.createElement(SettingsPanel, { engine: engine, onOpenFloat: function () { if (floatShow) floatShow(); } });
          },
        );
      });
    }

    exports.apply = apply;
    exports.inject = ["slots"];
    return module.exports;
  }
});
