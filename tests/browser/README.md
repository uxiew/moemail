# 配额相关浏览器回归

只在本地测试。夹具会拦截 `/api/*`，使用 `example.com` 假数据，不验证真实登录或邮件投递。

在仓库根目录运行以下命令；临时路由已存在时不要覆盖：

```sh
route='app/[locale]/quota-test'
mkdir "$route" || exit 1
trap 'rm -f "$route/page.tsx"; rmdir "$route"' EXIT
cp tests/browser/quota-fixture.tsx "$route/page.tsx"
NEXT_TELEMETRY_DISABLED=1 WRANGLER_SEND_METRICS=false pnpm dev --hostname 127.0.0.1
```

1. 用干净的浏览器会话打开 `http://127.0.0.1:3000/zh-CN/quota-test`。
2. 在开发者工具 Console 中执行 `tests/browser/assert-quota.js` 全文。分别用宽度 1280 和 390 重载运行，结果必须为 `pass: true`。
3. 打开 `http://127.0.0.1:3000/zh-CN/quota-test?config-failure` 后再次执行脚本。503 只能发起 1 次配置请求，不能无限重试。夹具在第 10 次以后挂起响应，防止旧代码卡死浏览器。
4. `Ctrl+C` 停止服务，确认临时路由已删除。不要把该路由打包发布。

无浏览器的定时器、并发、取消、网络失败、D1 清理和收件回归：`pnpm test:quota`。D1 使用临时配置和非持久本地数据库，不读取项目的 `.env`，也不接触远端数据库。

## 真实页面的 UI 对齐检查

打开实际首页、登录、邮箱或分享页，等待页面和邮件正文加载完成，再在 Console 执行 `tests/browser/assert-live-ui.js`。覆盖 1440×900、390×844，以及首页的 320×568；检查单个登录入口、三栏标题高度、长文本、当前布局的详情和主题切换。样例邮件不应横向溢出，任意邮件中的固定宽度表格需要另行检查。
