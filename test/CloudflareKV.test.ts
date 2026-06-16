/* Copyright © 2024 Seneca Project Contributors, MIT License. */

import Seneca from 'seneca'
import { Miniflare } from 'miniflare'

import CloudflareKVStoreDoc from '../src/CloudflareKVStoreDoc'
import CloudflareKVStore from '../src/CloudflareKVStore'

describe('CloudflareKVStore', () => {
  test('load-plugin', async () => {
    expect(CloudflareKVStore).toBeDefined()
    expect(CloudflareKVStoreDoc).toBeDefined()

    const mf = await makeMiniflare()
    const binding = await mf.getKVNamespace('TEST_KV')

    const seneca = Seneca({ legacy: false })
      .test()
      .use('promisify')
      .use('entity')
      .use(CloudflareKVStore, { kv: { binding } })

    await seneca.ready()

    expect(seneca.export('CloudflareKVStore/native')).toBeDefined()

    await mf.dispose()
  })

  test('utils.resolveKeyPrefix', () => {
    const utils = CloudflareKVStore['utils']
    const resolveKeyPrefix = utils.resolveKeyPrefix
    const resolveKey = utils.resolveKey

    const seneca = Seneca({ legacy: false }).test().use('entity')
    const ent0 = seneca.make('foo')
    const ent1 = seneca.make('foo/bar')

    expect(resolveKeyPrefix(ent0, { prefix: '', suffix: '' })).toEqual('foo')
    expect(resolveKeyPrefix(ent1, { prefix: '', suffix: '' })).toEqual(
      'foo/bar',
    )

    expect(resolveKeyPrefix(ent1, { prefix: 'p0', suffix: 's0' })).toEqual(
      'p0/foo/bar/s0',
    )

    expect(
      resolveKeyPrefix(ent1, {
        map: { '-/foo/bar': 'FOOBAR' },
        prefix: 'p0',
        suffix: 's0',
      }),
    ).toEqual('FOOBAR')

    expect(resolveKey(ent0, 'i0', { prefix: '', suffix: '' })).toEqual('foo/i0')
  })

  describe('crud', () => {
    let mf: Miniflare
    let seneca: any

    beforeAll(async () => {
      mf = await makeMiniflare()
      const binding = await mf.getKVNamespace('TEST_KV')

      seneca = Seneca({ legacy: false })
        .test()
        .use('promisify')
        .use('entity')
        .use(CloudflareKVStore, { kv: { binding } })

      await seneca.ready()
    })

    afterAll(async () => {
      await mf.dispose()
    })

    test('save and load by id', async () => {
      const foo = await seneca.entity('foo/bar').data$({ x: 1, y: 'a' }).save$()

      expect(foo.id).toBeDefined()
      expect(foo).toMatchObject({ x: 1, y: 'a' })

      const loaded = await seneca.entity('foo/bar').load$(foo.id)
      expect(loaded).toMatchObject({ id: foo.id, x: 1, y: 'a' })
    })

    test('load missing returns null', async () => {
      const loaded = await seneca.entity('foo/bar').load$('not-an-id')
      expect(loaded).toEqual(null)
    })

    test('list, sort, skip and limit', async () => {
      for (let i = 0; i < 5; i++) {
        await seneca.entity('foo/chunk').data$({ test: 'list01', n: i }).save$()
      }

      const all = await seneca.entity('foo/chunk').list$({ test: 'list01' })

      expect(all.length).toEqual(5)

      const sorted = await seneca.entity('foo/chunk').list$({
        test: 'list01',
        sort$: { n: 1 },
      })
      expect(sorted.map((n: any) => n.n)).toEqual([0, 1, 2, 3, 4])

      const sortedDesc = await seneca.entity('foo/chunk').list$({
        test: 'list01',
        sort$: { n: -1 },
      })
      expect(sortedDesc.map((n: any) => n.n)).toEqual([4, 3, 2, 1, 0])

      const page = await seneca.entity('foo/chunk').list$({
        test: 'list01',
        sort$: { n: 1 },
        skip$: 1,
        limit$: 2,
      })
      expect(page.map((n: any) => n.n)).toEqual([1, 2])
    })

    test('list with fields$', async () => {
      const ent = await seneca
        .entity('foo/field')
        .data$({ test: 'fields01', a: 1, b: 2 })
        .save$()

      const list = await seneca.entity('foo/field').list$({
        test: 'fields01',
        fields$: ['a'],
      })

      expect(list.length).toEqual(1)
      expect(list[0]).toMatchObject({ id: ent.id, a: 1 })
      expect(list[0].b).toBeUndefined()
    })

    test('remove by id', async () => {
      const ent = await seneca.entity('foo/bar').data$({ x: 9 }).save$()

      await seneca.entity('foo/bar').remove$(ent.id)

      const loaded = await seneca.entity('foo/bar').load$(ent.id)
      expect(loaded).toEqual(null)
    })

    test('remove with all$', async () => {
      for (let i = 0; i < 3; i++) {
        await seneca
          .entity('foo/rmall')
          .data$({ test: 'rmall01', n: i })
          .save$()
      }

      await seneca.entity('foo/rmall').remove$({ test: 'rmall01', all$: true })

      const list = await seneca.entity('foo/rmall').list$({ test: 'rmall01' })
      expect(list).toEqual([])
    })
  })

  describe('makeRestClient', () => {
    const makeRestClient = CloudflareKVStore['utils'].makeRestClient

    const cf = {
      accountId: 'acc01',
      apiToken: 'tok01',
      namespaceId: 'ns01',
      baseUrl: 'https://example.test/client/v4',
    }

    let fetchMock: jest.Mock

    beforeEach(() => {
      fetchMock = jest.fn()
        ; (global as any).fetch = fetchMock
    })

    test('get found', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => '{"id":"i0"}',
      })

      const client = makeRestClient(cf)
      const value = await client.get('foo/bar/i0')

      expect(value).toEqual('{"id":"i0"}')
      expect(fetchMock).toHaveBeenCalledWith(
        'https://example.test/client/v4/accounts/acc01/storage/kv/' +
        'namespaces/ns01/values/foo%2Fbar%2Fi0',
        { headers: { Authorization: 'Bearer tok01' } },
      )
    })

    test('get not found', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 404 })

      const client = makeRestClient(cf)
      const value = await client.get('foo/bar/missing')

      expect(value).toEqual(null)
    })

    test('list', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          result: [{ name: 'foo/bar/i0' }, { name: 'foo/bar/i1' }],
          result_info: { cursor: '' },
        }),
      })

      const client = makeRestClient(cf)
      const res = await client.list({ prefix: 'foo/bar/' })

      expect(res.keys).toEqual([{ name: 'foo/bar/i0' }, { name: 'foo/bar/i1' }])
      expect(res.list_complete).toEqual(true)
    })
  })
})

async function makeMiniflare() {
  return new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("ok") } }',
    kvNamespaces: ['TEST_KV'],
  })
}
