import { useState } from 'react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { IconDownload, IconUpload, IconDots, IconDatabase } from '@tabler/icons-react'
import { toast } from 'sonner'
import { useMessages } from '@/hooks/useMessages'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useAssistant } from '@/hooks/useAssistant'

interface KvCacheButtonsProps {
  threadId: string
}

const KvCacheButtons = ({ threadId }: KvCacheButtonsProps) => {
  const { t } = useTranslation()
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [saveDialogOpen, setSaveDialogOpen] = useState(false)
  const [restoreDialogOpen, setRestoreDialogOpen] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [restoreFile, setRestoreFile] = useState('')
  const [availableDumps, setAvailableDumps] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  
  const { getMessages } = useMessages()
  const { getProviderByName } = useModelProvider()
  const { currentAssistant } = useAssistant()

  const handleSaveClick = () => {
    setDropdownOpen(false)
    setSaveDialogOpen(true)
    setSaveName('')
  }

  const handleRestoreClick = async () => {
    setDropdownOpen(false)
    setLoading(true)
    
    try {
      const provider = getProviderByName('llamacpp')
      if (!provider) {
        toast.error(t('No active model engine provider'))
        return
      }

      const extension = window.core.extensionManager.getByName('llamacpp')
      if (!extension || typeof extension.listConversationDumps !== 'function') {
        toast.error(t('KV cache functionality not supported'))
        return
      }

      const dumps = await extension.listConversationDumps()
      setAvailableDumps(dumps)
      setRestoreDialogOpen(true)
      setRestoreFile('')
    } catch (error) {
      console.error('Failed to list conversation dumps:', error)
      toast.error(t('Failed to list saved conversations'))
    } finally {
      setLoading(false)
    }
  }

  const handleSaveConfirm = async () => {
    if (!saveName.trim()) {
      toast.error(t('Please enter a name'))
      return
    }

    if (!currentAssistant?.id) {
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

      const extension = window.core.extensionManager.getByName('llamacpp')
      if (!extension || typeof extension.saveConversationDump !== 'function') {
        toast.error(t('KV cache functionality not supported'))
        return
      }

      const messages = getMessages(threadId) || []
      await extension.saveConversationDump(currentAssistant.id, saveName.trim(), messages)
      
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

  const handleRestoreConfirm = async () => {
    if (!restoreFile) {
      toast.error(t('Please select a conversation'))
      return
    }

    if (!currentAssistant?.id) {
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

      const extension = window.core.extensionManager.getByName('llamacpp')
      if (!extension || typeof extension.restoreConversationDump !== 'function') {
        toast.error(t('KV cache functionality not supported'))
        return
      }

      await extension.restoreConversationDump(currentAssistant.id, restoreFile)
      
      toast.success(t('Conversation restored successfully'))
      setRestoreDialogOpen(false)
      setRestoreFile('')
    } catch (error) {
      console.error('Failed to restore conversation:', error)
      toast.error(t('Failed to restore conversation'))
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
              title={t('KV Cache Save/Restore')}
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
          >
            <IconDownload size={16} />
            {t('Save Conversation')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem 
            onClick={handleRestoreClick}
            className="flex items-center gap-2"
            disabled={loading}
          >
            <IconUpload size={16} />
            {t('Restore Conversation')}
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

      <Dialog open={restoreDialogOpen} onOpenChange={setRestoreDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('Restore Conversation')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <select
                id="restore-file"
                value={restoreFile}
                onChange={(e) => setRestoreFile(e.target.value)}
                aria-label={t('Select Conversation')}
                className="w-full p-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">{t('Choose a saved conversation')}</option>
                {availableDumps.map((dump) => (
                  <option key={dump} value={dump}>
                    {dump}
                  </option>
                ))}
              </select>
            </div>
            {availableDumps.length === 0 && (
              <p className="text-sm text-gray-500">
                {t('No saved conversations found')}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setRestoreDialogOpen(false)}
                disabled={loading}
              >
                {t('Cancel')}
              </Button>
              <Button
                onClick={handleRestoreConfirm}
                disabled={loading || !restoreFile || availableDumps.length === 0}
              >
                {loading ? t('Restoring...') : t('Restore')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

export default KvCacheButtons