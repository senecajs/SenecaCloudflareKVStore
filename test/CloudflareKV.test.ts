/* Copyright © 2024 Seneca Project Contributors, MIT License. */

import { createServer, Server } from 'node:http'
import { AddressInfo } from 'node:net'

import Seneca from 'seneca'
import type {} from '@seneca/entity'
import { Miniflare } from 'miniflare'
import { build } from 'esbuild'

import CloudflareKVStoreDoc from '../src/CloudflareKVStoreDoc'
import CloudflareKVStore from '../src/CloudflareKVStore'

const REST = {
  accountId: 'acct-local',
  apiToken: 'token-local',
  namespaceId: 'ns-local',
}

let mf: Miniflare
let standIn: { server: Server; baseUrl: string }

beforeAll(async () => {
  mf = await makeMiniflare()
  standIn = await startKVRestStandIn(await mf.getKVNamespace('REST_KV'))
})

afterAll(async () => {
  await new Promise((resolve) => standIn.server.close(resolve))
  await mf.dispose()
})

describe('CloudflareKVStore', () => {
  test('load-plugin', async () => {
    expect(CloudflareKVStore).toBeDefined()
    expect(CloudflareKVStoreDoc).toBeDefined()

    const seneca = await makeSeneca('binding')

    expect(seneca.export('CloudflareKVStore/native')).toBeDefined()
    expect(seneca.export('CloudflareKVStore/native')().client).toBeDefined()
    await seneca.close()
  })

  test('utils.resolveKeyPrefix', async () => {
    const utils = CloudflareKVStore['utils']
    const resolveKeyPrefix = utils.resolveKeyPrefix
    const resolveKey = utils.resolveKey

    const seneca = Seneca({ legacy: false }).test().use('@seneca/entity')
    await seneca.ready()
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

  test('prefix and suffix options', async () => {
    const seneca = await makeSeneca('binding', { prefix: 'p1', suffix: 's1' })
    const kv = await mf.getKVNamespace('TEST_KV')

    const a = await seneca.entity('foo/plain').data$({ x: 1 }).save$()
    expect(await kv.get('p1/foo/plain/s1/' + a.id)).toEqual(
      JSON.stringify({ x: 1, id: a.id }),
    )

    const loaded = await seneca.entity('foo/plain').load$(a.id)
    expect(loaded).toMatchObject({ id: a.id, x: 1 })
    await seneca.close()
  })

  test('generate_id option', async () => {
    let n = 0
    const seneca = await makeSeneca('binding', {
      generate_id: (ent: any) =>
        'item' === ent.canon$({ object: true }).name ? 'gen-' + ++n : undefined,
    })

    const a = await seneca.entity('gen/item').data$({ x: 1 }).save$()
    expect(a.id).toEqual('gen-1')

    // undefined from the option: the entity plugin generates the id.
    const b = await seneca.entity('gen/other').data$({ x: 2 }).save$()
    expect(typeof b.id).toEqual('string')
    expect(b.id.length).toBeGreaterThan(0)
    expect(b.id).not.toMatch(/^gen-/)
    await seneca.close()
  })

  test('invalid options are rejected', async () => {
    for (const bad of [{ generate_id: 'not-a-function' }, { bad: 1 }]) {
      const errs: any[] = []
      const seneca = Seneca({ legacy: false, debug: { undead: true } })
        .test((err: any) => errs.push(err), 'silent')
        .use('@seneca/entity')
        .use(CloudflareKVStore, bad)
      await seneca.ready()
      expect(errs.map((err: any) => err.code)).toEqual([
        'invalid_plugin_option',
      ])
      await seneca.close()
    }
  })
})

// The same entity tests run through the Workers KV binding and through the
// REST client. The REST client talks to a local stand-in for the Workers
// KV REST API, backed by a Miniflare KV namespace.
describe.each(['binding', 'rest'] as const)('crud (%s)', (mode) => {
  let seneca: any

  beforeAll(async () => {
    seneca = await makeSeneca(mode)
  })

  afterAll(async () => {
    await seneca.close()
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

  test('load by query', async () => {
    await seneca.entity('foo/query').data$({ test: 'query01', n: 7 }).save$()

    const loaded = await seneca.entity('foo/query').load$({ n: 7 })
    expect(loaded).toMatchObject({ test: 'query01', n: 7 })

    const missing = await seneca.entity('foo/query').load$({ n: -1 })
    expect(missing).toEqual(null)
  })

  test('update existing entity', async () => {
    const ent = await seneca.entity('foo/upd').data$({ x: 1 }).save$()

    ent.x = 2
    const updated = await ent.save$()
    expect(updated).toMatchObject({ id: ent.id, x: 2 })

    const loaded = await seneca.entity('foo/upd').load$(ent.id)
    expect(loaded.x).toEqual(2)
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

  test('remove first match', async () => {
    for (let i = 0; i < 2; i++) {
      await seneca.entity('foo/rmone').data$({ test: 'rmone01' }).save$()
    }

    await seneca.entity('foo/rmone').remove$({ test: 'rmone01' })

    const list = await seneca.entity('foo/rmone').list$({ test: 'rmone01' })
    expect(list.length).toEqual(1)
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

  describe('request shape (fetch mock)', () => {
    const realFetch = global.fetch
    let fetchMock: jest.Mock

    beforeEach(() => {
      fetchMock = jest.fn()
      ;(global as any).fetch = fetchMock
    })

    afterEach(() => {
      global.fetch = realFetch
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

  describe('local REST stand-in', () => {
    test('list pages with a cursor', async () => {
      const client = makeRestClient({ ...REST, baseUrl: standIn.baseUrl })

      for (let i = 0; i < 12; i++) {
        await client.put('page/item/i' + String(i).padStart(2, '0'), '{}')
      }

      const first = await client.list({ prefix: 'page/item/', limit: 10 })
      expect(first.keys.length).toEqual(10)
      expect(first.list_complete).toEqual(false)
      expect(typeof first.cursor).toEqual('string')

      const second = await client.list({
        prefix: 'page/item/',
        limit: 10,
        cursor: first.cursor,
      })
      expect(second.keys.map((k: any) => k.name)).toEqual([
        'page/item/i10',
        'page/item/i11',
      ])
      expect(second.list_complete).toEqual(true)
      expect(second.cursor).toBeUndefined()
    })

    test('HTTP errors', async () => {
      const client = makeRestClient({
        ...REST,
        apiToken: 'wrong-token',
        baseUrl: standIn.baseUrl,
      })

      await expect(client.get('k')).rejects.toThrow(
        'CloudflareKVStore: get failed: 403',
      )
      await expect(client.put('k', 'v')).rejects.toThrow(
        'CloudflareKVStore: put failed: 403',
      )
      await expect(client.delete('k')).rejects.toThrow(
        'CloudflareKVStore: delete failed: 403',
      )
      await expect(client.list({ prefix: 'k' })).rejects.toThrow(
        'CloudflareKVStore: list failed: 403',
      )
    })

    test('entity action error', async () => {
      const seneca = await makeSeneca(
        'rest',
        {
          cloudflare: {
            ...REST,
            apiToken: 'wrong-token',
            baseUrl: standIn.baseUrl,
          },
        },
        'silent',
      )

      await expect(
        seneca.entity('foo/bar').data$({ x: 1 }).save$(),
      ).rejects.toThrow('put failed: 403')
      await expect(seneca.entity('foo/bar').load$('i0')).rejects.toThrow(
        'get failed: 403',
      )
      await expect(seneca.entity('foo/bar').list$({})).rejects.toThrow(
        'list failed: 403',
      )
      await expect(seneca.entity('foo/bar').remove$('i0')).rejects.toThrow(
        'delete failed: 403',
      )
      await seneca.close()
    })
  })
})

// Seneca, @seneca/entity and this store run inside workerd, in a Worker
// that Miniflare starts, with the KVNamespace binding of the Worker's env
// passed as the kv.binding option.
describe('inside workerd', () => {
  test('crud through env binding', async () => {
    const script = await bundleWorker(`
      import Seneca from 'seneca'
      import Entity from '@seneca/entity'
      import CloudflareKVStore from '../src/CloudflareKVStore'

      export default {
        async fetch(request, env) {
          const seneca = Seneca({ legacy: false, log: 'silent' })
            .use(Entity)
            .use(CloudflareKVStore, { kv: { binding: env.KV } })
          await seneca.ready()

          const saved = await seneca.entity('w/item').data$({ n: 1 }).save$()
          await seneca.entity('w/item').data$({ n: 2 }).save$()
          const loaded = await seneca.entity('w/item').load$(saved.id)
          const list = await seneca.entity('w/item').list$({ sort$: { n: -1 } })
          await seneca.entity('w/item').remove$(saved.id)
          const gone = await seneca.entity('w/item').load$(saved.id)
          const same =
            env.KV === seneca.export('CloudflareKVStore/native')().client
          await seneca.close()

          return Response.json({
            loaded: loaded.data$(false),
            list: list.map((e) => e.n),
            gone,
            same,
          })
        },
      }
    `)

    const worker = new Miniflare({
      modules: true,
      script,
      compatibilityDate: '2026-01-01',
      compatibilityFlags: ['nodejs_compat'],
      kvNamespaces: ['KV'],
    })

    try {
      const res = await worker.dispatchFetch('http://localhost/')
      const out: any = await res.json()
      expect(out.loaded).toMatchObject({ n: 1 })
      expect(out.list).toEqual([2, 1])
      expect(out.gone).toEqual(null)
      expect(out.same).toEqual(true)
    } finally {
      await worker.dispose()
    }
  })
})

// Bundles a Worker module from source that imports seneca, @seneca/entity
// and the store. workerd provides the Node.js built-in modules that Seneca
// needs through the nodejs_compat flag.
async function bundleWorker(contents: string) {
  const out = await build({
    stdin: { contents, resolveDir: __dirname, loader: 'ts' },
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
    logLevel: 'error',
    banner: {
      js:
        "import { createRequire } from 'node:module';" +
        "const require = createRequire('/');",
    },
  })
  return out.outputFiles[0].text
}

async function makeSeneca(
  mode: 'binding' | 'rest',
  options: any = {},
  log?: string,
) {
  const conn =
    'binding' === mode
      ? { kv: { binding: await mf.getKVNamespace('TEST_KV') } }
      : { cloudflare: { ...REST, baseUrl: standIn.baseUrl } }

  const seneca = Seneca({ legacy: false })
    .test(log)
    .use('@seneca/entity')
    .use(CloudflareKVStore, { ...conn, ...options })
  await seneca.ready()
  return seneca
}

async function makeMiniflare() {
  return new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("ok") } }',
    kvNamespaces: ['TEST_KV', 'REST_KV'],
  })
}

// A local stand-in for the Workers KV REST API, for the endpoints that the
// REST client calls, under /accounts/{account_id}/storage/kv/namespaces/
// {namespace_id}: GET, PUT and DELETE values/{key_name}, and GET keys with
// prefix, cursor and limit. Values are the raw body; the other responses
// have the documented envelope {success, errors, messages, result}, and
// keys adds result_info {count, cursor}, with an empty cursor on the last
// page. Each call runs on a Miniflare KV namespace. Port 0: the system
// picks a free port.
async function startKVRestStandIn(kv: any) {
  const route =
    /^\/client\/v4\/accounts\/([^/]+)\/storage\/kv\/namespaces\/([^/]+)\/(?:values\/(.+)|(keys))$/

  const server = createServer(async (req, res) => {
    const send = (status: number, body: any) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    const ok = (result: any, extra: any = {}) =>
      send(200, { success: true, errors: [], messages: [], result, ...extra })
    const fail = (status: number, code: number, message: string) =>
      send(status, {
        success: false,
        errors: [{ code, message }],
        messages: [],
        result: null,
      })

    const url = new URL(req.url || '', 'http://localhost')
    const m = route.exec(url.pathname)
    if (null == m) {
      return fail(404, 7003, 'No route for that URI')
    }
    if ('Bearer ' + REST.apiToken !== req.headers.authorization) {
      return fail(403, 10000, 'Authentication error')
    }
    if (REST.accountId !== m[1] || REST.namespaceId !== m[2]) {
      return fail(404, 10013, 'namespace not found')
    }

    try {
      if (m[4]) {
        if ('GET' !== req.method) return fail(405, 10000, 'Method not allowed')
        const limit = url.searchParams.get('limit')
        const out = await kv.list({
          prefix: url.searchParams.get('prefix') || undefined,
          cursor: url.searchParams.get('cursor') || undefined,
          limit: null == limit ? 1000 : Number(limit),
        })
        return ok(
          out.keys.map((k: any) => ({ name: k.name })),
          {
            result_info: {
              count: out.keys.length,
              cursor: out.list_complete ? '' : out.cursor,
            },
          },
        )
      }

      const key = decodeURIComponent(m[3])

      if ('GET' === req.method) {
        const value = await kv.get(key)
        if (null == value) return fail(404, 10009, "get: 'key not found'")
        res.writeHead(200, { 'content-type': 'application/octet-stream' })
        return res.end(value)
      }

      if ('PUT' === req.method) {
        let body = ''
        for await (const chunk of req) body += chunk
        await kv.put(key, body)
        return ok({})
      }

      if ('DELETE' === req.method) {
        await kv.delete(key)
        return ok({})
      }

      fail(405, 10000, 'Method not allowed')
    } catch (err: any) {
      fail(500, 10001, err.message)
    }
  })

  await new Promise<void>((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve()),
  )
  const port = (server.address() as AddressInfo).port
  return { server, baseUrl: `http://127.0.0.1:${port}/client/v4` }
}
