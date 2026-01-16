import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import llamacpp_extension from '../index'
import { chatCompletionRequestMessage } from '@janhq/core'

// Mock fetch globally
global.fetch = vi.fn()

// Mock @janhq/core functions
vi.mock('@janhq/core', async () => {
  const actual = await vi.importActual('@janhq/core')
  return {
    ...actual,
    getJanDataFolderPath: vi.fn().mockResolvedValue('/path/to/jan'),
    joinPath: vi.fn().mockImplementation((paths: string[]) => {
      return Promise.resolve(paths.join('/'))
    }),
    fs: {
      existsSync: vi.fn(),
      mkdir: vi.fn(),
      writeTextFile: vi.fn(),
      readTextFile: vi.fn(),
      readdirSync: vi.fn(),
    }
  }
})

// Mock @tauri-apps/api/core
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn()
}))

// Mock backend functions
vi.mock('../backend', () => ({
  isBackendInstalled: vi.fn(),
  getBackendExePath: vi.fn(),
  downloadBackend: vi.fn(),
  listSupportedBackends: vi.fn(),
  getBackendDir: vi.fn(),
}))

// Mock window object for Tauri internals
Object.defineProperty(global, 'window', {
  value: {
    __TAURI_INTERNALS__: {
      invoke: vi.fn()
    },
    core: {
      extensionManager: {
        getByName: vi.fn().mockReturnValue({
          downloadFiles: vi.fn().mockResolvedValue(undefined)
        })
      }
    }
  },
  writable: true
})

describe('llamacpp_extension KV Cache Methods', () => {
  let extension: llamacpp_extension
  const mockSessionInfo = {
    model_id: 'test-model',
    pid: 123,
    port: 3000,
    api_key: 'test-api-key'
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    extension = new llamacpp_extension()
    
    const { invoke } = await import('@tauri-apps/api/core')
    
    // Mock Tauri invoke calls with proper return values based on command
    vi.mocked(invoke).mockImplementation(async (command: string, args?: any) => {
      switch (command) {
        case 'plugin:llamacpp|find_session_by_model':
          // Return the mock session info for 'test-model', null for others
          return args?.modelId === 'test-model' ? mockSessionInfo : null
        case 'plugin:llamacpp|is_process_running':
          // Default to process running unless specific test overrides
          return true
        default:
          return true
      }
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('saveKvCache', () => {
    it('should save KV cache successfully', async () => {
      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({ status: 'ok' })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({ success: true })
        })

      await extension.saveKvCache('test-model', 'test-save')

      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:3000/slots/0?action=save',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-api-key'
          },
          body: JSON.stringify({ filename: 'test-save.bin' })
        }
      )
    })

    it('should throw error if no active session found', async () => {
      await expect(extension.saveKvCache('nonexistent-model', 'test-save'))
        .rejects.toThrow('No active session found for model: nonexistent-model')
    })

    it('should throw error if process is not running', async () => {
      const { invoke } = await import('@tauri-apps/api/core')
      
      vi.mocked(invoke).mockImplementation(async (command: string, args?: any) => {
        switch (command) {
          case 'plugin:llamacpp|find_session_by_model':
            return args?.modelId === 'test-model' ? mockSessionInfo : null
          case 'plugin:llamacpp|is_process_running':
            return false
          default:
            return true
        }
      })

      await expect(extension.saveKvCache('test-model', 'test-save'))
        .rejects.toThrow('Model process has crashed! Please reload!')
    })

    it('should throw error if health check fails', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'))

      await expect(extension.saveKvCache('test-model', 'test-save'))
        .rejects.toThrow('Model appears to have crashed! Please reload!')
    })

    it('should throw error if KV cache save API fails', async () => {
      global.fetch = vi.fn()
        .mockResolvedValueOnce({ 
          ok: true,
          json: vi.fn().mockResolvedValue({ status: 'ok' })
        })
        .mockResolvedValueOnce({ 
          ok: false, 
          status: 500,
          json: vi.fn().mockResolvedValue({ error: 'Slot save failed' })
        })

      await expect(extension.saveKvCache('test-model', 'test-save'))
        .rejects.toThrow('KV cache save failed with status 500')
    })
  })

  describe('restoreKvCache', () => {
    it('should restore KV cache successfully', async () => {
      global.fetch = vi.fn()
        .mockResolvedValueOnce({ 
          ok: true,
          json: vi.fn().mockResolvedValue({ status: 'ok' })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({ success: true })
        })

      await extension.restoreKvCache('test-model', 'test-restore')

      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:3000/slots/0?action=restore',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-api-key'
          },
          body: JSON.stringify({ filename: 'test-restore.bin' })
        }
      )
    })

    it('should throw error if no active session found', async () => {
      await expect(extension.restoreKvCache('nonexistent-model', 'test-restore'))
        .rejects.toThrow('No active session found for model: nonexistent-model')
    })

    it('should throw error if KV cache restore API fails', async () => {
      global.fetch = vi.fn()
        .mockResolvedValueOnce({ 
          ok: true,
          json: vi.fn().mockResolvedValue({ status: 'ok' })
        })
        .mockResolvedValueOnce({ 
          ok: false, 
          status: 404,
          json: vi.fn().mockResolvedValue({ error: 'File not found' })
        })

      await expect(extension.restoreKvCache('test-model', 'test-restore'))
        .rejects.toThrow('KV cache restore failed with status 404')
    })
  })

  describe('saveConversationDump', () => {
    const mockMessages: chatCompletionRequestMessage[] = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' }
    ]

    it('should save conversation dump successfully', async () => {
      const { fs } = await import('@janhq/core')
      
      global.fetch = vi.fn()
        .mockResolvedValueOnce({ 
          ok: true,
          json: vi.fn().mockResolvedValue({ status: 'ok' })
        })
        .mockResolvedValueOnce({ 
          ok: true,
          json: vi.fn().mockResolvedValue({ success: true })
        })
      
      vi.mocked(fs.existsSync).mockResolvedValue(true)
      vi.mocked(fs.writeTextFile).mockResolvedValue(undefined)

      await extension.saveConversationDump('test-model', 'test-conversation', mockMessages)

      // Verify KV cache save was called
      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:3000/slots/0?action=save',
        expect.objectContaining({
          method: 'POST'
        })
      )

      // Verify conversation data was written (just check that writeTextFile was called)
      expect(fs.writeTextFile).toHaveBeenCalled()
      
      // Verify the JSON content contains the expected data
      const writeCall = vi.mocked(fs.writeTextFile).mock.calls[0]
      expect(writeCall[1]).toContain('"modelId": "test-model"')
      expect(writeCall[1]).toContain('"role": "user"')
      expect(writeCall[1]).toContain('"content": "Hello"')
    })

    it('should create dumps directory if it does not exist', async () => {
      const { fs } = await import('@janhq/core')
      
      global.fetch = vi.fn()
        .mockResolvedValueOnce({ 
          ok: true,
          json: vi.fn().mockResolvedValue({ status: 'ok' })
        })
        .mockResolvedValueOnce({ 
          ok: true,
          json: vi.fn().mockResolvedValue({ success: true })
        })
      
      vi.mocked(fs.existsSync).mockResolvedValue(false)
      vi.mocked(fs.mkdir).mockResolvedValue(undefined)
      vi.mocked(fs.writeTextFile).mockResolvedValue(undefined)

      await extension.saveConversationDump('test-model', 'test-conversation', mockMessages)

      expect(fs.mkdir).toHaveBeenCalled()
    })

    it('should throw error if KV cache save fails', async () => {
      global.fetch = vi.fn()
        .mockResolvedValueOnce({ 
          ok: true,
          json: vi.fn().mockResolvedValue({ status: 'ok' })
        })
        .mockResolvedValueOnce({ 
          ok: false, 
          status: 500,
          json: vi.fn().mockResolvedValue({ error: 'Save failed' })
        })

      await expect(extension.saveConversationDump('test-model', 'test-conversation', mockMessages))
        .rejects.toThrow('KV cache save failed with status 500')
    })
  })

  describe('restoreConversationDump', () => {
    const mockConversationData = {
      modelId: 'test-model',
      timestamp: '2024-01-01T00:00:00.000Z',
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' }
      ]
    }

    it('should restore conversation dump successfully', async () => {
      const { fs } = await import('@janhq/core')
      
      vi.mocked(fs.existsSync).mockResolvedValue(true)
      vi.mocked(fs.readTextFile).mockResolvedValue(JSON.stringify(mockConversationData))
      
      global.fetch = vi.fn()
        .mockResolvedValueOnce({ 
          ok: true,
          json: vi.fn().mockResolvedValue({ status: 'ok' })
        })
        .mockResolvedValueOnce({ 
          ok: true,
          json: vi.fn().mockResolvedValue({ success: true })
        })

      const result = await extension.restoreConversationDump('test-model', 'test-conversation')
      
      expect(result).toEqual(mockConversationData.messages)
      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:3000/slots/0?action=restore',
        expect.objectContaining({
          method: 'POST'
        })
      )
    })

    it('should throw error if conversation file does not exist', async () => {
      const { fs } = await import('@janhq/core')
      
      vi.mocked(fs.existsSync).mockResolvedValue(false)

      await expect(extension.restoreConversationDump('test-model', 'nonexistent'))
        .rejects.toThrow('Conversation dump not found: nonexistent.json')
    })

    it('should throw error if conversation file has invalid format', async () => {
      const { fs } = await import('@janhq/core')
      
      vi.mocked(fs.existsSync).mockResolvedValue(true)
      vi.mocked(fs.readTextFile).mockResolvedValue('{"invalid": "format"}')

      await expect(extension.restoreConversationDump('test-model', 'invalid'))
        .rejects.toThrow('Invalid conversation dump format: invalid.json')
    })

    it('should throw error if KV cache restore fails', async () => {
      const { fs } = await import('@janhq/core')
      
      vi.mocked(fs.existsSync).mockResolvedValue(true)
      vi.mocked(fs.readTextFile).mockResolvedValue(JSON.stringify(mockConversationData))
      
      global.fetch = vi.fn()
        .mockResolvedValueOnce({ 
          ok: true,
          json: vi.fn().mockResolvedValue({ status: 'ok' })
        })
        .mockResolvedValueOnce({ 
          ok: false, 
          status: 404,
          json: vi.fn().mockResolvedValue({ error: 'File not found' })
        })

      await expect(extension.restoreConversationDump('test-model', 'test-conversation'))
        .rejects.toThrow('KV cache restore failed with status 404')
    })
  })

  describe('listConversationDumps', () => {
    it('should list available conversation dumps', async () => {
      const { fs } = await import('@janhq/core')
      
      vi.mocked(fs.existsSync).mockResolvedValue(true)
      vi.mocked(fs.readdirSync).mockResolvedValue([
        'conversation1.json',
        'conversation2.json',
        'some-other-file.txt',
        'conversation3.json'
      ])

      const result = await extension.listConversationDumps()

      expect(result).toEqual(['conversation1', 'conversation2', 'conversation3'])
    })

    it('should return empty array if dumps directory does not exist', async () => {
      const { fs } = await import('@janhq/core')
      
      vi.mocked(fs.existsSync).mockResolvedValue(false)

      const result = await extension.listConversationDumps()

      expect(result).toEqual([])
    })

    it('should return empty array if no JSON files found', async () => {
      const { fs } = await import('@janhq/core')
      
      vi.mocked(fs.existsSync).mockResolvedValue(true)
      vi.mocked(fs.readdirSync).mockResolvedValue([
        'some-file.txt',
        'another-file.log'
      ])

      const result = await extension.listConversationDumps()

      expect(result).toEqual([])
    })

    it('should handle file system errors gracefully', async () => {
      const { fs } = await import('@janhq/core')
      
      vi.mocked(fs.existsSync).mockRejectedValue(new Error('File system error'))

      const result = await extension.listConversationDumps()

      expect(result).toEqual([])
    })
  })

  describe('findSessionByModel helper method', () => {
    it('should find session by model ID', async () => {
      const session = await extension['findSessionByModel']('test-model')
      expect(session).toEqual(mockSessionInfo)
    })

    it('should return null if model not found', async () => {
      const session = await extension['findSessionByModel']('nonexistent-model')
      expect(session).toBeNull()
    })
  })
})