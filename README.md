# FastGithub-GoGo

<p align="center"><img src="https://cdn.jsdmirror.com/gh/piaopiaosir/FastGithub-GoGo@main/newicon.png" width="120" height="120" alt="FastGithub-GoGo"></p>

GitHub 镜像加速用户脚本。探测 GitHub 连通性，不可达时自动切换镜像站；Release / raw / 归档下载链接走代理加速；提供可拖拽、可最小化为悬浮球的设置面板。

## 功能特性

- **连通性探测**：启动时及手动触发探测 GitHub 可达性，结果写入本地配置并记录探测时间。
- **自动切换镜像**：确认不可访问时自动跳转到镜像站；可在设置中关闭，检测到 GitHub 登录态时默认跳过。
- **下载加速**：Release / raw / 归档等下载链接自动改写为代理地址，支持自定义代理与镜像节点，支持一键还原原始链接。
- **全站守卫**：脚本在所有网页加载；GitHub 直连不通时，页面上的 GitHub 链接会被就地改写为镜像地址并保留原始地址（可在设置中关闭）。
- **镜像与节点池**：内置预设镜像（换域名型，页面与下载共用）；反代节点地址在运行时从虾壳接口拉取，脚本内不硬编码节点，启动时自动拉取并测速，仅使用可用节点；可手动刷新重新测速。
- **设置面板**：使用 Shadow DOM 隔离，不干扰页面样式；支持拖拽、收起为悬浮球、Esc 收起；设置实时写入 GM 存储。

## 安装

1. 安装用户脚本管理器：Tampermonkey / Violentmonkey / ScriptCat。
2. 通过 Raw 链接安装：[FastGithub-GoGo.user.js](https://raw.githubusercontent.com/piaopiaosir/FastGithub-GoGo/main/FastGithub-GoGo.user.js)
3. 打开 GitHub 任意页面，右下角出现面板即表示脚本已运行。

## 设置项

| 设置 | 说明 |
| --- | --- |
| 启用加速 | 关闭后不再探测、跳转或改写链接 |
| 自动跳转镜像 | 确认不可访问时自动切换 |
| 登录后不跳转 | 检测到 GitHub 登录态时留在原站 |
| 下载链接加速 | Release / raw / 归档链接走代理 |
| 全站接管 GitHub 链接 | 其他网页上的 GitHub 链接在直连不通时改写到镜像 |
| 空闲自动收起 | 20 秒无操作后收成悬浮球 |
| 探测超时 | 连通性探测超时时间，1000 至 15000 毫秒 |
| 镜像站点 / 下载加速代理 | 选择当前使用的镜像与代理节点，支持新增自定义地址并自动测速 |

## 已知限制

用户脚本只能在**已经加载出文档**的页面里运行。如果 github.com 在 DNS / TCP / TLS 阶段就不可达，浏览器显示的是错误页，脚本管理器不会向错误页注入脚本，因此**手输 github.com 这一动作无法被脚本拦截**——这是浏览器机制的硬限制。

脚本能覆盖的场景：GitHub 能开始加载但很慢或资源被墙（按缓存快速跳转）、从其他网页点击 GitHub 链接（全站守卫改写）、Release / raw / 归档下载加速。

要接管"地址栏输入"这一层，需要浏览器扩展 API、系统代理或 hosts。

## 图标

- `newicon.png`：256×256，用于脚本元数据 `@icon`
- `newicon.ico`：多尺寸（256 / 128 / 64 / 48 / 32 / 16）

CDN 地址（jsdmirror 加速）：`https://cdn.jsdmirror.com/gh/piaopiaosir/FastGithub-GoGo@main/newicon.png`

## 版本

当前版本：1.1.0

- 1.1.0：修正版本号，并配置脚本猫 Webhook 自动同步

## 许可

MIT © PIAOPIAO
