import type { OutboxCommandRecord } from './outbox.types'
import { OutboxValidationError } from './outbox.errors'
import { apiClient, ApiError } from '../../api-client'

export interface CommandDefinition {
  commandType: string
  version: number
  isAuthorized: boolean
  unauthorizedReason?: string
  validatePayload: (payload: unknown) => { valid: boolean; error?: string }
  handler?: (record: OutboxCommandRecord) => Promise<{ serverResultId?: string; data?: unknown }>
}

const PROHIBITED_FINANCIAL_COMMANDS = new Set([
  'create_sale',
  'void_sale',
  'record_customer_payment',
  'allocate_advance',
  'record_stock_adjustment',
  'record_stock_count',
  'confirm_stock_count',
  'create_purchase_order',
  'receive_goods',
  'record_supplier_payment',
])

export class CommandRegistry {
  private definitions = new Map<string, CommandDefinition>()

  constructor() {
    this.registerProhibitedFinancialCommands()
    this.registerTestCommands()
    this.registerOfflineSalesCommands()
  }

  private registerOfflineSalesCommands() {
    this.definitions.set('create_offline_sale', {
      commandType: 'create_offline_sale',
      version: 1,
      isAuthorized: true,
      validatePayload: (payload: unknown) => {
        if (!payload || typeof payload !== 'object') {
          return { valid: false, error: 'Payload must be a non-null object.' }
        }
        const p = payload as Record<string, unknown>
        if (!p.authorizationId || typeof p.authorizationId !== 'string') {
          return { valid: false, error: 'Missing authorizationId in offline sale payload.' }
        }
        if (!p.deviceId || typeof p.deviceId !== 'string') {
          return { valid: false, error: 'Missing deviceId in offline sale payload.' }
        }
        if (!p.provisionalReceiptNumber || typeof p.provisionalReceiptNumber !== 'string') {
          return { valid: false, error: 'Missing provisionalReceiptNumber.' }
        }
        if (!Array.isArray(p.items) || p.items.length === 0) {
          return { valid: false, error: 'Offline sale must contain at least one item.' }
        }
        return { valid: true }
      },
      handler: async (cmd) => {
        const headers: Record<string, string> = {
          'Idempotency-Key': cmd.idempotencyKey,
          'X-Business-Id': cmd.businessId,
        }
        if (cmd.branchId) {
          headers['X-Branch-Id'] = cmd.branchId
        }
        const preferredDeviceHeader =
          (typeof cmd.payload.installationId === 'string' && cmd.payload.installationId) ||
          (typeof cmd.payload.deviceId === 'string' && cmd.payload.deviceId) ||
          cmd.deviceId
        if (preferredDeviceHeader) {
          headers['X-Device-Id'] = preferredDeviceHeader
        }

        let resBody: { saleId?: string; invoiceNumber?: string }
        try {
          resBody = await apiClient.post<{ saleId?: string; invoiceNumber?: string }>(
            '/offline/sales/commit',
            cmd.payload,
            { headers }
          )
        } catch (err) {
          if (err instanceof ApiError) {
            const error = new Error(err.message)
            Object.assign(error, {
              status: err.status,
              code: err.code || 'COMMUNICATION_ERROR',
              details: err.details,
            })
            throw error
          }
          throw err
        }

        if (!resBody?.saleId || !resBody?.invoiceNumber) {
          throw new Error(
            'Server acknowledged /offline/sales/commit without official saleId and invoiceNumber.'
          )
        }

        const serverSaleId = resBody.saleId
        const officialInvoiceNumber = resBody.invoiceNumber

        if (cmd.payload.provisionalSaleId && typeof cmd.payload.provisionalSaleId === 'string') {
          const { offlineSalesRepository } = await import('../sales/offlineSales.repository')
          await offlineSalesRepository.acknowledgeSale(
            cmd.payload.provisionalSaleId,
            serverSaleId,
            officialInvoiceNumber
          )
        }

        return {
          serverResultId: serverSaleId,
          data: resBody,
        }
      },
    })
  }

  private registerProhibitedFinancialCommands() {
    for (const cmdType of PROHIBITED_FINANCIAL_COMMANDS) {
      this.definitions.set(cmdType, {
        commandType: cmdType,
        version: 1,
        isAuthorized: false,
        unauthorizedReason: `Unauthorized command '${cmdType}': Offline execution of financial and inventory transactions is strictly disabled until Step 13.6 approved in future stages.`,
        validatePayload: () => ({ valid: true }),
      })
    }
  }

  private registerTestCommands() {
    // Test Ping Command
    this.definitions.set('test_ping', {
      commandType: 'test_ping',
      version: 1,
      isAuthorized: true,
      validatePayload: (payload: unknown) => {
        if (!payload || typeof payload !== 'object') {
          return { valid: false, error: 'Payload must be an object.' }
        }
        return { valid: true }
      },
      handler: async () => ({
        serverResultId: `ack_${Date.now()}`,
        data: { pong: true },
      }),
    })

    // Sample Future Command (used in Step 13.4 tests)
    this.definitions.set('sample_future_command', {
      commandType: 'sample_future_command',
      version: 1,
      isAuthorized: true,
      validatePayload: (payload: unknown) => {
        if (!payload || typeof payload !== 'object') {
          return { valid: false, error: 'Payload must be an object.' }
        }
        return { valid: true }
      },
      handler: async () => ({
        serverResultId: `ack_sample_${Date.now()}`,
        data: { success: true },
      }),
    })

    this.definitions.set('sample_command', {
      commandType: 'sample_command',
      version: 1,
      isAuthorized: true,
      validatePayload: (payload: unknown) => {
        if (!payload || typeof payload !== 'object') {
          return { valid: false, error: 'Payload must be an object.' }
        }
        return { valid: true }
      },
      handler: async () => ({
        serverResultId: `ack_sample_${Date.now()}`,
        data: { success: true },
      }),
    })
  }

  /**
   * Registers or updates a command definition (used for tests or future approved commands).
   */
  registerCommand(definition: CommandDefinition): void {
    if (PROHIBITED_FINANCIAL_COMMANDS.has(definition.commandType.toLowerCase()) && definition.isAuthorized) {
      throw new Error(
        `Security Violation: Cannot authorize financial command '${definition.commandType}' in Step 13.4.`
      )
    }
    this.definitions.set(definition.commandType, definition)
  }

  /**
   * Retrieves a definition for a command type.
   */
  getDefinition(commandType: string): CommandDefinition | undefined {
    return this.definitions.get(commandType)
  }

  /**
   * Checks whether a command type is registered and authorized.
   */
  isAuthorized(commandType: string): { authorized: boolean; reason?: string } {
    const def = this.definitions.get(commandType)
    if (!def) {
      return {
        authorized: false,
        reason: `Command type '${commandType}' is not registered in the outbox command registry.`,
      }
    }
    if (!def.isAuthorized) {
      return {
        authorized: false,
        reason: def.unauthorizedReason || `Command type '${commandType}' is unauthorized for offline execution.`,
      }
    }
    return { authorized: true }
  }

  /**
   * Validates command payload before enqueue or dispatch.
   */
  validatePayload(commandType: string, version: number, payload: unknown): void {
    const def = this.definitions.get(commandType)
    if (!def) {
      throw new OutboxValidationError(`Unknown command type '${commandType}'.`)
    }
    if (def.version !== version) {
      throw new OutboxValidationError(
        `Unsupported command version ${version} for '${commandType}'. Expected version ${def.version}.`
      )
    }
    const result = def.validatePayload(payload)
    if (!result.valid) {
      throw new OutboxValidationError(result.error || `Invalid payload for command '${commandType}'.`)
    }
  }
}

export const commandRegistry = new CommandRegistry()

/**
 * Backwards compatibility helper for existing tests.
 */
export function isCommandAuthorizedForOfflineExecution(commandType: string): {
  authorized: boolean
  reason?: string
} {
  const normalized = commandType.trim().toLowerCase()

  if (PROHIBITED_FINANCIAL_COMMANDS.has(normalized)) {
    return {
      authorized: false,
      reason: `Unauthorized command '${commandType}': Offline execution of financial and inventory transactions is strictly disabled until Step 13.6.`,
    }
  }

  const def = commandRegistry.getDefinition(normalized)
  if (def && def.isAuthorized) {
    return { authorized: true }
  }

  return {
    authorized: false,
    reason: `Command '${commandType}' has no active offline handler. Offline mutations are deferred to Step 13.6.`,
  }
}
