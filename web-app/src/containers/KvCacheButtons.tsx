import { useState } from 'react'
import { ThreadMessage } from '@janhq/core'
import { useTranslation } from '@/i18n/react-i18next-compat'

// Interface for llamacpp extension with KV cache methods
interface LlamacppKvCacheExtension {
  saveConversationDump(
    modelId: string,
    filename: string,
    messages: ThreadMessage[],
    threadId: string,
    requestOptions?: any
  ): Promise<void>
}
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { IconDownload, IconDots, IconDatabase } from '@tabler/icons-react'
import { toast } from 'sonner'
import { useMessages } from '@/hooks/useMessages'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useAssistant } from '@/hooks/useAssistant'
import { useThreads } from '@/hooks/useThreads'

interface KvCacheButtonsProps {
  threadId: string
}

const KvCacheButtons = ({ threadId }: KvCacheButtonsProps) => {
  const { t } = useTranslation()
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [saveDialogOpen, setSaveDialogOpen] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [loading, setLoading] = useState(false)
  
  const { getMessages } = useMessages()
  const { getProviderByName } = useModelProvider()
  const { currentAssistant } = useAssistant()
  const { getCurrentThread } = useThreads()
  const hasMessages = (getMessages(threadId) || []).length > 0

  const handleSaveClick = () => {
    setDropdownOpen(false)
    setSaveDialogOpen(true)
    setSaveName('')
  }


  const handleSaveConfirm = async () => {
    if (!saveName.trim()) {
      toast.error(t('Please enter a name'))
      return
    }

    if (!currentAssistant?.id) {
      toast.error(t('No assistant selected'))
      return
    }

    if (!threadId) {
      toast.error(t('No thread selected'))
      return
    }

    const currentThread = getCurrentThread()
    const modelId = currentThread?.model?.id
    if (!modelId) {
      toast.error(t('No model selected'))
      return
    }

    setLoading(true)
    
    try {
      const provider = getProviderByName('llamacpp')
      if (!provider) {
        toast.error(t('llamacpp provider not available'))
        return
      }

      const extension = window.core.extensionManager.getByName('@janhq/llamacpp-extension') as LlamacppKvCacheExtension
      
      if (!extension) {
        toast.error(t('llamacpp extension not found'))
        return
      }
      
      if (typeof extension.saveConversationDump !== 'function') {
        toast.error(t('saveConversationDump method not found on extension'))
        return
      }

      const messages = getMessages(threadId) || []
      await extension.saveConversationDump(modelId, saveName.trim(), messages, threadId)
      
      toast.success(t('Conversation saved successfully'))
      setSaveDialogOpen(false)
      setSaveName('')
    } catch (error) {
      console.error('Failed to save conversation:', error)
      toast.error(t('Failed to save conversation'))
    } finally {
      setLoading(false)
    }
  }


  return (
    <>
      <DropdownMenu open={dropdownOpen} onOpenChange={setDropdownOpen}>
        <div className="inline-flex items-center justify-between gap-2 bg-main-view-fg/5 py-1 hover:bg-main-view-fg/8 px-2 rounded-sm">
          <DropdownMenuTrigger asChild>
            <button 
              className="font-medium cursor-pointer flex items-center gap-1.5 relative z-20"
              title={t('KV Cache Save')}
            >
              <div className="text-main-view-fg/80 flex items-center gap-1">
                <IconDatabase size={16} />
                <IconDots size={12} />
              </div>
            </button>
          </DropdownMenuTrigger>
        </div>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem 
          onClick={handleSaveClick}
          className="flex items-center gap-2"
          disabled={!hasMessages}
        >
          <IconDownload size={16} />
          {t('Save Conversation')}
        </DropdownMenuItem>
      </DropdownMenuContent>

      </DropdownMenu>

      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('Save Conversation')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Input
                id="save-name"
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                placeholder={t('Enter a name for this conversation')}
                aria-label={t('Conversation Name')}
                onKeyDown={(e) => e.key === 'Enter' && handleSaveConfirm()}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setSaveDialogOpen(false)}
                disabled={loading}
              >
                {t('Cancel')}
              </Button>
              <Button
                onClick={handleSaveConfirm}
                disabled={loading || !saveName.trim()}
              >
                {loading ? t('Saving...') : t('Save')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

    </>
  )
}

export default KvCacheButtons
