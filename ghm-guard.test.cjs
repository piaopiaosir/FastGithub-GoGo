"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SCRIPT = path.resolve(process.argv[2] || "FastGithub-GoGo.user.js");

function matchSelector(node, selector) {
  const text = String(selector).trim();
  const open = text.indexOf("[");
  let tag = "";
  if (open > 0) tag = text.slice(0, open);
  else if (open < 0) tag = text;
  if (tag && node.tagName !== tag.toUpperCase()) return false;
  if (open < 0) return true;
  const inner = text.slice(open + 1, text.length - 1);
  const star = inner.indexOf("*=");
  if (star >= 0) {
    const name = inner.slice(0, star);
    const value = inner.slice(star + 2).replace(/^["']/, "").replace(/["']$/, "");
    const current = node.getAttribute(name);
    return typeof current === "string" && current.indexOf(value) >= 0;
  }
  const eq = inner.indexOf("=");
  if (eq >= 0) {
    return node.getAttribute(inner.slice(0, eq)) === inner.slice(eq + 1).replace(/^["']/, "").replace(/["']$/, "");
  }
  return node.hasAttribute(inner);
}

class Node {
  constructor(doc, tagName, nodeType) {
    this.ownerDocument = doc;
    this.tagName = String(tagName || "").toUpperCase();
    this.nodeType = nodeType === undefined ? 1 : nodeType;
    this.attrs = new Map();
    this.children = [];
    this.parentNode = null;
    this.listeners = new Map();
    this.textValue = "";
  }
  setAttribute(name, value) { this.attrs.set(String(name), String(value)); }
  getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }
  hasAttribute(name) { return this.attrs.has(name); }
  removeAttribute(name) { this.attrs.delete(name); }
  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }
  removeEventListener() {}
  matches(selector) { return matchSelector(this, selector); }
  closest(selector) {
    let current = this;
    while (current && current.nodeType === 1) {
      if (matchSelector(current, selector)) return current;
      current = current.parentNode;
    }
    return null;
  }
  querySelectorAll(selector) {
    const found = [];
    const stack = [this];
    while (stack.length) {
      const current = stack.pop();
      if (current !== this && matchSelector(current, selector)) found.push(current);
      for (let index = current.children.length - 1; index >= 0; index -= 1) stack.push(current.children[index]);
    }
    return found;
  }
  querySelector(selector) {
    const found = this.querySelectorAll(selector);
    return found.length ? found[0] : null;
  }
  get textContent() { return this.textValue; }
  set textContent(value) { this.textValue = String(value); }
}

function createDocument(links) {
  const doc = new Node(null, "#document", 9);
  doc.createElement = function (tagName) { return new Node(doc, tagName); };
  doc.createElementNS = function (ns, tagName) { return new Node(doc, tagName); };
  doc.createTextNode = function (text) { const node = new Node(doc, "#text", 3); node.textValue = text; return node; };
  doc.getElementById = function () { return null; };
  doc.readyState = "complete";

  const html = new Node(doc, "html");
  const head = new Node(doc, "head");
  const body = new Node(doc, "body");
  html.appendChild(head);
  html.appendChild(body);
  doc.appendChild(html);
  doc.documentElement = html;
  doc.head = head;
  doc.body = body;

  links.forEach(function (item) {
    const anchor = new Node(doc, "a");
    anchor.setAttribute("href", item.href);
    anchor.setAttribute("id", item.id);
    body.appendChild(anchor);
  });
  return doc;
}

function runScenario(options) {
  return new Promise(function (resolve) {
    const doc = createDocument(options.links);
    const storage = new Map();
    const sandbox = {};
    sandbox.window = sandbox;
    sandbox.self = sandbox;
    sandbox.document = doc;
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
    sandbox.addEventListener = function () {};
    sandbox.removeEventListener = function () {};
    sandbox.location = {
      hostname: options.hostname,
      href: "https://" + options.hostname + "/post",
      assign: function (url) { sandbox.__navigated = url; },
      replace: function (url) { sandbox.__navigated = url; },
      reload: function () {}
    };
    sandbox.sessionStorage = { getItem: function () { return null; }, setItem: function () {} };
    sandbox.localStorage = { getItem: function () { return null; }, setItem: function () {} };
    sandbox.MutationObserver = function () { return { observe: function () {}, disconnect: function () {} }; };
    sandbox.Image = function () { return { set src(value) {} }; };
    sandbox.GM_getValue = function (key, fallback) { return storage.has(key) ? storage.get(key) : fallback; };
    sandbox.GM_setValue = function (key, value) { storage.set(key, value); };
    sandbox.GM_notification = function () {};
    sandbox.GM_xmlhttpRequest = function (request) {
      const url = String(request.url || "");
      if (url.indexOf("robots.txt") >= 0) {
        setTimeout(function () {
          if (options.githubReachable) request.onload({ status: 200 });
          else request.onerror({});
        }, 5);
        return;
      }
      setTimeout(function () { request.onload({ status: 200 }); }, 5);
    };

    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(SCRIPT, "utf8"), sandbox, { filename: SCRIPT });

    setTimeout(function () {
      const snapshot = options.links.map(function (item) {
        const anchor = doc.getElementById ? null : null;
        return null;
      });
      const anchors = doc.body.querySelectorAll("a[href]");
      const rows = anchors.map(function (anchor) {
        return { href: anchor.getAttribute("href"), original: anchor.getAttribute("data-ghg-href"), mark: anchor.getAttribute("data-ghg-link") };
      });
      resolve({ rows: rows, navigated: sandbox.__navigated || "" });
    }, 150);
  });
}

(async function run() {
  const results = [];
  function check(name, ok, detail) { results.push({ name: name, ok: !!ok, detail: detail === undefined ? "" : String(detail) }); }

  const broken = await runScenario({
    hostname: "news.example.com",
    githubReachable: false,
    links: [
      { href: "https://github.com/microsoft/vscode" },
      { href: "https://example.com/article" },
      { href: "https://github.com/cli/cli/releases/download/v2.0.0/gh.txt" }
    ]
  });
  check("不可达时改写仓库链接", broken.rows[0].href === "https://github.gohj99.site/microsoft/vscode", broken.rows[0].href);
  check("不可达时改写下载链接", broken.rows[2].href === "https://github.gohj99.site/cli/cli/releases/download/v2.0.0/gh.txt", broken.rows[2].href);
  check("非 GitHub 链接不动", broken.rows[1].href === "https://example.com/article", broken.rows[1].href);
  check("保留原始地址", broken.rows[0].original === "https://github.com/microsoft/vscode", broken.rows[0].original);

  const healthy = await runScenario({
    hostname: "news.example.com",
    githubReachable: true,
    links: [{ href: "https://github.com/microsoft/vscode" }]
  });
  check("可达时不改写", healthy.rows[0].href === "https://github.com/microsoft/vscode", healthy.rows[0].href);

  const onGithub = await runScenario({
    hostname: "github.com",
    githubReachable: true,
    links: [{ href: "https://github.com/microsoft/vscode" }]
  });
  check("GitHub 页面不触发守卫改写", onGithub.rows[0].href === "https://github.com/microsoft/vscode", onGithub.rows[0].href);

  const failed = results.filter(function (item) { return !item.ok; });
  results.forEach(function (item) {
    console.log((item.ok ? "  PASS " : "  FAIL ") + item.name + (item.detail ? "  [" + item.detail + "]" : ""));
  });
  console.log("");
  console.log("通过 " + (results.length - failed.length) + " / " + results.length);
  if (failed.length) process.exitCode = 1;
})().catch(function (error) {
  console.error("GUARD TEST CRASH:", error && error.stack ? error.stack : error);
  process.exitCode = 2;
});
