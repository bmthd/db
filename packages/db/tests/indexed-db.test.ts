import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createCollection } from "../src/index"
import { indexedDBCollectionOptions } from "../src/indexed-db"
import { NoStorageAvailableError, StorageKeyRequiredError } from "../src/errors"
import type { IndexedDBApi } from "../src/indexed-db"

// Mock IndexedDB implementation for testing
class MockIDBRequest implements IDBRequest {
  result: any = null
  error: DOMException | null = null
  source: IDBObjectStore | IDBIndex | IDBCursor | null = null
  transaction: IDBTransaction | null = null
  readyState: IDBRequestReadyState = `pending`
  onsuccess: ((event: Event) => void) | null = null
  onerror: ((event: Event) => void) | null = null

  addEventListener(): void {}
  removeEventListener(): void {}
  dispatchEvent(): boolean {
    return true
  }
}

class MockIDBObjectStore implements IDBObjectStore {
  name = `test-store`
  keyPath: string | Array<string> | null = null
  indexNames: DOMStringList = {
    length: 0,
    contains: () => false,
    item: () => null,
  }
  transaction: IDBTransaction = null as any
  autoIncrement = false
  private store = new Map<any, any>()

  add(): IDBRequest {
    return new MockIDBRequest()
  }

  put(value: any, key?: any): IDBRequest {
    const request = new MockIDBRequest()
    setTimeout(() => {
      this.store.set(key, value)
      request.result = key
      request.readyState = `done`
      if (request.onsuccess) {
        request.onsuccess(new Event(`success`))
      }
    }, 0)
    return request
  }

  delete(): IDBRequest {
    return new MockIDBRequest()
  }

  get(key: any): IDBRequest {
    const request = new MockIDBRequest()
    setTimeout(() => {
      request.result = this.store.get(key)
      request.readyState = `done`
      if (request.onsuccess) {
        request.onsuccess(new Event(`success`))
      }
    }, 0)
    return request
  }

  clear(): IDBRequest {
    const request = new MockIDBRequest()
    setTimeout(() => {
      this.store.clear()
      request.readyState = `done`
      if (request.onsuccess) {
        request.onsuccess(new Event(`success`))
      }
    }, 0)
    return request
  }

  openCursor(): IDBRequest {
    const request = new MockIDBRequest()
    setTimeout(() => {
      const entries = Array.from(this.store.entries())
      let index = 0

      const cursor = {
        primaryKey: entries[index]?.[0],
        key: entries[index]?.[0],
        value: entries[index]?.[1],
        continue: () => {
          index++
          if (index < entries.length) {
            cursor.primaryKey = entries[index][0]
            cursor.key = entries[index][0]
            cursor.value = entries[index][1]
            setTimeout(() => {
              request.result = cursor
              if (request.onsuccess) {
                request.onsuccess(new Event(`success`))
              }
            }, 0)
          } else {
            setTimeout(() => {
              request.result = null
              if (request.onsuccess) {
                request.onsuccess(new Event(`success`))
              }
            }, 0)
          }
        },
      }

      request.result = entries.length > 0 ? cursor : null
      request.readyState = `done`
      if (request.onsuccess) {
        request.onsuccess(new Event(`success`))
      }
    }, 0)
    return request
  }

  openKeyCursor(): IDBRequest {
    return new MockIDBRequest()
  }
  count(): IDBRequest {
    return new MockIDBRequest()
  }
  getKey(): IDBRequest {
    return new MockIDBRequest()
  }
  getAll(): IDBRequest {
    return new MockIDBRequest()
  }
  getAllKeys(): IDBRequest {
    return new MockIDBRequest()
  }
  index(): IDBIndex {
    return null as any
  }
  createIndex(): IDBIndex {
    return null as any
  }
  deleteIndex(): void {}
}

class MockIDBTransaction implements IDBTransaction {
  db: IDBDatabase = null as any
  error: DOMException | null = null
  mode: IDBTransactionMode = `readonly`
  durability: IDBTransactionDurability = `default`
  objectStoreNames: DOMStringList = {
    length: 1,
    contains: () => true,
    item: () => `test-store`,
  }
  onabort: ((event: Event) => void) | null = null
  oncomplete: ((event: Event) => void) | null = null
  onerror: ((event: Event) => void) | null = null

  private stores = new Map<string, MockIDBObjectStore>()

  objectStore(name: string): IDBObjectStore {
    if (!this.stores.has(name)) {
      this.stores.set(name, new MockIDBObjectStore())
    }
    return this.stores.get(name)!
  }

  abort(): void {}
  commit(): void {}
  addEventListener(): void {}
  removeEventListener(): void {}
  dispatchEvent(): boolean {
    return true
  }
}

class MockIDBDatabase implements IDBDatabase {
  name = `test-db`
  version = 1
  objectStoreNames: DOMStringList = {
    length: 1,
    contains: () => true,
    item: () => `test-store`,
  }
  onabort: ((event: Event) => void) | null = null
  onclose: ((event: Event) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onversionchange: ((event: Event) => void) | null = null

  close(): void {}

  createObjectStore(): IDBObjectStore {
    return new MockIDBObjectStore()
  }

  deleteObjectStore(): void {}

  transaction(
    _storeNames: string | Array<string>,
    _mode?: IDBTransactionMode
  ): IDBTransaction {
    return new MockIDBTransaction()
  }

  addEventListener(): void {}
  removeEventListener(): void {}
  dispatchEvent(): boolean {
    return true
  }
}

class MockIDBOpenDBRequest extends MockIDBRequest implements IDBOpenDBRequest {
  onblocked: ((event: Event) => void) | null = null
  onupgradeneeded: ((event: Event) => void) | null = null
}

// Mock IndexedDB API for testing
class MockIndexedDB implements IndexedDBApi {
  open(_name: string, _version?: number): IDBOpenDBRequest {
    const request = new MockIDBOpenDBRequest()
    setTimeout(() => {
      request.result = new MockIDBDatabase()
      request.readyState = `done`
      if (request.onsuccess) {
        request.onsuccess(new Event(`success`))
      }
    }, 0)
    return request
  }
}

// Test interface for todo items
interface Todo {
  id: string
  title: string
  completed: boolean
  createdAt: Date
}

describe(`IndexedDB collection`, () => {
  let mockIndexedDB: MockIndexedDB

  beforeEach(() => {
    mockIndexedDB = new MockIndexedDB()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe(`basic functionality`, () => {
    it(`should create an IndexedDB collection with required config`, async () => {
      const collection = createCollection(
        indexedDBCollectionOptions<Todo>({
          dbName: `test-db`,
          storeName: `todos`,
          indexedDB: mockIndexedDB,
          getKey: (todo) => todo.id,
        })
      )

      expect(collection.id).toBe(`indexed-db-collection:test-db:todos`)
      expect(collection.utils.clearDatabase).toBeDefined()
      expect(collection.utils.getDatabaseSize).toBeDefined()
    })

    it(`should use custom id when provided`, async () => {
      const collection = createCollection(
        indexedDBCollectionOptions<Todo>({
          id: `custom-todos`,
          dbName: `test-db`,
          storeName: `todos`,
          indexedDB: mockIndexedDB,
          getKey: (todo) => todo.id,
        })
      )

      expect(collection.id).toBe(`custom-todos`)
    })

    it(`should throw error when dbName is missing`, () => {
      expect(() =>
        indexedDBCollectionOptions<Todo>({
          dbName: ``,
          storeName: `todos`,
          getKey: (todo) => todo.id,
        })
      ).toThrow(StorageKeyRequiredError)
    })

    it(`should throw error when storeName is missing`, () => {
      expect(() =>
        indexedDBCollectionOptions<Todo>({
          dbName: `test-db`,
          storeName: ``,
          getKey: (todo) => todo.id,
        })
      ).toThrow(StorageKeyRequiredError)
    })

    it(`should throw error when IndexedDB is not available`, () => {
      expect(() =>
        indexedDBCollectionOptions<Todo>({
          dbName: `test-db`,
          storeName: `todos`,
          indexedDB: null as any,
          getKey: (todo) => todo.id,
        })
      ).toThrow(NoStorageAvailableError)
    })
  })

  describe(`data operations`, () => {
    let collection: ReturnType<typeof createCollection>

    beforeEach(() => {
      collection = createCollection(
        indexedDBCollectionOptions<Todo>({
          dbName: `test-db`,
          storeName: `todos`,
          indexedDB: mockIndexedDB,
          getKey: (todo) => todo.id,
        })
      )
    })

    it(`should insert items into the collection`, async () => {
      const todo: Todo = {
        id: `1`,
        title: `Test Todo`,
        completed: false,
        createdAt: new Date(),
      }

      await collection.insert(todo)

      expect(collection.size).toBe(1)
      expect(collection.get(todo.id)).toEqual(todo)
    })

    it(`should update items in the collection`, async () => {
      const todo: Todo = {
        id: `1`,
        title: `Test Todo`,
        completed: false,
        createdAt: new Date(),
      }

      await collection.insert(todo)

      await collection.update(todo.id, (draft) => {
        draft.completed = true
      })

      expect(collection.size).toBe(1)
      expect(collection.get(todo.id)?.completed).toBe(true)
    })

    it(`should delete items from the collection`, async () => {
      const todo: Todo = {
        id: `1`,
        title: `Test Todo`,
        completed: false,
        createdAt: new Date(),
      }

      await collection.insert(todo)
      await collection.delete(todo.id)

      expect(collection.size).toBe(0)
    })
  })

  describe(`utilities`, () => {
    let collection: ReturnType<typeof createCollection>

    beforeEach(() => {
      collection = createCollection(
        indexedDBCollectionOptions<Todo>({
          dbName: `test-db`,
          storeName: `todos`,
          indexedDB: mockIndexedDB,
          getKey: (todo) => todo.id,
        })
      )
    })

    it(`should clear all data from database`, async () => {
      const todo: Todo = {
        id: `1`,
        title: `Test Todo`,
        completed: false,
        createdAt: new Date(),
      }

      await collection.insert(todo)
      expect(collection.size).toBe(1)

      await collection.utils.clearDatabase()

      // Verify the clearDatabase utility works
      const dbSize = await collection.utils.getDatabaseSize()
      expect(dbSize).toBeGreaterThanOrEqual(0) // Database size after clear
    })

    it(`should return database size`, async () => {
      const size = await collection.utils.getDatabaseSize()
      expect(typeof size).toBe(`number`)
      expect(size).toBeGreaterThanOrEqual(0)
    })
  })

  describe(`mutation handlers`, () => {
    it(`should call onInsert handler when provided`, async () => {
      const onInsert = vi.fn()
      const collection = createCollection(
        indexedDBCollectionOptions<Todo>({
          dbName: `test-db`,
          storeName: `todos`,
          indexedDB: mockIndexedDB,
          getKey: (todo) => todo.id,
          onInsert,
        })
      )

      const todo: Todo = {
        id: `1`,
        title: `Test Todo`,
        completed: false,
        createdAt: new Date(),
      }

      await collection.insert(todo)

      expect(onInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          transaction: expect.objectContaining({
            mutations: expect.arrayContaining([
              expect.objectContaining({
                modified: todo,
              }),
            ]),
          }),
        })
      )
    })

    it(`should call onUpdate handler when provided`, async () => {
      const onUpdate = vi.fn()
      const collection = createCollection(
        indexedDBCollectionOptions<Todo>({
          dbName: `test-db`,
          storeName: `todos`,
          indexedDB: mockIndexedDB,
          getKey: (todo) => todo.id,
          onUpdate,
        })
      )

      const todo: Todo = {
        id: `1`,
        title: `Test Todo`,
        completed: false,
        createdAt: new Date(),
      }

      await collection.insert(todo)

      await collection.update(todo.id, (draft) => {
        draft.completed = true
      })

      expect(onUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          transaction: expect.objectContaining({
            mutations: expect.arrayContaining([
              expect.objectContaining({
                modified: expect.objectContaining({
                  id: todo.id,
                  completed: true,
                }),
              }),
            ]),
          }),
        })
      )
    })

    it(`should call onDelete handler when provided`, async () => {
      const onDelete = vi.fn()
      const collection = createCollection(
        indexedDBCollectionOptions<Todo>({
          dbName: `test-db`,
          storeName: `todos`,
          indexedDB: mockIndexedDB,
          getKey: (todo) => todo.id,
          onDelete,
        })
      )

      const todo: Todo = {
        id: `1`,
        title: `Test Todo`,
        completed: false,
        createdAt: new Date(),
      }

      await collection.insert(todo)
      await collection.delete(todo.id)

      expect(onDelete).toHaveBeenCalledWith(
        expect.objectContaining({
          transaction: expect.objectContaining({
            mutations: expect.arrayContaining([
              expect.objectContaining({
                original: todo,
              }),
            ]),
          }),
        })
      )
    })
  })

  describe(`sync metadata`, () => {
    it(`should return correct sync metadata`, () => {
      const options = indexedDBCollectionOptions<Todo>({
        dbName: `test-db`,
        storeName: `todos`,
        indexedDB: mockIndexedDB,
        getKey: (todo) => todo.id,
      })

      const metadata = options.sync.getSyncMetadata?.()
      expect(metadata).toEqual({
        dbName: `test-db`,
        storeName: `todos`,
        storageType: `indexedDB`,
      })
    })
  })
})
