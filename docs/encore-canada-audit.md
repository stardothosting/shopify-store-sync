# Encore Canada Audit Baseline

## Safety posture

- Source store is read-only for this phase.
- Destination store is the only store that should ever receive writes from this tool.
- Live source writes are out of scope until explicitly approved, which is not expected for this project.

## Stores

### Source store

- Domain: `encore-food-service.myshopify.com`
- Shop name: `Encore Canada`
- Primary domain: `https://encorecanada.com`
- Current themes:
  - `Athens` (`live`)
  - `Dawn` (`unpublished`)

### Destination dev store

- Domain: `shift8-encorecanada.myshopify.com`
- Shop name: `shift8-encorecanada`
- Primary domain: `https://shift8-encorecanada.myshopify.com`
- Current themes:
  - `Horizon` (`live`)

## Source counts observed through read-only GraphQL

- Products: `410`
- Collections: `17`
- Pages: `8`
- Blogs: `1`
- Articles: `0`
- Menus: `9`
- Redirects: `1`

## Sample source content observed

### Products

- `7in-round-aluminum-containers-heavy-weight-silver`
- `7in-round-plastic-dome-lids-for-aluminum-containers-clear`
- `8in-round-aluminum-containers-heavy-weight-silver`

### Collections

- `cups`
- `bags`
- `cutlery`

### Pages

- `contact-us`
- `about-us`
- `faqs`

### Blogs

- `news`

### Redirects

- `/pages/contact` -> `/pages/contact-us`

## Current verified destination outcome

The current dev store audit and verification report confirm parity for the implemented surfaces:

- all source product handles exist on destination
- all source collection handles exist on destination
- all source page handles exist on destination
- current blog/article counts are aligned for audited data
- portable product and variant metafields are synced and verified
- storefront menus are synced and verified
- URL redirects are synced and verified

Intentional exclusions:

- `customer-account-main-menu`
- 2 source-GID-referencing metafields

## Current blocker

Inventory quantities are not yet synced because the current Shopify CLI auth does not have access to `locations`, which Shopify requires before quantities can be set for a destination location.
