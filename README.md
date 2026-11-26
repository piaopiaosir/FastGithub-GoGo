# FastGithub-GoGo

<p align="center"><img src="icon.png" width="120" height="120" alt="FastGithub-GoGo"></p>

GitHub 镜像加速用户脚本。探测 GitHub 连通性，不可达时自动切换镜像站；Release / raw / 归档下载链接走代理加速；提供可拖拽、可最小化为悬浮球的设置面板。

## 功能特性

- **连通性探测**：启动时及手动触发探测 GitHub 可达性，结果写入本地配置并记录探测时间。
- **自动切换镜像**：确认不可访问时自动跳转到镜像站；可在设置中关闭，检测到 GitHub 登录态时默认跳过。
- **下载加速**：Release / raw / 归档等下载链接自动改写为代理地址，支持自定义代理与镜像节点，支持一键还原原始链接。
- **镜像与节点池**：内置预设镜像与回退代理节点，启动时自动拉取节点池并测速，仅使用可用节点；可手动刷新重新测速。
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
| 空闲自动收起 | 20 秒无操作后收成悬浮球 |
| 探测超时 | 连通性探测超时时间，1000 至 15000 毫秒 |
| 镜像站点 / 下载加速代理 | 选择当前使用的镜像与代理节点，支持新增自定义地址并自动测速 |

## 开发与测试

```bash
node ghm-smoke.test.cjs
```

测试使用极简 DOM 模拟环境，覆盖容器挂载、探测、跳转、下载链接改写、面板交互、设置写回等断言。设置 `GHM_DUMP=1` 可额外导出面板预览 HTML。

## 图标

- `icon.png`：256×256，用于脚本元数据 `@icon`
- `icon.ico`：多尺寸（256 / 128 / 64 / 48 / 32 / 16）

CDN 地址（jsdmirror 加速）：`https://cdn.jsdmirror.com/gh/piaopiaosir/FastGithub-GoGo@main/icon.png`

## 版本

当前版本：0.0.0

## 许可

MIT © PIAOPIAO
