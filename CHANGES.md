# Changes

## 0.1.0 2026-11-21

* First release. A Seneca entity store backed by Cloudflare Workers KV, through a Workers binding or the Cloudflare REST API.
* Seneca 4: the peer dependencies are `seneca` `^4.0.0` and `@seneca/entity` `^29.0.0`. Node.js 24 or later (`engines.node` `>=24`).
* The option defaults are built with the validator that Seneca passes to the plugin: `defaults` is a function of `{ valid }`. Seneca 4 rejects defaults built with Gubu (`plugin_gubu_shape`), and gubu was never a declared dependency. `kv` and `cloudflare` stay open. Unknown top-level options are rejected with `invalid_plugin_option`.
* The option `generate_id` must be a function when given. The default returns `undefined`, which means that the entity plugin generates the id, as before.
* The store connects in the plugin's `init` task (`seneca.init`), not in a raw `init:CloudflareKVStore` action.
* No dependency on `seneca-promisify`, `seneca-entity` or `@seneca/entity-util`. Load the entity plugin as `@seneca/entity`.
* `npm pack` and `npm publish` build `dist/` first (`prepack`).
* Releases are published from GitHub Actions with npm trusted publishing and provenance. The local `repo-tag` and `repo-publish` scripts are removed.
* Tested with Miniflare's local Workers KV (workerd): from Node through the Workers binding and through the REST client against a local stand-in for the Workers KV REST API, and inside a Miniflare Worker (`nodejs_compat`) with the `env` binding. A deployed Cloudflare Worker and the real Cloudflare REST API were not tested on Seneca 4.
