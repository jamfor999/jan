import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { KvCacheButtons } from '../KvCacheButtons'
import { toast } from 'sonner'

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  }
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  })
}))

vi.mock('@/hooks/useMessages', () => ({
  useMessages: () => ({
    getMessages: vi.fn().mockReturnValue([
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' }
    ])
  })
}))

vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: () => ({
    getProviderByName: vi.fn().mockReturnValue({ id: 'llamacpp' })
  })
}))

vi.mock('@/hooks/useAssistant', () => ({
  useAssistant: () => ({
    currentAssistant: { id: 'test-model' }
  })
}))

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children, open, onOpenChange }: any) => (
    <div data-testid="dropdown-menu" data-open={open}>
      <div onClick={() => onOpenChange(!open)}>{children}</div>
    </div>
  ),
  DropdownMenuTrigger: ({ children }: any) => children,
  DropdownMenuContent: ({ children }: any) => (
    <div data-testid="dropdown-content">{children}</div>
  ),
  DropdownMenuItem: ({ children, onClick, disabled }: any) => (
    <button 
      data-testid="dropdown-item"
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  ),
  DropdownMenuSeparator: () => <div data-testid="dropdown-separator" />
}))

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: any) => open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children }: any) => <div data-testid="dialog-content">{children}</div>,
  DialogHeader: ({ children }: any) => <div data-testid="dialog-header">{children}</div>,
  DialogTitle: ({ children }: any) => <h2 data-testid="dialog-title">{children}</h2>
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, disabled, variant }: any) => (
    <button 
      onClick={onClick} 
      disabled={disabled}
      data-testid={variant === 'outline' ? 'cancel-button' : 'confirm-button'}
    >
      {children}
    </button>
  )
}))

vi.mock('@/components/ui/input', () => ({
  Input: (props: any) => (
    <input 
      data-testid="input"
      {...props}
    />
  )
}))

vi.mock('@tabler/icons-react', () => ({
  IconDownload: () => <div data-testid="download-icon" />,
  IconUpload: () => <div data-testid="upload-icon" />,
  IconDots: () => <div data-testid="dots-icon" />,
  IconDatabase: () => <div data-testid="database-icon" />
}))

describe('KvCacheButtons', () => {
  let user: ReturnType<typeof userEvent.setup>
  let mockExtension: any

  beforeEach(() => {
    user = userEvent.setup()
    vi.clearAllMocks()
    
    mockExtension = {
      listConversationDumps: vi.fn(),
      saveConversationDump: vi.fn(),
      restoreConversationDump: vi.fn()
    }

    global.window = {
      ...global.window,
      core: {
        extensionManager: {
          getByName: vi.fn().mockReturnValue(mockExtension)
        }
      }
    } as any
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Initial Render', () => {
    it('should render the KV cache button', () => {
      render(<KvCacheButtons threadId="test-thread" />)
      
      expect(screen.getByTitle('KV Cache Save/Restore')).toBeInTheDocument()
      expect(screen.getByTestId('database-icon')).toBeInTheDocument()
      expect(screen.getByTestId('dots-icon')).toBeInTheDocument()
    })

    it('should not show dialogs initially', () => {
      render(<KvCacheButtons threadId="test-thread" />)
      
      expect(screen.queryByTestId('dialog')).not.toBeInTheDocument()
    })
  })

  describe('Dropdown Menu', () => {
    it('should show dropdown menu when clicked', async () => {
      render(<KvCacheButtons threadId="test-thread" />)
      
      const button = screen.getByTitle('KV Cache Save/Restore')
      await user.click(button)
      
      expect(screen.getByText('Save Conversation')).toBeInTheDocument()
      expect(screen.getByText('Restore Conversation')).toBeInTheDocument()
      expect(screen.getByTestId('download-icon')).toBeInTheDocument()
      expect(screen.getByTestId('upload-icon')).toBeInTheDocument()
    })

    it('should open save dialog when Save Conversation is clicked', async () => {
      render(<KvCacheButtons threadId="test-thread" />)
      
      const button = screen.getByTitle('KV Cache Save/Restore')
      await user.click(button)
      
      const saveItem = screen.getByText('Save Conversation')
      await user.click(saveItem)
      
      await waitFor(() => {
        expect(screen.getByTestId('dialog')).toBeInTheDocument()
        expect(screen.getByTestId('dialog-title')).toHaveTextContent('Save Conversation')
      })
    })

    it('should open restore dialog when Restore Conversation is clicked', async () => {
      mockExtension.listConversationDumps.mockResolvedValue(['conversation1', 'conversation2'])
      
      render(<KvCacheButtons threadId="test-thread" />)
      
      const button = screen.getByTitle('KV Cache Save/Restore')
      await user.click(button)
      
      const restoreItem = screen.getByText('Restore Conversation')
      await user.click(restoreItem)
      
      await waitFor(() => {
        expect(screen.getByTestId('dialog')).toBeInTheDocument()
        expect(screen.getByTestId('dialog-title')).toHaveTextContent('Restore Conversation')
      })
      
      expect(mockExtension.listConversationDumps).toHaveBeenCalled()
    })
  })

  describe('Save Dialog', () => {
    beforeEach(async () => {
      render(<KvCacheButtons threadId="test-thread" />)
      
      const button = screen.getByTitle('KV Cache Save/Restore')
      await user.click(button)
      
      const saveItem = screen.getByText('Save Conversation')
      await user.click(saveItem)
      
      await waitFor(() => {
        expect(screen.getByTestId('dialog')).toBeInTheDocument()
      })
    })

    it('should show save dialog with input field', () => {
      expect(screen.getByTestId('input')).toBeInTheDocument()
      expect(screen.getByText('Save')).toBeInTheDocument()
      expect(screen.getByText('Cancel')).toBeInTheDocument()
    })

    it('should disable save button when input is empty', () => {
      const saveButton = screen.getByTestId('confirm-button')
      expect(saveButton).toBeDisabled()
    })

    it('should enable save button when input has value', async () => {
      const input = screen.getByTestId('input')
      await user.type(input, 'My Conversation')
      
      const saveButton = screen.getByTestId('confirm-button')
      expect(saveButton).not.toBeDisabled()
    })

    it('should handle Enter key to save', async () => {
      mockExtension.saveConversationDump.mockResolvedValue(undefined)
      
      const input = screen.getByTestId('input')
      await user.type(input, 'My Conversation')
      await user.keyboard('{Enter}')
      
      await waitFor(() => {
        expect(mockExtension.saveConversationDump).toHaveBeenCalledWith(
          'test-model',
          'My Conversation',
          expect.any(Array)
        )
      })
    })

    it('should close dialog when cancel is clicked', async () => {
      const cancelButton = screen.getByTestId('cancel-button')
      await user.click(cancelButton)
      
      await waitFor(() => {
        expect(screen.queryByTestId('dialog')).not.toBeInTheDocument()
      })
    })

    it('should save conversation successfully', async () => {
      mockExtension.saveConversationDump.mockResolvedValue(undefined)
      
      const input = screen.getByTestId('input')
      await user.type(input, 'My Conversation')
      
      const saveButton = screen.getByTestId('confirm-button')
      await user.click(saveButton)
      
      await waitFor(() => {
        expect(mockExtension.saveConversationDump).toHaveBeenCalledWith(
          'test-model',
          'My Conversation',
          expect.any(Array)
        )
      })
      
      expect(toast.success).toHaveBeenCalledWith('Conversation saved successfully')
    })

    it('should handle save error', async () => {
      mockExtension.saveConversationDump.mockRejectedValue(new Error('Save failed'))
      
      const input = screen.getByTestId('input')
      await user.type(input, 'My Conversation')
      
      const saveButton = screen.getByTestId('confirm-button')
      await user.click(saveButton)
      
      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('Failed to save conversation')
      })
    })

    it('should show error for empty name', async () => {
      const saveButton = screen.getByTestId('confirm-button')
      fireEvent.click(saveButton)
      
      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('Please enter a name')
      })
    })
  })

  describe('Restore Dialog', () => {
    beforeEach(async () => {
      mockExtension.listConversationDumps.mockResolvedValue(['conversation1', 'conversation2'])
      
      render(<KvCacheButtons threadId="test-thread" />)
      
      const button = screen.getByTitle('KV Cache Save/Restore')
      await user.click(button)
      
      const restoreItem = screen.getByText('Restore Conversation')
      await user.click(restoreItem)
      
      await waitFor(() => {
        expect(screen.getByTestId('dialog')).toBeInTheDocument()
      })
    })

    it('should show restore dialog with dropdown', async () => {
      await waitFor(() => {
        expect(screen.getByRole('combobox')).toBeInTheDocument()
        expect(screen.getByText('Restore')).toBeInTheDocument()
        expect(screen.getByText('Cancel')).toBeInTheDocument()
      })
    })

    it('should populate dropdown with available dumps', async () => {
      const select = screen.getByRole('combobox')
      
      await waitFor(() => {
        expect(screen.getByText('conversation1')).toBeInTheDocument()
        expect(screen.getByText('conversation2')).toBeInTheDocument()
      })
    })

    it('should disable restore button when no selection', () => {
      const restoreButton = screen.getByTestId('confirm-button')
      expect(restoreButton).toBeDisabled()
    })

    it('should enable restore button when selection is made', async () => {
      const select = screen.getByRole('combobox')
      await user.selectOptions(select, 'conversation1')
      
      const restoreButton = screen.getByTestId('confirm-button')
      expect(restoreButton).not.toBeDisabled()
    })

    it('should restore conversation successfully', async () => {
      mockExtension.restoreConversationDump.mockResolvedValue([])
      
      const select = screen.getByRole('combobox')
      await user.selectOptions(select, 'conversation1')
      
      const restoreButton = screen.getByTestId('confirm-button')
      await user.click(restoreButton)
      
      await waitFor(() => {
        expect(mockExtension.restoreConversationDump).toHaveBeenCalledWith(
          'test-model',
          'conversation1'
        )
      })
      
      expect(toast.success).toHaveBeenCalledWith('Conversation restored successfully')
    })

    it('should handle restore error', async () => {
      mockExtension.restoreConversationDump.mockRejectedValue(new Error('Restore failed'))
      
      const select = screen.getByRole('combobox')
      await user.selectOptions(select, 'conversation1')
      
      const restoreButton = screen.getByTestId('confirm-button')
      await user.click(restoreButton)
      
      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('Failed to restore conversation')
      })
    })

    it('should show message when no saved conversations found', async () => {
      mockExtension.listConversationDumps.mockResolvedValue([])
      
      render(<KvCacheButtons threadId="test-thread" />)
      
      const button = screen.getByTitle('KV Cache Save/Restore')
      await user.click(button)
      
      const restoreItem = screen.getByText('Restore Conversation')
      await user.click(restoreItem)
      
      await waitFor(() => {
        expect(screen.getByText('No saved conversations found')).toBeInTheDocument()
      })
    })
  })

  describe('Error Handling', () => {
    it('should handle missing provider error', async () => {
      vi.mocked(require('@/hooks/useModelProvider').useModelProvider).mockReturnValue({
        getProviderByName: vi.fn().mockReturnValue(null)
      })
      
      render(<KvCacheButtons threadId="test-thread" />)
      
      const button = screen.getByTitle('KV Cache Save/Restore')
      await user.click(button)
      
      const saveItem = screen.getByText('Save Conversation')
      await user.click(saveItem)
      
      await waitFor(() => {
        expect(screen.getByTestId('input')).toBeInTheDocument()
      })
      
      const input = screen.getByTestId('input')
      await user.type(input, 'Test')
      
      const saveButton = screen.getByTestId('confirm-button')
      await user.click(saveButton)
      
      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('llamacpp provider not available')
      })
    })

    it('should handle missing extension error', async () => {
      global.window.core.extensionManager.getByName = vi.fn().mockReturnValue(null)
      
      render(<KvCacheButtons threadId="test-thread" />)
      
      const button = screen.getByTitle('KV Cache Save/Restore')
      await user.click(button)
      
      const restoreItem = screen.getByText('Restore Conversation')
      await user.click(restoreItem)
      
      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('KV cache functionality not supported')
      })
    })

    it('should handle missing currentAssistant error', async () => {
      vi.mocked(require('@/hooks/useAssistant').useAssistant).mockReturnValue({
        currentAssistant: null
      })
      
      render(<KvCacheButtons threadId="test-thread" />)
      
      const button = screen.getByTitle('KV Cache Save/Restore')
      await user.click(button)
      
      const saveItem = screen.getByText('Save Conversation')
      await user.click(saveItem)
      
      await waitFor(() => {
        expect(screen.getByTestId('input')).toBeInTheDocument()
      })
      
      const input = screen.getByTestId('input')
      await user.type(input, 'Test')
      
      const saveButton = screen.getByTestId('confirm-button')
      await user.click(saveButton)
      
      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('No model selected')
      })
    })
  })

  describe('Loading States', () => {
    it('should show loading state during save', async () => {
      let resolvePromise: (value?: any) => void
      const savePromise = new Promise(resolve => {
        resolvePromise = resolve
      })
      
      mockExtension.saveConversationDump.mockReturnValue(savePromise)
      
      render(<KvCacheButtons threadId="test-thread" />)
      
      const button = screen.getByTitle('KV Cache Save/Restore')
      await user.click(button)
      
      const saveItem = screen.getByText('Save Conversation')
      await user.click(saveItem)
      
      await waitFor(() => {
        expect(screen.getByTestId('input')).toBeInTheDocument()
      })
      
      const input = screen.getByTestId('input')
      await user.type(input, 'Test')
      
      const saveButton = screen.getByTestId('confirm-button')
      await user.click(saveButton)
      
      expect(screen.getByText('Saving...')).toBeInTheDocument()
      expect(saveButton).toBeDisabled()
      
      resolvePromise!()
      
      await waitFor(() => {
        expect(screen.queryByText('Saving...')).not.toBeInTheDocument()
      })
    })

    it('should show loading state during restore', async () => {
      let resolvePromise: (value?: any) => void
      const restorePromise = new Promise(resolve => {
        resolvePromise = resolve
      })
      
      mockExtension.listConversationDumps.mockResolvedValue(['conversation1'])
      mockExtension.restoreConversationDump.mockReturnValue(restorePromise)
      
      render(<KvCacheButtons threadId="test-thread" />)
      
      const button = screen.getByTitle('KV Cache Save/Restore')
      await user.click(button)
      
      const restoreItem = screen.getByText('Restore Conversation')
      await user.click(restoreItem)
      
      await waitFor(() => {
        expect(screen.getByRole('combobox')).toBeInTheDocument()
      })
      
      const select = screen.getByRole('combobox')
      await user.selectOptions(select, 'conversation1')
      
      const restoreButton = screen.getByTestId('confirm-button')
      await user.click(restoreButton)
      
      expect(screen.getByText('Restoring...')).toBeInTheDocument()
      expect(restoreButton).toBeDisabled()
      
      resolvePromise!()
      
      await waitFor(() => {
        expect(screen.queryByText('Restoring...')).not.toBeInTheDocument()
      })
    })
  })
})