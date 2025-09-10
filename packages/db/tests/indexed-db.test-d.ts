import { describe, expectTypeOf, it } from "vitest"
import { createCollection } from "../src/index"
import { indexedDBCollectionOptions } from "../src/indexed-db"
import type {
  IndexedDBCollectionConfig,
  IndexedDBCollectionUtils,
} from "../src/indexed-db"

interface User {
  id: string
  name: string
  email: string
}

describe(`IndexedDB collection type definitions`, () => {
  it(`should have correct config types`, () => {
    // Test that the config interface exists and has required fields
    expectTypeOf<IndexedDBCollectionConfig<User>>().toMatchTypeOf<{
      dbName: string
      storeName: string
      getKey: (item: User) => string | number
    }>()
  })

  it(`should have correct utils types`, () => {
    expectTypeOf<IndexedDBCollectionUtils>().toEqualTypeOf<{
      clearDatabase: () => Promise<void>
      getDatabaseSize: () => Promise<number>
    }>()
  })

  it(`should create collection with correct types`, () => {
    const collection = createCollection(
      indexedDBCollectionOptions<User>({
        dbName: `test-db`,
        storeName: `users`,
        getKey: (user) => user.id,
      })
    )

    expectTypeOf(collection.utils.clearDatabase).toEqualTypeOf<
      () => Promise<void>
    >()
    expectTypeOf(collection.utils.getDatabaseSize).toEqualTypeOf<
      () => Promise<number>
    >()
    expectTypeOf(collection.id).toEqualTypeOf<string>()
    expectTypeOf(collection.get(`test`)).toEqualTypeOf<User | undefined>()
    expectTypeOf(collection.insert).toEqualTypeOf<
      (item: User) => Promise<void>
    >()
    expectTypeOf(collection.update).toEqualTypeOf<
      (item: User) => Promise<void>
    >()
    expectTypeOf(collection.delete).toEqualTypeOf<
      (key: string | number) => Promise<void>
    >()
  })

  it(`should work with explicit types`, () => {
    const collection = createCollection(
      indexedDBCollectionOptions<User>({
        dbName: `test-db`,
        storeName: `users`,
        getKey: (user) => user.id,
      })
    )

    expectTypeOf(collection.get(`test`)).toEqualTypeOf<User | undefined>()
  })

  it(`should work with schema inference`, () => {
    // This would work with a proper schema type in real usage
    const collection = createCollection(
      indexedDBCollectionOptions({
        dbName: `test-db`,
        storeName: `users`,
        getKey: (user: any) => user.id,
      })
    )

    expectTypeOf(collection.get(`test`)).toEqualTypeOf<
      Record<string, unknown> | undefined
    >()
  })
})
