"use client"

import { useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { EmailList } from "./email-list"
import { MessageListContainer } from "./message-list-container"
import { MessageView } from "./message-view"
import { SendDialog } from "./send-dialog"
import { cn } from "@/lib/utils"
import { useCopy } from "@/hooks/use-copy"
import { useSendPermission } from "@/hooks/use-send-permission"
import { Copy } from "lucide-react"
import { useDesktopLayout } from "@/hooks/use-desktop-layout"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"

interface Email {
  id: string
  address: string
}

export function ThreeColumnLayout() {
  const t = useTranslations("emails.layout")
  const [selectedEmail, setSelectedEmail] = useState<Email | null>(null)
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null)
  const [selectedMessageType, setSelectedMessageType] = useState<'received' | 'sent'>('received')
  const [refreshTrigger, setRefreshTrigger] = useState(0)
  const { copyToClipboard } = useCopy()
  const { canSend: canSendEmails } = useSendPermission()
  const isDesktop = useDesktopLayout()
  const mobileInboxRef = useRef<HTMLDivElement>(null)

  const columnClass = "min-w-0 border-2 border-primary/20 bg-background rounded-lg overflow-hidden flex flex-col"
  const headerClass = "h-14 min-w-0 p-2 border-b-2 border-primary/20 flex items-center justify-between shrink-0"
  const titleClass = "text-sm font-bold px-2 w-full overflow-hidden"

  // 详情覆盖在列表上，不卸载列表，关闭后才能保留分页和滚动位置。
  const mobileView = selectedEmail ? "emails" : "list"

  const copyEmailAddress = () => {
    copyToClipboard(selectedEmail?.address || "")
  }

  const handleMessageSelect = (messageId: string | null, messageType: 'received' | 'sent' = 'received') => {
    setSelectedMessageId(messageId)
    setSelectedMessageType(messageType)
  }

  const handleSendSuccess = () => {
    setRefreshTrigger(prev => prev + 1)
  }

  return (
    <div className="pb-5 pt-20 h-full min-h-0 flex flex-col">
      {/* 桌面端三栏布局 */}
      {isDesktop === true && <div className="hidden lg:grid grid-cols-12 gap-4 h-full min-h-0">
        <div className={cn("col-span-3", columnClass)}>
          <div className={headerClass}>
            <h2 className={titleClass}>{t("myEmails")}</h2>
          </div>
          <div className="flex-1 overflow-auto">
            <EmailList
              onEmailSelect={(email) => {
                setSelectedEmail(email)
                setSelectedMessageId(null)
              }}
              selectedEmailId={selectedEmail?.id}
            />
          </div>
        </div>

        <div className={cn("col-span-4", columnClass)}>
          <div className={headerClass}>
            <h2 className={titleClass}>
              {selectedEmail ? (
                <div className="w-full flex justify-between items-center gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate min-w-0">{selectedEmail.address}</span>
                    <button type="button" className="shrink-0 text-primary" aria-label={t("copyEmailAddress")} onClick={copyEmailAddress}>
                      <Copy className="size-4" />
                    </button>
                  </div>
                  {selectedEmail && canSendEmails && (
                    <SendDialog 
                      emailId={selectedEmail.id} 
                      fromAddress={selectedEmail.address}
                      onSendSuccess={handleSendSuccess}
                    />
                  )}
                </div>
              ) : (
                t("selectEmail")
              )}
            </h2>
          </div>
          {selectedEmail && (
            <div className="flex-1 overflow-auto">
              <MessageListContainer
                email={selectedEmail}
                onMessageSelect={handleMessageSelect}
                selectedMessageId={selectedMessageId}
                refreshTrigger={refreshTrigger}
              />
            </div>
          )}
        </div>

        <div className={cn("col-span-5", columnClass)}>
          <div className={headerClass}>
            <h2 className={titleClass}>
              {selectedMessageId ? t("messageContent") : t("selectMessage")}
            </h2>
          </div>
          {selectedEmail && selectedMessageId && (
            <div className="flex-1 overflow-auto">
              <MessageView
                emailId={selectedEmail.id}
                messageId={selectedMessageId}
                messageType={selectedMessageType}
                onClose={() => setSelectedMessageId(null)}
              />
            </div>
          )}
        </div>
      </div>}

      {/* 移动端单栏布局 */}
      {isDesktop === false && <div className="lg:hidden h-full min-h-0">
        <div className={cn("h-full", columnClass)}>
          {mobileView === "list" && (
            <>
              <div className={headerClass}>
                <h2 className={titleClass}>{t("myEmails")}</h2>
              </div>
              <div className="flex-1 min-h-0 overflow-hidden">
                <EmailList
                  onEmailSelect={(email) => {
                    setSelectedEmail(email)
                  }}
                  selectedEmailId={selectedEmail?.id}
                />
              </div>
            </>
          )}

          {mobileView === "emails" && selectedEmail && (
            <div ref={mobileInboxRef} tabIndex={-1} data-mobile-inbox className="h-full min-h-0 flex flex-col outline-none">
              <div className={cn(headerClass, "gap-2")}>
                <button
                  onClick={() => {
                    setSelectedEmail(null)
                    setSelectedMessageId(null)
                  }}
                  className="text-sm text-primary shrink-0"
                >
                  {t("backToEmailList")}
                </button>
                <div className="flex-1 flex justify-between items-center gap-2 min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate min-w-0 flex-1 text-right">{selectedEmail.address}</span>
                    <button type="button" className="shrink-0 text-primary" aria-label={t("copyEmailAddress")} onClick={copyEmailAddress}>
                      <Copy className="size-4" />
                    </button>
                  </div>
                  {canSendEmails && (
                    <SendDialog 
                      emailId={selectedEmail.id} 
                      fromAddress={selectedEmail.address}
                      onSendSuccess={handleSendSuccess}
                    />
                  )}
                </div>
              </div>
              <div className="flex-1 min-h-0 overflow-hidden">
                <MessageListContainer
                  email={selectedEmail}
                  onMessageSelect={handleMessageSelect}
                  selectedMessageId={selectedMessageId}
                  refreshTrigger={refreshTrigger}
                />
              </div>
            </div>
          )}

        </div>
        <Dialog open={!!selectedEmail && !!selectedMessageId} onOpenChange={open => { if (!open) setSelectedMessageId(null) }}>
          <DialogContent side="bottom" data-mobile-message-sheet aria-describedby={undefined}
            onCloseAutoFocus={event => { event.preventDefault(); mobileInboxRef.current?.focus({ preventScroll: true }) }}>
            <div className="shrink-0 border-b border-primary/20 px-4 pb-3 pt-2">
              <div aria-hidden="true" className="mx-auto mb-2 h-1 w-10 rounded-full bg-muted-foreground/30" />
              <DialogTitle className="pr-12 text-sm">{t("messageContent")}</DialogTitle>
            </div>
            <div className="flex-1 min-h-0 overflow-auto overscroll-contain">
              {selectedEmail && selectedMessageId && (
                <MessageView
                  key={selectedMessageId}
                  emailId={selectedEmail.id}
                  messageId={selectedMessageId}
                  messageType={selectedMessageType}
                  onClose={() => setSelectedMessageId(null)}
                />
              )}
            </div>
          </DialogContent>
        </Dialog>
      </div>}
    </div>
  )
}
