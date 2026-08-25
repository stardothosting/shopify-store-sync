# Testing

## What exists today

The tool now has lightweight automated tests for pure helper logic using Node's built-in test runner.

Run:

```bash
npm test
```

Current automated coverage includes:

- resource detection order in `sync:all`
- handle-based comparison behavior
- menu normalization and comparison behavior
- redirect comparison behavior
- portable metafield filtering rules
- product/variant metafield parity logic
- variant option key normalization

## What is not covered by automated tests yet

- live Shopify CLI execution
- GraphQL mutation payload correctness against a mocked schema
- pagination edge cases on large stores
- error handling for partial mutation failures
- inventory sync behavior after location access is granted
- menu remapping for every menu item type Shopify may return
- files, metaobjects, markets, policies, and future unsupported surfaces

## Current confidence model

Because most scripts are thin CLI wrappers around `shopify store execute`, confidence comes from three layers:

1. Unit tests for pure comparison and planning helpers
2. Dry-run inspection of each sync command
3. Post-sync verification from fresh audit snapshots

## Recommended next testing improvements

### Short term

- move more mapping helpers out of CLI entry points and into reusable modules
- add fixture-driven tests for menu remapping and redirect upsert planning
- add tests for progress/report formatting only if that output becomes part of a machine-consumed interface

### Medium term

- add mocked `execFileSync` integration tests for each CLI script
- add fixtures for source/destination audit directories and expected verification output
- formalize regression tests for skipped cases such as customer account menus and source-GID metafields

### Long term

- add sandbox integration tests against a disposable Shopify dev store
- prove auth/scope failure modes with explicit test fixtures and expected error messages

## Practical note

There is still no meaningful automated coverage around the legacy `index.js` / upstream token-based execution path. For the current agency workflow, the CLI-backed scripts are the tested and recommended path.
