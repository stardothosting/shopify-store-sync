# Agency Workflow

## Goal

Use a client store as a read-only content source, recreate the storefront-relevant content in an agency-owned dev store, and verify that the dev store is sufficient for theme customization and stakeholder review.

## Non-goals

- writing to the source client store
- migrating orders, customers, or other private transactional records
- copying generic admin configuration that does not affect storefront implementation
- treating the dev store as an operational replacement for the live store

## Standard operating procedure

### 1. Inventory first

Run:

```bash
npm run audit:inventory -- --store <source-store>
```

Use the result to answer:

- what theme-relevant surfaces exist
- which surfaces are used by the source store
- which surfaces are already supported by this tool
- which surfaces remain unsupported or blocked by scope/schema limits

### 2. Export full audit snapshots

Run:

```bash
npm run audit:cli -- --store <source-store>
npm run audit:cli -- --store <destination-store>
```

These snapshots become the source of truth for planning, sync, and verification.

### 3. Plan before writing

Run:

```bash
npm run plan:cli -- --source audit/<source-store> --destination audit/<destination-store>
```

This shows what appears missing on the destination by handle-based comparison.

### 4. Dry-run every new surface first

Before the first live run for a new command or a new client store, run the sync without `--live`.

Examples:

```bash
npm run sync:products -- --source audit/<source-store> --destination <destination-store>
npm run sync:menus -- --source audit/<source-store> --destination <destination-store>
```

Review the payload summary and only proceed if the mapping behavior makes sense.

### 5. Live-sync only to the dev store

Examples:

```bash
npm run sync:products -- --source audit/<source-store> --destination <destination-store> --live
npm run sync:all -- --all --source audit/<source-store> --destination <destination-store> --live
```

### 6. Refresh the destination audit and verify

Run:

```bash
npm run audit:cli -- --store <destination-store>
npm run verify -- --source audit/<source-store> --destination audit/<destination-store>
```

Verification should be considered mandatory after live sync.

## Safe defaults

- source store remains read-only
- dev store is the only write target
- `sync:all` includes only verified, dependable surfaces
- risky or scope-blocked surfaces stay manual until proven safe

## Current manual or blocked areas

- inventory quantity parity requires `locations` access
- customer account menus are store-specific and intentionally skipped
- source-GID-based metafields are intentionally skipped unless a remapping strategy exists
- files, metaobjects, markets, publications, policies, and theme settings remain future work
