# Encore Canada Notes

## Safety rule

The live client store is source-of-truth data only during the initial phase.

- Read from the source store only.
- Do not create, update, or delete anything on the source store.
- The first real run must be `--audit --save-data`.
- Only the dev store should ever receive write operations from this tool.

## Current recommended workflow

1. Run `npm run audit:inventory -- --store encore-food-service.myshopify.com`.
2. Run `npm run audit:cli -- --store encore-food-service.myshopify.com`.
3. Run `npm run audit:cli -- --store shift8-encorecanada.myshopify.com`.
4. Run `npm run plan:cli -- --source audit/encore-food-service.myshopify.com --destination audit/shift8-encorecanada.myshopify.com`.
5. Dry-run new sync surfaces before the first live write.
6. Run `npm run sync:all -- --all --source audit/encore-food-service.myshopify.com --destination shift8-encorecanada.myshopify.com --live`.
7. Refresh the destination audit.
8. Run `npm run verify -- --source audit/encore-food-service.myshopify.com --destination audit/shift8-encorecanada.myshopify.com`.

## Verified Encore migration surfaces

- products
- collections
- pages
- blogs
- articles
- portable product metafields
- portable variant metafields
- storefront menus
- URL redirects

## Important intentional skips

- `customer-account-main-menu` is not synced because it references store-specific customer account resources.
- Metafields whose values contain source-store Shopify GIDs are skipped until a remapping strategy exists.

## Current open gaps

- files library export/sync
- metaobject definitions and entries
- policy content parity
- market/publication parity
- inventory quantity parity is blocked by missing `locations` access for the active Shopify auth
- stronger automated tests around the Shopify CLI wrapper scripts
