# Bitwarden uTools 插件

用 uTools 快速搜索 Bitwarden 密码库，并复制密码、用户名、TOTP。

## 功能

- 默认按文件夹搜索，适合优先搜索 TOTP 文件夹里的条目
- 综合搜索：`name` / `username` / `url` / `folder`
- 模糊搜索：本地二次排序，支持少量拼写误差、子序列匹配
- 按 Name 搜索：选择 `Name` 或输入 `n: github`
- 按 URL 搜索：选择 `URL` 或输入 `u: github.com`
- 按文件夹搜索：选择 `文件夹` 或输入 `f: 工作 github` / `f 工作 github`
- 复制 TOTP：选中后按 `Enter`
- 复制密码：`Ctrl+T`
- 复制用户名：`Ctrl+U`
- 手动同步并刷新本地缓存：`Ctrl+R`

## 连接方式

插件通过本机 Bitwarden CLI 调用，不直接保存或处理远程 vault 数据。

1. 安装并确保 `bw --version` 可用。
2. 打开插件，填写一次性配置：
   - Client ID
   - Client Secret
   - 主密码
   - `bw` 路径（如果默认 `bw` 找不到）
3. 点击“保存配置并连接”。

首次配置会连接 CLI、登录/解锁并拉取一次数据到本地缓存。之后每次进入插件只读取本地缓存，不检查 CLI 状态，也不自动拉取最新数据。

如果需要最新数据，点击插件右上角“同步”或按 `Ctrl+R`。

为了实现最快复制，本插件会在同步时把密码和 TOTP 种子一起缓存到本地。复制密码/TOTP 时优先使用本地缓存，不再调用 CLI，因此可以即时复制。

> Client ID / Secret / 主密码会保存到 uTools 存储中，优先使用 `utools.dbCryptoStorage`。

## 安全说明

- 本地缓存会保存搜索字段、密码明文和 TOTP 种子，用于极速复制。
- 修改 Bitwarden 数据后，需要手动同步刷新本地缓存。
- `BW_SESSION` 只保存在插件 preload 进程内存中，插件进程结束后失效。
- 只建议在个人电脑使用；不建议在共享电脑上保存 Client Secret、主密码、密码缓存和 TOTP 缓存。

## 开发调试

在 uTools 开发者工具中选择本目录的 `plugin.json` 接入开发。

核心文件：

- `plugin.json`：uTools 指令配置
- `preload.js`：Bitwarden CLI 封装
- `index.html` / `index.js` / `index.css`：插件界面
