# Coverage Status

## Covered end-to-end today

The following surfaces have all four pieces in place for the current workflow:

- audited
- syncable
- re-verifiable from saved JSON
- validated in Encore against the dev store

Covered surfaces:

- products
- collections
- pages
- blogs
- articles
- portable product metafields
- portable variant metafields
- storefront menus
- URL redirects

## Partially covered

### Inventory quantities

Status:

- source quantities are present in `products.json`
- a dedicated sync script exists
- parity can be checked manually from audit data
- live sync is blocked by missing Shopify `locations` access for the current auth path

Decision:

- keep the script in the repo
- keep it out of `sync:all`
- document it as scope-gated

### Customer account menu

Status:

- audited
- detected during menu sync
- intentionally skipped during live sync

Reason:

- menu items reference store-specific customer account resources

## Audited but not yet syncable

- files library
- metaobject definitions and entries
- policy content
- market configuration
- publication configuration
- selling plan data
- app-installed custom data that cannot be safely remapped automatically

## Verification scope today

`npm run verify` currently checks:

- handle presence for products, collections, pages, blogs, and articles
- type/value parity for portable product and variant metafields
- normalized storefront menu parity
- redirect `path` and `target` parity

It does not yet verify:

- media/file parity
- inventory quantities
- metaobjects
- policies
- market/localization behavior
- theme settings or customized theme code

## Encore-specific result snapshot

Current verified Encore outcome:

- products: source count present on destination
- collections: source handles present on destination
- pages: source handles present on destination
- blogs/articles: parity confirmed for current audited data
- portable metafields: synced and verified
- storefront menus: synced and verified, excluding the customer account menu
- redirects: synced and verified

## Recommended next implementation priorities

1. Files library export and sync
2. Metaobject definitions and entries
3. Better scope/error reporting around blocked Shopify surfaces
4. Inventory parity once auth includes `locations`
5. Fixture-based integration-style tests for sync planners
