# Shopify Store Sync

This tool is being adapted into an agency-safe Shopify content migration utility. The current focus is storefront reconstruction for theme discovery, design implementation, QA, and stakeholder demos without writing to the client live store.

The workflow in this fork is CLI-first:

1. Audit the source store in read-only mode.
2. Inventory theme-relevant surfaces so we know what exists and what is still unsupported.
3. Sync only to the agency dev store.
4. Verify source versus destination from saved audit snapshots.

## Current status

Today this fork supports read-only audit, planning, sync, and verification for:

- products
- product variants
- collections
- pages
- blogs
- articles
- product and variant metafields that can be safely remapped
- storefront menus
- URL redirects

The current known partial/blocking area is inventory quantity parity. The script exists, but the current Shopify CLI auth used in Encore does not have `locations` access, so inventory is not part of the default `sync:all` path.

## Safety rules

- Never write to the source client store.
- Treat the source store as read-only even if credentials appear to allow writes.
- Only run `--live` commands against the dev store.
- Refresh audits before planning, syncing, or verifying.
- Prefer small dry-runs before a first live run on a new store.
- Do not copy customer, order, or other private operational data into the dev store.

## Recommended workflow

### 1. Inventory the source store

Use this first when you want a broader view of theme-relevant surfaces and support gaps:

```bash
npm run audit:inventory -- --store encore-food-service.myshopify.com
```

### 2. Export read-only audit snapshots

This produces JSON snapshots under `audit/<store>/` that the rest of the workflow uses:

```bash
npm run audit:cli -- --store encore-food-service.myshopify.com
npm run audit:cli -- --store shift8-encorecanada.myshopify.com
```

### 3. Compare before writing

```bash
npm run plan:cli -- --source audit/encore-food-service.myshopify.com --destination audit/shift8-encorecanada.myshopify.com
```

### 4. Dry-run or live-sync supported resources

```bash
npm run sync:all -- --all --source audit/encore-food-service.myshopify.com --destination shift8-encorecanada.myshopify.com
npm run sync:all -- --all --source audit/encore-food-service.myshopify.com --destination shift8-encorecanada.myshopify.com --live
```

### 5. Refresh audits and verify parity

```bash
npm run audit:cli -- --store shift8-encorecanada.myshopify.com
npm run verify -- --source audit/encore-food-service.myshopify.com --destination audit/shift8-encorecanada.myshopify.com
```

## Command reference

### Audit and reporting

- `npm run audit:inventory -- --store <store>`
- `npm run audit:cli -- --store <store>`
- `npm run plan:cli -- --source <audit_dir> --destination <audit_dir>`
- `npm run verify -- --source <audit_dir> --destination <audit_dir>`

### Sync commands

- `npm run sync:all -- --all --source <audit_dir> --destination <store>`
- `npm run sync:blogs -- --source <audit_dir> --destination <store>`
- `npm run sync:articles -- --source <audit_dir> --destination <store>`
- `npm run sync:collections -- --source <audit_dir> --destination <store>`
- `npm run sync:pages -- --source <audit_dir> --destination <store>`
- `npm run sync:products -- --source <audit_dir> --destination <store>`
- `npm run sync:metafields -- --source <audit_dir> --destination <store>`
- `npm run sync:menus -- --source <audit_dir> --destination <store>`
- `npm run sync:redirects -- --source <audit_dir> --destination <store>`
- `npm run sync:inventory -- --source <audit_dir> --destination <store>`

All sync commands support:

- `--live` to execute writes
- `--limit <n>` for smaller proof runs where implemented

## What `sync:all` currently includes

The orchestrator runs resources in dependency order:

1. blogs
2. collections
3. pages
4. articles
5. products
6. metafields
7. menus
8. redirects

Inventory is intentionally excluded from `sync:all` until Shopify location access is available for the active auth method.

## Verification model

`npm run verify` currently checks:

- source handles exist on destination for products, collections, pages, blogs, and articles
- portable product and variant metafields match on type and value
- storefront menus match after URL normalization
- redirects match on `path` and `target`

It does not yet verify:

- files library parity
- metaobject entries
- market/publication configuration
- policy content parity
- inventory quantity parity
- theme settings or theme code

## Progress output

Live sync scripts print:

- percent complete
- elapsed time
- ETA
- latest handle processed
- final throughput summary with total runtime and items per minute

## Testing

The project now includes Node-based automated tests for the pure comparison and orchestration helpers:

```bash
npm test
```

These tests currently cover:

- sync orchestration resource detection order
- menu normalization and comparison behavior
- redirect comparison behavior
- portable metafield filtering and parity comparison
- variant key normalization helpers

They do not mock Shopify CLI or perform live API integration tests. Runtime confidence for mutation scripts still depends on dry-runs, live runs against a dev store, and post-sync verification.

## Internal docs

See the `docs/` folder for project-specific internal documentation:

- `docs/workflow.md`
- `docs/coverage-status.md`
- `docs/testing.md`
- `docs/encore-canada-notes.md`
- `docs/encore-canada-audit.md`

## Future extraction notes

If this tool is pulled into its own repository, the first cleanup steps should be:

- remove the nested Git history from this copied upstream snapshot
- formalize auth strategy for Shopify CLI versus custom app tokens
- move reusable comparison logic into a shared library instead of CLI files
- add fixture-driven tests for every sync planner and verifier path
- add integration tests with mocked `shopify store execute` responses

## License

MIT.
