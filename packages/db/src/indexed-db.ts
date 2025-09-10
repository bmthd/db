import {
  NoStorageAvailableError,
  SerializationError,
  StorageKeyRequiredError,
} from "./errors"
import type {
  CollectionConfig,
  DeleteMutationFnParams,
  InsertMutationFnParams,
  ResolveType,
  SyncConfig,
  UpdateMutationFnParams,
  UtilsRecord,
} from "./types"
import type { StandardSchemaV1 } from "@standard-schema/spec"

/**
 * IndexedDB API interface - subset of IndexedDB that we need
 */
export interface IndexedDBApi {
  open: (name: string, version?: number) => IDBOpenDBRequest
}

/**
 * Internal storage format that includes version tracking
 */
interface StoredItem<T> {
  versionKey: string
  data: T
}

/**
 * Configuration interface for IndexedDB collection options
 * @template TExplicit - The explicit type of items in the collection (highest priority)
 * @template TSchema - The schema type for validation and type inference (second priority)
 * @template TFallback - The fallback type if no explicit or schema type is provided
 *
 * @remarks
 * Type resolution follows a priority order:
 * 1. If you provide an explicit type via generic parameter, it will be used
 * 2. If no explicit type is provided but a schema is, the schema's output type will be inferred
 * 3. If neither explicit type nor schema is provided, the fallback type will be used
 *
 * You should provide EITHER an explicit type OR a schema, but not both, as they would conflict.
 */
export interface IndexedDBCollectionConfig<
  TExplicit = unknown,
  TSchema extends StandardSchemaV1 = never,
  TFallback extends object = Record<string, unknown>,
> {
  /**
   * The name of the IndexedDB database to use
   */
  dbName: string

  /**
   * The name of the object store to use for storing collection data
   */
  storeName: string

  /**
   * IndexedDB API to use (defaults to window.indexedDB)
   */
  indexedDB?: IndexedDBApi

  /**
   * Collection identifier (defaults to "indexed-db-collection:{dbName}:{storeName}" if not provided)
   */
  id?: string
  schema?: TSchema
  getKey: CollectionConfig<ResolveType<TExplicit, TSchema, TFallback>>[`getKey`]
  sync?: CollectionConfig<ResolveType<TExplicit, TSchema, TFallback>>[`sync`]

  /**
   * Optional asynchronous handler function called before an insert operation
   * @param params Object containing transaction and collection information
   * @returns Promise resolving to any value
   */
  onInsert?: (
    params: InsertMutationFnParams<ResolveType<TExplicit, TSchema, TFallback>>
  ) => Promise<any>

  /**
   * Optional asynchronous handler function called before an update operation
   * @param params Object containing transaction and collection information
   * @returns Promise resolving to any value
   */
  onUpdate?: (
    params: UpdateMutationFnParams<ResolveType<TExplicit, TSchema, TFallback>>
  ) => Promise<any>

  /**
   * Optional asynchronous handler function called before a delete operation
   * @param params Object containing transaction and collection information
   * @returns Promise resolving to any value
   */
  onDelete?: (
    params: DeleteMutationFnParams<ResolveType<TExplicit, TSchema, TFallback>>
  ) => Promise<any>
}

/**
 * Type for the clear database function
 */
export type ClearDatabaseFn = () => Promise<void>

/**
 * Type for the getDatabaseSize utility function
 */
export type GetDatabaseSizeFn = () => Promise<number>

/**
 * IndexedDB collection utilities type
 */
export interface IndexedDBCollectionUtils extends UtilsRecord {
  clearDatabase: ClearDatabaseFn
  getDatabaseSize: GetDatabaseSizeFn
}

/**
 * Validates that a value can be stored in IndexedDB
 * @param value - The value to validate for IndexedDB storage
 * @param operation - The operation type being performed (for error messages)
 * @throws Error if the value cannot be stored in IndexedDB
 */
function validateIndexedDBSerializable(value: any, operation: string): void {
  try {
    // IndexedDB can store most JavaScript types, but we'll validate JSON serialization
    // as a safe baseline (similar to localStorage)
    JSON.stringify(value)
  } catch (error) {
    throw new SerializationError(
      operation,
      error instanceof Error ? error.message : String(error)
    )
  }
}

/**
 * Generate a UUID for version tracking
 * @returns A unique identifier string for tracking data versions
 */
function generateUuid(): string {
  return crypto.randomUUID()
}

/**
 * Creates IndexedDB collection options for use with a standard Collection
 *
 * This function creates a collection that persists data to IndexedDB
 * and provides real-time synchronization capabilities.
 *
 * @template TExplicit - The explicit type of items in the collection (highest priority)
 * @template TSchema - The schema type for validation and type inference (second priority)
 * @template TFallback - The fallback type if no explicit or schema type is provided
 * @param config - Configuration options for the IndexedDB collection
 * @returns Collection options with utilities including clearDatabase and getDatabaseSize
 *
 * @example
 * // Basic IndexedDB collection
 * const collection = createCollection(
 *   indexedDBCollectionOptions({
 *     dbName: 'myapp',
 *     storeName: 'todos',
 *     getKey: (item) => item.id,
 *   })
 * )
 *
 * @example
 * // IndexedDB collection with mutation handlers
 * const collection = createCollection(
 *   indexedDBCollectionOptions({
 *     dbName: 'myapp',
 *     storeName: 'todos',
 *     getKey: (item) => item.id,
 *     onInsert: async ({ transaction }) => {
 *       console.log('Item inserted:', transaction.mutations[0].modified)
 *     },
 *   })
 * )
 */
export function indexedDBCollectionOptions<
  TExplicit = unknown,
  TSchema extends StandardSchemaV1 = never,
  TFallback extends object = Record<string, unknown>,
>(
  config: IndexedDBCollectionConfig<TExplicit, TSchema, TFallback>
): Omit<CollectionConfig<ResolveType<TExplicit, TSchema, TFallback>>, `id`> & {
  id: string
  utils: IndexedDBCollectionUtils
} {
  type ResolvedType = ResolveType<TExplicit, TSchema, TFallback>

  // Validate required parameters
  if (!config.dbName) {
    throw new StorageKeyRequiredError(`dbName is required`)
  }
  if (!config.storeName) {
    throw new StorageKeyRequiredError(`storeName is required`)
  }

  // Default to window.indexedDB if no indexedDB is provided
  const indexedDB =
    config.indexedDB ||
    (typeof window !== `undefined` ? window.indexedDB : null)

  if (!indexedDB) {
    throw new NoStorageAvailableError(`IndexedDB is not available`)
  }

  // Track the last known state to detect changes
  const lastKnownData = new Map<string | number, StoredItem<ResolvedType>>()

  // Create database connection promise
  let dbPromise: Promise<IDBDatabase> | null = null

  /**
   * Get or create database connection
   */
  const getDatabase = (): Promise<IDBDatabase> => {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(config.dbName, 1)

        request.onerror = () => {
          reject(
            new Error(`Failed to open IndexedDB database: ${config.dbName}`)
          )
        }

        request.onsuccess = () => {
          resolve(request.result)
        }

        request.onupgradeneeded = () => {
          const database = request.result
          if (!database.objectStoreNames.contains(config.storeName)) {
            database.createObjectStore(config.storeName)
          }
        }
      })
    }
    return dbPromise
  }

  /**
   * Save data to IndexedDB
   * @param dataMap - Map of items with version tracking to save to IndexedDB
   */
  const saveToDatabase = async (
    dataMap: Map<string | number, StoredItem<ResolvedType>>
  ): Promise<void> => {
    try {
      const db = await getDatabase()
      const transaction = db.transaction([config.storeName], `readwrite`)
      const store = transaction.objectStore(config.storeName)

      // Clear existing data and add new data
      await new Promise<void>((resolve, reject) => {
        const clearRequest = store.clear()
        clearRequest.onsuccess = () => resolve()
        clearRequest.onerror = () => reject(clearRequest.error)
      })

      // Add all items
      const promises: Array<Promise<void>> = []
      dataMap.forEach((storedItem, key) => {
        const promise = new Promise<void>((resolve, reject) => {
          const request = store.put(storedItem, key)
          request.onsuccess = () => resolve()
          request.onerror = () => reject(request.error)
        })
        promises.push(promise)
      })

      await Promise.all(promises)
    } catch (error) {
      console.error(
        `[IndexedDBCollection] Error saving data to database "${config.dbName}" store "${config.storeName}":`,
        error
      )
      throw error
    }
  }

  /**
   * Removes all collection data from the configured IndexedDB store
   */
  const clearDatabase: ClearDatabaseFn = async (): Promise<void> => {
    const db = await getDatabase()
    const transaction = db.transaction([config.storeName], `readwrite`)
    const store = transaction.objectStore(config.storeName)

    return new Promise<void>((resolve, reject) => {
      const request = store.clear()
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  /**
   * Get the approximate size of the stored data
   * @returns The approximate size in bytes of the stored collection data
   */
  const getDatabaseSize: GetDatabaseSizeFn = async (): Promise<number> => {
    try {
      const data = await loadFromDatabase<ResolvedType>(
        config.dbName,
        config.storeName,
        indexedDB
      )
      // Rough estimate based on JSON serialization
      const serialized = JSON.stringify(Array.from(data.entries()))
      return new Blob([serialized]).size
    } catch {
      return 0
    }
  }

  // Create the sync configuration
  const sync = createIndexedDBSync<ResolvedType>(
    config.dbName,
    config.storeName,
    indexedDB,
    config.getKey,
    lastKnownData
  )

  /**
   * Manual trigger function for local sync updates
   * Forces a check for database changes and updates the collection if needed
   */
  const triggerLocalSync = () => {
    if (sync.manualTrigger) {
      sync.manualTrigger()
    }
  }

  /*
   * Create wrapper handlers for direct persistence operations that perform actual database operations
   * Wraps the user's onInsert handler to also save changes to IndexedDB
   */
  const wrappedOnInsert = async (
    params: InsertMutationFnParams<ResolvedType>
  ) => {
    // Validate that all values in the transaction can be stored in IndexedDB
    params.transaction.mutations.forEach((mutation) => {
      validateIndexedDBSerializable(mutation.modified, `insert`)
    })

    // Call the user handler BEFORE persisting changes (if provided)
    let handlerResult: any = {}
    if (config.onInsert) {
      handlerResult = (await config.onInsert(params)) ?? {}
    }

    // Always persist to database
    // Load current data from database
    const currentData = await loadFromDatabase<ResolvedType>(
      config.dbName,
      config.storeName,
      indexedDB
    )

    // Add new items with version keys
    params.transaction.mutations.forEach((mutation) => {
      const key = config.getKey(mutation.modified)
      const storedItem: StoredItem<ResolvedType> = {
        versionKey: generateUuid(),
        data: mutation.modified,
      }
      currentData.set(key, storedItem)
    })

    // Save to database
    await saveToDatabase(currentData)

    // Manually trigger local sync
    triggerLocalSync()

    return handlerResult
  }

  const wrappedOnUpdate = async (
    params: UpdateMutationFnParams<ResolvedType>
  ) => {
    // Validate that all values in the transaction can be stored in IndexedDB
    params.transaction.mutations.forEach((mutation) => {
      validateIndexedDBSerializable(mutation.modified, `update`)
    })

    // Call the user handler BEFORE persisting changes (if provided)
    let handlerResult: any = {}
    if (config.onUpdate) {
      handlerResult = (await config.onUpdate(params)) ?? {}
    }

    // Always persist to database
    // Load current data from database
    const currentData = await loadFromDatabase<ResolvedType>(
      config.dbName,
      config.storeName,
      indexedDB
    )

    // Update items with new version keys
    params.transaction.mutations.forEach((mutation) => {
      const key = config.getKey(mutation.modified)
      const storedItem: StoredItem<ResolvedType> = {
        versionKey: generateUuid(),
        data: mutation.modified,
      }
      currentData.set(key, storedItem)
    })

    // Save to database
    await saveToDatabase(currentData)

    // Manually trigger local sync
    triggerLocalSync()

    return handlerResult
  }

  const wrappedOnDelete = async (
    params: DeleteMutationFnParams<ResolvedType>
  ) => {
    // Call the user handler BEFORE persisting changes (if provided)
    let handlerResult: any = {}
    if (config.onDelete) {
      handlerResult = (await config.onDelete(params)) ?? {}
    }

    // Always persist to database
    // Load current data from database
    const currentData = await loadFromDatabase<ResolvedType>(
      config.dbName,
      config.storeName,
      indexedDB
    )

    // Remove items
    params.transaction.mutations.forEach((mutation) => {
      // For delete operations, mutation.original contains the full object
      const key = config.getKey(mutation.original as ResolvedType)
      currentData.delete(key)
    })

    // Save to database
    await saveToDatabase(currentData)

    // Manually trigger local sync
    triggerLocalSync()

    return handlerResult
  }

  // Extract standard Collection config properties
  const {
    dbName: _dbName,
    storeName: _storeName,
    indexedDB: _indexedDB,
    onInsert: _onInsert,
    onUpdate: _onUpdate,
    onDelete: _onDelete,
    id,
    ...restConfig
  } = config

  // Default id to a pattern based on database and store name if not provided
  const collectionId =
    id ?? `indexed-db-collection:${config.dbName}:${config.storeName}`

  return {
    ...restConfig,
    id: collectionId,
    sync,
    onInsert: wrappedOnInsert,
    onUpdate: wrappedOnUpdate,
    onDelete: wrappedOnDelete,
    utils: {
      clearDatabase,
      getDatabaseSize,
    },
  }
}

/**
 * Load data from IndexedDB and return as a Map
 * @param dbName - The name of the IndexedDB database
 * @param storeName - The name of the object store
 * @param indexedDB - The IndexedDB API to use
 * @returns Map of stored items with version tracking, or empty Map if loading fails
 */
async function loadFromDatabase<T extends object>(
  dbName: string,
  storeName: string,
  indexedDB: IndexedDBApi
): Promise<Map<string | number, StoredItem<T>>> {
  try {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(dbName, 1)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result)
      request.onupgradeneeded = () => {
        const database = request.result
        if (!database.objectStoreNames.contains(storeName)) {
          database.createObjectStore(storeName)
        }
      }
    })

    const transaction = db.transaction([storeName], `readonly`)
    const store = transaction.objectStore(storeName)

    const dataMap = new Map<string | number, StoredItem<T>>()

    return new Promise((resolve, reject) => {
      const request = store.openCursor()

      request.onerror = () => reject(request.error)

      request.onsuccess = () => {
        const cursor = request.result
        if (cursor) {
          const key = cursor.primaryKey as string | number
          const value = cursor.value

          // Runtime check to ensure the value has the expected StoredItem structure
          if (
            value &&
            typeof value === `object` &&
            `versionKey` in value &&
            `data` in value
          ) {
            const storedItem = value as StoredItem<T>
            dataMap.set(key, storedItem)
          } else {
            console.warn(
              `[IndexedDBCollection] Invalid data format for key "${key}" in database "${dbName}" store "${storeName}"`
            )
          }

          cursor.continue()
        } else {
          resolve(dataMap)
        }
      }
    })
  } catch (error) {
    console.warn(
      `[IndexedDBCollection] Error loading data from database "${dbName}" store "${storeName}":`,
      error
    )
    return new Map()
  }
}

/**
 * Internal function to create IndexedDB sync configuration
 * Creates a sync configuration that handles IndexedDB persistence
 * @param dbName - The name of the IndexedDB database
 * @param storeName - The name of the object store
 * @param indexedDB - The IndexedDB API to use
 * @param getKey - Function to extract the key from an item
 * @param lastKnownData - Map tracking the last known state for change detection
 * @returns Sync configuration with manual trigger capability
 */
function createIndexedDBSync<T extends object>(
  dbName: string,
  storeName: string,
  indexedDB: IndexedDBApi,
  _getKey: (item: T) => string | number,
  lastKnownData: Map<string | number, StoredItem<T>>
): SyncConfig<T> & { manualTrigger?: () => void } {
  let syncParams: Parameters<SyncConfig<T>[`sync`]>[0] | null = null

  /**
   * Compare two Maps to find differences using version keys
   * @param oldData - The previous state of stored items
   * @param newData - The current state of stored items
   * @returns Array of changes with type, key, and value information
   */
  const findChanges = (
    oldData: Map<string | number, StoredItem<T>>,
    newData: Map<string | number, StoredItem<T>>
  ): Array<{
    type: `insert` | `update` | `delete`
    key: string | number
    value?: T
  }> => {
    const changes: Array<{
      type: `insert` | `update` | `delete`
      key: string | number
      value?: T
    }> = []

    // Check for deletions and updates
    oldData.forEach((oldStoredItem, key) => {
      const newStoredItem = newData.get(key)
      if (!newStoredItem) {
        changes.push({ type: `delete`, key, value: oldStoredItem.data })
      } else if (oldStoredItem.versionKey !== newStoredItem.versionKey) {
        changes.push({ type: `update`, key, value: newStoredItem.data })
      }
    })

    // Check for insertions
    newData.forEach((newStoredItem, key) => {
      if (!oldData.has(key)) {
        changes.push({ type: `insert`, key, value: newStoredItem.data })
      }
    })

    return changes
  }

  /**
   * Process database changes and update collection
   * Loads new data from database, compares with last known state, and applies changes
   */
  const processDatabaseChanges = async () => {
    if (!syncParams) return

    const { begin, write, commit } = syncParams

    // Load the new data
    const newData = await loadFromDatabase<T>(dbName, storeName, indexedDB)

    // Find the specific changes
    const changes = findChanges(lastKnownData, newData)

    if (changes.length > 0) {
      begin()
      changes.forEach(({ type, value }) => {
        if (value) {
          validateIndexedDBSerializable(value, type)
          write({ type, value })
        }
      })
      commit()

      // Update lastKnownData
      lastKnownData.clear()
      newData.forEach((storedItem, key) => {
        lastKnownData.set(key, storedItem)
      })
    }
  }

  const syncConfig: SyncConfig<T> & { manualTrigger?: () => void } = {
    sync: async (params: Parameters<SyncConfig<T>[`sync`]>[0]) => {
      const { begin, write, commit, markReady } = params

      // Store sync params for later use
      syncParams = params

      // Initial load
      const initialData = await loadFromDatabase<T>(
        dbName,
        storeName,
        indexedDB
      )
      if (initialData.size > 0) {
        begin()
        initialData.forEach((storedItem) => {
          validateIndexedDBSerializable(storedItem.data, `load`)
          write({ type: `insert`, value: storedItem.data })
        })
        commit()
      }

      // Update lastKnownData
      lastKnownData.clear()
      initialData.forEach((storedItem, key) => {
        lastKnownData.set(key, storedItem)
      })

      // Mark collection as ready after initial load
      markReady()
    },

    /**
     * Get sync metadata - returns database and store information
     * @returns Object containing database name and store name metadata
     */
    getSyncMetadata: () => ({
      dbName,
      storeName,
      storageType: `indexedDB`,
    }),

    // Manual trigger function for local updates
    manualTrigger: processDatabaseChanges,
  }

  return syncConfig
}
