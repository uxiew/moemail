# 已有站点上线与回滚

## 上线前

1. 使用 `.mise.toml` 的 Node/pnpm 版本，运行 `pnpm install --frozen-lockfile`、`pnpm test:quota`、`pnpm test:build`、类型检查、lint 和 `pnpm build:pages`。Pages 构建与运行验收见[本地预览](local-preview.md)。
2. `pnpm exec wrangler whoami` 确认账号，再用 `wrangler pages deployment list --project-name <项目名> --environment production --json` 记录旧部署 ID；两个 Worker 用 `wrangler deployments list --name <Worker名> --json` 记录当前 100% 流量的版本 ID。
3. 将线上配置下载到独立目录，核对 Pages、邮件 Worker 和清理 Worker 指向同一个 D1；保留线上 KV、密钥、兼容日期、路由和 Cron。**不要把本地假数据配置或 `AUTH_URL=http://localhost:8788` 部署上去。**
4. 检查 diff、提交并正常推送；远端有新提交时先合并，不强推。

`pnpm-workspace.yaml` 明确批准锁文件中所需的安装脚本。出现 `ERR_PNPM_IGNORED_BUILDS` 时，先审查新增版本再更新清单，不使用全局放行或关闭检查。

## 更新已有资源

- 使用项目锁定的 Wrangler（`pnpm exec wrangler`），不要用 `pnpm dlx wrangler` 临时下载不同版本。
- Pages 用 `wrangler pages deploy .vercel/output/static --project-name <项目名> --branch main --commit-hash <提交SHA> --commit-message <简短说明>`。必须在核对过的生产配置所在目录执行。
- 两个 Worker 分别先执行 `wrangler deploy --config <生产配置> --dry-run`，再用相同配置部署并加 `--keep-vars`。两次部署都要成功；记录新版本 ID，不以某一条成功代替整体成功。
- 仅更新代码时不要运行一键初始化脚本：`scripts/deploy/index.ts` 还会创建缺失资源、应用 D1 迁移和推送密钥，并且 Worker 失败只告警。该脚本和原有 `Deploy` workflow 适用于已明确接受这些动作的初始化/迁移操作，不是无副作用的更新入口。
- 不手工触发生产清理 Cron、不导入测试种子、不用 `check-local-preview.ts` 测生产。部署清理代码后，既有定时任务会继续按原计划执行。

## 验收与回滚

上线后复查三个部署记录、Pages 生产 URL、登录页和未登录私有 API 的 401；浏览器检查页面与静态资源能加载。真实 OAuth、邮件投递和管理员设置属于另行验收，不能用匿名探测替代。

- Pages：在项目 Deployments 中选旧的成功生产部署，执行 **Rollback to this deployment**；预览部署不能用作生产回滚目标。[Cloudflare 回滚说明](https://developers.cloudflare.com/pages/configuration/rollbacks/)
- Worker：`pnpm exec wrangler rollback <旧版本ID> --name <Worker名> --message <回滚原因>`，分别处理邮件和清理 Worker；回滚后重新检查部署记录。
- 代码回滚不恢复已删除的 D1 数据，也不撤销独立修改过的 KV/密钥。本次无迁移更新不应改这些资源。
- 旧 Pages 版本含已知鉴权漏洞，只作为紧急恢复手段；回滚后需立即限制访问并继续修复，不能长期停留在旧版本。
