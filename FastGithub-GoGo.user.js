// ==UserScript==
// @name         FastGithub-GoGo 
// @namespace    飘飘
// @author       PIAOPIAO
// @version      1.1.0
// @description  🚀 GitHub 转圈圈？自动探路，不通就秒切镜像站｜Release / raw / 归档下载全走代理加速，快到飞起｜面板能拖能缩还能变悬浮球，飘飘出品，冲鸭！
// @license      MIT
// @icon         https://cdn.jsdmirror.com/gh/piaopiaosir/FastGithub-GoGo@main/newicon.png
// @match        *://github.com/*
// @match        *://*.github.com/*
// @match        *://raw.githubusercontent.com/*
// @match        *://*/*
// @exclude      *://gist.github.com/*
// @run-at       document-start
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        GM_notification
// @connect      *
// ==/UserScript==

(function () {
  "use strict";

  /* ================================================================== *
   * 0. 常量
   * ================================================================== */

  const SCRIPT_VERSION = (function () {
    try {
      if (typeof GM_info !== "undefined" && GM_info && GM_info.script && GM_info.script.version) {
        return String(GM_info.script.version);
      }
    } catch (error) {
      /* 忽略 */
    }
    return "1.1.0";
  })();
  const STORAGE_KEY = "ghm.settings.v2";
  const LEGACY_STORAGE_KEY = "config";
  const LOG_TAG = "[GitHub加速]";

  const NODE_CACHE_MS = 60 * 60 * 1000;
  const PRESET_VERSION = 1;
  const MIRROR_CACHE_MS = 10 * 60 * 1000;
  const NODE_TEST_CACHE_MS = 30 * 60 * 1000;
  const PRESET_MIRRORS = [
    { host: "https://github.gohj99.site", rawHost: "raw.github.gohj99.site" },
    { host: "https://6github.com", rawHost: "raw.6githubusercontent.com" }
  ];


  const DEFAULT_SETTINGS = {
    enabled: true,
    autoRedirect: true,
    respectLogin: true,
    mirrorId: "",
    rewriteDownloads: true,
    globalRewrite: true,
    proxyId: "",
    probeTimeoutMs: 4000,
    probeCacheMinutes: 10,
    autoCollapse: false,
    debug: false,
    customMirrors: [],
    customProxies: [],
    panel: { x: null, y: null, collapsed: false },
    lastProbe: { at: 0, reachable: null, latencyMs: 0 },
    nodePool: { fetchedAt: 0, testedAt: 0, nodes: [] },
    mirrorsCheckedAt: 0,
    presetsVersion: 0
  };

  /* ================================================================== *
   * 1. 基础工具
   * ================================================================== */

  const Log = (function () {
    let verbose = false;
    function emit(level, args) {
      if (!verbose) return;
      try {
        const method = console[level] || console.log;
        method.apply(console, [LOG_TAG].concat(args));
      } catch (error) {
        /* 控制台不可用时静默 */
      }
    }
    return {
      setVerbose: function (value) { verbose = value === true; },
      info: function () { emit("log", Array.prototype.slice.call(arguments)); },
      warn: function () { emit("warn", Array.prototype.slice.call(arguments)); },
      error: function () { emit("error", Array.prototype.slice.call(arguments)); }
    };
  })();

  const Dom = (function () {
    const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
    const ICON_PATHS = {
      bolt: "M13 2 4 14h6l-1 8 9-12h-6l1-8z",
      refresh: "M20.5 12a8.5 8.5 0 1 1-2.4-5.9M20.5 4v6h-6",
      collapse: "M6 9l6 6 6-6",
      expand: "M6 15l6-6 6 6",
      close: "M18 6L6 18M6 6l12 12",
      link: "M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1",
      sliders: "M4 7h9M17 7h3M4 17h3M11 17h9M15 4v6M8 14v6",
      gauge: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 12l4-4",
      arrow: "M5 12h14M13 6l6 6-6 6",
      reset: "M3 12a9 9 0 1 0 3-6.7M3 4v5h5",
      plus: "M12 5v14M5 12h14"
    };

    function applyOptions(node, options) {
      Object.keys(options).forEach(function (key) {
        const value = options[key];
        if (value === null || value === undefined || value === false) return;
        if (key === "class") node.className = String(value);
        else if (key === "text") node.textContent = String(value);
        else if (key === "style" && typeof value === "object") Object.assign(node.style, value);
        else if (key.slice(0, 2) === "on" && typeof value === "function") node.addEventListener(key.slice(2).toLowerCase(), value);
        else node.setAttribute(key, String(value));
      });
    }

    function appendChildren(node, children) {
      [].concat(children).forEach(function (child) {
        if (child === null || child === undefined || child === false) return;
        node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
      });
    }

    function create(tagName, options, children) {
      const node = document.createElement(tagName);
      if (options) applyOptions(node, options);
      if (children) appendChildren(node, children);
      return node;
    }

    function icon(name, size) {
      const svg = document.createElementNS(SVG_NAMESPACE, "svg");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("width", String(size || 16));
      svg.setAttribute("height", String(size || 16));
      svg.setAttribute("fill", "none");
      svg.setAttribute("stroke", "currentColor");
      svg.setAttribute("stroke-width", "2");
      svg.setAttribute("stroke-linecap", "round");
      svg.setAttribute("stroke-linejoin", "round");
      svg.setAttribute("aria-hidden", "true");
      const path = document.createElementNS(SVG_NAMESPACE, "path");
      path.setAttribute("d", ICON_PATHS[name] || ICON_PATHS.bolt);
      svg.appendChild(path);
      return svg;
    }

    return { create: create, icon: icon };
  })();

  const Format = (function () {
    function relativeTime(timestamp) {
      const at = Number(timestamp);
      if (!at) return "从未检测";
      const delta = Date.now() - at;
      if (delta < 10000) return "刚刚";
      const seconds = Math.round(delta / 1000);
      if (seconds < 60) return seconds + " 秒前";
      const minutes = Math.round(seconds / 60);
      if (minutes < 60) return minutes + " 分钟前";
      const hours = Math.round(minutes / 60);
      if (hours < 24) return hours + " 小时前";
      return Math.round(hours / 24) + " 天前";
    }

    function latency(milliseconds) {
      const value = Number(milliseconds);
      if (!isFinite(value) || value <= 0) return "--";
      return Math.round(value) + " ms";
    }

    return { relativeTime: relativeTime, latency: latency };
  })();

  const Catalog = (function () {
    function parseMirror(value, rawHost) {
      const text = String(value || "").trim();
      if (!text) return null;
      const withScheme = text.indexOf("http://") === 0 || text.indexOf("https://") === 0 ? text : "https://" + text;
      try {
        const url = new URL(withScheme);
        if (url.protocol !== "https:" && url.protocol !== "http:") return null;
        const host = url.hostname;
        if (!host) return null;
        let path = url.pathname || "/";
        while (path.length > 1 && path.charAt(path.length - 1) === "/") path = path.slice(0, -1);
        const kind = path === "/" || path === "" ? "host" : "path";
        const label = host + (kind === "path" ? path : "");
        return {
          id: "mirror:" + label,
          label: label,
          kind: kind,
          host: host,
          prefix: kind === "path" ? path : "",
          rawHost: typeof rawHost === "string" ? rawHost : ""
        };
      } catch (error) {
        return null;
      }
    }

    function parseProxy(value) {
      const text = String(value || "").trim();
      if (!text) return null;
      const withScheme = text.indexOf("http://") === 0 || text.indexOf("https://") === 0 ? text : "https://" + text;
      try {
        const url = new URL(withScheme);
        if (url.protocol !== "https:" && url.protocol !== "http:") return null;
        if (!url.hostname) return null;
        let path = url.pathname || "/";
        while (path.length > 1 && path.charAt(path.length - 1) === "/") path = path.slice(0, -1);
        if (path === "/") path = "";
        const base = url.protocol + "//" + url.hostname + path + "/";
        const label = url.hostname + path;
        return { id: "proxy:" + label, label: label, base: base, mode: "prefix", latencyMs: 0 };
      } catch (error) {
        return null;
      }
    }

    function mirrors() {
      const list = SettingsStore.get().customMirrors;
      return Array.isArray(list) ? list : [];
    }

    function proxies() {
      const list = SettingsStore.get().customProxies;
      return Array.isArray(list) ? list : [];
    }

    function mirrorById(id) {
      const list = mirrors();
      for (let index = 0; index < list.length; index += 1) {
        if (list[index].id === id) return list[index];
      }
      return null;
    }

    function proxyById(id) {
      const list = proxies();
      for (let index = 0; index < list.length; index += 1) {
        if (list[index].id === id) return list[index];
      }
      return null;
    }

    function addMirror(value) {
      const mirror = parseMirror(value);
      if (!mirror) return null;
      const list = mirrors().slice();
      if (!list.some(function (item) { return item.id === mirror.id; })) list.push(mirror);
      SettingsStore.patch({ customMirrors: list, mirrorId: mirror.id });
      return mirror;
    }

    function removeMirror(id) {
      const current = SettingsStore.get().mirrorId;
      const list = mirrors().filter(function (item) { return item.id !== id; });
      SettingsStore.patch({ customMirrors: list, mirrorId: current === id ? "" : current });
    }

    function addProxy(value) {
      const proxy = parseProxy(value);
      if (!proxy) return null;
      const list = proxies().slice();
      if (!list.some(function (item) { return item.id === proxy.id; })) list.push(proxy);
      SettingsStore.patch({ customProxies: list, proxyId: proxy.id });
      return proxy;
    }

    function removeProxy(id) {
      const current = SettingsStore.get().proxyId;
      const list = proxies().filter(function (item) { return item.id !== id; });
      SettingsStore.patch({ customProxies: list, proxyId: current === id ? "" : current });
    }

    return {
      mirrors: mirrors,
      proxies: proxies,
      mirrorById: mirrorById,
      proxyById: proxyById,
      addMirror: addMirror,
      removeMirror: removeMirror,
      addProxy: addProxy,
      removeProxy: removeProxy,
      parseMirror: parseMirror,
      parseProxy: parseProxy
    };
  })();

  /* ================================================================== *
   * 2. 配置仓库
   * ================================================================== */

  const SettingsStore = (function () {
    const subscribers = new Set();
    let cached = null;
    let saveTimer = 0;

    function cloneDefaults() {
      return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    }

    function readStored(key) {
      try {
        const raw = typeof GM_getValue === "function"
          ? GM_getValue(key, "")
          : (window.localStorage.getItem(key) || "");
        if (!raw) return null;
        if (typeof raw === "object") return raw;
        return JSON.parse(raw);
      } catch (error) {
        Log.warn("读取存储失败", key, error);
        return null;
      }
    }

    function writeStored(key, value) {
      try {
        const text = JSON.stringify(value);
        if (typeof GM_setValue === "function") GM_setValue(key, text);
        else window.localStorage.setItem(key, text);
        return true;
      } catch (error) {
        Log.warn("写入存储失败", key, error);
        return false;
      }
    }

    function clampNumber(value, min, max, fallback) {
      const parsed = Number(value);
      if (!isFinite(parsed)) return fallback;
      return Math.round(Math.min(max, Math.max(min, parsed)));
    }

    function normalizePanel(raw) {
      const source = raw && typeof raw === "object" ? raw : {};
      const x = Number(source.x);
      const y = Number(source.y);
      return {
        x: isFinite(x) ? x : null,
        y: isFinite(y) ? y : null,
        collapsed: source.collapsed === true
      };
    }

    function normalizeLastProbe(raw) {
      const source = raw && typeof raw === "object" ? raw : {};
      const at = Number(source.at);
      return {
        at: isFinite(at) && at > 0 ? at : 0,
        reachable: typeof source.reachable === "boolean" ? source.reachable : null,
        latencyMs: clampNumber(source.latencyMs, 0, 60000, 0)
      };
    }

    function normalizeMirrors(raw) {
      const list = Array.isArray(raw) ? raw : [];
      const output = [];
      for (let index = 0; index < list.length && output.length < 20; index += 1) {
        const item = list[index] || {};
        if (typeof item.host !== "string" || !item.host) continue;
        const kind = item.kind === "path" ? "path" : "host";
        const prefix = kind === "path" && typeof item.prefix === "string" ? item.prefix : "";
        const label = item.host + prefix;
        output.push({
          id: "mirror:" + label,
          label: label,
          kind: kind,
          host: item.host,
          prefix: prefix,
          rawHost: typeof item.rawHost === "string" ? item.rawHost : "",
          latencyMs: clampNumber(item.latencyMs, 0, 60000, 0),
          ok: typeof item.ok === "boolean" ? item.ok : null
        });
      }
      return output;
    }

    function normalizeProxies(raw) {
      const list = Array.isArray(raw) ? raw : [];
      const output = [];
      for (let index = 0; index < list.length && output.length < 20; index += 1) {
        const item = list[index] || {};
        const base = typeof item.base === "string" ? item.base : "";
        if (base.indexOf("http") !== 0) continue;
        let host = "";
        let path = "/";
        let origin = "";
        try {
          const url = new URL(base);
          host = url.hostname;
          path = url.pathname || "/";
          origin = url.protocol + "//" + url.hostname;
        } catch (error) {
          continue;
        }
        if (!host) continue;
        while (path.length > 1 && path.charAt(path.length - 1) === "/") path = path.slice(0, -1);
        if (path === "/") path = "";
        output.push({
          id: "proxy:" + host + path,
          label: host + path,
          base: origin + path + "/",
          mode: "prefix",
          latencyMs: 0
        });
      }
      return output;
    }

    function normalizeNodePool(raw) {
      const source = raw && typeof raw === "object" ? raw : {};
      const list = Array.isArray(source.nodes) ? source.nodes : [];
      const nodes = [];
      for (let index = 0; index < list.length && nodes.length < 120; index += 1) {
        const item = list[index] || {};
        const id = typeof item.id === "string" ? item.id : "";
        const base = typeof item.base === "string" ? item.base : "";
        if (!id || base.indexOf("http") !== 0) continue;
        nodes.push({
          id: id,
          base: base,
          label: typeof item.label === "string" && item.label ? item.label : id,
          mode: "prefix",
          latencyMs: clampNumber(item.latencyMs, 0, 60000, 0),
          ok: item.ok === true
        });
      }
      const fetchedAt = Number(source.fetchedAt);
      const testedAt = Number(source.testedAt);
      return {
        fetchedAt: isFinite(fetchedAt) && fetchedAt > 0 ? fetchedAt : 0,
        testedAt: isFinite(testedAt) && testedAt > 0 ? testedAt : 0,
        nodes: nodes
      };
    }

    function normalize(raw) {
      const result = cloneDefaults();
      if (!raw || typeof raw !== "object") return result;
      if (typeof raw.enabled === "boolean") result.enabled = raw.enabled;
      if (typeof raw.autoRedirect === "boolean") result.autoRedirect = raw.autoRedirect;
      if (typeof raw.respectLogin === "boolean") result.respectLogin = raw.respectLogin;
      if (typeof raw.rewriteDownloads === "boolean") result.rewriteDownloads = raw.rewriteDownloads;
      if (typeof raw.autoCollapse === "boolean") result.autoCollapse = raw.autoCollapse;
      if (typeof raw.globalRewrite === "boolean") result.globalRewrite = raw.globalRewrite;
      if (typeof raw.debug === "boolean") result.debug = raw.debug;
      result.mirrorId = typeof raw.mirrorId === "string" ? raw.mirrorId : "";
      result.proxyId = typeof raw.proxyId === "string" ? raw.proxyId : "";
      result.probeTimeoutMs = clampNumber(raw.probeTimeoutMs, 1000, 15000, result.probeTimeoutMs);
      result.probeCacheMinutes = clampNumber(raw.probeCacheMinutes, 1, 120, result.probeCacheMinutes);
      result.customMirrors = normalizeMirrors(raw.customMirrors);
      result.customProxies = normalizeProxies(raw.customProxies);
      result.panel = normalizePanel(raw.panel);
      result.lastProbe = normalizeLastProbe(raw.lastProbe);
      result.nodePool = normalizeNodePool(raw.nodePool);
      const checkedAt = Number(raw.mirrorsCheckedAt);
      result.mirrorsCheckedAt = isFinite(checkedAt) && checkedAt > 0 ? checkedAt : 0;
      result.presetsVersion = clampNumber(raw.presetsVersion, 0, 999, 0);
      return result;
    }

    function migrateLegacy(legacy) {
      if (!legacy || typeof legacy !== "object") return null;
      const migrated = { customMirrors: [], customProxies: [] };
      if (typeof legacy.enabled === "boolean") migrated.enabled = legacy.enabled;
      if (typeof legacy.autoMode === "boolean") migrated.autoRedirect = legacy.autoMode;
      if (typeof legacy.rewriteDownloads === "boolean") migrated.rewriteDownloads = legacy.rewriteDownloads;

      const mirrorValues = [];
      const legacyMirrors = Array.isArray(legacy.mirrors) ? legacy.mirrors : [];
      legacyMirrors.forEach(function (item) {
        if (item && typeof item.url === "string") mirrorValues.push(item.url);
      });
      if (typeof legacy.selectedMirror === "string" && legacy.selectedMirror) mirrorValues.unshift(legacy.selectedMirror);
      mirrorValues.forEach(function (value) {
        const mirror = Catalog.parseMirror(value);
        if (!mirror) return;
        if (migrated.customMirrors.some(function (item) { return item.id === mirror.id; })) return;
        migrated.customMirrors.push(mirror);
      });
      if (migrated.customMirrors.length) migrated.mirrorId = migrated.customMirrors[0].id;

      const proxyValues = [];
      const legacyProxies = Array.isArray(legacy.fileProxies) ? legacy.fileProxies : [];
      legacyProxies.forEach(function (item) {
        if (item && typeof item.url === "string") proxyValues.push(item.url);
      });
      if (typeof legacy.selectedFileProxy === "string" && legacy.selectedFileProxy) proxyValues.unshift(legacy.selectedFileProxy);
      proxyValues.forEach(function (value) {
        const proxy = Catalog.parseProxy(value);
        if (!proxy) return;
        if (migrated.customProxies.some(function (item) { return item.id === proxy.id; })) return;
        migrated.customProxies.push(proxy);
      });
      if (migrated.customProxies.length) migrated.proxyId = migrated.customProxies[0].id;

      const interval = Number(legacy.checkInterval);
      if (isFinite(interval) && interval > 0) migrated.probeCacheMinutes = Math.round(interval / 60000);
      Log.info("已迁移旧版配置", migrated);
      return migrated;
    }

    function emit() {
      subscribers.forEach(function (listener) {
        try { listener(cached); } catch (error) { Log.error("订阅回调异常", error); }
      });
    }

    function saveNow() {
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = 0;
      }
      writeStored(STORAGE_KEY, cached);
    }

    function save() {
      if (saveTimer) return;
      saveTimer = window.setTimeout(function () {
        saveTimer = 0;
        saveNow();
      }, 240);
    }

    function seedPresets(settings) {
      const list = settings.customMirrors.slice();
      PRESET_MIRRORS.forEach(function (preset) {
        const mirror = Catalog.parseMirror(preset.host, preset.rawHost);
        if (!mirror) return;
        if (list.some(function (item) { return item.id === mirror.id; })) return;
        list.push(mirror);
      });
      const patch = { customMirrors: list, presetsVersion: PRESET_VERSION };
      if (!settings.mirrorId && list.length) patch.mirrorId = list[0].id;
      return Object.assign({}, settings, patch);
    }

    function load() {
      if (cached) return cached;
      const stored = readStored(STORAGE_KEY);
      let source = stored;
      let shouldPersist = !stored;
      if (!stored) {
        const legacy = readStored(LEGACY_STORAGE_KEY);
        if (legacy) {
          source = migrateLegacy(legacy);
          shouldPersist = true;
        }
      }
      cached = normalize(source);
      if (!cached.presetsVersion || cached.presetsVersion < PRESET_VERSION) {
        cached = normalize(seedPresets(cached));
        shouldPersist = true;
      }
      if (shouldPersist) saveNow();
      return cached;
    }

    function get() {
      if (!cached) load();
      return cached;
    }

    function patch(partial) {
      if (!partial) return get();
      const next = Object.assign({}, get());
      Object.keys(partial).forEach(function (key) {
        if (key === "panel" || key === "lastProbe") next[key] = Object.assign({}, next[key], partial[key]);
        else next[key] = partial[key];
      });
      cached = normalize(next);
      emit();
      save();
      return cached;
    }

    function reset() {
      cached = normalize(seedPresets(cloneDefaults()));
      emit();
      saveNow();
      return cached;
    }

    function subscribe(listener) {
      if (typeof listener !== "function") return function () {};
      subscribers.add(listener);
      return function () { subscribers.delete(listener); };
    }

    return { load: load, get: get, patch: patch, reset: reset, subscribe: subscribe, saveNow: saveNow };
  })();

  /* ================================================================== *
   * 3. 站点识别
   * ================================================================== */

  const Site = (function () {
    const RAW_HOST = "raw.githubusercontent.com";
    const EXCLUDED_SUBDOMAINS = ["api.", "gist.", "uploads.", "codeload.", "objects.", "media.", "avatars.", "user-images.", "render."];

    function hostname() {
      return String((window.location && window.location.hostname) || "").toLowerCase();
    }

    function isMirrorHost(host) {
      const target = String(host || "").toLowerCase();
      if (!target) return false;
      const list = Catalog.mirrors();
      for (let index = 0; index < list.length; index += 1) {
        const mirror = list[index];
        if (!mirror.host) continue;
        if (target === mirror.host) return true;
        if (target.slice(-(mirror.host.length + 1)) === "." + mirror.host) return true;
      }
      return false;
    }

    function kindOf(host) {
      const target = String(host || "").toLowerCase();
      if (!target) return "other";
      if (target === RAW_HOST) return "raw";
      if (target === "github.com" || target === "www.github.com") return "github";
      if (target.slice(-11) === ".github.com") {
        for (let index = 0; index < EXCLUDED_SUBDOMAINS.length; index += 1) {
          if (target.indexOf(EXCLUDED_SUBDOMAINS[index]) === 0) return "other";
        }
        return "github";
      }
      if (isMirrorHost(target)) return "mirror";
      return "other";
    }

    function readLoginName() {
      try {
        const meta = document.querySelector("meta[name=user-login]");
        if (meta) {
          const value = String(meta.getAttribute("content") || "").trim();
          if (value) return value;
        }
        const logout = document.querySelector('a[href="/logout"]');
        return logout ? "已登录" : "";
      } catch (error) {
        return "";
      }
    }

    return { hostname: hostname, kindOf: kindOf, isMirrorHost: isMirrorHost, readLoginName: readLoginName };
  })();


  /* ================================================================== *
   * 4. 反代节点注册表
   * ================================================================== */

  const NodeRegistry = (function () {
    const SOURCE_URL = "https://xiake.pro/github/script.js";
    const PROBE_FILE = "https://raw.githubusercontent.com/microsoft/vscode/main/resources/win32/code_70x70.png";
    const REMOTE_PREFIX = "remote:";
    const PROBE_CONCURRENCY = 8;
    const FETCH_TIMEOUT_MS = 8000;
    let runningFetch = null;
    let testing = null;

    function pool() {
      const value = SettingsStore.get().nodePool;
      return value && Array.isArray(value.nodes) ? value.nodes : [];
    }

    function usableNodes() {
      return pool()
        .filter(function (node) { return node.ok === true; })
        .sort(function (left, right) { return left.latencyMs - right.latencyMs; });
    }

    function allProxies() {
      return Catalog.proxies().concat(usableNodes());
    }

    function mirrorDownloaders() {
      return Catalog.mirrors().map(function (mirror) {
        return {
          id: mirror.id,
          label: mirror.label,
          mode: "host",
          host: mirror.host,
          rawHost: mirror.rawHost || "",
          latencyMs: 0
        };
      });
    }

    function downloadOptions() {
      return allProxies().concat(mirrorDownloaders());
    }

    function proxyById(id) {
      const custom = Catalog.proxyById(id);
      if (custom) return custom;
      const usable = usableNodes();
      for (let index = 0; index < usable.length; index += 1) {
        if (usable[index].id === id) return usable[index];
      }
      const mirror = Catalog.mirrorById(id);
      if (mirror) {
        return {
          id: mirror.id,
          label: mirror.label,
          mode: "host",
          host: mirror.host,
          rawHost: mirror.rawHost || "",
          latencyMs: 0
        };
      }
      return null;
    }

    function isRemote(id) {
      return typeof id === "string" && id.indexOf(REMOTE_PREFIX) === 0;
    }

    function normalizeBase(value) {
      const text = String(value || "").trim();
      if (!text) return "";
      const withScheme = text.indexOf("http://") === 0 || text.indexOf("https://") === 0 ? text : "https://" + text;
      try {
        const url = new URL(withScheme);
        if (url.protocol !== "https:" && url.protocol !== "http:") return "";
        if (!url.hostname) return "";
        let path = url.pathname || "/";
        while (path.length > 1 && path.charAt(path.length - 1) === "/") path = path.slice(0, -1);
        if (path === "/") path = "";
        return url.protocol + "//" + url.hostname + path + "/";
      } catch (error) {
        return "";
      }
    }

    function toNode(base) {
      const normalized = normalizeBase(base);
      if (!normalized) return null;
      let host = "";
      try { host = new URL(normalized).hostname; } catch (error) { return null; }
      if (!host) return null;
      return { id: REMOTE_PREFIX + host, base: normalized, label: host, mode: "prefix", latencyMs: 0 };
    }

    function dedupe(bases) {
      const seen = {};
      const nodes = [];
      bases.forEach(function (value) {
        const node = toNode(value);
        if (!node || seen[node.id]) return;
        seen[node.id] = true;
        nodes.push(node);
      });
      return nodes;
    }

    function extractNodes(text) {
      const source = String(text || "");
      const marker = source.indexOf("mirrors = [");
      if (marker < 0) return [];
      const end = source.indexOf("];", marker);
      if (end < 0) return [];
      const block = source.slice(marker, end);
      const values = [];
      let cursor = 0;
      while (cursor < block.length) {
        const open = block.indexOf('"', cursor);
        if (open < 0) break;
        const close = block.indexOf('"', open + 1);
        if (close < 0) break;
        const value = block.slice(open + 1, close);
        if (value.indexOf("http") === 0) values.push(value);
        cursor = close + 1;
      }
      return values;
    }

    function fetchPool() {
      return new Promise(function (resolve) {
        let settled = false;
        const timer = window.setTimeout(function () { finish([], "timeout"); }, FETCH_TIMEOUT_MS);

        function finish(nodes, reason) {
          if (settled) return;
          settled = true;
          window.clearTimeout(timer);
          Log.info("节点池来源", reason, nodes.length);
          resolve(nodes);
        }

        if (typeof GM_xmlhttpRequest !== "function") {
          finish([], "no-gm");
          return;
        }
        try {
          GM_xmlhttpRequest({
            method: "GET",
            url: SOURCE_URL + "?ghm=" + Date.now(),
            timeout: FETCH_TIMEOUT_MS,
            onload: function (response) {
              const found = extractNodes(response.responseText || "");
              finish(found, found.length ? "remote" : "empty");
            },
            onerror: function () { finish([], "error"); },
            ontimeout: function () { finish([], "timeout"); }
          });
        } catch (error) {
          finish([], "exception");
        }
      });
    }

    function probeNode(node, timeoutMs) {
      return new Promise(function (resolve) {
        const startedAt = Date.now();
        let settled = false;
        const timer = window.setTimeout(function () { finish(false, "timeout"); }, timeoutMs + 400);

        function finish(ok, reason) {
          if (settled) return;
          settled = true;
          window.clearTimeout(timer);
          resolve({ ok: ok, latencyMs: Date.now() - startedAt, reason: reason || "" });
        }

        if (typeof GM_xmlhttpRequest !== "function") {
          finish(false, "no-gm");
          return;
        }
        try {
          GM_xmlhttpRequest({
            method: "GET",
            url: node.base + PROBE_FILE + "?ghm=" + Date.now(),
            timeout: timeoutMs,
            responseType: "arraybuffer",
            onload: function (response) {
              if (response.status !== 200 && response.status !== 206) {
                finish(false, "http " + response.status);
                return;
              }
              const buffer = response.response;
              if (buffer && typeof buffer.byteLength === "number") {
                const bytes = new Uint8Array(buffer);
                const isPng = bytes.length > 100 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
                finish(isPng, isPng ? "ok" : "not-png");
                return;
              }
              if (buffer && typeof buffer.size === "number") {
                const blobOk = buffer.size > 100;
                finish(blobOk, blobOk ? "ok" : "empty");
                return;
              }
              finish(false, "empty");
            },
            onerror: function () { finish(false, "network"); },
            ontimeout: function () { finish(false, "timeout"); }
          });
        } catch (error) {
          finish(false, "exception");
        }
      });
    }

    function probeAll(nodes, options) {
      const settings = options || {};
      const timeoutMs = settings.timeoutMs || 3000;
      const onProgress = settings.onProgress;
      const total = nodes.length;
      const working = [];
      let completed = 0;
      let cursor = 0;

      return new Promise(function (resolve) {
        if (!total) {
          resolve(working);
          return;
        }
        function worker() {
          if (cursor >= nodes.length) return;
          const node = nodes[cursor];
          cursor += 1;
          probeNode(node, timeoutMs).then(function (result) {
            completed += 1;
            if (result.ok) {
              working.push({ id: node.id, base: node.base, label: node.label, mode: "prefix", latencyMs: result.latencyMs });
            }
            if (onProgress) onProgress(completed, total, working.length);
            if (completed >= nodes.length) resolve(working);
            else worker();
          });
        }
        for (let index = 0; index < Math.min(PROBE_CONCURRENCY, total); index += 1) worker();
      });
    }

    function mergePool(incoming, previous) {
      const known = {};
      previous.forEach(function (node) { known[node.id] = node; });
      return incoming.map(function (node) {
        const old = known[node.id];
        return {
          id: node.id,
          base: node.base,
          label: node.label,
          mode: "prefix",
          ok: old ? old.ok === true : false,
          latencyMs: old ? old.latencyMs : 0
        };
      });
    }

    function applyPool(nodes, fetchedAt, testedAt) {
      SettingsStore.patch({ nodePool: { fetchedAt: fetchedAt, testedAt: testedAt, nodes: nodes } });
      fixSelection();
    }

    function fixSelection() {
      const current = SettingsStore.get().proxyId;
      const options = downloadOptions();
      if (!options.length) {
        if (current) SettingsStore.patch({ proxyId: "" });
        return;
      }
      const exists = current && options.some(function (item) { return item.id === current; });
      if (!exists) SettingsStore.patch({ proxyId: options[0].id });
    }

    function ensurePool(options) {
      const force = options && options.force === true;
      if (runningFetch) return runningFetch;
      const current = SettingsStore.get().nodePool;
      const fresh = current.fetchedAt > 0 && Date.now() - current.fetchedAt < NODE_CACHE_MS;
      if (!force && fresh && current.nodes.length) {
        return Promise.resolve({ cached: true, total: current.nodes.length });
      }
      runningFetch = fetchPool().then(function (bases) {
        runningFetch = null;
        const merged = mergePool(dedupe(bases), current.nodes);
        applyPool(merged, Date.now(), current.testedAt);
        Log.info("节点池已更新", merged.length);
        return { cached: false, total: merged.length };
      }).catch(function (error) {
        runningFetch = null;
        Log.warn("节点池更新失败", error);
        return { cached: false, total: current.nodes.length, error: String(error) };
      });
      return runningFetch;
    }

    function testAll(options) {
      if (testing) return testing;
      const callbacks = options || {};
      const timeoutMs = Math.max(2500, SettingsStore.get().probeTimeoutMs);
      testing = ensurePool({ force: !pool().length }).then(function () {
        const current = SettingsStore.get().nodePool;
        const nodes = current.nodes || [];
        if (!nodes.length) return { total: 0, working: 0, nodes: [] };
        if (callbacks.onStage) callbacks.onStage("probing", nodes.length);
        return probeAll(nodes, { timeoutMs: timeoutMs, onProgress: callbacks.onProgress }).then(function (results) {
          const measured = {};
          results.forEach(function (result) { measured[result.id] = result; });
          const merged = nodes.map(function (node) {
            const hit = measured[node.id];
            return Object.assign({}, node, { ok: !!hit, latencyMs: hit ? hit.latencyMs : 0 });
          });
          applyPool(merged, current.fetchedAt, Date.now());
          testing = null;
          const usable = merged.filter(function (node) { return node.ok; });
          Log.info("节点测速完成", usable.length + "/" + merged.length);
          return { total: merged.length, working: usable.length, nodes: usable };
        });
      }).catch(function (error) {
        testing = null;
        Log.error("节点测速失败", error);
        return { total: 0, working: 0, nodes: [], error: String(error) };
      });
      return testing;
    }

    return {
      ensurePool: ensurePool,
      testAll: testAll,
      allProxies: allProxies,
      downloadOptions: downloadOptions,
      usableNodes: usableNodes,
      pool: pool,
      proxyById: proxyById,
      isRemote: isRemote,
      fixSelection: fixSelection
    };
  })();

  /* ================================================================== *
   * 5. 地址映射
   * ================================================================== */

  const UrlMapper = (function () {
    function toAbsolute(href) {
      if (!href) return null;
      try { return new URL(String(href), window.location.href); } catch (error) { return null; }
    }

    function isHttp(url) {
      return !!url && (url.protocol === "https:" || url.protocol === "http:");
    }

    function downloadKind(url) {
      if (!isHttp(url)) return "";
      const host = url.hostname.toLowerCase();
      const path = url.pathname || "";
      if (host === "raw.githubusercontent.com") return "raw";
      if (host === "codeload.github.com") return "archive";
      if (host === "objects.githubusercontent.com") return "asset";
      if (host === "media.githubusercontent.com") return "media";
      if (host !== "github.com" && host !== "www.github.com") return "";
      if (path.indexOf("/releases/") >= 0 && path.indexOf("/download/") >= 0) return "release";
      if (path.indexOf("/archive/") >= 0) return "archive";
      if (path.indexOf("/raw/") >= 0) return "raw";
      return "";
    }

    function isAccelerated(url) {
      if (!isHttp(url)) return false;
      if (Site.isMirrorHost(url.hostname.toLowerCase())) return true;
      const text = url.href;
      const proxies = NodeRegistry.allProxies();
      for (let index = 0; index < proxies.length; index += 1) {
        if (text.indexOf(proxies[index].base) === 0) return true;
      }
      return false;
    }

    function buildDownloadUrl(url, downloader) {
      if (!url || !downloader) return "";
      if (downloader.mode !== "host") return buildProxyUrl(url.href, downloader);
      let copy;
      try {
        copy = new URL(url.href);
      } catch (error) {
        return "";
      }
      const host = copy.hostname.toLowerCase();
      if (host === "github.com" || host === "www.github.com") {
        copy.hostname = downloader.host;
        return copy.href;
      }
      if (host === "raw.githubusercontent.com" && downloader.rawHost) {
        copy.hostname = downloader.rawHost;
        return copy.href;
      }
      return "";
    }

    function buildProxyUrl(target, proxy) {
      const absolute = typeof target === "string" ? target : (target && target.href);
      if (!absolute || !proxy) return absolute || "";
      if (proxy.mode === "query") return proxy.base + "?" + proxy.param + "=" + encodeURIComponent(absolute);
      return proxy.base + absolute;
    }

    function canMirror(url) {
      if (!isHttp(url)) return false;
      const host = url.hostname.toLowerCase();
      return host === "github.com" || host === "www.github.com" || host.slice(-11) === ".github.com";
    }

    function buildMirrorUrl(target, mirror) {
      if (!target || !mirror) return "";
      let source;
      try {
        source = new URL(typeof target === "string" ? target : target.href);
      } catch (error) {
        return "";
      }
      if (!canMirror(source)) return "";
      if (mirror.kind === "host") {
        const copy = new URL(source.href);
        copy.hostname = mirror.host;
        return copy.href;
      }
      let prefix = String(mirror.prefix || "");
      while (prefix.length > 1 && prefix.charAt(prefix.length - 1) === "/") prefix = prefix.slice(0, -1);
      return "https://" + mirror.host + prefix + source.pathname + source.search + source.hash;
    }

    return {
      toAbsolute: toAbsolute,
      isHttp: isHttp,
      downloadKind: downloadKind,
      isAccelerated: isAccelerated,
      buildProxyUrl: buildProxyUrl,
      buildDownloadUrl: buildDownloadUrl,
      buildMirrorUrl: buildMirrorUrl,
      canMirror: canMirror
    };
  })();


  /* ================================================================== *
   * 6. 连通性探测
   * ================================================================== */

  const Reachability = (function () {
    const PROBE_URL = "https://github.com/robots.txt";
    const PROBE_IMAGE_URL = "https://github.com/favicon.ico";
    let inflight = null;

    function probeOnce(timeoutMs) {
      return new Promise(function (resolve) {
        const startedAt = Date.now();
        let settled = false;

        function settle(ok, reason) {
          if (settled) return;
          settled = true;
          window.clearTimeout(guardTimer);
          resolve({ ok: ok, latencyMs: Date.now() - startedAt, reason: reason || "" });
        }

        const guardTimer = window.setTimeout(function () { settle(false, "guard-timeout"); }, timeoutMs + 600);

        if (typeof GM_xmlhttpRequest === "function") {
          try {
            GM_xmlhttpRequest({
              method: "GET",
              url: PROBE_URL + "?ghm=" + Date.now(),
              timeout: timeoutMs,
              onload: function (response) { settle(response.status >= 200 && response.status < 400, "http " + response.status); },
              onerror: function () { settle(false, "network"); },
              ontimeout: function () { settle(false, "timeout"); },
              onabort: function () { settle(false, "abort"); }
            });
            return;
          } catch (error) {
            Log.warn("GM_xmlhttpRequest 不可用，回退图片探测", error);
          }
        }

        try {
          const image = new Image();
          image.onload = function () { settle(true, "image"); };
          image.onerror = function () { settle(false, "image"); };
          image.src = PROBE_IMAGE_URL + "?ghm=" + Date.now();
        } catch (error) {
          settle(false, "unsupported");
        }
      });
    }

    function probe() {
      if (inflight) return inflight;
      const timeoutMs = SettingsStore.get().probeTimeoutMs;
      Log.info("开始探测 GitHub 连通性，超时 " + timeoutMs + " ms");
      inflight = probeOnce(timeoutMs).then(function (result) {
        inflight = null;
        const verdict = {
          reachable: result.ok,
          latencyMs: result.latencyMs,
          at: Date.now(),
          reason: result.reason
        };
        SettingsStore.patch({
          lastProbe: { at: verdict.at, reachable: verdict.reachable, latencyMs: verdict.latencyMs }
        });
        Log.info("探测完成", verdict);
        return verdict;
      }).catch(function (error) {
        inflight = null;
        Log.error("探测异常", error);
        return { reachable: false, latencyMs: 0, at: Date.now(), reason: "error" };
      });
      return inflight;
    }

    function cachedVerdict() {
      const settings = SettingsStore.get();
      const last = settings.lastProbe || {};
      if (!last.at || typeof last.reachable !== "boolean") return null;
      if (Date.now() - last.at > settings.probeCacheMinutes * 60000) return null;
      return { reachable: last.reachable, latencyMs: last.latencyMs, at: last.at, fromCache: true };
    }

    return { probe: probe, cachedVerdict: cachedVerdict };
  })();

  /* ================================================================== *
   * 7. 镜像跳转
   * ================================================================== */

  const Redirector = (function () {
    const GUARD_KEY = "ghm.redirected.at";
    const GUARD_WINDOW_MS = 20000;
    let lastAttemptAt = 0;

    function recentRedirect() {
      try {
        const at = Number(window.sessionStorage.getItem(GUARD_KEY));
        return !!at && Date.now() - at < GUARD_WINDOW_MS;
      } catch (error) {
        return false;
      }
    }

    function markRedirect() {
      try { window.sessionStorage.setItem(GUARD_KEY, String(Date.now())); } catch (error) { /* 隐私模式下忽略 */ }
    }

    function activeMirror() {
      const list = Catalog.mirrors();
      return Catalog.mirrorById(SettingsStore.get().mirrorId) || list[0] || null;
    }

    function targetForCurrentPage(mirror) {
      const kind = Site.kindOf(Site.hostname());
      const target = mirror || activeMirror();
      if (kind === "github") return target ? UrlMapper.buildMirrorUrl(window.location.href, target) : "";
      if (kind === "raw") {
        const proxy = NodeRegistry.proxyById(SettingsStore.get().proxyId);
        return proxy ? UrlMapper.buildDownloadUrl(new URL(window.location.href), proxy) : "";
      }
      return "";
    }

    function probeMirror(mirror) {
      return new Promise(function (resolve) {
        const startedAt = Date.now();
        if (!mirror || !mirror.host || typeof GM_xmlhttpRequest !== "function") {
          resolve({ ok: false, latencyMs: 0 });
          return;
        }
        let settled = false;
        const timer = window.setTimeout(function () { finish(false); }, 5000);

        function finish(ok) {
          if (settled) return;
          settled = true;
          window.clearTimeout(timer);
          resolve({ ok: ok, latencyMs: Date.now() - startedAt });
        }

        try {
          GM_xmlhttpRequest({
            method: "GET",
            url: "https://" + mirror.host + "/?ghm=" + Date.now(),
            timeout: 5000,
            onload: function (response) { finish(response.status >= 200 && response.status < 400); },
            onerror: function () { finish(false); },
            ontimeout: function () { finish(false); }
          });
        } catch (error) {
          finish(false);
        }
      });
    }

    function verifyMirror(mirror) {
      return probeMirror(mirror).then(function (result) { return result.ok; });
    }

    function redirectToMirror(options) {
      const settings = SettingsStore.get();
      const request = options || {};
      if (!settings.enabled) { Log.info("已禁用，跳过跳转"); return false; }

      const kind = Site.kindOf(Site.hostname());
      if (kind !== "github" && kind !== "raw") { Log.info("当前站点无需跳转", kind); return false; }

      if (!request.force) {
        if (!settings.autoRedirect) return false;
        if (Date.now() - lastAttemptAt < 1500) return false;
        if (recentRedirect()) { Log.info("刚刚跳转过，跳过本轮"); return false; }
        if (settings.respectLogin && Site.readLoginName()) { Log.info("检测到登录态，跳过自动跳转"); return false; }
      }

      const mirror = request.mirror || activeMirror();
      const target = targetForCurrentPage(mirror);
      if (!target) { Log.info("当前页面无法映射到镜像"); return false; }
      if (target === window.location.href) return false;

      lastAttemptAt = Date.now();
      markRedirect();

      if (kind === "raw" || !mirror || request.skipVerify) {
        Log.info(request.skipVerify ? "按缓存的镜像健康状态直接跳转" : "直接跳转", target);
        try {
          window.location.replace(target);
          return true;
        } catch (error) {
          Log.error("跳转失败", error);
          return false;
        }
      }

      verifyMirror(mirror).then(function (ok) {
        if (ok) {
          Log.info("跳转到镜像", mirror.label, target);
          try {
            window.location.replace(target);
          } catch (error) {
            Log.error("跳转失败", error);
          }
          return;
        }
        Log.warn("镜像不可用", mirror.label);
        Notifier.notify("镜像 " + mirror.label + " 无法访问，已留在 GitHub");
      });
      return true;
    }

    return {
      redirectToMirror: redirectToMirror,
      targetForCurrentPage: targetForCurrentPage,
      activeMirror: activeMirror,
      probeMirror: probeMirror,
      verifyMirror: verifyMirror,
      recentRedirect: recentRedirect
    };
  })();

  /* ================================================================== *
   * 8. 下载链接改写
   * ================================================================== */

  const DownloadLinkPatcher = (function () {
    const MARK_ATTRIBUTE = "data-ghm-link";
    const ORIGINAL_ATTRIBUTE = "data-ghm-original";
    const RAW_HREF_ATTRIBUTE = "data-ghm-href";
    const TITLE_ATTRIBUTE = "data-ghm-title";
    let observer = null;
    let scanTimer = 0;
    let active = false;
    let watcher = null;

    function activeProxy() {
      return NodeRegistry.proxyById(SettingsStore.get().proxyId);
    }

    function consider(anchor) {
      if (!anchor || anchor.nodeType !== 1) return;
      if (anchor.hasAttribute(MARK_ATTRIBUTE)) return;
      const href = anchor.getAttribute("href");
      if (!href || href.charAt(0) === "#") return;
      if (href.indexOf("mailto:") === 0 || href.indexOf("javascript:") === 0) return;

      const absolute = UrlMapper.toAbsolute(href);
      if (!absolute) return;
      const kind = UrlMapper.downloadKind(absolute);
      if (!kind) return;
      if (UrlMapper.isAccelerated(absolute)) return;

      const proxy = activeProxy();
      if (!proxy) return;
      const proxied = UrlMapper.buildDownloadUrl(absolute, proxy);
      if (!proxied || proxied === absolute.href) return;

      const originalTitle = anchor.getAttribute("title");
      if (originalTitle) anchor.setAttribute(TITLE_ATTRIBUTE, originalTitle);
      anchor.setAttribute(RAW_HREF_ATTRIBUTE, href);
      anchor.setAttribute(ORIGINAL_ATTRIBUTE, absolute.href);
      anchor.setAttribute("href", proxied);
      anchor.setAttribute(MARK_ATTRIBUTE, kind);
      anchor.setAttribute("title", "已通过 " + proxy.label + " 加速（原始地址：" + absolute.href + "）");
      anchor.classList.add("ghm-link-boosted");
    }

    function scan(root) {
      const scope = root && typeof root.querySelectorAll === "function" ? root : document;
      let nodes;
      try {
        nodes = scope.querySelectorAll("a[href]");
      } catch (error) {
        return;
      }
      for (let index = 0; index < nodes.length; index += 1) {
        try { consider(nodes[index]); } catch (error) { /* 单个链接失败不影响其余 */ }
      }
    }

    function scheduleScan() {
      if (scanTimer) return;
      scanTimer = window.setTimeout(function () {
        scanTimer = 0;
        if (active) scan(document);
      }, 180);
    }

    function attachObserver() {
      if (observer || typeof MutationObserver !== "function" || !document.body) return;
      observer = new MutationObserver(function (records) {
        if (records && records.length) scheduleScan();
      });
      observer.observe(document.body, { childList: true, subtree: true });
      Log.info("已监听 DOM 变化");
    }

    function start() {
      if (active) return;
      const settings = SettingsStore.get();
      if (!settings.enabled || !settings.rewriteDownloads) return;
      active = true;
      scan(document);
      attachObserver();
      Log.info("下载链接改写已启用");
    }

    function stop() {
      active = false;
      if (scanTimer) {
        clearTimeout(scanTimer);
        scanTimer = 0;
      }
      if (observer) {
        observer.disconnect();
        observer = null;
      }
    }

    function sync() {
      const settings = SettingsStore.get();
      if (!settings.enabled || !settings.rewriteDownloads) {
        stop();
        return;
      }
      start();
      scan(document);
    }

    function restoreAll() {
      let nodes = [];
      try { nodes = document.querySelectorAll("a[" + MARK_ATTRIBUTE + "]"); } catch (error) { return; }
      for (let index = 0; index < nodes.length; index += 1) {
        const anchor = nodes[index];
        const rawHref = anchor.getAttribute(RAW_HREF_ATTRIBUTE);
        const original = anchor.getAttribute(ORIGINAL_ATTRIBUTE);
        const originalTitle = anchor.getAttribute(TITLE_ATTRIBUTE);
        if (rawHref !== null) anchor.setAttribute("href", rawHref);
        else if (original) anchor.setAttribute("href", original);
        if (originalTitle !== null) anchor.setAttribute("title", originalTitle);
        else anchor.removeAttribute("title");
        anchor.removeAttribute(MARK_ATTRIBUTE);
        anchor.removeAttribute(ORIGINAL_ATTRIBUTE);
        anchor.removeAttribute(RAW_HREF_ATTRIBUTE);
        anchor.removeAttribute(TITLE_ATTRIBUTE);
        anchor.classList.remove("ghm-link-boosted");
      }
      Log.info("已恢复原始链接", nodes.length);
    }

    function watch() {
      if (watcher) return;
      let lastKey = "";
      watcher = SettingsStore.subscribe(function (settings) {
        const key = [settings.proxyId, settings.enabled, settings.rewriteDownloads].join("|");
        if (key === lastKey) return;
        lastKey = key;
        restoreAll();
        sync();
      });
      const current = SettingsStore.get();
      lastKey = [current.proxyId, current.enabled, current.rewriteDownloads].join("|");
    }

    return { start: start, stop: stop, sync: sync, restoreAll: restoreAll, scan: scan, watch: watch };
  })();

  /* ================================================================== *
   * 9. 通知
   * ================================================================== */

  const Notifier = (function () {
    function notify(message) {
      try {
        if (typeof GM_notification === "function") {
          GM_notification({ title: "GitHub 镜像加速", text: message, timeout: 2600 });
          return;
        }
      } catch (error) {
        Log.warn("系统通知不可用", error);
      }
      try { MirrorHub.toast(message); } catch (error) { Log.info(message); }
    }
    return { notify: notify };
  })();


  /* ================================================================== *
   * 10. 悬浮面板
   * ================================================================== */

  const HUB_STYLE = `
:host { all: initial; }

.ghm-shell {
  --ghm-brand: #2563eb;
  --ghm-brand-hover: #1d4ed8;
  --ghm-text: #0f172a;
  --ghm-text-2: #475569;
  --ghm-text-3: #8b98ab;
  --ghm-line: #e7ebf2;
  --ghm-line-soft: #f2f5f9;
  --ghm-surface: #f6f8fb;
  --ghm-surface-2: #ffffff;
  --ghm-ok: #15803d;
  --ghm-bad: #b91c1c;
  --ghm-warn: #b45309;
  --ghm-ease: cubic-bezier(.22, 1, .36, 1);
  position: fixed;
  left: 16px;
  top: 92px;
  width: 348px;
  height: 468px;
  z-index: 2147483000;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  font-size: 13px;
  line-height: 1.5;
  color: var(--ghm-text);
  -webkit-font-smoothing: antialiased;
  color-scheme: light dark;
  transition: width .2s var(--ghm-ease), height .2s var(--ghm-ease);
  animation: ghmPopIn .22s var(--ghm-ease) both;
}

.ghm-shell, .ghm-shell * { box-sizing: border-box; }

.ghm-shell[data-state="closed"] { width: 56px; height: 56px; }
.ghm-shell[data-dragging="true"] { transition: none; }
.ghm-shell[data-dragging="true"] * { cursor: grabbing !important; user-select: none; }

.ghm-panel {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--ghm-surface-2);
  border: 1px solid var(--ghm-line);
  border-radius: 16px;
  box-shadow: 0 18px 44px -18px rgba(15, 23, 42, .38), 0 2px 8px rgba(15, 23, 42, .06);
  opacity: 1;
  transform: none;
  transition: opacity .16s ease, transform .18s var(--ghm-ease);
}

.ghm-shell[data-state="closed"] .ghm-panel { opacity: 0; transform: scale(.96); pointer-events: none; }

.ghm-head {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 10px 10px 12px;
  border-bottom: 1px solid var(--ghm-line);
  background: var(--ghm-surface-2);
  cursor: grab;
  touch-action: none;
}

.ghm-mark {
  flex: none;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 9px;
  color: #fff;
  background: linear-gradient(135deg, #2563eb, #4f46e5);
  box-shadow: 0 4px 10px -4px rgba(37, 99, 235, .65);
}

.ghm-titles { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.ghm-title { font-size: 13px; font-weight: 650; letter-spacing: .01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ghm-sub { display: flex; align-items: center; gap: 5px; font-size: 11px; color: var(--ghm-text-3); white-space: nowrap; overflow: hidden; }
.ghm-sub-text { overflow: hidden; text-overflow: ellipsis; }
.ghm-sub-dot { flex: none; width: 6px; height: 6px; border-radius: 50%; background: #94a3b8; }
.ghm-sub[data-tone="ok"] .ghm-sub-dot { background: var(--ghm-ok); }
.ghm-sub[data-tone="bad"] .ghm-sub-dot { background: var(--ghm-bad); }
.ghm-sub[data-tone="pending"] .ghm-sub-dot { background: var(--ghm-warn); animation: ghmPulse 1.1s ease-in-out infinite; }

.ghm-head-actions { flex: none; display: flex; align-items: center; gap: 2px; }

.ghm-icon {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--ghm-text-3);
  cursor: pointer;
  transition: background .15s, color .15s;
}

.ghm-icon:hover { background: var(--ghm-surface); color: var(--ghm-text); }
.ghm-icon:focus-visible { outline: 2px solid var(--ghm-brand); outline-offset: 1px; }
.ghm-icon:disabled { opacity: .45; cursor: default; }

.ghm-tabs {
  flex: none;
  display: flex;
  gap: 2px;
  padding: 6px;
  background: var(--ghm-surface);
  border-bottom: 1px solid var(--ghm-line);
}

.ghm-tab {
  flex: 1;
  height: 26px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--ghm-text-2);
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background .15s, color .15s, box-shadow .15s;
}

.ghm-tab:hover { color: var(--ghm-text); }
.ghm-tab[aria-selected="true"] { background: var(--ghm-surface-2); color: var(--ghm-brand); box-shadow: 0 1px 2px rgba(15, 23, 42, .08); }
.ghm-tab:focus-visible { outline: 2px solid var(--ghm-brand); outline-offset: 1px; }

.ghm-body { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; padding: 10px; }

.ghm-view { display: none; flex-direction: column; gap: 10px; }
.ghm-view[data-active="true"] { display: flex; }

.ghm-health {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px;
  border: 1px solid var(--ghm-line);
  border-radius: 12px;
  background: var(--ghm-surface);
}

.ghm-health-dot { flex: none; width: 9px; height: 9px; border-radius: 50%; background: #94a3b8; box-shadow: 0 0 0 4px rgba(148, 163, 184, .16); }
.ghm-health[data-tone="ok"] .ghm-health-dot { background: var(--ghm-ok); box-shadow: 0 0 0 4px rgba(21, 128, 61, .14); }
.ghm-health[data-tone="bad"] .ghm-health-dot { background: var(--ghm-bad); box-shadow: 0 0 0 4px rgba(185, 28, 28, .14); }
.ghm-health[data-tone="pending"] .ghm-health-dot { background: var(--ghm-warn); animation: ghmPulse 1.1s ease-in-out infinite; }

.ghm-health-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.ghm-health-title { font-size: 12.5px; font-weight: 600; }
.ghm-health-meta { font-size: 11px; color: var(--ghm-text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.ghm-latency {
  flex: none;
  padding: 1px 7px;
  border: 1px solid var(--ghm-line);
  border-radius: 99px;
  background: var(--ghm-surface-2);
  color: var(--ghm-text-2);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.ghm-section { display: flex; flex-direction: column; gap: 6px; }
.ghm-section-title { font-size: 10.5px; font-weight: 650; letter-spacing: .06em; text-transform: uppercase; color: var(--ghm-text-3); }

.ghm-select, .ghm-input {
  width: 100%;
  height: 30px;
  padding: 0 8px;
  border: 1px solid var(--ghm-line);
  border-radius: 8px;
  background: var(--ghm-surface-2);
  color: var(--ghm-text);
  font: inherit;
  font-size: 12px;
  outline: none;
  transition: border-color .15s, box-shadow .15s;
}

.ghm-select:focus, .ghm-input:focus { border-color: var(--ghm-brand); box-shadow: 0 0 0 3px rgba(37, 99, 235, .14); }
.ghm-input-number { width: 76px; flex: none; text-align: right; }

.ghm-btn {
  width: 100%;
  min-height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 0 10px;
  border: 1px solid var(--ghm-line);
  border-radius: 8px;
  background: var(--ghm-surface-2);
  color: var(--ghm-text-2);
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background .15s, border-color .15s, color .15s;
}

.ghm-btn:hover { background: var(--ghm-surface); color: var(--ghm-text); }
.ghm-btn:focus-visible { outline: 2px solid var(--ghm-brand); outline-offset: 1px; }
.ghm-btn-primary { border-color: transparent; background: var(--ghm-brand); color: #fff; }
.ghm-btn-primary:hover { background: var(--ghm-brand-hover); color: #fff; }
.ghm-btn:disabled, .ghm-btn-primary:disabled { opacity: .5; cursor: not-allowed; }
.ghm-select:disabled { opacity: .6; cursor: not-allowed; }

.ghm-field { display: flex; flex-direction: column; gap: 6px; }
.ghm-field-row { display: flex; align-items: center; gap: 6px; }
.ghm-field-row .ghm-select { flex: 1; min-width: 0; }
.ghm-icon-field { flex: none; width: 30px; height: 30px; border: 1px solid var(--ghm-line); background: var(--ghm-surface-2); }
.ghm-icon-field:hover { background: var(--ghm-surface); }
.ghm-editor { display: none; flex-direction: column; gap: 6px; padding: 8px; border: 1px solid var(--ghm-line); border-radius: 10px; background: var(--ghm-surface); }
.ghm-editor[data-open="true"] { display: flex; }
.ghm-editor-row { display: flex; gap: 6px; }
.ghm-editor-row .ghm-input { flex: 1; min-width: 0; }
.ghm-editor-add { width: auto; flex: none; padding: 0 12px; }
.ghm-actions { flex: none; display: flex; gap: 6px; padding: 8px 10px; border-top: 1px solid var(--ghm-line); background: var(--ghm-surface-2); }
.ghm-actions .ghm-btn { flex: 1; }
.ghm-btn-row { display: flex; gap: 6px; }

.ghm-hint { font-size: 11px; line-height: 1.45; color: var(--ghm-text-3); }

.ghm-row { display: flex; align-items: center; gap: 10px; padding: 8px 2px; border-top: 1px solid var(--ghm-line-soft); }
.ghm-row:first-of-type { border-top: 0; }
.ghm-row-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.ghm-row-label { font-size: 12px; font-weight: 500; }
.ghm-row-hint { font-size: 10.5px; color: var(--ghm-text-3); }
.ghm-row-toggle { cursor: pointer; }

.ghm-switch { position: relative; flex: none; width: 34px; height: 20px; display: inline-flex; }
.ghm-switch-input { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; z-index: 2; }
.ghm-switch-track { position: absolute; inset: 0; border-radius: 99px; background: #cbd5e1; transition: background .18s; }
.ghm-switch-track::after { content: ""; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: #fff; box-shadow: 0 1px 2px rgba(15, 23, 42, .28); transition: transform .18s var(--ghm-ease); }
.ghm-switch-input:checked + .ghm-switch-track { background: var(--ghm-brand); }
.ghm-switch-input:checked + .ghm-switch-track::after { transform: translateX(14px); }
.ghm-switch-input:focus-visible + .ghm-switch-track { box-shadow: 0 0 0 3px rgba(37, 99, 235, .22); }

.ghm-node-list { display: flex; flex-direction: column; gap: 4px; }

.ghm-node {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--ghm-line);
  border-radius: 8px;
  background: var(--ghm-surface-2);
  color: var(--ghm-text);
  font: inherit;
  cursor: pointer;
  text-align: left;
  transition: background .12s, border-color .12s, box-shadow .12s;
}

.ghm-node:hover { background: var(--ghm-surface); }
.ghm-node[aria-pressed="true"] { border-color: var(--ghm-brand); box-shadow: 0 0 0 2px rgba(37, 99, 235, .16); }
.ghm-node-host { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10.5px; }
.ghm-node-latency { flex: none; font-size: 10px; color: var(--ghm-text-3); font-variant-numeric: tabular-nums; }
.ghm-node[aria-pressed="true"] .ghm-node-latency { color: var(--ghm-brand); }

.ghm-chip-list { display: flex; flex-direction: column; gap: 4px; }

.ghm-chip { display: flex; align-items: center; gap: 4px; }

.ghm-chip-main {
  flex: 1;
  min-width: 0;
  padding: 5px 8px;
  border: 1px solid var(--ghm-line);
  border-radius: 8px;
  background: var(--ghm-surface-2);
  color: var(--ghm-text);
  font: inherit;
  font-size: 11px;
  text-align: left;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ghm-chip-main[aria-pressed="true"] { border-color: var(--ghm-brand); color: var(--ghm-brand); box-shadow: 0 0 0 2px rgba(37, 99, 235, .14); }

.ghm-chip-x {
  flex: none;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 1px solid var(--ghm-line);
  border-radius: 8px;
  background: var(--ghm-surface-2);
  color: var(--ghm-text-3);
  font: inherit;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
}

.ghm-chip-x:hover { color: var(--ghm-bad); border-color: var(--ghm-bad); }

.ghm-foot {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-top: 1px solid var(--ghm-line);
  background: var(--ghm-surface);
  font-size: 10.5px;
  color: var(--ghm-text-3);
}

.ghm-foot-side { flex: 1 1 0; min-width: 0; }
.ghm-foot-by { flex: 0 0 auto; letter-spacing: .02em; opacity: .85; color: inherit; text-decoration: none; cursor: pointer; }
.ghm-foot-by:hover { opacity: 1; color: var(--ghm-text); text-decoration: underline; }
.ghm-foot-link { flex: 1 1 0; margin-left: auto; padding: 2px 5px; border: 0; border-radius: 5px; background: transparent; color: var(--ghm-text-3); font: inherit; font-size: 10.5px; text-align: right; cursor: pointer; }
.ghm-foot-link:hover { background: var(--ghm-surface-2); color: var(--ghm-text); }

.ghm-orb {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid var(--ghm-line);
  border-radius: 50%;
  background: var(--ghm-surface-2);
  color: var(--ghm-brand);
  cursor: grab;
  touch-action: none;
  opacity: 0;
  visibility: hidden;
  transform: scale(.82);
  transition: opacity .16s ease, transform .2s var(--ghm-ease), box-shadow .2s;
  box-shadow: 0 12px 28px -12px rgba(15, 23, 42, .44), 0 1px 3px rgba(15, 23, 42, .08);
}

.ghm-orb:active { cursor: grabbing; }
.ghm-orb:focus-visible { outline: 2px solid var(--ghm-brand); outline-offset: 2px; }
.ghm-shell[data-state="closed"] .ghm-orb { opacity: 1; visibility: visible; transform: none; }

.ghm-orb-core {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: linear-gradient(135deg, #2563eb, #4f46e5);
  color: #fff;
  box-shadow: 0 4px 10px -3px rgba(37, 99, 235, .7);
}

.ghm-orb[data-probing="true"] .ghm-orb-core::after {
  content: "";
  position: absolute;
  inset: -5px;
  border-radius: 50%;
  border: 2px solid rgba(37, 99, 235, .25);
  border-top-color: var(--ghm-brand);
  animation: ghmSpin .9s linear infinite;
}

.ghm-orb-dot { position: absolute; right: 5px; bottom: 5px; width: 9px; height: 9px; border-radius: 50%; background: #94a3b8; box-shadow: 0 0 0 2px var(--ghm-surface-2); }
.ghm-orb-dot[data-tone="ok"] { background: var(--ghm-ok); }
.ghm-orb-dot[data-tone="bad"] { background: var(--ghm-bad); }
.ghm-orb-dot[data-tone="pending"] { background: var(--ghm-warn); animation: ghmPulse 1.1s ease-in-out infinite; }

.ghm-toast {
  position: absolute;
  left: 50%;
  bottom: 12px;
  max-width: calc(100% - 24px);
  padding: 6px 10px;
  border-radius: 8px;
  background: rgba(15, 23, 42, .92);
  color: #fff;
  font-size: 11px;
  line-height: 1.4;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  opacity: 0;
  transform: translate(-50%, 8px);
  pointer-events: none;
  transition: opacity .18s, transform .18s;
}

.ghm-toast[data-visible="true"] { opacity: 1; transform: translate(-50%, 0); }

.ghm-shell[data-state="closed"] .ghm-toast {
  bottom: calc(100% + 10px);
  left: 50%;
  max-width: 220px;
  padding: 5px 9px;
  white-space: normal;
  text-align: center;
  line-height: 1.35;
  box-shadow: 0 8px 20px -10px rgba(15, 23, 42, .5);
}

.ghm-shell ::-webkit-scrollbar { width: 4px; height: 4px; }
.ghm-shell ::-webkit-scrollbar-track { background: transparent; }
.ghm-shell ::-webkit-scrollbar-thumb { background: #d7dee8; border-radius: 99px; }

@keyframes ghmPulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: .45; transform: scale(.82); } }
@keyframes ghmSpin { to { transform: rotate(360deg); } }
@keyframes ghmPopIn { from { opacity: 0; transform: translateY(6px) scale(.98); } to { opacity: 1; transform: none; } }

@media (max-width: 430px) {
  .ghm-shell { width: calc(100vw - 20px); height: min(468px, calc(100vh - 40px)); }
}

@media (prefers-color-scheme: dark) {
  .ghm-shell {
    --ghm-text: #e6edf3;
    --ghm-text-2: #c2ccd8;
    --ghm-text-3: #8b98a8;
    --ghm-line: #2b3441;
    --ghm-line-soft: #222a35;
    --ghm-surface: #171c24;
    --ghm-surface-2: #0f141b;
    --ghm-ok: #3fb950;
    --ghm-bad: #f85149;
    --ghm-warn: #d29922;
  }
  .ghm-switch-track { background: #3a4552; }
  .ghm-orb-dot { background: #4a5563; }
}

@media (prefers-reduced-motion: reduce) {
  .ghm-shell, .ghm-shell * { transition-duration: .001ms !important; animation-duration: .001ms !important; animation-iteration-count: 1 !important; }
}
`;

  const MirrorHub = (function () {
    const SIZE = { width: 348, height: 468, orb: 56, margin: 10 };
    const DEFAULT_TOP = 92;
    const DEFAULT_RIGHT_GAP = 16;
    const AUTO_COLLAPSE_DELAY = 20000;

    const state = {
      mounted: false,
      collapsed: false,
      dragging: false,
      dragMoved: false,
      probing: false,
      nodeChecking: false,
      checking: false,
      editor: "",
      view: "status",
      position: { x: 16, y: DEFAULT_TOP }
    };

    const refs = {};
    let shadow = null;
    let hostElement = null;
    let toastTimer = 0;
    let idleTimer = 0;
    let resizeTimer = 0;
    let unsubscribe = null;

    function mount() {
      if (state.mounted || !document.body) return;
      if (document.getElementById("gh-mirror-hub")) return;

      hostElement = document.createElement("div");
      hostElement.id = "gh-mirror-hub";
      document.body.appendChild(hostElement);
      if (typeof hostElement.attachShadow !== "function") {
        Log.warn("浏览器不支持 Shadow DOM，面板不可用");
        return;
      }

      shadow = hostElement.attachShadow({ mode: "open" });
      const styleElement = document.createElement("style");
      styleElement.textContent = HUB_STYLE;
      shadow.appendChild(styleElement);

      shadow.appendChild(buildShell());
      state.mounted = true;

      const panelSettings = SettingsStore.get().panel;
      state.collapsed = panelSettings.collapsed === true || Site.kindOf(Site.hostname()) === "raw";
      refs.shell.setAttribute("data-state", state.collapsed ? "closed" : "open");

      restorePosition();
      bindEvents();
      syncAll();
      unsubscribe = SettingsStore.subscribe(syncAll);
      autoRefresh();
      Log.info("面板已挂载");
    }

    function buildShell() {
      const shell = Dom.create("div", { class: "ghm-shell", "data-state": "open", "data-dragging": "false" });
      refs.shell = shell;
      refs.panel = buildPanel();
      refs.orb = buildOrb();
      refs.toast = Dom.create("div", { class: "ghm-toast", "data-visible": "false", role: "status", "aria-live": "polite" });
      shell.appendChild(refs.panel);
      shell.appendChild(refs.orb);
      shell.appendChild(refs.toast);
      return shell;
    }

    function buildHeader() {
      const subText = Dom.create("span", { class: "ghm-sub-text", text: "正在检测…" });
      const sub = Dom.create("span", { class: "ghm-sub", "data-tone": "pending" }, [
        Dom.create("i", { class: "ghm-sub-dot" }),
        subText
      ]);
      refs.sub = sub;
      refs.subText = subText;

      refs.probeButton = Dom.create("button", {
        class: "ghm-icon",
        type: "button",
        title: "立即检测连通性",
        "aria-label": "立即检测连通性",
        "data-action": "probe",
        "data-no-drag": "1"
      }, [Dom.icon("refresh", 15)]);

      refs.collapseButton = Dom.create("button", {
        class: "ghm-icon",
        type: "button",
        title: "收起为悬浮球",
        "aria-label": "收起为悬浮球",
        "data-action": "collapse",
        "data-no-drag": "1"
      }, [Dom.icon("collapse", 16)]);

      return Dom.create("header", { class: "ghm-head", "data-drag": "1" }, [
        Dom.create("span", { class: "ghm-mark" }, [Dom.icon("bolt", 16)]),
        Dom.create("div", { class: "ghm-titles" }, [
          Dom.create("div", { class: "ghm-title", text: "GitHub 镜像加速" }),
          sub
        ]),
        Dom.create("div", { class: "ghm-head-actions" }, [refs.probeButton, refs.collapseButton])
      ]);
    }

    function buildTabs() {
      const tabs = Dom.create("nav", { class: "ghm-tabs", role: "tablist" });
      const definitions = [
        { key: "status", label: "状态" },
        { key: "settings", label: "设置" }
      ];
      definitions.forEach(function (definition) {
        const button = Dom.create("button", {
          class: "ghm-tab",
          type: "button",
          role: "tab",
          "data-action": "tab",
          "data-tab": definition.key,
          "aria-selected": definition.key === state.view ? "true" : "false",
          text: definition.label
        });
        if (definition.key === "status") refs.statusTab = button;
        else refs.settingsTab = button;
        tabs.appendChild(button);
      });
      return tabs;
    }


    function buildPanel() {
      const panel = Dom.create("section", { class: "ghm-panel", role: "dialog", "aria-label": "GitHub 镜像加速" });
      panel.appendChild(buildHeader());
      panel.appendChild(buildTabs());

      const body = Dom.create("div", { class: "ghm-body" });
      refs.statusView = buildStatusView();
      refs.settingsView = buildSettingsView();
      body.appendChild(refs.statusView);
      body.appendChild(refs.settingsView);
      panel.appendChild(body);
      panel.appendChild(buildActions());
      panel.appendChild(buildFooter());
      return panel;
    }

    function buildActions() {
      refs.mirrorButton = Dom.create("button", {
        class: "ghm-btn ghm-btn-primary",
        type: "button",
        "data-action": "switch",
        text: "立即切换到镜像"
      });
      return Dom.create("div", { class: "ghm-actions" }, [
        refs.mirrorButton,
        Dom.create("button", {
          class: "ghm-btn",
          type: "button",
          "data-action": "restore-links",
          text: "恢复原始链接"
        })
      ]);
    }

    function iconButton(iconName, title, action) {
      return Dom.create("button", {
        class: "ghm-icon ghm-icon-field",
        type: "button",
        title: title,
        "aria-label": title,
        "data-action": action
      }, [Dom.icon(iconName, 14)]);
    }

    function buildEditor(kind) {
      const input = Dom.create("input", {
        class: "ghm-input",
        type: "text",
        placeholder: kind === "mirror" ? "镜像地址，如 bgithub.xyz" : "加速地址，如 https://gh-proxy.com/",
        "aria-label": kind === "mirror" ? "新增镜像地址" : "新增加速地址"
      });
      input.addEventListener("keydown", function (event) {
        if (event.key !== "Enter") return;
        event.preventDefault();
        if (kind === "mirror") addMirrorFromInput();
        else addProxyFromInput();
      });
      const chips = Dom.create("div", { class: "ghm-chip-list" });
      const editor = Dom.create("div", { class: "ghm-editor", "data-open": "false", "data-kind": kind }, [
        Dom.create("div", { class: "ghm-editor-row" }, [
          input,
          Dom.create("button", {
            class: "ghm-btn ghm-btn-primary ghm-editor-add",
            type: "button",
            "data-action": kind + "-add",
            text: "添加"
          })
        ]),
        chips
      ]);
      if (kind === "mirror") {
        refs.mirrorInput = input;
        refs.mirrorChips = chips;
        refs.mirrorEditor = editor;
      } else {
        refs.proxyInput = input;
        refs.proxyChips = chips;
        refs.proxyEditor = editor;
      }
      return editor;
    }

    function buildStatusView() {
      refs.healthTitle = Dom.create("strong", { class: "ghm-health-title", text: "正在检测…" });
      refs.healthMeta = Dom.create("span", { class: "ghm-health-meta", text: "请稍候" });
      refs.latency = Dom.create("span", { class: "ghm-latency", text: "--" });
      refs.health = Dom.create("div", { class: "ghm-health", "data-tone": "pending" }, [
        Dom.create("span", { class: "ghm-health-dot" }),
        Dom.create("div", { class: "ghm-health-text" }, [refs.healthTitle, refs.healthMeta]),
        refs.latency
      ]);

      refs.mirrorSelect = Dom.create("select", { class: "ghm-select", "aria-label": "镜像站点" });
      refs.mirrorSelect.addEventListener("change", function () {
        SettingsStore.patch({ mirrorId: refs.mirrorSelect.value });
        syncAll();
      });
      refs.mirrorRefresh = iconButton("refresh", "重新检测镜像延迟", "mirror-refresh");
      refs.mirrorAdd = iconButton("plus", "添加镜像", "mirror-add-open");
      refs.mirrorHint = Dom.create("div", { class: "ghm-hint" });

      refs.proxySelect = Dom.create("select", { class: "ghm-select", "aria-label": "下载加速代理" });
      refs.proxySelect.addEventListener("change", function () {
        selectProxy(refs.proxySelect.value);
      });
      refs.proxyRefresh = iconButton("refresh", "重新测速节点", "proxy-refresh");
      refs.proxyAdd = iconButton("plus", "添加加速地址", "proxy-add-open");
      refs.proxyHint = Dom.create("div", { class: "ghm-hint" });

      const mirrorSection = Dom.create("div", { class: "ghm-field" }, [
        Dom.create("div", { class: "ghm-section-title", text: "镜像站点" }),
        Dom.create("div", { class: "ghm-field-row" }, [refs.mirrorSelect, refs.mirrorRefresh, refs.mirrorAdd]),
        buildEditor("mirror"),
        refs.mirrorHint
      ]);

      const downloadSection = Dom.create("div", { class: "ghm-field" }, [
        Dom.create("div", { class: "ghm-section-title", text: "下载加速" }),
        Dom.create("div", { class: "ghm-field-row" }, [refs.proxySelect, refs.proxyRefresh, refs.proxyAdd]),
        buildEditor("proxy"),
        refs.proxyHint
      ]);

      populateMirrorSelect();
      populateProxySelect();

      return Dom.create("section", {
        class: "ghm-view",
        "data-view": "status",
        "data-active": state.view === "status" ? "true" : "false"
      }, [refs.health, mirrorSection, downloadSection]);
    }

    function switchRow(options) {
      const input = Dom.create("input", { class: "ghm-switch-input", type: "checkbox" });
      input.addEventListener("change", function () {
        const patch = {};
        patch[options.key] = input.checked;
        SettingsStore.patch(patch);
        if (options.key === "enabled" || options.key === "rewriteDownloads") DownloadLinkPatcher.sync();
        if (options.key === "debug") Log.setVerbose(input.checked);
      });
      if (options.bind) options.bind(input);

      return Dom.create("label", { class: "ghm-row ghm-row-toggle" }, [
        Dom.create("span", { class: "ghm-row-main" }, [
          Dom.create("span", { class: "ghm-row-label", text: options.label }),
          options.hint ? Dom.create("span", { class: "ghm-row-hint", text: options.hint }) : null
        ]),
        Dom.create("span", { class: "ghm-switch" }, [
          input,
          Dom.create("span", { class: "ghm-switch-track" })
        ])
      ]);
    }

    function numberRow(options) {
      const input = Dom.create("input", {
        class: "ghm-input ghm-input-number",
        type: "number",
        min: options.min,
        max: options.max,
        step: options.step || 1
      });
      input.addEventListener("change", function () {
        const raw = Number(input.value);
        const safe = isFinite(raw) ? raw : options.fallback;
        const value = Math.round(Math.min(options.max, Math.max(options.min, safe)));
        input.value = String(value);
        const patch = {};
        patch[options.key] = value;
        SettingsStore.patch(patch);
      });
      if (options.bind) options.bind(input);

      return Dom.create("div", { class: "ghm-row" }, [
        Dom.create("span", { class: "ghm-row-main" }, [
          Dom.create("span", { class: "ghm-row-label", text: options.label }),
          options.hint ? Dom.create("span", { class: "ghm-row-hint", text: options.hint }) : null
        ]),
        input
      ]);
    }


    function populateProxySelect() {
      const select = refs.proxySelect;
      if (!select) return;
      const catalog = NodeRegistry.downloadOptions();
      const signature = catalog.map(function (item) { return item.id; }).join("|");
      if (select.getAttribute("data-signature") !== signature) {
        while (select.childNodes.length) select.removeChild(select.childNodes[0]);
        if (!catalog.length) {
          select.appendChild(Dom.create("option", { value: "", text: "暂无可用加速地址" }));
        } else {
          catalog.forEach(function (item) {
            const suffix = item.mode === "host"
              ? " · 镜像"
              : (item.latencyMs ? " · " + Math.round(item.latencyMs) + "ms" : "");
            select.appendChild(Dom.create("option", { value: item.id, text: (item.label || item.id) + suffix }));
          });
        }
        select.setAttribute("data-signature", signature);
      }
      select.disabled = !catalog.length;
      select.value = SettingsStore.get().proxyId;
      if (refs.proxyHint) {
        const value = SettingsStore.get().nodePool;
        const usable = NodeRegistry.usableNodes().length;
        if (state.nodeChecking) refs.proxyHint.textContent = "正在测速节点…";
        else if (!catalog.length) refs.proxyHint.textContent = "暂无可用加速地址，点右侧＋添加。";
        else if (value.testedAt) refs.proxyHint.textContent = "节点可用 " + usable + " / " + value.nodes.length + " · " + Format.relativeTime(value.testedAt) + "测速";
        else refs.proxyHint.textContent = "Release / raw / 归档链接会改写到所选地址。";
      }
    }

    function populateMirrorSelect() {
      const select = refs.mirrorSelect;
      if (!select) return;
      const catalog = Catalog.mirrors();
      const signature = catalog.map(function (item) {
        return item.id + ":" + (item.latencyMs || 0) + (item.ok === false ? "!" : "");
      }).join("|");
      if (select.getAttribute("data-signature") !== signature) {
        while (select.childNodes.length) select.removeChild(select.childNodes[0]);
        if (!catalog.length) {
          select.appendChild(Dom.create("option", { value: "", text: "尚未添加镜像" }));
        } else {
          catalog.forEach(function (item) {
            const suffix = item.ok === false ? " · 不可用" : (item.latencyMs ? " · " + Math.round(item.latencyMs) + "ms" : "");
            select.appendChild(Dom.create("option", { value: item.id, text: item.label + suffix }));
          });
        }
        select.setAttribute("data-signature", signature);
      }
      const hasMirrors = catalog.length > 0;
      select.disabled = !hasMirrors;
      if (refs.mirrorButton) refs.mirrorButton.disabled = !hasMirrors;
      if (refs.mirrorHint) {
        const checkedAt = SettingsStore.get().mirrorsCheckedAt;
        if (!hasMirrors) refs.mirrorHint.textContent = "还没有镜像，点右侧＋添加。";
        else if (state.checking) refs.mirrorHint.textContent = "正在检测镜像延迟…";
        else if (checkedAt) refs.mirrorHint.textContent = "延迟每 10 分钟自动检测一次。";
        else refs.mirrorHint.textContent = "GitHub 不可访问时自动替换页面。";
      }
      select.value = hasMirrors ? SettingsStore.get().mirrorId : "";
    }

    function renderCustomLists() {
      const settings = SettingsStore.get();
      const mirrorSignature = (settings.customMirrors || []).map(function (item) { return item.id; }).join("|") + "#" + settings.mirrorId;
      if (refs.mirrorChips && refs.mirrorChips.getAttribute("data-signature") !== mirrorSignature) {
        refs.mirrorChips.setAttribute("data-signature", mirrorSignature);
        while (refs.mirrorChips.childNodes.length) refs.mirrorChips.removeChild(refs.mirrorChips.childNodes[0]);
        const mirrors = settings.customMirrors || [];
        if (!mirrors.length) refs.mirrorChips.appendChild(Dom.create("div", { class: "ghm-hint", text: "未添加镜像" }));
        mirrors.forEach(function (mirror) {
          refs.mirrorChips.appendChild(Dom.create("div", { class: "ghm-chip" }, [
            Dom.create("button", {
              class: "ghm-chip-main",
              type: "button",
              "data-action": "mirror-pick",
              "data-id": mirror.id,
              "aria-pressed": mirror.id === settings.mirrorId ? "true" : "false",
              text: mirror.label
            }),
            Dom.create("button", {
              class: "ghm-chip-x",
              type: "button",
              "data-action": "mirror-remove",
              "data-id": mirror.id,
              "aria-label": "删除镜像",
              text: "×"
            })
          ]));
        });
      }

      const proxySignature = (settings.customProxies || []).map(function (item) { return item.id; }).join("|") + "#" + settings.proxyId;
      if (refs.proxyChips && refs.proxyChips.getAttribute("data-signature") !== proxySignature) {
        refs.proxyChips.setAttribute("data-signature", proxySignature);
        while (refs.proxyChips.childNodes.length) refs.proxyChips.removeChild(refs.proxyChips.childNodes[0]);
        const proxies = settings.customProxies || [];
        if (!proxies.length) refs.proxyChips.appendChild(Dom.create("div", { class: "ghm-hint", text: "未添加加速地址" }));
        proxies.forEach(function (proxy) {
          refs.proxyChips.appendChild(Dom.create("div", { class: "ghm-chip" }, [
            Dom.create("button", {
              class: "ghm-chip-main",
              type: "button",
              "data-action": "proxy-pick",
              "data-id": proxy.id,
              "aria-pressed": proxy.id === settings.proxyId ? "true" : "false",
              text: proxy.label
            }),
            Dom.create("button", {
              class: "ghm-chip-x",
              type: "button",
              "data-action": "proxy-remove",
              "data-id": proxy.id,
              "aria-label": "删除加速地址",
              text: "×"
            })
          ]));
        });
      }
    }

    function syncEditors() {
      if (refs.mirrorEditor) refs.mirrorEditor.setAttribute("data-open", state.editor === "mirror" ? "true" : "false");
      if (refs.proxyEditor) refs.proxyEditor.setAttribute("data-open", state.editor === "proxy" ? "true" : "false");
    }

    function toggleEditor(kind) {
      state.editor = state.editor === kind ? "" : kind;
      syncEditors();
      if (!state.editor) return;
      const input = state.editor === "mirror" ? refs.mirrorInput : refs.proxyInput;
      if (input) {
        try { input.focus(); } catch (error) { /* 聚焦失败忽略 */ }
      }
    }

    function checkMirrors(options) {
      const silent = options && options.silent === true;
      if (state.checking) return;
      const mirrors = Catalog.mirrors();
      if (!mirrors.length) return;
      state.checking = true;
      if (refs.mirrorRefresh) refs.mirrorRefresh.disabled = true;
      populateMirrorSelect();
      Promise.all(mirrors.map(function (mirror) {
        return Redirector.probeMirror(mirror).then(function (result) {
          return Object.assign({}, mirror, { ok: result.ok, latencyMs: result.latencyMs });
        });
      })).then(function (updated) {
        state.checking = false;
        if (refs.mirrorRefresh) refs.mirrorRefresh.disabled = false;
        SettingsStore.patch({ customMirrors: updated, mirrorsCheckedAt: Date.now() });
        populateMirrorSelect();
        syncControls();
        if (silent) return;
        const okCount = updated.filter(function (item) { return item.ok; }).length;
        toast(okCount + " / " + updated.length + " 个镜像可用");
      });
    }

    function autoRefresh() {
      const settings = SettingsStore.get();
      if (!settings.enabled) return;
      const now = Date.now();
      if (Catalog.mirrors().length && (!settings.mirrorsCheckedAt || now - settings.mirrorsCheckedAt > MIRROR_CACHE_MS)) {
        checkMirrors({ silent: true });
      }
      if (!settings.nodePool.testedAt || now - settings.nodePool.testedAt > NODE_TEST_CACHE_MS) {
        runNodeCheck({ silent: true });
      }
    }

    function afterCustomChange() {
      NodeRegistry.fixSelection();
      populateMirrorSelect();
      populateProxySelect();
      renderCustomLists();
      syncControls();
      DownloadLinkPatcher.restoreAll();
      DownloadLinkPatcher.sync();
    }

    function buildSettingsView() {
      const behavior = Dom.create("div", { class: "ghm-section" }, [
        Dom.create("div", { class: "ghm-section-title", text: "行为与检测" })
      ]);

      const toggles = [
        { key: "enabled", label: "启用加速", hint: "关闭后不再探测、跳转或改写链接", bind: function (input) { refs.enabledInput = input; } },
        { key: "autoRedirect", label: "自动跳转镜像", hint: "确认不可访问时自动切换", bind: function (input) { refs.autoRedirectInput = input; } },
        { key: "respectLogin", label: "登录后不跳转", hint: "检测到 GitHub 登录态时留在原站", bind: function (input) { refs.respectLoginInput = input; } },
        { key: "rewriteDownloads", label: "下载链接加速", hint: "Release / raw / 归档链接走代理", bind: function (input) { refs.rewriteInput = input; } },
        { key: "globalRewrite", label: "全站接管 GitHub 链接", hint: "其他网页上的 GitHub 链接在直连不通时改写到镜像", bind: function (input) { refs.globalRewriteInput = input; } },
        { key: "autoCollapse", label: "空闲自动收起", hint: "20 秒无操作后收成悬浮球", bind: function (input) { refs.autoCollapseInput = input; } },
        { key: "debug", label: "调试日志", hint: "在控制台输出运行细节", bind: function (input) { refs.debugInput = input; } }
      ];
      toggles.forEach(function (toggle) { behavior.appendChild(switchRow(toggle)); });

      behavior.appendChild(numberRow({
        key: "probeTimeoutMs",
        label: "检测超时",
        hint: "1000 - 15000 毫秒",
        min: 1000,
        max: 15000,
        step: 500,
        fallback: DEFAULT_SETTINGS.probeTimeoutMs,
        bind: function (input) { refs.timeoutInput = input; }
      }));

      behavior.appendChild(numberRow({
        key: "probeCacheMinutes",
        label: "结果缓存",
        hint: "1 - 120 分钟",
        min: 1,
        max: 120,
        step: 1,
        fallback: DEFAULT_SETTINGS.probeCacheMinutes,
        bind: function (input) { refs.cacheInput = input; }
      }));

      const maintenance = Dom.create("div", { class: "ghm-section" }, [
        Dom.create("div", { class: "ghm-section-title", text: "维护" }),
        Dom.create("button", { class: "ghm-btn", type: "button", "data-action": "reset-position", text: "重置面板位置" }),
        Dom.create("button", { class: "ghm-btn", type: "button", "data-action": "reset-settings", text: "恢复默认设置" })
      ]);

      return Dom.create("section", {
        class: "ghm-view",
        "data-view": "settings",
        "data-active": state.view === "settings" ? "true" : "false"
      }, [behavior, maintenance]);
    }

    function buildFooter() {
      return Dom.create("footer", { class: "ghm-foot" }, [
        Dom.create("span", { class: "ghm-foot-side", text: "v" + SCRIPT_VERSION }),
        Dom.create("a", {
          class: "ghm-foot-by",
          href: "https://github.com/piaopiaosir",
          target: "_blank",
          rel: "noopener noreferrer",
          title: "访问 PIAOPIAO 的 GitHub 主页",
          text: "by PIAOPIAO"
        }),
        Dom.create("button", {
          class: "ghm-foot-link",
          type: "button",
          "data-action": "reset-settings",
          text: "恢复默认"
        })
      ]);
    }

    function buildOrb() {
      refs.orbDot = Dom.create("span", { class: "ghm-orb-dot", "data-tone": "idle" });
      const orb = Dom.create("button", {
        class: "ghm-orb",
        type: "button",
        "data-action": "expand",
        "data-drag": "1",
        "data-probing": "false",
        title: "展开 GitHub 镜像加速面板",
        "aria-label": "展开 GitHub 镜像加速面板"
      }, [
        Dom.create("span", { class: "ghm-orb-core" }, [Dom.icon("bolt", 15)]),
        refs.orbDot
      ]);
      return orb;
    }


    /* ---------- 位置与尺寸 ---------- */

    function targetSize() {
      if (state.collapsed) return { width: SIZE.orb, height: SIZE.orb };
      return {
        width: Math.min(SIZE.width, Math.max(200, window.innerWidth - SIZE.margin * 2)),
        height: Math.min(SIZE.height, Math.max(200, window.innerHeight - SIZE.margin * 2))
      };
    }

    function clampPoint(x, y, forcedSize) {
      const size = forcedSize || targetSize();
      const maxX = Math.max(SIZE.margin, window.innerWidth - size.width - SIZE.margin);
      const maxY = Math.max(SIZE.margin, window.innerHeight - size.height - SIZE.margin);
      const safeX = typeof x === "number" && isFinite(x) ? x : SIZE.margin;
      const safeY = typeof y === "number" && isFinite(y) ? y : DEFAULT_TOP;
      return {
        x: Math.min(Math.max(SIZE.margin, safeX), maxX),
        y: Math.min(Math.max(SIZE.margin, safeY), maxY)
      };
    }

    function applyPosition(x, y) {
      state.position.x = x;
      state.position.y = y;
      if (!refs.shell) return;
      refs.shell.style.left = Math.round(x) + "px";
      refs.shell.style.top = Math.round(y) + "px";
    }

    function persistPosition() {
      SettingsStore.patch({
        panel: {
          x: Math.round(state.position.x),
          y: Math.round(state.position.y),
          collapsed: state.collapsed
        }
      });
    }

    function restorePosition() {
      const saved = SettingsStore.get().panel || {};
      const defaultX = Math.max(SIZE.margin, window.innerWidth - SIZE.width - DEFAULT_RIGHT_GAP);
      const x = typeof saved.x === "number" && isFinite(saved.x) ? saved.x : defaultX;
      const y = typeof saved.y === "number" && isFinite(saved.y) ? saved.y : DEFAULT_TOP;
      const point = clampPoint(x, y);
      applyPosition(point.x, point.y);
    }

    /* ---------- 展开 / 收起 ---------- */

    function collapse() {
      if (!state.mounted || state.collapsed) return;
      state.collapsed = true;
      refs.shell.setAttribute("data-state", "closed");
      cancelIdleCollapse();
      persistPosition();
      syncOrb();
    }

    function expand() {
      if (!state.mounted || !state.collapsed) return;
      state.collapsed = false;
      refs.shell.setAttribute("data-state", "open");
      const point = clampPoint(state.position.x, state.position.y, targetSize());
      applyPosition(point.x, point.y);
      persistPosition();
      scheduleIdleCollapse();
      syncAll();
    }

    function scheduleIdleCollapse() {
      cancelIdleCollapse();
      if (state.collapsed || !SettingsStore.get().autoCollapse) return;
      idleTimer = window.setTimeout(function () {
        idleTimer = 0;
        collapse();
      }, AUTO_COLLAPSE_DELAY);
    }

    function cancelIdleCollapse() {
      if (!idleTimer) return;
      window.clearTimeout(idleTimer);
      idleTimer = 0;
    }

    /* ---------- 拖拽 ---------- */

    function startDrag(event) {
      if (state.dragging) return;
      const rect = refs.shell.getBoundingClientRect();
      state.dragging = true;
      state.dragMoved = false;
      state.pointerOffsetX = event.clientX - rect.left;
      state.pointerOffsetY = event.clientY - rect.top;
      state.pointerStartX = event.clientX;
      state.pointerStartY = event.clientY;
      refs.shell.setAttribute("data-dragging", "true");
      cancelIdleCollapse();
      document.addEventListener("pointermove", handlePointerMove, true);
      document.addEventListener("pointerup", handlePointerUp, true);
      document.addEventListener("pointercancel", handlePointerUp, true);
    }

    function handlePointerMove(event) {
      if (!state.dragging) return;
      const deltaX = event.clientX - state.pointerStartX;
      const deltaY = event.clientY - state.pointerStartY;
      if (!state.dragMoved && Math.abs(deltaX) + Math.abs(deltaY) > 3) state.dragMoved = true;
      if (!state.dragMoved) return;
      if (event.cancelable) event.preventDefault();
      const point = clampPoint(event.clientX - state.pointerOffsetX, event.clientY - state.pointerOffsetY);
      applyPosition(point.x, point.y);
    }

    function handlePointerUp() {
      if (!state.dragging) return;
      document.removeEventListener("pointermove", handlePointerMove, true);
      document.removeEventListener("pointerup", handlePointerUp, true);
      document.removeEventListener("pointercancel", handlePointerUp, true);
      if (refs.shell) refs.shell.setAttribute("data-dragging", "false");
      const wasMoved = state.dragMoved;
      state.dragging = false;
      state.dragMoved = false;
      const point = clampPoint(state.position.x, state.position.y);
      applyPosition(point.x, point.y);
      persistPosition();
      if (!wasMoved && state.collapsed) expand();
      else scheduleIdleCollapse();
    }

    function handlePointerDown(event) {
      if (!state.mounted) return;
      if (event.button !== undefined && event.button !== 0) return;
      const target = event.target;
      if (!target || typeof target.closest !== "function") return;
      if (target.closest("[data-no-drag]")) return;
      if (!target.closest("[data-drag]")) return;
      startDrag(event);
    }

    /* ---------- 视图刷新 ---------- */

    function syncAll() {
      if (!state.mounted) return;
      syncStatus();
      syncControls();
      syncOrb();
    }

    function syncStatus() {
      if (!refs.health) return;
      const settings = SettingsStore.get();
      const probe = settings.lastProbe || {};
      const tone = state.probing ? "pending" : (probe.reachable === true ? "ok" : (probe.reachable === false ? "bad" : "idle"));
      const loginName = Site.readLoginName();

      let title = "尚未检测";
      let meta = "点击右上角的刷新按钮开始探测";

      if (state.probing) {
        title = "正在检测 GitHub 连通性…";
        meta = "超时上限 " + settings.probeTimeoutMs + " ms";
      } else if (tone === "ok") {
        title = "GitHub 可访问";
        meta = "延迟 " + Format.latency(probe.latencyMs) + " · " + Format.relativeTime(probe.at);
      } else if (tone === "bad") {
        title = "GitHub 无法访问";
        if (loginName && settings.respectLogin) meta = "检测到登录态 " + loginName + "，已跳过自动跳转";
        else if (settings.autoRedirect) meta = "已切换到镜像 · " + Format.relativeTime(probe.at);
        else meta = "可在下方手动切换镜像 · " + Format.relativeTime(probe.at);
      }

      refs.health.setAttribute("data-tone", tone);
      refs.healthTitle.textContent = title;
      refs.healthMeta.textContent = meta;
      refs.healthMeta.setAttribute("title", meta);
      refs.latency.textContent = state.probing ? "…" : (tone === "ok" ? Format.latency(probe.latencyMs) : "--");

      if (refs.sub && refs.subText) {
        refs.sub.setAttribute("data-tone", tone === "idle" ? "pending" : tone);
        if (state.probing) refs.subText.textContent = "正在检测…";
        else if (tone === "ok") refs.subText.textContent = "可访问 · " + Format.latency(probe.latencyMs);
        else if (tone === "bad") refs.subText.textContent = "不可访问 · 使用镜像";
        else refs.subText.textContent = "待检测";
      }
    }

    function syncControls() {
      const settings = SettingsStore.get();
      populateMirrorSelect();
      populateProxySelect();
      renderCustomLists();
      syncEditors();
      if (refs.proxySelect && refs.proxySelect.value !== settings.proxyId) refs.proxySelect.value = settings.proxyId;
      if (refs.enabledInput) refs.enabledInput.checked = settings.enabled;
      if (refs.autoRedirectInput) refs.autoRedirectInput.checked = settings.autoRedirect;
      if (refs.respectLoginInput) refs.respectLoginInput.checked = settings.respectLogin;
      if (refs.rewriteInput) refs.rewriteInput.checked = settings.rewriteDownloads;
      if (refs.globalRewriteInput) refs.globalRewriteInput.checked = settings.globalRewrite;
      if (refs.autoCollapseInput) refs.autoCollapseInput.checked = settings.autoCollapse;
      if (refs.debugInput) refs.debugInput.checked = settings.debug;
      if (refs.probeButton) refs.probeButton.disabled = state.probing;

      const activeElement = shadow ? shadow.activeElement : null;
      if (refs.timeoutInput && activeElement !== refs.timeoutInput) refs.timeoutInput.value = String(settings.probeTimeoutMs);
      if (refs.cacheInput && activeElement !== refs.cacheInput) refs.cacheInput.value = String(settings.probeCacheMinutes);

      const statusActive = state.view === "status" ? "true" : "false";
      const settingsActive = state.view === "settings" ? "true" : "false";
      if (refs.statusView) refs.statusView.setAttribute("data-active", statusActive);
      if (refs.settingsView) refs.settingsView.setAttribute("data-active", settingsActive);
      if (refs.statusTab && refs.settingsTab) {
        refs.statusTab.setAttribute("aria-selected", statusActive);
        refs.settingsTab.setAttribute("aria-selected", settingsActive);
      }
    }

    function syncOrb() {
      if (!refs.orb || !refs.orbDot) return;
      const probe = SettingsStore.get().lastProbe || {};
      refs.orb.setAttribute("data-probing", state.probing ? "true" : "false");
      refs.orbDot.setAttribute("data-tone", state.probing
        ? "pending"
        : (probe.reachable === true ? "ok" : (probe.reachable === false ? "bad" : "idle")));
    }

    /* ---------- 交互 ---------- */

    function toast(message) {
      if (!state.mounted || !refs.toast) {
        Log.info(message);
        return;
      }
      refs.toast.textContent = message;
      refs.toast.setAttribute("data-visible", "true");
      if (toastTimer) window.clearTimeout(toastTimer);
      toastTimer = window.setTimeout(function () {
        toastTimer = 0;
        if (refs.toast) refs.toast.setAttribute("data-visible", "false");
      }, 2400);
    }

    function setView(view) {
      state.view = view === "settings" ? "settings" : "status";
      syncControls();
    }

    function runProbe() {
      if (state.probing) return;
      state.probing = true;
      syncAll();
      Reachability.probe().then(function (verdict) {
        state.probing = false;
        syncAll();
        if (!verdict) return;
        if (verdict.reachable) {
          toast("GitHub 可访问 · " + Format.latency(verdict.latencyMs));
          return;
        }
        const auto = SettingsStore.get().autoRedirect;
        toast(auto ? "GitHub 不可访问，正在切换镜像" : "GitHub 不可访问，可手动切换镜像");
        if (auto) {
          window.setTimeout(function () { Redirector.redirectToMirror({ reason: "manual-probe" }); }, 500);
        }
      }).catch(function (error) {
        state.probing = false;
        syncAll();
        Log.error("探测流程异常", error);
      });
    }

    function selectProxy(proxyId) {
      if (!proxyId) return;
      SettingsStore.patch({ proxyId: proxyId });
      populateProxySelect();
      syncControls();
      DownloadLinkPatcher.restoreAll();
      DownloadLinkPatcher.sync();
      const proxy = NodeRegistry.proxyById(proxyId);
      toast("下载加速已切换为 " + (proxy ? proxy.label : proxyId));
    }

    function runNodeCheck(options) {
      const silent = options && options.silent === true;
      if (state.nodeChecking) return;
      state.nodeChecking = true;
      if (refs.proxyRefresh) refs.proxyRefresh.disabled = true;
      populateProxySelect();
      NodeRegistry.testAll({
        onStage: function (stage, total) {
          if (refs.proxyHint) refs.proxyHint.textContent = "测速中 0 / " + total;
        },
        onProgress: function (done, total, ok) {
          if (refs.proxyHint) refs.proxyHint.textContent = "测速中 " + done + " / " + total + " · 可用 " + ok;
        }
      }).then(function (summary) {
        state.nodeChecking = false;
        if (refs.proxyRefresh) refs.proxyRefresh.disabled = false;
        populateProxySelect();
        syncControls();
        DownloadLinkPatcher.restoreAll();
        DownloadLinkPatcher.sync();
        if (!silent) toast(summary.working ? "可用节点 " + summary.working + " 个" : "没有可用节点");
      });
    }

    function switchCurrentPage() {
      const mirror = Redirector.activeMirror();
      if (!mirror) {
        toast("尚未添加镜像，请到「设置 → 自定义」添加");
        return;
      }
      if (!Redirector.targetForCurrentPage(mirror)) {
        toast("当前页面无法映射到镜像");
        return;
      }
      if (!Redirector.redirectToMirror({ force: true, mirror: mirror })) toast("跳转被跳过，请确认加速已启用");
    }

    function addMirrorFromInput() {
      const value = refs.mirrorInput ? refs.mirrorInput.value : "";
      const added = Catalog.addMirror(value);
      if (!added) {
        toast("镜像地址无效");
        return;
      }
      if (refs.mirrorInput) refs.mirrorInput.value = "";
      state.editor = "";
      syncEditors();
      afterCustomChange();
      checkMirrors({ silent: true });
      toast("已添加镜像 " + added.label);
    }

    function addProxyFromInput() {
      const value = refs.proxyInput ? refs.proxyInput.value : "";
      const added = Catalog.addProxy(value);
      if (!added) {
        toast("加速地址无效");
        return;
      }
      if (refs.proxyInput) refs.proxyInput.value = "";
      state.editor = "";
      syncEditors();
      afterCustomChange();
      toast("已添加加速地址 " + added.label);
    }

    function resetSettings() {
      if (!window.confirm("恢复默认设置？所有本地偏好都会被覆盖。")) return;
      SettingsStore.reset();
      if (state.collapsed) {
        state.collapsed = false;
        if (refs.shell) refs.shell.setAttribute("data-state", "open");
      }
      DownloadLinkPatcher.restoreAll();
      DownloadLinkPatcher.sync();
      resetPanelPosition(true);
      syncAll();
      toast("已恢复默认设置");
    }

    function resetPanelPosition(silent) {
      const point = clampPoint(
        window.innerWidth - SIZE.width - DEFAULT_RIGHT_GAP,
        DEFAULT_TOP,
        { width: SIZE.width, height: SIZE.height }
      );
      applyPosition(point.x, point.y);
      persistPosition();
      if (!silent) toast("面板位置已重置");
    }

    function handleAction(event) {
      const target = event.target;
      const trigger = target && typeof target.closest === "function" ? target.closest("[data-action]") : null;
      if (!trigger) return;
      const action = trigger.getAttribute("data-action");
      if (action === "tab") setView(trigger.getAttribute("data-tab"));
      else if (action === "collapse") collapse();
      else if (action === "expand") {
        if (event.detail === 0) expand();
      }
      else if (action === "probe") runProbe();
      else if (action === "switch") switchCurrentPage();
      else if (action === "restore-links") {
        DownloadLinkPatcher.restoreAll();
        toast("已恢复本页原始链接");
      } else if (action === "reload") {
        window.setTimeout(function () { window.location.reload(); }, 120);
      } else if (action === "reset-position") resetPanelPosition(false);
      else if (action === "reset-settings") resetSettings();
      else if (action === "mirror-refresh") checkMirrors();
      else if (action === "proxy-refresh") runNodeCheck();
      else if (action === "mirror-add-open") toggleEditor("mirror");
      else if (action === "proxy-add-open") toggleEditor("proxy");
      else if (action === "mirror-add") addMirrorFromInput();
      else if (action === "proxy-add") addProxyFromInput();
      else if (action === "mirror-pick") {
        SettingsStore.patch({ mirrorId: trigger.getAttribute("data-id") });
        syncAll();
      } else if (action === "proxy-pick") selectProxy(trigger.getAttribute("data-id"));
      else if (action === "mirror-remove") {
        Catalog.removeMirror(trigger.getAttribute("data-id"));
        afterCustomChange();
      } else if (action === "proxy-remove") {
        Catalog.removeProxy(trigger.getAttribute("data-id"));
        afterCustomChange();
      }
    }

    function handleKeydown(event) {
      if (event.key !== "Escape") return;
      if (!state.mounted || state.collapsed) return;
      const activeElement = shadow ? shadow.activeElement : null;
      const tag = activeElement && activeElement.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      collapse();
    }

    function handleResize() {
      if (resizeTimer) window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(function () {
        resizeTimer = 0;
        if (!state.mounted || state.dragging) return;
        const point = clampPoint(state.position.x, state.position.y);
        applyPosition(point.x, point.y);
        persistPosition();
      }, 180);
    }

    function bindEvents() {
      shadow.addEventListener("click", handleAction);
      shadow.addEventListener("pointerdown", handlePointerDown);
      document.addEventListener("keydown", handleKeydown);
      window.addEventListener("resize", handleResize);
    }

    /* ---------- 对外接口 ---------- */

    return {
      mount: mount,
      expand: expand,
      collapse: collapse,
      runProbe: runProbe,
      toast: toast
    };
  })();

  /* ================================================================== *
   * 11. 全站守卫（在任意网页上改写 GitHub 链接）
   * ================================================================== */

  const GlobalGuard = (function () {
    const MARK = "data-ghg-link";
    const ORIGINAL = "data-ghg-href";
    const LINK_QUERY = 'a[href*="github"]';
    let active = false;
    let observer = null;
    let scanTimer = 0;
    let unreachable = false;

    function rewrite(anchor) {
      if (!anchor || anchor.nodeType !== 1) return;
      if (anchor.hasAttribute(MARK)) return;
      const href = anchor.getAttribute("href");
      if (!href || href.charAt(0) === "#") return;
      const absolute = UrlMapper.toAbsolute(href);
      if (!absolute) return;
      if (!UrlMapper.canMirror(absolute)) return;
      const mirror = Redirector.activeMirror();
      if (!mirror) return;
      const target = UrlMapper.buildMirrorUrl(absolute.href, mirror);
      if (!target || target === absolute.href) return;
      anchor.setAttribute(ORIGINAL, href);
      anchor.setAttribute("href", target);
      anchor.setAttribute(MARK, mirror.label);
      const currentTitle = anchor.getAttribute("title");
      anchor.setAttribute("title", (currentTitle ? currentTitle + " · " : "") + "直连不通，已切到 " + mirror.label);
    }

    function scan() {
      if (!active || !unreachable) return;
      let nodes;
      try {
        nodes = document.querySelectorAll(LINK_QUERY);
      } catch (error) {
        return;
      }
      for (let index = 0; index < nodes.length; index += 1) {
        try { rewrite(nodes[index]); } catch (error) { /* 单个链接失败不影响其余 */ }
      }
    }

    function scheduleScan() {
      if (scanTimer) return;
      scanTimer = window.setTimeout(function () {
        scanTimer = 0;
        scan();
      }, 250);
    }

    function attachObserver() {
      if (observer || typeof MutationObserver !== "function" || !document.body) return;
      observer = new MutationObserver(function (records) {
        if (records && records.length) scheduleScan();
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }

    function onClick(event) {
      if (!active || !unreachable) return;
      const target = event.target;
      const anchor = target && typeof target.closest === "function" ? target.closest("a[href]") : null;
      if (!anchor || anchor.hasAttribute(MARK)) return;
      const absolute = UrlMapper.toAbsolute(anchor.getAttribute("href"));
      if (!absolute || !UrlMapper.canMirror(absolute)) return;
      const mirror = Redirector.activeMirror();
      if (!mirror) return;
      const next = UrlMapper.buildMirrorUrl(absolute.href, mirror);
      if (!next) return;
      event.preventDefault();
      if (anchor.target === "_blank" || event.ctrlKey || event.metaKey || event.shiftKey) {
        try { window.open(next, anchor.target || "_blank", "noopener"); } catch (error) { window.location.assign(next); }
        return;
      }
      window.location.assign(next);
    }

    function apply(reachable) {
      unreachable = reachable === false;
      if (!unreachable) return;
      scan();
      attachObserver();
    }

    function start() {
      if (active) return;
      const settings = SettingsStore.get();
      if (!settings.enabled || !settings.globalRewrite) return;
      active = true;
      document.addEventListener("click", onClick, true);
      const cached = Reachability.cachedVerdict();
      if (cached) {
        apply(cached.reachable);
        return;
      }
      Reachability.probe().then(function (verdict) {
        apply(verdict && verdict.reachable);
      });
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", function () {
          if (unreachable) {
            scan();
            attachObserver();
          }
        });
      }
    }

    return { start: start, scan: scan };
  })();

  /* ================================================================== *
   * 12. 启动
   * ================================================================== */

  const Bootstrap = (function () {
    let started = false;

    function whenBodyReady(callback) {
      if (document.body) {
        callback();
        return;
      }
      const onReady = function () {
        document.removeEventListener("DOMContentLoaded", onReady);
        callback();
      };
      if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", onReady);
      else window.setTimeout(callback, 0);
    }

    function queueRedirect(reason) {
      const settings = SettingsStore.get();
      const wait = settings.respectLogin ? 700 : 0;
      const mirror = Redirector.activeMirror();
      const checkedAt = settings.mirrorsCheckedAt;
      const trusted = !!(mirror && mirror.ok !== false && checkedAt && Date.now() - checkedAt < MIRROR_CACHE_MS);
      window.setTimeout(function () {
        const latest = SettingsStore.get();
        if (!latest.enabled || !latest.autoRedirect) return;
        Redirector.redirectToMirror({ reason: reason, skipVerify: trusted });
      }, wait);
    }

    function scheduleInitialProbe() {
      const settings = SettingsStore.get();
      if (!settings.enabled) return;
      const cached = Reachability.cachedVerdict();
      if (cached) {
        Log.info("复用缓存的探测结果", cached);
        if (!cached.reachable && settings.autoRedirect) queueRedirect("cache");
        return;
      }
      Reachability.probe().then(function (verdict) {
        if (!verdict || verdict.reachable) return;
        if (SettingsStore.get().autoRedirect) queueRedirect("probe");
      });
    }

    function start() {
      if (started) return;
      started = true;
      SettingsStore.load();
      Log.setVerbose(SettingsStore.get().debug);

      if (Site.kindOf(Site.hostname()) === "other") {
        Log.info("非 GitHub 站点，进入全站守卫模式");
        try { GlobalGuard.start(); } catch (error) { Log.error("全站守卫启动失败", error); }
        return;
      }

      NodeRegistry.ensurePool().then(function (result) {
        Log.info("节点池就绪", result.total);
      });
      try {
        window.addEventListener("pagehide", function () { SettingsStore.saveNow(); });
      } catch (error) {
        Log.warn("注册卸载保存失败", error);
      }
      scheduleInitialProbe();

      whenBodyReady(function () {
        try { MirrorHub.mount(); } catch (error) { Log.error("面板挂载失败", error); }
        try { DownloadLinkPatcher.watch(); } catch (error) { Log.error("链接监听启动失败", error); }
        try { DownloadLinkPatcher.sync(); } catch (error) { Log.error("链接改写启动失败", error); }
      });
    }

    return { start: start };
  })();

  try {
    Bootstrap.start();
  } catch (error) {
    try { console.error(LOG_TAG, "启动失败", error); } catch (ignore) { /* 控制台不可用时忽略 */ }
  }
})();

