# 我的专属工作台 · Workbench

一个手机端的 PWA 网页应用，专为外企物业资产运营 / 绿色可持续 / 商务转型场景设计。
每天自动拉取最新行业资讯、商务英语练习、TED 演讲。

## 功能模块

| 模块 | 内容 | 数据源（公开 RSS） |
|---|---|---|
| 🏢 物业资产 · 楼宇交易 | 商业地产交易、写字楼 refi、融资政策 | CommercialCafe、RealEstateAgentMagazine、ScienceDaily |
| 🌱 绿色金融 · 双碳动态 | 碳达峰碳中和、绿色金融、可持续商业 | ScienceDaily Earth、ScienceDaily Energy、TriplePundit |
| 💬 商务英语 · 每日一练 | 外企物业 + ESG 场景对话 / 邮件 / 谈判 | 内置课程库（确定性轮播） |
| 🎤 今日 TED · 演讲口才 | 短时长演讲 + 学习要点 + 词汇 | TED Talks 精选 |

## 如何使用

### 方式 1：本地启动（推荐用于开发）

```bash
cd workbench-app
python3 serve.py 8099
# 然后浏览器打开 http://127.0.0.1:8099/index.html
```

### 方式 2：部署到服务器

把 `workbench-app/` 下除 `serve.py` 外的所有文件上传到任意静态服务器即可。
**注意：必须保留 `/proxy?url=` 后端能力**（参考 `serve.py` 中的实现），否则浏览器无法直接访问外部 RSS。

### 方式 3：手机像 App 一样使用

iOS Safari 打开 → 分享 → 添加到主屏幕
Android Chrome 打开 → 菜单 → 添加到主屏幕

## 每日更新机制

- 资讯：每次打开自动拉取当日最新，本地缓存（localStorage）保留一天
- TED / 商务英语：以日期为种子确定性轮播，同一天内容稳定
- 顶部"↻ 刷新"按钮可清缓存强制重拉

## 文件说明

- `index.html` - 页面结构与样式
- `app.js` - 核心逻辑（RSS 抓取、解析、渲染）
- `manifest.json` - PWA 配置（可添加到主屏幕）
- `icon.svg` / `icon-192.png` / `icon-512.png` - 图标
- `serve.py` - 本地开发服务器（含 CORS 代理）

## 自定义扩展

### 改 RSS 源
编辑 `app.js` 顶部的 `SOURCES` 对象，加新的 RSS URL 即可。

### 加商务英语场景
编辑 `app.js` 中 `ENG_LESSONS` 数组，按现有结构添加新场景。

### 加 TED 推荐
编辑 `app.js` 中 `TED_PICKS` 数组。TED 视频 ID 在 TED 链接 `ted.com/talks/<slug>` 对应的 YouTube 嵌入 URL `youtube.com/embed/<id>` 中获取。

## 已知限制

- 部分 RSS 在中国大陆访问可能受限，建议部署时把代理路径换成你自己的后端
- TED YouTube 嵌入需要访问 YouTube 网络，国内可改用跳转 TED.com 的方式

---

构建于 2026/07/25 · 基于真实公开 RSS 数据