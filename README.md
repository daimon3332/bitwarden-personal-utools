# Bitwarden uTools 插件

一个面向个人电脑使用的 uTools Bitwarden 快速搜索与复制插件，重点优化 TOTP 场景：打开快、搜索快、复制快。

## 功能

- 默认按文件夹搜索，适合优先搜索 TOTP 文件夹里的条目
- 支持综合搜索：`name` / `username` / `url` / `folder`
- 支持模糊搜索：本地二次排序，支持少量拼写误差和子序列匹配
- 按 Name 搜索：选择 `Name` 或输入 `n: github`
- 按 URL 搜索：选择 `URL` 或输入 `u: github.com`
- 按文件夹搜索：选择 `文件夹` 或输入 `f: 工作 github` / `f 工作 github`
- 自定义文件夹筛选：右上角“自定义文件夹”可添加多个固定文件夹（例如 `totp`、`work`），添加后下拉框会出现对应文件夹名称；未添加时不显示自定义文件夹选项
- 复制 TOTP：选中后按 `Enter` 或双击条目
- 复制密码：`Ctrl+T`
- 复制用户名：`Ctrl+U`
- 手动同步并刷新本地缓存：`Ctrl+R`

## 连接方式

插件通过本机 Bitwarden CLI 获取数据，不直接调用 Bitwarden 远程 API。

1. 安装 Bitwarden CLI，并确保 `bw --version` 可用。
2. 打开插件，填写一次性配置：
   - Client ID
   - Client Secret
   - 主密码
   - Bitwarden 服务地址（默认 `https://vault.bitwarden.com`，自建服务填写自己的域名）
   - `bw` 路径（如果默认 `bw` 找不到）
3. 点击“保存配置并连接”。

自定义服务地址本质上会执行：

```bash
bw config server https://你的域名
```

如果当前 Bitwarden CLI 已经登录到另一个服务地址，插件会先执行 `bw logout`，再更新 `bw config server`，然后使用保存的 Client ID / Client Secret 重新登录并同步。切换服务地址会清空旧服务地址对应的本地缓存。

首次配置会连接 CLI、登录/解锁并拉取一次数据到本地缓存。之后每次进入插件只读取本地缓存，不检查 CLI 状态，也不自动拉取最新数据。

如果需要最新数据，点击插件右上角“同步”或按 `Ctrl+R`。

右上角“自定义文件夹”可以配置多个常用文件夹名，例如 `totp`、`work`。配置后，搜索模式下拉框会出现对应文件夹名称，选择后仅在该文件夹内搜索和展示条目；未配置时下拉框不会出现自定义文件夹选项。

## 极速复制模式

为了实现即时复制，本插件会在同步时把以下数据缓存到本地：

- 搜索字段：名称、用户名、网址、文件夹名、条目 ID
- 密码明文
- TOTP 种子

复制密码、用户名和 TOTP 时会优先使用本地缓存，不再调用 CLI，因此复制速度接近即时。

TOTP 会在插件内根据本地缓存的种子实时生成当前验证码，支持普通 TOTP、`otpauth://` URI 和 `steam://` 格式。

## 安全说明

- Client ID / Client Secret / 主密码会保存到 uTools 存储中，优先使用 `utools.dbCryptoStorage`。
- 本地缓存会保存密码明文和 TOTP 种子，仅建议在个人可信设备上使用。
- 修改 Bitwarden 数据后，需要手动同步刷新本地缓存。
- `BW_SESSION` 只保存在插件 preload 进程内存中，插件进程结束后失效。
- 不建议在共享电脑上保存 Client Secret、主密码、密码缓存和 TOTP 缓存。

## 开发调试

在 uTools 开发者工具中选择本目录的 `plugin.json` 接入开发。

核心文件：

- `plugin.json`：uTools 指令配置
- `preload.js`：Bitwarden CLI 封装、本地缓存、TOTP 生成
- `index.html` / `index.js` / `index.css`：插件界面
