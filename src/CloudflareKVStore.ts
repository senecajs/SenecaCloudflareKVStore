/* Copyright (c) 2024 Seneca contributors, MIT License */

import { Gubu } from 'gubu'

const { Open, Any, Skip } = Gubu

type CloudflareConfig = {
  accountId: string
  apiToken: string
  namespaceId: string
  baseUrl: string
}

type Options = {
  debug: boolean
  map?: any
  prefix: string
  suffix: string
  generate_id?: (ent: any) => string
  cmd: {
    list: {
      size: number
      maxScan: number
    }
  }
  kv: any
  cloudflare: any
}

export type CloudflareKVStoreOptions = Partial<Options>

type KVListEntry = { name: string }

type KVListResult = {
  keys: KVListEntry[]
  list_complete: boolean
  cursor?: string
}

// Minimal subset of the Cloudflare Workers KVNamespace binding interface
// that this plugin needs. A real binding satisfies this directly.
type KVClient = {
  get(key: string): Promise<string | null>
  put(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
  list(opts: {
    prefix?: string
    cursor?: string
    limit?: number
  }): Promise<KVListResult>
}

function CloudflareKVStore(this: any, options: Options) {
  const seneca: any = this

  const init = seneca.export('entity/init')
  const generate_id: (ent: any) => string =
    options.generate_id || seneca.export('entity/generate_id')

  let desc: any = 'CloudflareKVStore'

  let client: KVClient

  let store = {
    name: 'CloudflareKVStore',

    save: function (this: any, msg: any, reply: any) {
      const ent = msg.ent
      const id = null == ent.id ? generate_id(ent) : ent.id
      const key = resolveKey(ent, id, options)

      const data = ent.data$(false)
      data.id = id

      client
        .put(key, JSON.stringify(data))
        .then(() => {
          ent.id = id
          reply(ent)
        })
        .catch((err: any) => reply(err))
    },

    load: function (this: any, msg: any, reply: any) {
      const ent = msg.ent
      const q = msg.q || {}

      if (null != q.id) {
        const key = resolveKey(ent, q.id, options)

        client
          .get(key)
          .then((raw: string | null) => {
            if (null == raw) {
              return reply(null)
            }

            const data = JSON.parse(raw)
            ent.data$(data)
            ent.id = data.id
            reply(ent)
          })
          .catch((err: any) => reply(err))
      } else {
        listEntities(ent, { ...q, limit$: 1 }, options, client)
          .then((list: any[]) => reply(list[0] || null))
          .catch((err: any) => reply(err))
      }
    },

    list: function (this: any, msg: any, reply: any) {
      const ent = msg.ent
      const q = msg.q || {}

      listEntities(ent, q, options, client)
        .then((list: any[]) => reply(list))
        .catch((err: any) => reply(err))
    },

    remove: function (this: any, msg: any, reply: any) {
      const ent = msg.ent
      const q = msg.q || {}

      if (null != q.id) {
        const key = resolveKey(ent, q.id, options)

        client
          .delete(key)
          .then(() => reply(null))
          .catch((err: any) => reply(err))

        return
      }

      const all = true === q.all$
      const limit$ = all ? options.cmd.list.maxScan : 1

      listEntities(ent, { ...q, limit$ }, options, client)
        .then((list: any[]) => {
          return Promise.all(
            list.map((item: any) =>
              client.delete(resolveKey(ent, item.id, options)),
            ),
          )
        })
        .then(() => reply(null))
        .catch((err: any) => reply(err))
    },

    close: function (this: any, _msg: any, reply: any) {
      this.log.debug('close', desc)
      reply()
    },

    native: function (this: any, _msg: any, reply: any) {
      reply(null, {
        client: () => client,
      })
    },
  }

  let meta = init(seneca, options, store)

  desc = meta.desc

  seneca.prepare(async function (this: any) {
    client = options.kv.binding
      ? (options.kv.binding as KVClient)
      : makeRestClient(options.cloudflare as CloudflareConfig)
  })

  return {
    name: store.name,
    tag: meta.tag,
    exportmap: {
      native: () => {
        return { client }
      },
    },
  }
}

// Builds a KV-key prefix for an entity canon, e.g. `foo/bar`.
function resolveKeyPrefix(ent: any, options: Options): string {
  let canonstr = ent.canon$({ string: true })

  options.map = options.map || {}
  if ('' != options.map[canonstr] && null != options.map[canonstr]) {
    return options.map[canonstr]
  }

  let prefix = options.prefix
  let suffix = options.suffix

  prefix = '' == prefix || null == prefix ? '' : prefix + '/'
  suffix = '' == suffix || null == suffix ? '' : '/' + suffix

  // -/foo/bar -> foo/bar; -/-/foo -> foo
  let infix = canonstr.replace(/-\//g, '')

  return prefix + infix + suffix
}

function resolveKey(ent: any, id: string, options: Options): string {
  return resolveKeyPrefix(ent, options) + '/' + id
}

// Lists, filters, sorts and pages entities for an entity canon.
// NOTE: KV has no native query support, so this scans all keys under
// the canon's prefix (up to cmd.list.maxScan) and filters in memory.
async function listEntities(
  ent: any,
  q: any,
  options: Options,
  client: KVClient,
): Promise<any[]> {
  const prefix = resolveKeyPrefix(ent, options) + '/'
  const maxScan = options.cmd.list.maxScan

  const keys: string[] = []
  let cursor: string | undefined

  do {
    const page = await client.list({ prefix, cursor, limit: 1000 })

    for (const entry of page.keys) {
      keys.push(entry.name)
    }

    cursor = page.list_complete ? undefined : page.cursor
  } while (null != cursor && keys.length < maxScan)

  const items = await Promise.all(
    keys.slice(0, maxScan).map(async (key) => {
      const raw = await client.get(key)
      return null == raw ? null : JSON.parse(raw)
    }),
  )

  let list = items.filter((item) => null != item)

  for (const field of Object.keys(q)) {
    if (field.endsWith('$')) {
      continue
    }

    list = list.filter((item) => item[field] === q[field])
  }

  if (q.sort$) {
    const entries = Object.entries(q.sort$)
    const [field, dir] = entries[0]

    list = list.slice().sort((a, b) => {
      if (a[field] === b[field]) {
        return 0
      }

      const order = a[field] < b[field] ? -1 : 1
      return 0 > (dir as number) ? -order : order
    })
  }

  const skip = q.skip$ || 0
  const limit = null == q.limit$ ? options.cmd.list.size : q.limit$

  list = list.slice(skip, skip + limit)

  if (Array.isArray(q.fields$)) {
    list = list.map((item) => {
      const picked: any = { id: item.id }

      for (const field of q.fields$) {
        picked[field] = item[field]
      }

      return picked
    })
  }

  return list.map((data) => {
    const item = ent.make$().data$(data)
    item.id = data.id
    return item
  })
}

// REST API client for Cloudflare Workers KV, used when no binding is
// supplied (e.g. running outside a Cloudflare Worker, or in tests).
function makeRestClient(cf: CloudflareConfig): KVClient {
  const base =
    cf.baseUrl +
    `/accounts/${cf.accountId}/storage/kv/namespaces/${cf.namespaceId}`

  const headers = { Authorization: `Bearer ${cf.apiToken}` }

  return {
    async get(key: string) {
      const res = await fetch(`${base}/values/${encodeURIComponent(key)}`, {
        headers,
      })

      if (404 === res.status) {
        return null
      }

      if (!res.ok) {
        throw new Error('CloudflareKVStore: get failed: ' + res.status)
      }

      return await res.text()
    },

    async put(key: string, value: string) {
      const res = await fetch(`${base}/values/${encodeURIComponent(key)}`, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'text/plain' },
        body: value,
      })

      if (!res.ok) {
        throw new Error('CloudflareKVStore: put failed: ' + res.status)
      }
    },

    async delete(key: string) {
      const res = await fetch(`${base}/values/${encodeURIComponent(key)}`, {
        method: 'DELETE',
        headers,
      })

      if (!res.ok && 404 !== res.status) {
        throw new Error('CloudflareKVStore: delete failed: ' + res.status)
      }
    },

    async list(opts: { prefix?: string; cursor?: string; limit?: number }) {
      const params = new URLSearchParams()

      if (null != opts.prefix) {
        params.set('prefix', opts.prefix)
      }

      if (null != opts.cursor) {
        params.set('cursor', opts.cursor)
      }

      if (null != opts.limit) {
        params.set('limit', String(opts.limit))
      }

      const res = await fetch(`${base}/keys?${params.toString()}`, {
        headers,
      })

      if (!res.ok) {
        throw new Error('CloudflareKVStore: list failed: ' + res.status)
      }

      const body: any = await res.json()
      const cursor = body.result_info && body.result_info.cursor

      return {
        keys: (body.result || []).map((entry: any) => ({
          name: entry.name,
        })),
        list_complete: '' === cursor || null == cursor,
        cursor: cursor || undefined,
      }
    },
  }
}

// Default options.
const defaults: Options = {
  debug: false,
  map: Any(),
  prefix: '',
  suffix: '',

  cmd: {
    list: {
      size: 11,
      maxScan: 1000,
    },
  },

  kv: Open({
    binding: Skip(Any()),
  }),

  cloudflare: Open({
    accountId: '',
    apiToken: '',
    namespaceId: '',
    baseUrl: 'https://api.cloudflare.com/client/v4',
  }),
}

Object.assign(CloudflareKVStore, {
  defaults,
  utils: { resolveKeyPrefix, resolveKey, makeRestClient },
})

export default CloudflareKVStore

if ('undefined' !== typeof module) {
  module.exports = CloudflareKVStore
}
