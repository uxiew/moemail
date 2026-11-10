interface Env {
  DB: D1Database
}

const CLEANUP_CONFIG = {
  /** 是否删除过期邮箱 */
  DELETE_EXPIRED_EMAILS: true,
  /** 每批删除的最大邮箱数 */
  BATCH_SIZE: 100,
  /** 最多循环几批（防止单次 Cron 运行太久） */
  MAX_BATCHES: 10,
} as const

const main = {
  async scheduled(_: ScheduledEvent, env: Env) {
    if (!CLEANUP_CONFIG.DELETE_EXPIRED_EMAILS) {
      console.log('Expired email deletion is disabled')
      return
    }

    const now = Date.now()
    let totalDeleted = 0

    // 循环批量删除，防止过期邮箱积压时单批 100 条清不完
    for (let batch = 0; batch < CLEANUP_CONFIG.MAX_BATCHES; batch++) {
      // 用子查询代替 DELETE … LIMIT，兼容性更好
      const result = await env.DB
        .prepare(`
          DELETE FROM email
          WHERE id IN (
            SELECT id FROM email WHERE expires_at < ? LIMIT ?
          )
        `)
        .bind(now, CLEANUP_CONFIG.BATCH_SIZE)
        .run()

      const deleted = result?.meta?.changes ?? 0
      totalDeleted += deleted

      if (deleted < CLEANUP_CONFIG.BATCH_SIZE) {
        // 这批没删满，说明已经清完了
        break
      }
    }

    console.log(`Cleanup: deleted ${totalDeleted} expired emails`)
  }
}

export default main
