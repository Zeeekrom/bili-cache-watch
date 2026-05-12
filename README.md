# Bili Cache Watch

一个本地全栈网站，用来保存 Bilibili 缓存视频的 BV 号，并定时检查视频是否疑似删除、不可见或受限。

## 运行

```powershell
npm install
npm run dev
```

打开 `http://localhost:3000`。

如果 3000 端口已经被其他项目占用：

```powershell
$env:PORT="3001"; npm run dev
```

默认每 60 分钟检查一次。可以通过环境变量调整：

```powershell
$env:CHECK_INTERVAL_MINUTES="30"; npm run dev
```

## 公开视频前的登录保护

如果要把网站发到互联网上，先设置自己的邀请码和 Cookie 签名密钥：

```powershell
$env:PORT="3001"
$env:BILI_INVITE_CODE="reeshiram-YuBirdSing-202605"
$env:BILI_AUTH_SECRET="至少32位的随机长字符串"
node --experimental-sqlite src/server.js
```

未登录时，首页、API、封面、预览和下载都会被拦截到登录页。默认邀请码是 `change-me`，只适合本地测试，公开前一定要改掉。公开访问时建议放在 HTTPS 反向代理或隧道后面。

也可以复制 `.env.example` 为 `.env`，然后把 `BILI_INVITE_CODE` 改成 `reeshiram-YuBirdSing-202605`。

## Docker 部署

```powershell
docker build -t bili-cache-watch .
docker run -d --name bili-cache-watch -p 3001:3001 `
  -e BILI_INVITE_CODE="reeshiram-YuBirdSing-202605" `
  -e BILI_AUTH_SECRET="至少32位的随机长字符串" `
  -v bili-cache-data:/app/data `
  bili-cache-watch
```

或者使用 compose：

```powershell
$env:BILI_AUTH_SECRET="至少32位的随机长字符串"
docker compose up -d --build
```

云平台部署时需要配置这些环境变量：

- `PORT=3001`
- `BILI_INVITE_CODE=reeshiram-YuBirdSing-202605`
- `BILI_AUTH_SECRET=至少32位的随机长字符串`
- `CHECK_INTERVAL_MINUTES=60`

## 安卓模拟器导入

1. 启动安卓模拟器，登录 Bilibili App。
2. 在 App 里手动进入缓存/离线缓存视频列表页。
3. 确认电脑能看到模拟器：

```powershell
npm run android:devices
```

输出里应该能看到类似 `emulator-5554 device`。
4. 安装 Appium Android 驱动：

```powershell
npm run appium:setup
```

5. 启动 Appium：

```powershell
npm run appium:start
```

6. 另开一个终端运行导入：

```powershell
npm run import:android
```

也可以直接在网页 `http://localhost:3001` 的“缓存导入”区域点击“从安卓模拟器导入”。

导入脚本默认使用自动模式：

1. 优先读取模拟器中的 Bilibili 离线缓存元数据：`/sdcard/Android/data/tv.danmaku.bili/download/**/entry.json`。
2. 如果读不到元数据，才回退到 Android UI 自动化方案。

如果需要只扫描可见文本，不点开条目：

```powershell
$env:IMPORT_MODE="visible"; npm run import:android
```

如果导入不到内容，先让模拟器停在 Bilibili 缓存列表页，然后运行诊断：

```powershell
npm run android:inspect
```

诊断会把当前页面 XML 和截图保存到 `data/`，并打印可见控件，方便针对你的 Bilibili App 版本继续适配。

## 本地路径导入

如果你从真实手机手动拷贝了 Bilibili 缓存目录到电脑，可以在网页“从本地路径导入”里填写目录。程序会递归扫描目录下所有 `entry.json`，读取 BV 号、标题和 UP 主。

例如可以填写：

```text
D:\BiliCache\download
```

或项目内相对路径：

```text
data\android-download-copy
```

如果路径里有中文且终端命令测试出现乱码，网页输入通常仍可正常传 UTF-8；也可以先把导出的缓存目录放到纯英文路径。

## 真实手机导入

网页“缓存导入”区域还支持直接从 Windows 的 MTP 手机路径复制缓存。

使用前确认：

- 手机已通过数据线连接电脑。
- 手机上已经允许电脑访问文件。
- 路径指向 Bilibili 的 `download` 缓存目录。

示例路径：

```text
此电脑\REDMI K90 Pro Max\Internal shared storage\Android\data\tv.danmaku.bili\download
```

导入时程序会先读取每个缓存条目的 `entry.json`，和数据库里已有 BV 对比，只复制未导入过的视频缓存目录到：

```text
data\phone-import
```

复制完成后会自动导入 BV、标题和 UP 主。部分旧格式缓存只有 `avid` 没有 `bvid`，程序会自动换算成 BV 号。

## 手动检查

```powershell
npm run check
```

## 数据位置

SQLite 数据库在 `data/bili-watch.sqlite`。
