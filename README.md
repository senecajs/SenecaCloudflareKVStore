![Seneca](http://senecajs.org/files/assets/seneca-logo.png)
> A [Seneca.js][] data storage plugin.

# SenecaCloudflareKVStore
[![npm version][npm-badge]][npm-url]
[![Build](https://github.com/senecajs/SenecaCloudflareKVStore/actions/workflows/build.yml/badge.svg)](https://github.com/senecajs/SenecaCloudflareKVStore/actions/workflows/build.yml)
[![Coveralls][BadgeCoveralls]][Coveralls]



| ![Voxgig](https://www.voxgig.com/res/img/vgt01r.png) | This open source module is sponsored and supported by [Voxgig](https://www.voxgig.com). |
|---|---|


## Description

This module is a plugin for the Seneca framework. It provides a
Seneca data entity storage engine backed by [Cloudflare Workers
KV][], a globally distributed key-value store.

The Seneca framework provides an [ActiveRecord-style data storage API][].
Each supported database has a plugin, such as this one, that provides
the underlying Seneca plugin actions required for data persistence.

If you're using this module, and need help, you can:

- Post a [github issue][],
- Tweet to [@senecajs][],
- Ask on the [Gitter][gitter-url].

If you are new to Seneca in general, please take a look at [senecajs.org][]. We have everything from
tutorials to sample apps to help get you up and running quickly.


## Code examples

For code samples, please see the [tests][CloudflareKVStore-tests] for this plugin.

### Seneca compatibility
Supports Seneca versions **3.x** and above


## Install

```sh
npm install seneca
npm install seneca-entity
npm install @seneca/cloudflare-kv-store
```

You'll need the [seneca](http://github.com/senecajs/seneca) toolkit to use this module - it's just a plugin.

## Quick Example

```js
const seneca = require('seneca')()

seneca
  .use('promisify')
  .use('entity')
  .use('@seneca/cloudflare-kv-store', {
    // Use a Cloudflare Workers KV binding directly (e.g. inside a
    // Worker, or a binding from Miniflare/wrangler in dev/test).
    kv: {
      binding: MY_KV_NAMESPACE,
    },
  })

seneca.ready(async function () {
  const apple = await seneca.entity('fruit')
    .data$({ name: 'Pink Lady', price: 0.99 })
    .save$()

  console.log('apple.id = ' + apple.id)
})
```

## Usage
You don't use this module directly. It provides an underlying data storage engine for the Seneca entity API:

```js
var entity = seneca.make$('typename')
entity.someproperty = "something"
entity.anotherproperty = 100

entity.save$(function (err, entity) { ... })
entity.load$({id: ... }, function (err, entity) { ... })
entity.list$({property: ... }, function (err, entity) { ... })
entity.remove$({id: ... }, function (err, entity) { ... })
```

## Options

### `kv.binding`

A [`KVNamespace`][] binding, as provided to a Cloudflare Worker (or by
[Miniflare](https://miniflare.dev) / `wrangler` in local development
and tests). When set, this binding is used directly and the
`cloudflare` REST options below are ignored.

```js
.use('@seneca/cloudflare-kv-store', {
  kv: { binding: env.MY_KV_NAMESPACE },
})
```

### `cloudflare`

When no `kv.binding` is provided, the plugin talks to Workers KV over
the [Cloudflare REST API][], for use outside a Worker (e.g. a Node.js
server or script):

```js
.use('@seneca/cloudflare-kv-store', {
  cloudflare: {
    accountId: '...',
    apiToken: '...',
    namespaceId: '...',
  },
})
```

### `prefix` / `suffix` / `map`

Control how an entity's canon (`zone/base/name`) is mapped to a KV key
prefix, e.g. entity `foo/bar` with id `i0` is stored under key
`foo/bar/i0` by default. `prefix`/`suffix` add fixed segments, and
`map` provides an exact override per canon string (e.g. `{'-/foo/bar':
'custom-prefix'}`).

### `cmd.list.size` / `cmd.list.maxScan`

`cmd.list.size` (default `11`) is the default result count for
`list$` when `limit$` is not given. `cmd.list.maxScan` (default
`1000`) caps how many keys under a canon's prefix are scanned to
answer a `list$`/`load$`/`remove$` query (see below).

### Query Support
The standard Seneca query format is supported:

- `.list$({f1:v1, f2:v2, ...})` implies pseudo-query `f1==v1 AND f2==v2, ...`.

- `.list$({f1:v1,...}, {sort$:{field1:1}})` means sort by f1, ascending.

- `.list$({f1:v1,...}, {sort$:{field1:-1}})` means sort by f1, descending.

- `.list$({f1:v1,...}, {limit$:10})` means only return 10 results.

- `.list$({f1:v1,...}, {skip$:5})` means skip the first 5.

- `.list$({f1:v1,...}, {fields$:['fd1','f2']})` means only return the listed fields.

Note: you can use `sort$`, `limit$`, `skip$` and `fields$` together.

**Limitation:** Workers KV has no native query support. To answer a
`list$` query, this plugin lists all keys under the entity canon's
prefix (up to `cmd.list.maxScan`), fetches each value, and then
filters, sorts and paginates in memory. This is fine for small to
moderate collections, but is not suitable for large datasets — for
those, consider [@seneca/cloudflare-d1-store][] instead.

### Native Driver
The `native` action exposes the underlying KV client (either the
`KVNamespace` binding, or the REST client), via
`seneca.export('CloudflareKVStore/native')`.

## Contributing
The [Senecajs org][] encourages open participation. If you feel you can help in any way, be it with
documentation, examples, extra testing, or new features please get in touch.

## Test
To run tests, simply use npm:

```sh
npm run test
```

Tests run against a local Workers KV namespace provided by
[Miniflare](https://miniflare.dev) — no Cloudflare account or
credentials are required.

## License
Copyright (c) 2024-2026, Richard Rodger and other contributors.
Licensed under [MIT][].

[MIT]: ./LICENSE
[npm-badge]: https://badge.fury.io/js/@seneca%2Fcloudflare-kv-store.svg
[npm-url]: https://badge.fury.io/js/@seneca%2Fcloudflare-kv-store
[Senecajs org]: https://github.com/senecajs/
[Seneca.js]: https://www.npmjs.com/package/seneca
[@senecajs]: http://twitter.com/senecajs
[senecajs.org]: http://senecajs.org/
[gitter-badge]: https://badges.gitter.im/Join%20Chat.svg
[gitter-url]: https://gitter.im/senecajs/seneca
[github issue]: https://github.com/senecajs/SenecaCloudflareKVStore/issues
[ActiveRecord-style data storage API]:http://senecajs.org/tutorials/understanding-data-entities.html
[Coveralls]: https://coveralls.io/github/senecajs/SenecaCloudflareKVStore?branch=main
[BadgeCoveralls]: https://coveralls.io/repos/github/senecajs/SenecaCloudflareKVStore/badge.svg?branch=main
[CloudflareKVStore-tests]: https://github.com/senecajs/SenecaCloudflareKVStore/tree/main/test
[Cloudflare Workers KV]: https://developers.cloudflare.com/kv/
[Cloudflare REST API]: https://developers.cloudflare.com/api/operations/workers-kv-namespace-write-key-value-pair
[`KVNamespace`]: https://developers.cloudflare.com/kv/api/
[@seneca/cloudflare-d1-store]: https://github.com/senecajs/SenecaCloudflareD1Store
