import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import llamacpp_extension from '../index'
import { chatCompletionRequestMessage } from '@janhq/core'

global.fetch = vi.fn()

vi.mock('@janhq/core', async () => {
  const actual = await vi.importActual('@janhq/core')
  return {
    ...actual,
    getJanDataFolderPath: vi.fn().mockResolvedValue('/test/jan'),
    joinPath: vi.fn().mockImplementation((paths: string[]) => Promise.resolve(paths.join('/'))),
    fs: {
      existsSync: vi.fn(),
      mkdir: vi.fn(),
      writeTextFile: vi.fn(),
      readTextFile: vi.fn(),
      readdirSync: vi.fn(),
    }
  }
})

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn()
}))

vi.mock('../backend', () => ({
  isBackendInstalled: vi.fn(),
  getBackendExePath: vi.fn(),
  downloadBackend: vi.fn(),
  listSupportedBackends: vi.fn(),
  getBackendDir: vi.fn(),
}))

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

describe('KV Cache Integration Tests', () => {
  let extension: llamacpp_extension
  const mockSessionInfo = {
    model_id: 'test-model',
    pid: 123,
    port: 3000,
    api_key: 'test-api-key'
  }

  const mockMessages: chatCompletionRequestMessage[] = [
    { role: 'user', content: 'Hello' },
    { role: 'assistant', content: 'Hi there!' }
  ]

  beforeEach(async () => {
    vi.clearAllMocks()
    extension = new llamacpp_extension()
    
    const { invoke } = await import('@tauri-apps/api/core')
    
    vi.mocked(invoke).mockImplementation(async (command: string, args?: any) => {
      switch (command) {
        case 'plugin:llamacpp|find_session_by_model':
          return args?.modelId === 'test-model' ? mockSessionInfo : null
        case 'plugin:llamacpp|is_process_running':
          return true
        default:
          return true
      }
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Complete Save and Restore Flow', () => {
    it('should save and restore a complete conversation dump successfully', async () => {
      const { fs } = await import('@janhq/core')
      
      vi.mocked(fs.existsSync).mockImplementation(async (path: string) => {
        return path.includes('dumps')
      })
      vi.mocked(fs.mkdir).mockResolvedValue(undefined)
      vi.mocked(fs.writeTextFile).mockResolvedValue(undefined)
      
      const mockConversationData = {
        modelId: 'test-model',
        timestamp: expect.any(String),
        messages: mockMessages
      }
      vi.mocked(fs.readTextFile).mockResolvedValue(JSON.stringify(mockConversationData))
      
      global.fetch = vi.fn()
        .mockResolvedValueOnce({ 
          ok: true, 
          json: () => Promise.resolve({ status: 'ok' })
        })
        .mockResolvedValueOnce({ 
          ok: true, 
          json: () => Promise.resolve({ success: true })
        })
        .mockResolvedValueOnce({ 
          ok: true, 
          json: () => Promise.resolve({ status: 'ok' })
        })
        .mockResolvedValueOnce({ 
          ok: true, 
          json: () => Promise.resolve({ success: true })
        })

      await extension.saveConversationDump('test-model', 'integration-test', mockMessages)
      
      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:3000/slots/0?action=save',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-api-key'
          },
          body: JSON.stringify({ filename: 'integration-test.bin' })
        })
      )
      
      expect(fs.writeTextFile).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining('"modelId": "test-model"')
      )
      
      const restoredMessages = await extension.restoreConversationDump('test-model', 'integration-test')
      
      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:3000/slots/0?action=restore',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-api-key'
          },
          body: JSON.stringify({ filename: 'integration-test.bin' })
        })
      )
      
      expect(restoredMessages).toEqual(mockMessages)
    })

    it('should handle the complete lifecycle with file listing', async () => {
      const { fs } = await import('@janhq/core')
      
      vi.mocked(fs.existsSync).mockResolvedValue(true)
      vi.mocked(fs.mkdir).mockResolvedValue(undefined)
      vi.mocked(fs.writeTextFile).mockResolvedValue(undefined)
      vi.mocked(fs.readdirSync).mockResolvedValue([
        'conversation1.json',
        'conversation2.json',
        'other-file.txt'
      ])
      
      global.fetch = vi.fn()
        .mockResolvedValue({ 
          ok: true, 
          json: () => Promise.resolve({ success: true })
        })

      const dumps = await extension.listConversationDumps()
      expect(dumps).toEqual(['conversation1', 'conversation2'])
      
      await extension.saveConversationDump('test-model', 'new-conversation', mockMessages)
      
      vi.mocked(fs.readdirSync).mockResolvedValue([
        'conversation1.json',
        'conversation2.json',
        'new-conversation.json',
        'other-file.txt'
      ])
      
      const updatedDumps = await extension.listConversationDumps()
      expect(updatedDumps).toEqual(['conversation1', 'conversation2', 'new-conversation'])
    })
  })

  describe('Error Recovery and Resilience', () => {
    it('should clean up properly when KV cache save fails during conversation dump', async () => {
      const { fs } = await import('@janhq/core')
      
      vi.mocked(fs.existsSync).mockResolvedValue(true)
      
      global.fetch = vi.fn()
        .mockResolvedValueOnce({ 
          ok: true,
          json: () => Promise.resolve({ status: 'ok' })
        })
        .mockResolvedValueOnce({ 
          ok: false, 
          status: 500,
          json: () => Promise.resolve({ error: 'Save failed' })
        })

      await expect(extension.saveConversationDump('test-model', 'failed-save', mockMessages))
        .rejects.toThrow('KV cache save failed with status 500')
      
      expect(fs.writeTextFile).not.toHaveBeenCalled()
    })

    it('should handle partial restore failure gracefully', async () => {
      const { fs } = await import('@janhq/core')
      
      vi.mocked(fs.existsSync).mockResolvedValue(true)
      vi.mocked(fs.readTextFile).mockResolvedValue(JSON.stringify({
        modelId: 'test-model',
        timestamp: '2024-01-01T00:00:00.000Z',
        messages: mockMessages
      }))
      
      global.fetch = vi.fn()
        .mockResolvedValueOnce({ 
          ok: true,
          json: () => Promise.resolve({ status: 'ok' })
        })
        .mockResolvedValueOnce({ 
          ok: false, 
          status: 404,
          json: () => Promise.resolve({ error: 'Not found' })
        })

      await expect(extension.restoreConversationDump('test-model', 'failed-restore'))
        .rejects.toThrow('KV cache restore failed with status 404')
    })
  })

  describe('API Integration', () => {
    it('should make correct API calls to llama.cpp slot endpoints', async () => {
      const mockHealthResponse = { 
        ok: true, 
        status: 200,
        json: () => Promise.resolve({ status: 'ok' })
      }
      const mockSlotResponse = { 
        ok: true, 
        status: 200,
        json: () => Promise.resolve({ success: true })
      }
      
      global.fetch = vi.fn()
        .mockResolvedValueOnce(mockHealthResponse)
        .mockResolvedValueOnce(mockSlotResponse)

      await extension.saveKvCache('test-model', 'api-test')
      
      expect(fetch).toHaveBeenCalledTimes(2)
      
      expect(fetch).toHaveBeenNthCalledWith(1, 'http://localhost:3000/health')
      expect(fetch).toHaveBeenNthCalledWith(2, 
        'http://localhost:3000/slots/0?action=save',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-api-key'
          },
          body: JSON.stringify({ filename: 'api-test.bin' })
        }
      )
    })

    it('should verify process health before making API calls', async () => {
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

      await expect(extension.saveKvCache('test-model', 'process-check'))
        .rejects.toThrow('Model process has crashed! Please reload!')
      
      expect(invoke).toHaveBeenCalledWith('plugin:llamacpp|is_process_running', {
        pid: 123
      })
      
      expect(fetch).not.toHaveBeenCalled()
    })
  })
})