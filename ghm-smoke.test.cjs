"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SCRIPT_PATH = path.resolve(process.argv[2] || "FastGithub-GoGo.user.js");

/* ---------------- 极简 DOM ---------------- */

class FakeNode {
  constructor(doc, tagName, nodeType) {
    this.ownerDocument = doc;
    this.tagName = String(tagName || "").toUpperCase();
    this.nodeType = nodeType === undefined ? 1 : nodeType;
    this.childNodes = [];
    this.parentNode = null;
    this.attributes = new Map();
    this.style = {};
    this.listeners = new Map();
    this.checked = false;
    this.value = "";
    this.disabled = false;
    this.textValue = "";
  }

  get className() { return this.attributes.get("class") || ""; }
  set className(next) { this.attributes.set("class", String(next)); }
  get id() { return this.attributes.get("id") || ""; }
  set id(next) { this.attributes.set("id", String(next)); }

  get textContent() {
    if (this.nodeType === 3) return this.textValue;
    return this.childNodes.map(function (child) { return child.textContent; }).join("");
  }

  set textContent(next) {
    if (this.nodeType === 3) { this.textValue = String(next); return; }
    this.childNodes = [];
    if (next !== "" && next !== null && next !== undefined) {
      this.appendChild(this.ownerDocument.createTextNode(String(next)));
    }
  }

  get firstChild() { return this.childNodes.length ? this.childNodes[0] : null; }

  appendChild(child) {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }

  removeChild(child) {
    const index = this.childNodes.indexOf(child);
    if (index >= 0) this.childNodes.splice(index, 1);
    child.parentNode = null;
    return child;
  }

  setAttribute(name, value) {
    this.attributes.set(String(name), String(value));
    if (name === "value") this.value = String(value);
  }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  hasAttribute(name) { return this.attributes.has(name); }
  removeAttribute(name) { this.attributes.delete(name); }

  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }
  removeEventListener(type, handler) {
    const list = this.listeners.get(type);
    if (!list) return;
    const index = list.indexOf(handler);
    if (index >= 0) list.splice(index, 1);
  }

  get classList() {
    const node = this;
    return {
      add: function (name) {
        const parts = node.className.split(" ").filter(Boolean);
        if (parts.indexOf(name) < 0) parts.push(name);
        node.className = parts.join(" ");
      },
      remove: function (name) {
        node.className = node.className.split(" ").filter(function (part) { return part && part !== name; }).join(" ");
      },
      contains: function (name) { return node.className.split(" ").indexOf(name) >= 0; }
    };
  }

  matches(selector) { return matchesSelector(this, selector); }

  closest(selector) {
    let current = this;
    while (current && current.nodeType === 1) {
      if (matchesSelector(current, selector)) return current;
      current = current.parentNode;
    }
    return null;
  }

  querySelectorAll(selector) {
    const out = [];
    collectMatches(this, selector, out);
    return out;
  }

  querySelector(selector) {
    const found = this.querySelectorAll(selector);
    return found.length ? found[0] : null;
  }

  getBoundingClientRect() {
    const left = parseFloat(this.style.left) || 0;
    const top = parseFloat(this.style.top) || 0;
    const width = this.getAttribute("data-state") === "closed" ? 56 : 348;
    return { left: left, top: top, width: width, height: 492, right: left + width, bottom: top + 492 };
  }

  attachShadow() {
    const root = new FakeShadow(this);
    this.shadowRoot = root;
    return root;
  }

  dispatchEvent(event) { fire(this, event); return true; }
}

class FakeText extends FakeNode {
  constructor(doc, text) { super(doc, "#text", 3); this.textValue = String(text); }
  get textContent() { return this.textValue; }
  set textContent(next) { this.textValue = String(next); }
}

class FakeShadow extends FakeNode {
  constructor(host) {
    super(host.ownerDocument, "#shadow-root", 11);
    this.hostElement = host;
    this.parentNode = null;
    this.activeElement = null;
  }
}

function matchesSelector(node, selector) {
  if (!node || node.nodeType !== 1) return false;
  const text = String(selector).trim();
  if (text.charAt(0) === ".") {
    return node.className.split(" ").indexOf(text.slice(1)) >= 0;
  }
  const bracketIndex = text.indexOf("[");
  if (bracketIndex < 0) return node.tagName === text.toUpperCase();
  const tagPart = bracketIndex > 0 ? text.slice(0, bracketIndex) : "";
  if (tagPart && node.tagName !== tagPart.toUpperCase()) return false;
  const attrPart = text.slice(bracketIndex + 1, text.length - 1);
  const eq = attrPart.indexOf("=");
  if (eq < 0) return node.attributes.has(attrPart);
  const name = attrPart.slice(0, eq);
  const expected = attrPart.slice(eq + 1).replace(/^["']/, "").replace(/["']$/, "");
  return node.attributes.get(name) === expected;
}

function collectMatches(root, selector, out) {
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    if (current !== root && matchesSelector(current, selector)) out.push(current);
    for (let index = current.childNodes.length - 1; index >= 0; index -= 1) stack.push(current.childNodes[index]);
  }
}

function fire(node, event) {
  let current = node;
  while (current) {
    const list = current.listeners && current.listeners.get(event.type);
    if (list) list.slice().forEach(function (handler) { handler(event); });
    current = current.parentNode;
  }
}

function createDocument() {
  const doc = new FakeNode(null, "#document", 9);
  doc.createElement = function (tagName) { return new FakeNode(doc, tagName); };
  doc.createElementNS = function (namespace, tagName) {
    const node = new FakeNode(doc, tagName);
    node.namespaceURI = namespace;
    return node;
  };
  doc.createTextNode = function (text) { return new FakeText(doc, text); };
  doc.getElementById = function (id) { return collectById(doc, id); };
  doc.readyState = "loading";
  doc.documentElement = new FakeNode(doc, "html");
  doc.head = new FakeNode(doc, "head");
  doc.body = new FakeNode(doc, "body");
  doc.documentElement.appendChild(doc.head);
  doc.documentElement.appendChild(doc.body);
  doc.appendChild(doc.documentElement);
  return doc;
}

function collectById(root, id) {
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    if (current.getAttribute && current.getAttribute("id") === id) return current;
    for (let index = current.childNodes.length - 1; index >= 0; index -= 1) stack.push(current.childNodes[index]);
  }
  return null;
}

const document = createDocument();
const storage = new Map();
const calls = { probe: [], menu: [], notification: [], replaced: [], reloads: [] };
let probeHandler = null;

class FakeMutationObserver {
  constructor(callback) { this.callback = callback; this.active = false; }
  observe() { this.active = true; }
  disconnect() { this.active = false; }
  takeRecords() { return []; }
}

class FakeImage {
  constructor() { this.onload = null; this.onerror = null; this._src = ""; }
  set src(value) { this._src = value; }
  get src() { return this._src; }
}

const sandbox = {};
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.top = sandbox;
sandbox.document = document;
sandbox.console = console;
sandbox.URL = URL;
sandbox.Promise = Promise;
sandbox.Map = Map;
sandbox.Set = Set;
sandbox.JSON = JSON;
sandbox.Number = Number;
sandbox.String = String;
sandbox.Object = Object;
sandbox.Array = Array;
sandbox.Math = Math;
sandbox.Date = Date;
sandbox.Error = Error;
sandbox.isFinite = isFinite;
sandbox.parseInt = parseInt;
sandbox.parseFloat = parseFloat;
sandbox.encodeURIComponent = encodeURIComponent;
sandbox.setTimeout = setTimeout;
sandbox.clearTimeout = clearTimeout;
sandbox.setInterval = setInterval;
sandbox.clearInterval = clearInterval;
sandbox.requestAnimationFrame = function (fn) { return setTimeout(fn, 16); };
sandbox.cancelAnimationFrame = clearTimeout;
sandbox.MutationObserver = FakeMutationObserver;
sandbox.Image = FakeImage;
sandbox.confirm = function () { return true; };
sandbox.innerWidth = 1280;
sandbox.innerHeight = 800;
sandbox.matchMedia = function () {
  return { matches: false, addEventListener: function () {}, removeEventListener: function () {} };
};
sandbox.addEventListener = function () {};
sandbox.removeEventListener = function () {};
sandbox.location = {
  hostname: "github.com",
  href: "https://github.com/owner/repo",
  replace: function (target) { calls.replaced.push(target); },
  reload: function () { calls.reloads.push(Date.now()); }
};
sandbox.sessionStorage = {
  store: new Map(),
  getItem: function (key) { return this.store.has(key) ? this.store.get(key) : null; },
  setItem: function (key, value) { this.store.set(key, String(value)); }
};
sandbox.localStorage = {
  store: new Map(),
  getItem: function (key) { return this.store.has(key) ? this.store.get(key) : null; },
  setItem: function (key, value) { this.store.set(key, String(value)); }
};

sandbox.GM_getValue = function (key, fallback) { return storage.has(key) ? storage.get(key) : fallback; };
sandbox.GM_setValue = function (key, value) { storage.set(key, value); };
sandbox.GM_registerMenuCommand = function (label) { calls.menu.push(label); };
sandbox.GM_notification = function (options) { calls.notification.push(options && options.text); };
const NODE_SCRIPT = 'var mirrors = ["https://good-node.test","https://dead-node.test","https://good-node.test/"]; var tail = 1;';

sandbox.GM_xmlhttpRequest = function (options) {
  const url = String(options.url || "");
  if (url.indexOf("xiake.pro") >= 0) {
    setTimeout(function () { options.onload({ status: 200, responseText: NODE_SCRIPT }); }, 5);
    return;
  }
  if (url.indexOf("bgithub.xyz") >= 0 || url.indexOf("gohj99.site") >= 0 || url.indexOf("6github.com") >= 0) {
    setTimeout(function () { options.onload({ status: 200 }); }, 5);
    return;
  }
  if (url.indexOf("code_70x70.png") >= 0) {
    const ok = url.indexOf("good-node.test") >= 0;
    const bytes = new Uint8Array(ok ? 338 : 120);
    if (ok) { bytes[0] = 0x89; bytes[1] = 0x50; bytes[2] = 0x4e; bytes[3] = 0x47; }
    setTimeout(function () {
      if (ok) options.onload({ status: 200, response: bytes.buffer });
      else options.onerror({});
    }, 5);
    return;
  }
  calls.probe.push(url);
  probeHandler = options;
};

/* 页面里预先放两个链接：一个 Release 资源，一个普通页面 */
const releaseLink = document.createElement("a");
releaseLink.setAttribute("href", "/owner/repo/releases/download/v1/app.zip");
releaseLink.setAttribute("title", "下载 app.zip");
document.body.appendChild(releaseLink);

const plainLink = document.createElement("a");
plainLink.setAttribute("href", "/owner/repo/issues");
document.body.appendChild(plainLink);

vm.createContext(sandbox);
const source = fs.readFileSync(SCRIPT_PATH, "utf8");
vm.runInContext(source, sandbox, { filename: SCRIPT_PATH });

/* ---------------- 断言 ---------------- */

function escapeHtml(text) {
  return String(text)
    .split("&").join("&amp;")
    .split("<").join("&lt;")
    .split(">").join("&gt;")
    .split('"').join("&quot;");
}

function serialize(node) {
  if (!node) return "";
  if (node.nodeType === 3) return escapeHtml(node.textContent);
  if (node.nodeType === 11) return node.childNodes.map(serialize).join("");
  const tag = node.tagName.toLowerCase();
  let attrs = "";
  node.attributes.forEach(function (value, name) { attrs += " " + name + '="' + escapeHtml(value) + '"'; });
  if (node.tagName === "INPUT") {
    if (node.checked) attrs += " checked";
    if (node.value) attrs += ' value="' + escapeHtml(node.value) + '"';
  }
  if (node.disabled) attrs += " disabled";
  const inner = node.childNodes.map(serialize).join("");
  return "<" + tag + attrs + ">" + inner + "</" + tag + ">";
}

const results = [];
function check(name, condition, detail) {
  results.push({ name: name, ok: !!condition, detail: detail === undefined ? "" : String(detail) });
}
function click(node) {
  fire(node, {
    type: "click", target: node, button: 0, cancelable: true,
    preventDefault: function () {}, stopPropagation: function () {}
  });
}
function pointer(node, type, x, y) {
  fire(node, {
    type: type, target: node, button: 0, clientX: x, clientY: y, cancelable: true,
    preventDefault: function () {}, stopPropagation: function () {}
  });
}
function shellOf() {
  const host = document.getElementById("gh-mirror-hub");
  if (!host || !host.shadowRoot) return null;
  return host.shadowRoot.querySelector(".ghm-shell");
}

(async function run() {
  await new Promise(function (resolve) { setTimeout(resolve, 30); });

  const host = document.getElementById("gh-mirror-hub");
  const shell = shellOf();
  check("挂载 shadow 容器", !!host && !!host.shadowRoot, host ? "ok" : "缺失");
  check("面板 shell 存在", !!shell, shell ? shell.getAttribute("data-state") : "缺失");
  if (!shell) throw new Error("面板未创建，后续断言无法进行");

  check("头部拖拽区存在", !!shell.querySelector("[data-drag]"));
  check("状态视图存在", !!shell.querySelector("[data-view=status]"));
  check("设置视图存在", !!shell.querySelector("[data-view=settings]"));
  check("不再注册菜单", calls.menu.length === 0, calls.menu.join(" | "));

  // 探测
  check("启动即发起探测", calls.probe.length >= 1, calls.probe[0]);
  if (probeHandler && probeHandler.onload) probeHandler.onload({ status: 200 });
  await new Promise(function (resolve) { setTimeout(resolve, 400); });

  const saved = JSON.parse(storage.get("ghm.settings.v2") || "{}");
  check("探测结果写入配置", saved.lastProbe && saved.lastProbe.reachable === true, JSON.stringify(saved.lastProbe));
  const health = shell.querySelector(".ghm-health");
  check("健康卡片变为 ok", !!health && health.getAttribute("data-tone") === "ok", health && health.getAttribute("data-tone"));

  if (process.env.GHM_DUMP) {
    const styleNode = host.shadowRoot.childNodes[0];
    const css = styleNode ? styleNode.textContent : "";
    const previewCss = 'html,body{margin:0;padding:0;background:#f6f8fa;}' +
      '.preview-stage{position:relative;width:1280px;height:760px;}' +
      '.preview-stage .ghm-shell{animation:none!important;left:40px!important;top:40px!important;}';
    const page = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">' +
      '<title>GitHub 镜像加速 - 面板</title><style>' + previewCss + css + '</style></head>' +
      '<body><div class="preview-stage">' + serialize(shell) + '</div></body></html>';
    fs.writeFileSync('panel-preview.html', page, 'utf8');
    console.log('preview open: ' + page.length + ' bytes');
  }

  // 预设镜像默认接管下载加速（换域名模式）
  const bootSettings = JSON.parse(storage.get("ghm.settings.v2") || "{}");
  check("预设镜像已注入", (bootSettings.customMirrors || []).length === 2, JSON.stringify((bootSettings.customMirrors || []).map(function (m) { return m.host; })));
  const earlyHref = releaseLink.getAttribute("href") || "";
  check("下载链接已被加速", earlyHref !== "/owner/repo/releases/download/v1/app.zip", earlyHref);
  check("原始地址被记录", releaseLink.getAttribute("data-ghm-original") === "https://github.com/owner/repo/releases/download/v1/app.zip", releaseLink.getAttribute("data-ghm-original"));
  check("普通链接保持不变", plainLink.getAttribute("href") === "/owner/repo/issues", plainLink.getAttribute("href"));

  // 收起 / 展开
  click(shell.querySelector("[data-action=collapse]"));
  await new Promise(function (resolve) { setTimeout(resolve, 20); });
  check("收起后进入 closed", shell.getAttribute("data-state") === "closed", shell.getAttribute("data-state"));

  const orb = shell.querySelector(".ghm-orb");
  check("悬浮球存在", !!orb);
  pointer(orb, "pointerdown", 100, 300);
  pointer(document, "pointerup", 100, 300);
  await new Promise(function (resolve) { setTimeout(resolve, 20); });
  check("点击悬浮球展开", shell.getAttribute("data-state") === "open", shell.getAttribute("data-state"));

  // 拖拽
  const header = shell.querySelector("[data-drag]");
  const before = shell.style.left;
  pointer(header, "pointerdown", 300, 200);
  pointer(document, "pointermove", 380, 260);
  pointer(document, "pointerup", 380, 260);
  await new Promise(function (resolve) { setTimeout(resolve, 20); });
  check("拖拽改变 left", shell.style.left !== before, before + " -> " + shell.style.left);

  // 最小化后拖动：松手不能展开
  click(shell.querySelector("[data-action=collapse]"));
  await new Promise(function (resolve) { setTimeout(resolve, 20); });
  const orbAfter = shell.querySelector(".ghm-orb");
  const orbLeftBefore = shell.style.left;
  pointer(orbAfter, "pointerdown", 200, 400);
  pointer(document, "pointermove", 260, 460);
  pointer(document, "pointerup", 260, 460);
  await new Promise(function (resolve) { setTimeout(resolve, 20); });
  click(orbAfter);
  await new Promise(function (resolve) { setTimeout(resolve, 20); });
  check("拖拽悬浮球后保持收起", shell.getAttribute("data-state") === "closed", shell.getAttribute("data-state"));
  check("拖拽悬浮球改变位置", shell.style.left !== orbLeftBefore, orbLeftBefore + " -> " + shell.style.left);

  fire(orbAfter, { type: "click", target: orbAfter, detail: 0, preventDefault: function () {}, stopPropagation: function () {} });
  await new Promise(function (resolve) { setTimeout(resolve, 20); });
  check("键盘回车可展开", shell.getAttribute("data-state") === "open", shell.getAttribute("data-state"));

  // Tab
  click(shell.querySelector("[data-tab=settings]"));
  const settingsView = shell.querySelector("[data-view=settings]");
  check("切到设置页", settingsView.getAttribute("data-active") === "true", settingsView.getAttribute("data-active"));
  check("设置页已无节点区块", !settingsView.querySelector("[data-action=node-refresh]"));
  check("设置页已无自定义区块", !settingsView.querySelector("input[aria-label=新增镜像地址]"));

  if (process.env.GHM_DUMP) {
    const styleNode = host.shadowRoot.childNodes[0];
    const css = styleNode ? styleNode.textContent : "";
    const previewCss = 'html,body{margin:0;padding:0;background:#f6f8fa;}' +
      '.preview-stage{position:relative;width:1280px;height:760px;}' +
      '.preview-stage .ghm-shell{animation:none!important;left:40px!important;top:40px!important;}' +
      '.preview-stage .ghm-toast{display:none!important;}';
    const page = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">' +
      '<title>GitHub 镜像加速 - 设置</title><style>' + previewCss + css + '</style></head>' +
      '<body><div class="preview-stage">' + serialize(shell) + '</div></body></html>';
    fs.writeFileSync('panel-preview-settings.html', page, 'utf8');
  }

  // 开关写回
  const inputs = settingsView.querySelectorAll("input");
  check("设置页开关数量", inputs.length >= 6, inputs.length);
  inputs[0].checked = false;
  fire(inputs[0], { type: "change", target: inputs[0] });
  await new Promise(function (resolve) { setTimeout(resolve, 400); });
  const afterToggle = JSON.parse(storage.get("ghm.settings.v2") || "{}");
  check("开关写回存储", afterToggle.enabled === false, JSON.stringify(afterToggle.enabled));
  inputs[0].checked = true;
  fire(inputs[0], { type: "change", target: inputs[0] });

  // 数字输入
  const numberInput = settingsView.querySelector("input[type=number]");
  check("数字输入存在", !!numberInput);
  if (numberInput) {
    numberInput.value = "999999";
    fire(numberInput, { type: "change", target: numberInput });
    await new Promise(function (resolve) { setTimeout(resolve, 400); });
    const afterNumber = JSON.parse(storage.get("ghm.settings.v2") || "{}");
    check("数字输入被夹到上限", afterNumber.probeTimeoutMs === 15000, JSON.stringify(afterNumber.probeTimeoutMs));
    numberInput.value = "4000";
    fire(numberInput, { type: "change", target: numberInput });
  }

  // 启动即自动拉取 + 自动测速
  const bootState = JSON.parse(storage.get("ghm.settings.v2") || "{}");
  const bootPool = ((bootState.nodePool || {}).nodes) || [];
  check("启动自动拉取节点池", bootPool.length === 2, bootPool.map(function (node) { return node.id; }).join(","));
  check("启动自动测速", (bootState.nodePool || {}).testedAt > 0, String((bootState.nodePool || {}).testedAt || 0));
  const bootUsable = bootPool.filter(function (node) { return node.ok; });
  check("自动测速只标可用节点", bootUsable.length === 1 && bootUsable[0].id === "remote:good-node.test", bootUsable.map(function (node) { return node.id; }).join(","));

  // 两个下拉框右侧的图标
  const mirrorRefresh = shell.querySelector("[data-action=mirror-refresh]");
  const proxyRefresh = shell.querySelector("[data-action=proxy-refresh]");
  const mirrorPlus = shell.querySelector("[data-action=mirror-add-open]");
  const proxyPlus = shell.querySelector("[data-action=proxy-add-open]");
  check("镜像行有刷新图标", !!mirrorRefresh);
  check("镜像行有加号图标", !!mirrorPlus);
  check("加速行有刷新图标", !!proxyRefresh);
  check("加速行有加号图标", !!proxyPlus);

  // 镜像延迟自动检测
  check("启动自动检测镜像延迟", (bootState.mirrorsCheckedAt || 0) > 0, String(bootState.mirrorsCheckedAt || 0));
  const latencyMirrors = bootState.customMirrors || [];
  check("镜像延迟已记录", latencyMirrors.length === 2 && latencyMirrors.every(function (item) { return typeof item.latencyMs === "number" && item.latencyMs >= 0; }), JSON.stringify(latencyMirrors.map(function (item) { return item.latencyMs; })));

  // 刷新图标重新测速
  click(proxyRefresh);
  await new Promise(function (resolve) { setTimeout(resolve, 600); });
  const afterRefresh = JSON.parse(storage.get("ghm.settings.v2") || "{}");
  const refreshedUsable = (((afterRefresh.nodePool || {}).nodes) || []).filter(function (node) { return node.ok; });
  check("刷新图标重新测速", refreshedUsable.length === 1, refreshedUsable.length);

  const proxySelect = shell.querySelector("select[aria-label=下载加速代理]");
  const optionCount = proxySelect ? proxySelect.querySelectorAll("option").length : 0;
  check("代理下拉含节点与镜像", optionCount === 3, optionCount);

  // 加号打开镜像编辑器并添加
  click(mirrorPlus);
  await new Promise(function (resolve) { setTimeout(resolve, 20); });
  const mirrorEditor = shell.querySelector("[data-kind=mirror]");
  check("加号打开镜像编辑器", !!mirrorEditor && mirrorEditor.getAttribute("data-open") === "true", mirrorEditor && mirrorEditor.getAttribute("data-open"));

  const mirrorInput = shell.querySelector("input[aria-label=新增镜像地址]");
  check("有镜像输入框", !!mirrorInput);
  if (mirrorInput) {
    mirrorInput.value = "bgithub.xyz";
    click(shell.querySelector("[data-action=mirror-add]"));
    await new Promise(function (resolve) { setTimeout(resolve, 400); });
    const afterMirror = JSON.parse(storage.get("ghm.settings.v2") || "{}");
    const mirrors = afterMirror.customMirrors || [];
    check("自定义镜像已保存", mirrors.some(function (item) { return item.host === "bgithub.xyz"; }), JSON.stringify(mirrors.map(function (item) { return item.host; })));
    const mirrorSelect = shell.querySelector("select[aria-label=镜像站点]");
    check("镜像下拉已填充", !!mirrorSelect && mirrorSelect.querySelectorAll("option").length === 3, mirrorSelect ? mirrorSelect.querySelectorAll("option").length : 0);
  }

  // 加号添加自定义加速地址
  click(proxyPlus);
  await new Promise(function (resolve) { setTimeout(resolve, 20); });
  const proxyInput = shell.querySelector("input[aria-label=新增加速地址]");
  check("有加速地址输入框", !!proxyInput);
  if (proxyInput) {
    proxyInput.value = "https://example-proxy.test";
    click(shell.querySelector("[data-action=proxy-add]"));
    await new Promise(function (resolve) { setTimeout(resolve, 400); });
    const afterProxy = JSON.parse(storage.get("ghm.settings.v2") || "{}");
    const proxies = afterProxy.customProxies || [];
    check("自定义加速地址已保存", proxies.length === 1 && proxies[0].base === "https://example-proxy.test/", JSON.stringify(proxies.map(function (item) { return item.base; })));

    const patchedHref = releaseLink.getAttribute("href") || "";
    check("配置后链接走自定义加速", patchedHref === "https://example-proxy.test/https://github.com/owner/repo/releases/download/v1/app.zip", patchedHref);
  }

  // 底部操作栏与署名
  const foot = shell.querySelector(".ghm-foot");
  check("底部有署名", !!foot && foot.textContent.indexOf("by PIAOPIAO") >= 0, foot ? foot.textContent : "");
  check("底部显示版本号", !!foot && foot.textContent.indexOf("v") === 0, foot ? foot.textContent : "");

  const actionsBar = shell.querySelector(".ghm-actions");
  check("底部有操作栏", !!actionsBar);
  check("操作栏含切换与恢复", !!actionsBar && !!actionsBar.querySelector("[data-action=switch]") && !!actionsBar.querySelector("[data-action=restore-links]"));

  click(shell.querySelector("[data-action=restore-links]"));
  await new Promise(function (resolve) { setTimeout(resolve, 20); });
  check("恢复按钮还原 href", releaseLink.getAttribute("href") === "/owner/repo/releases/download/v1/app.zip", releaseLink.getAttribute("href"));

  if (process.env.GHM_DUMP) {
    const styleNode = host.shadowRoot.childNodes[0];
    const css = styleNode ? styleNode.textContent : "";
    const previewCss = 'html,body{margin:0;padding:0;background:#f6f8fa;}' +
      '.preview-stage{position:relative;width:1280px;height:760px;}' +
      '.preview-stage .ghm-shell{animation:none!important;left:40px!important;top:40px!important;}' +
      '.preview-stage .ghm-toast{display:none!important;}';
    const page = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">' +
      '<title>GitHub 镜像加速 - 节点</title><style>' + previewCss +
      '.preview-stage .ghm-shell{position:relative!important;left:0!important;top:0!important;width:390px!important;height:auto!important;}' +
      '.preview-stage .ghm-panel{position:relative!important;inset:auto!important;}' +
      '.preview-stage .ghm-body{overflow:visible!important;}' +
      css + '</style></head>' +
      '<body><div class="preview-stage">' + serialize(shell) + '</div></body></html>';
    fs.writeFileSync('panel-preview-nodes.html', page, 'utf8');
  }

  // 手动跳转
  click(shell.querySelector("[data-action=switch]"));
  await new Promise(function (resolve) { setTimeout(resolve, 200); });
  check("触发镜像跳转", calls.replaced.length > 0, calls.replaced[0] || "无");

  // GitHub 不可访问时自动跳转镜像
  await new Promise(function (resolve) { setTimeout(resolve, 1600); });
  try { sandbox.sessionStorage.store.delete("ghm.redirected.at"); } catch (error) { /* 忽略 */ }
  const beforeAuto = calls.replaced.length;
  click(shell.querySelector("[data-action=probe]"));
  await new Promise(function (resolve) { setTimeout(resolve, 40); });
  if (probeHandler && probeHandler.onerror) probeHandler.onerror({ error: "blocked" });
  await new Promise(function (resolve) { setTimeout(resolve, 1400); });
  check("不可访问时自动跳转", calls.replaced.length > beforeAuto, calls.replaced[calls.replaced.length - 1] || "无");

  // Escape
  fire(document, { type: "keydown", key: "Escape", target: document, preventDefault: function () {} });
  await new Promise(function (resolve) { setTimeout(resolve, 20); });
  check("Escape 收起面板", shell.getAttribute("data-state") === "closed", shell.getAttribute("data-state"));

  if (process.env.GHM_DUMP) {
    const styleNode = host.shadowRoot.childNodes[0];
    const css = styleNode ? styleNode.textContent : "";
    const previewCss = ".preview-stage{position:relative;height:800px;background:#f6f8fa;}" +
      ".preview-stage .ghm-shell{animation:none!important;left:40px!important;top:40px!important;}" +
      ".preview-stage .ghm-toast{display:none!important;}" +
      "html,body{margin:0;padding:0;height:100%;}";
    const html = "<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\">" +
      "<title>GitHub 镜像加速 · 面板预览</title><style>" + previewCss + css + "</style></head>" +
      "<body><div class=\"preview-stage\">" + serialize(shell) + "</div></body></html>";
    fs.writeFileSync(process.env.GHM_DUMP_FILE || "panel-preview.html", html, "utf8");
    console.log("preview: panel-preview.html (" + html.length + " bytes)");
  }

  const failed = results.filter(function (item) { return !item.ok; });
  results.forEach(function (item) {
    console.log((item.ok ? "  PASS " : "  FAIL ") + item.name + (item.detail ? "  [" + item.detail + "]" : ""));
  });
  console.log("");
  console.log("通过 " + (results.length - failed.length) + " / " + results.length);
  if (failed.length) process.exitCode = 1;
})().catch(function (error) {
  console.error("SMOKE CRASH:", error && error.stack ? error.stack : error);
  process.exitCode = 2;
});
