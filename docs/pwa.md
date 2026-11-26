# 手机安装到主屏幕

PWA 是可安装的网页应用。手机通过 HTTPS 打开网站后，可将 MoeMail 添加到主屏幕，以独立窗口打开；无需上架应用商店，也不需要新增 Cloudflare 服务。邮箱收发仍需联网，不提供离线邮箱副本。

## 用户看到什么

- Android：不拦截浏览器原生安装提示。浏览器判定可安装且用户尚未处理时，30 秒后提供「安装应用」备用入口；点击仍由系统确认，不满足条件时不展示无效按钮。
- iPhone / iPad：显示「查看添加步骤」，指引使用 Safari 的「分享 → 添加到主屏幕」。网页不能像 Android 一样主动调出原生安装框。
- iOS 站内指引延迟 3 秒，Android 备用入口延迟 30 秒；只在手机/平板且视口不超过 1023px、可用高度至少 568px 时出现。更矮的窗口或输入时暂时隐藏，避免遮挡操作。
- 关闭站内提示、取消或接受原生安装后，站内入口 7 天内不再提示；浏览器自身提示时机仍由浏览器控制。存储受限时只保证本次页面隐藏。独立应用窗口不提示；iOS 在普通 Safari 标签页里无法可靠识别另一个已安装的主屏幕应用。
- 桌面浏览器不显示这张手机提示卡，仍可使用浏览器自身提供的安装入口。

这些限制来自浏览器的安装能力，而不是 Cloudflare 开关。参考 [浏览器安装事件说明](https://web.dev/learn/pwa/installation-prompt) 和 [PWA 安装条件](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)。

## 实现边界

沿用 `next-pwa`、现有图标和 `standalone` 清单，不升级依赖。清单的 `id` 和 `start_url` 都保持 `/`，避免已安装用户被识别成另一个应用。

App Router 在客户端显式注册 `/sw.js`，不依赖旧插件对 Pages Router 的自动注入。只预缓存发布出的静态资源，不缓存登录页、邮箱 HTML、私有 API 或启动页；避免断网或退出登录后回放旧账号内容。内部 `app-build-manifest.json` 不会发布到 Pages，必须排除，否则它的 404 会让整个 Service Worker 安装失败。系统通知处理脚本通过 `importScripts` 引入，功能与配置见[后台通知](web-push.md)。

## 回归

在仓库根目录执行：

```sh
pnpm test:pwa
pnpm build:pages
pnpm test:pwa:build
```

最后一条读取实际 Pages 产物，验证预缓存清单只包含已发布的静态文件，并拒绝恢复运行时 API/页面缓存。它不能在构建之前执行，也不以编译成功代替浏览器启用成功。

按[本地预览](local-preview.md#检查真实-pages-产物)启动 Pages；开发模式不注册 Service Worker。使用干净浏览器会话，避免其他本地项目的 `/sw.js` 干扰：

1. Android UA、390×844：在 Console 执行 `tests/browser/assert-pwa.js`。脚本只允许 localhost，验证不阻止浏览器默认提示，并推进备用入口的 30 秒测试时钟，再检查事件只消费一次、等待期间禁用、取消/接受/已安装后隐藏、7 天抑制和失败提示。事件是合成的，不等于手机已安装成功。
2. iPhone UA：检查提示、手动安装步骤、关闭并刷新不再提示；320×568、390×844 均不横向溢出。聚焦输入框应隐藏提示；桌面 UA 不应出现手机提示。
3. 查看 Application → Service Workers，确认 `/sw.js` 为 activated 且控制当前页；Cache Storage 中不能出现 `/api/`、登录页或邮箱页响应。
4. 在假数据预览中读取邮箱后停止本地服务器：图标仍可从静态缓存读取，但同一个邮箱 API 必须请求失败，不能返回缓存邮件。

2026-11-26 本地验收：37 项自动测试、类型检查和完整 Pages 构建通过；lint 保留两条既有 Hook 依赖警告。Chrome 的 Android/iPhone UA 下检查了安装交互、320×568/390×844 布局和 320×500 隐藏边界；实际 Service Worker 已启用。停止服务器后图标可读，邮箱 API/登录页不可回放。假账号浏览器登录后邮箱 API 为 200，退出后为 401；现有 API 回归脚本的 119 次断言通过（不代表 119 个独立业务场景）。

2026-11-26 已推送并发布到既有 Cloudflare Pages，线上检查与回滚点见[本次上线记录](deployment.md#2026-11-26-pwa-上线记录)。

最终原生安装验收仍需真实 Android 和 iPhone：系统安装/添加确认、桌面图标启动、独立窗口、已有账号登录和应用更新。UA 模拟和合成事件不覆盖这些系统行为。
