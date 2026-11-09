import { Env } from '../types'
import { drizzle } from 'drizzle-orm/d1'
import { messages, emails, webhooks } from '../app/lib/schema'
import { and, eq, gt, sql } from 'drizzle-orm'
import PostalMime from 'postal-mime'
import { WEBHOOK_CONFIG } from '../app/config/webhook'
import { EmailMessage } from '../app/lib/webhook'

const handleEmail = async (message: ForwardableEmailMessage, env: Env) => {
  const db = drizzle(env.DB, { schema: { messages, emails, webhooks } })

  try {
    const targetEmail = await db.query.emails.findFirst({
      where: and(
        eq(sql`LOWER(${emails.address})`, message.to.toLowerCase()),
        gt(emails.expiresAt, new Date())
      )
    })

    if (!targetEmail) {
      message.setReject('Recipient does not exist or has expired')
      return
    }

    // 无效收件人不解析 MIME，也不保存正文或触发 webhook。
    const parsedMessage = await PostalMime.parse(message.raw)

    const savedMessage = await db.insert(messages).values({
      emailId: targetEmail.id,
      fromAddress: message.from,
      subject: parsedMessage.subject || '(无主题)',
      content: parsedMessage.text || '',
      html: parsedMessage.html || '',
      type: 'received',
    }).returning().get()

    const webhook = targetEmail.userId
      ? await db.query.webhooks.findFirst({
          where: eq(webhooks.userId, targetEmail.userId)
        })
      : undefined

    if (webhook?.enabled) {
      try {
        await fetch(webhook.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Webhook-Event': WEBHOOK_CONFIG.EVENTS.NEW_MESSAGE
          },
          body: JSON.stringify({
            emailId: targetEmail.id,
            messageId: savedMessage.id,
            fromAddress: savedMessage.fromAddress,
            subject: savedMessage.subject,
            content: savedMessage.content,
            html: savedMessage.html,
            receivedAt: savedMessage.receivedAt.toISOString(),
            toAddress: targetEmail.address
          } as EmailMessage)
        })
      } catch (error) {
        console.error('Failed to send webhook:', error)
      }
    }

    console.log('Email processed')
  } catch (error) {
    console.error('Failed to process email:', error)
  }
}

const worker = {
  async email(message: ForwardableEmailMessage, env: Env): Promise<void> {
    await handleEmail(message, env)
  }
}

export default worker 