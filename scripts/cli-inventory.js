/* eslint-env node */
/* global require, process, console */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const METAFIELD_OWNER_TYPES = [
  'SHOP',
  'PRODUCT',
  'PRODUCTVARIANT',
  'COLLECTION',
  'PAGE',
  'BLOG',
  'ARTICLE',
  'MARKET',
  'LOCATION',
  'CUSTOMER',
  'ORDER',
  'COMPANY',
  'COMPANY_LOCATION',
];

function parseArgs(argv) {
  const args = {
    store: null,
    outputDir: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--store') {
      args.store = argv[i + 1];
      i += 1;
    } else if (arg === '--output-dir') {
      args.outputDir = argv[i + 1];
      i += 1;
    }
  }

  if (!args.store) {
    throw new Error('Missing required --store argument.');
  }

  return args;
}

function sanitizeStoreName(store) {
  return store.replace(/[^a-z0-9.-]+/gi, '-');
}

function sanitizeTimestamp(timestamp) {
  return timestamp.replace(/[:.]/g, '-');
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function executeStoreQuery(store, query) {
  const outputFile = path.join(
    os.tmpdir(),
    `shopify-cli-inventory-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
  );

  try {
    execFileSync(
      'shopify',
      [
        'store',
        'execute',
        '--store',
        store,
        '--json',
        '--query',
        query,
        '--output-file',
        outputFile,
      ],
      {
        stdio: 'pipe',
        encoding: 'utf8',
      }
    );

    return JSON.parse(fs.readFileSync(outputFile, 'utf8'));
  } finally {
    if (fs.existsSync(outputFile)) {
      fs.unlinkSync(outputFile);
    }
  }
}

function safeQuery(store, name, query) {
  try {
    return {
      name,
      ok: true,
      data: executeStoreQuery(store, query),
    };
  } catch (error) {
    return {
      name,
      ok: false,
      error: error.message,
    };
  }
}

function nodeCount(connection) {
  return Array.isArray(connection?.nodes) ? connection.nodes.length : 0;
}

function countValue(countObject) {
  if (typeof countObject?.count === 'number') {
    return countObject.count;
  }
  return null;
}

function buildMetafieldDefinitionsQuery() {
  const aliases = METAFIELD_OWNER_TYPES.map((ownerType) => {
    const alias = ownerType.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    return `${alias}: metafieldDefinitions(first: 100, ownerType: ${ownerType}) {
      nodes {
        id
        namespace
        key
        name
        type {
          name
        }
        ownerType
        pinnedPosition
        validations {
          name
          value
        }
      }
    }`;
  });

  return `query MetafieldDefinitions {
    ownerTypes: __type(name: "MetafieldOwnerType") {
      enumValues {
        name
      }
    }
    ${aliases.join('\n    ')}
  }`;
}

function buildQueries() {
  return [
    {
      name: 'shop-context',
      query: `query ShopContext {
        shop {
          id
          name
          myshopifyDomain
          primaryDomain {
            url
            host
          }
          currencyCode
          ianaTimezone
          timezoneAbbreviation
          weightUnit
          taxesIncluded
          plan {
            displayName
            partnerDevelopment
          }
        }
      }`,
    },
    {
      name: 'shop-locales',
      query: `query ShopLocales {
        shopLocales {
          locale
          name
          primary
          published
        }
        availableLocales {
          isoCode
          name
        }
      }`,
    },
    {
      name: 'core-counts',
      query: `query CoreCounts {
        productsCount {
          count
          precision
        }
        productVariantsCount {
          count
          precision
        }
        collectionsCount {
          count
          precision
        }
        pagesCount {
          count
          precision
        }
        blogsCount {
          count
          precision
        }
        urlRedirectsCount {
          count
          precision
        }
        files(first: 1) {
          nodes {
            id
          }
        }
      }`,
    },
    {
      name: 'metafield-definitions',
      query: buildMetafieldDefinitionsQuery(),
    },
    {
      name: 'metaobject-definitions',
      query: `query MetaobjectDefinitions {
        metaobjectDefinitions(first: 100) {
          nodes {
            id
            type
            name
            fieldDefinitions {
              key
              name
              required
              type {
                name
              }
            }
          }
        }
      }`,
    },
    {
      name: 'menus',
      query: `query Menus {
        menus(first: 100) {
          nodes {
            id
            handle
            title
            items {
              id
              title
              type
              url
              resourceId
              items {
                id
                title
                type
                url
                resourceId
              }
            }
          }
        }
      }`,
    },
    {
      name: 'url-redirects',
      query: `query UrlRedirects {
        urlRedirects(first: 100) {
          nodes {
            id
            path
            target
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }`,
    },
    {
      name: 'files',
      query: `query Files {
        files(first: 100) {
          nodes {
            id
            alt
            createdAt
            fileStatus
            preview {
              image {
                url
              }
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }`,
    },
    {
      name: 'policies',
      query: `query Policies {
        privacySettings {
          privacyPolicy {
            autoManaged
          }
        }
        onlineStore {
          passwordProtection {
            enabled
          }
        }
      }`,
    },
    {
      name: 'markets',
      query: `query Markets {
        markets(first: 100) {
          nodes {
            id
            name
            handle
            status
            primary
            webPresence {
              defaultLocale {
                locale
                name
              }
              alternateLocales {
                locale
                name
              }
            }
          }
        }
      }`,
    },
    {
      name: 'publications',
      query: `query Publications {
        publications(first: 100) {
          nodes {
            id
            name
            supportsFuturePublishing
          }
        }
      }`,
    },
    {
      name: 'locations',
      query: `query Locations {
        locations(first: 100) {
          nodes {
            id
            name
            isActive
            shipsInventory
            fulfillsOnlineOrders
            address {
              country
              province
              city
            }
          }
        }
      }`,
    },
    {
      name: 'discounts-gift-cards',
      query: `query DiscountsAndGiftCards {
        discountNodesCount {
          count
          precision
        }
        discountNodes(first: 20) {
          nodes {
            id
            discount {
              __typename
              ... on DiscountCodeBasic {
                title
                status
                startsAt
                endsAt
              }
              ... on DiscountAutomaticBasic {
                title
                status
                startsAt
                endsAt
              }
              ... on DiscountCodeBxgy {
                title
                status
                startsAt
                endsAt
              }
              ... on DiscountAutomaticBxgy {
                title
                status
                startsAt
                endsAt
              }
            }
          }
        }
        giftCardConfiguration {
          issueLimit {
            amount
            currencyCode
          }
          purchaseLimit {
            amount
            currencyCode
          }
          expirationConfiguration {
            expirationUnit
            expirationValue
          }
        }
        giftCardsCount {
          count
          precision
        }
      }`,
    },
    {
      name: 'apps',
      query: `query Apps {
        appInstallations(first: 100) {
          nodes {
            id
            launchUrl
            app {
              id
              title
              handle
            }
          }
        }
      }`,
    },
    {
      name: 'selling-plans',
      query: `query SellingPlans {
        sellingPlanGroups(first: 100) {
          nodes {
            id
            name
            appId
            merchantCode
          }
        }
      }`,
    },
  ];
}

function extractMetafieldDefinitionCounts(data) {
  if (!data) {
    return {};
  }

  return METAFIELD_OWNER_TYPES.reduce((counts, ownerType) => {
    const alias = ownerType.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    counts[ownerType] = nodeCount(data[alias]);
    return counts;
  }, {});
}

function hasPolicy(policy) {
  return !!(policy?.body || policy?.url || policy?.title || typeof policy?.autoManaged === 'boolean');
}

function blockedByFailedProbe(surface, failedProbeNames) {
  const dependencies = {
    products: ['core-counts'],
    'product-metafields': ['metafield-definitions'],
    'variant-metafields': ['metafield-definitions'],
    collections: ['core-counts'],
    menus: ['menus'],
    pages: ['core-counts'],
    'blogs-articles': ['core-counts'],
    redirects: ['url-redirects'],
    files: ['files'],
    metaobjects: ['metaobject-definitions'],
    'shop-metafields': ['metafield-definitions'],
    policies: ['policies'],
    'markets-locales-currency': ['markets', 'shop-locales'],
    publications: ['publications'],
    'locations-inventory': ['locations'],
    discounts: ['discounts-gift-cards'],
    'gift-cards': ['discounts-gift-cards'],
    apps: ['apps'],
    'selling-plans': ['selling-plans'],
  };

  return (dependencies[surface.resource] || []).filter((probeName) => failedProbeNames.has(probeName));
}

function applyAuditStatus(surfaces, results) {
  const failedProbeNames = new Set(results.filter((result) => !result.ok).map((result) => result.name));

  return surfaces.map((surface) => {
    const blockedBy = blockedByFailedProbe(surface, failedProbeNames);
    if (blockedBy.length === 0) {
      return {
        ...surface,
        auditStatus: 'audited',
      };
    }

    return {
      ...surface,
      auditStatus: 'unknown',
      usedBySource: null,
      sourceCount: null,
      blockedBy,
      reason: `${surface.reason} Inventory probe was blocked or failed, so source usage is unknown.`,
    };
  });
}

function classifyCoverage(results) {
  const resultMap = new Map(results.map((result) => [result.name, result]));
  const coreCounts = resultMap.get('core-counts')?.data || {};
  const metafieldDefinitions = resultMap.get('metafield-definitions')?.data || {};
  const definitionCounts = extractMetafieldDefinitionCounts(metafieldDefinitions);
  const metaobjectDefinitions = resultMap.get('metaobject-definitions')?.data?.metaobjectDefinitions;
  const menus = resultMap.get('menus')?.data?.menus;
  const redirects = resultMap.get('url-redirects')?.data?.urlRedirects;
  const files = resultMap.get('files')?.data?.files;
  const policies = resultMap.get('policies')?.data?.privacySettings || {};
  const markets = resultMap.get('markets')?.data?.markets;
  const publications = resultMap.get('publications')?.data?.publications;
  const locations = resultMap.get('locations')?.data?.locations;
  const discounts = resultMap.get('discounts-gift-cards')?.data || {};
  const apps = resultMap.get('apps')?.data?.appInstallations;
  const sellingPlans = resultMap.get('selling-plans')?.data?.sellingPlanGroups;

  const surfaces = [
    {
      resource: 'products',
      usedBySource: countValue(coreCounts.productsCount) > 0,
      sourceCount: countValue(coreCounts.productsCount),
      themeRelevance: 'critical',
      recommendation: 'sync-and-verify',
      currentCliSupport: 'partial',
      reason: 'Product cards, product pages, collection grids, and search depend on product data.',
    },
    {
      resource: 'product-metafields',
      usedBySource: definitionCounts.PRODUCT > 0,
      sourceCount: definitionCounts.PRODUCT,
      themeRelevance: 'critical',
      recommendation: 'sync-and-verify',
      currentCliSupport: 'missing',
      reason: 'Custom product fields are commonly rendered as specifications or merchandising badges.',
    },
    {
      resource: 'variant-metafields',
      usedBySource: definitionCounts.PRODUCTVARIANT > 0,
      sourceCount: definitionCounts.PRODUCTVARIANT,
      themeRelevance: 'important',
      recommendation: 'audit-then-sync-if-visible',
      currentCliSupport: 'missing',
      reason: 'Variant custom fields can affect variant selectors, feeds, and storefront metadata.',
    },
    {
      resource: 'collections',
      usedBySource: countValue(coreCounts.collectionsCount) > 0,
      sourceCount: countValue(coreCounts.collectionsCount),
      themeRelevance: 'critical',
      recommendation: 'sync-and-verify',
      currentCliSupport: 'partial',
      reason: 'Collection pages, nav, filters, and merchandising depend on collection structure.',
    },
    {
      resource: 'menus',
      usedBySource: nodeCount(menus) > 0,
      sourceCount: nodeCount(menus),
      themeRelevance: 'critical',
      recommendation: 'sync-and-verify',
      currentCliSupport: 'missing',
      reason: 'Header, footer, mobile nav, and mega-menu behavior depend on menus.',
    },
    {
      resource: 'pages',
      usedBySource: countValue(coreCounts.pagesCount) > 0,
      sourceCount: countValue(coreCounts.pagesCount),
      themeRelevance: 'important',
      recommendation: 'sync-and-verify',
      currentCliSupport: 'supported',
      reason: 'Static pages are needed for footer links, policy-adjacent content, and client review.',
    },
    {
      resource: 'blogs-articles',
      usedBySource: countValue(coreCounts.blogsCount) > 0,
      sourceCount: countValue(coreCounts.blogsCount),
      themeRelevance: 'conditional',
      recommendation: 'sync-if-used',
      currentCliSupport: 'supported',
      reason: 'Blog templates matter only if editorial content is part of the storefront.',
    },
    {
      resource: 'redirects',
      usedBySource: countValue(coreCounts.urlRedirectsCount) > 0,
      sourceCount: countValue(coreCounts.urlRedirectsCount),
      themeRelevance: 'launch-critical',
      recommendation: 'audit-and-plan-launch-sync',
      currentCliSupport: 'missing',
      reason: 'Redirects protect URL continuity when launching redesigned navigation and URLs.',
    },
    {
      resource: 'files',
      usedBySource: nodeCount(files) > 0,
      sourceCount: nodeCount(files),
      themeRelevance: 'important',
      recommendation: 'audit-references-then-sync-needed-assets',
      currentCliSupport: 'partial',
      reason: 'Files can be referenced by pages, metafields, metaobjects, and app content.',
    },
    {
      resource: 'metaobjects',
      usedBySource: nodeCount(metaobjectDefinitions) > 0,
      sourceCount: nodeCount(metaobjectDefinitions),
      themeRelevance: 'critical-if-used',
      recommendation: 'sync-and-verify-if-used',
      currentCliSupport: 'missing',
      reason: 'Metaobjects often drive custom theme sections and structured content.',
    },
    {
      resource: 'shop-metafields',
      usedBySource: definitionCounts.SHOP > 0,
      sourceCount: definitionCounts.SHOP,
      themeRelevance: 'important',
      recommendation: 'audit-then-sync-if-visible',
      currentCliSupport: 'missing-in-cli',
      reason: 'Shop metafields can hold global storefront settings or app configuration.',
    },
    {
      resource: 'policies',
      usedBySource: hasPolicy(policies.privacyPolicy),
      sourceCount: [policies.privacyPolicy].filter(hasPolicy).length,
      themeRelevance: 'important',
      recommendation: 'audit-and-recreate-if-linked',
      currentCliSupport: 'missing',
      reason: 'Policy pages influence footer, checkout trust, and client demo completeness.',
    },
    {
      resource: 'markets-locales-currency',
      usedBySource: nodeCount(markets) > 0,
      sourceCount: nodeCount(markets),
      themeRelevance: 'critical-for-demo',
      recommendation: 'audit-and-align-dev-store',
      currentCliSupport: 'missing',
      reason: 'Canadian currency, locale, and market assumptions affect demo credibility.',
    },
    {
      resource: 'publications',
      usedBySource: nodeCount(publications) > 0,
      sourceCount: nodeCount(publications),
      themeRelevance: 'important',
      recommendation: 'audit-before-launch',
      currentCliSupport: 'missing',
      reason: 'Publication state controls which resources are visible in storefront channels.',
    },
    {
      resource: 'locations-inventory',
      usedBySource: nodeCount(locations) > 0,
      sourceCount: nodeCount(locations),
      themeRelevance: 'conditional',
      recommendation: 'audit-and-sync-only-if-storefront-visible',
      currentCliSupport: 'partial',
      reason: 'Locations and inventory matter if pickup, stock messaging, or sellability are shown.',
    },
    {
      resource: 'discounts',
      usedBySource: countValue(discounts.discountNodesCount) > 0,
      sourceCount: countValue(discounts.discountNodesCount),
      themeRelevance: 'demo-relevant',
      recommendation: 'audit-and-create-safe-test-discounts',
      currentCliSupport: 'missing',
      reason: 'Discount UX should be demoable, but real active codes should not be blindly cloned.',
    },
    {
      resource: 'gift-cards',
      usedBySource: !!discounts.giftCardConfiguration || countValue(discounts.giftCardsCount) > 0,
      sourceCount: countValue(discounts.giftCardsCount),
      themeRelevance: 'demo-relevant-if-sold',
      recommendation: 'audit-and-create-safe-test-gift-card-product-if-needed',
      currentCliSupport: 'missing',
      reason: 'Gift card purchase/design can matter, but balances and liabilities should not be cloned.',
    },
    {
      resource: 'apps',
      usedBySource: nodeCount(apps) > 0,
      sourceCount: nodeCount(apps),
      themeRelevance: 'critical-if-storefront-app',
      recommendation: 'manual-review',
      currentCliSupport: 'missing',
      reason: 'App-owned storefront widgets, filters, reviews, and metafields may need manual setup.',
    },
    {
      resource: 'selling-plans',
      usedBySource: nodeCount(sellingPlans) > 0,
      sourceCount: nodeCount(sellingPlans),
      themeRelevance: 'critical-if-used',
      recommendation: 'sync-or-simulate-if-used',
      currentCliSupport: 'missing',
      reason: 'Subscription UX affects product pages, cart, and price display if present.',
    },
  ];

  return {
    generatedAt: new Date().toISOString(),
    surfaces: applyAuditStatus(surfaces, results),
    failedProbes: results
      .filter((result) => !result.ok)
      .map((result) => ({
        resource: result.name,
        error: result.error,
      })),
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const generatedAt = new Date().toISOString();
  const outputDir =
    args.outputDir ||
    path.resolve(
      process.cwd(),
      'audit',
      sanitizeStoreName(args.store),
      'inventory',
      sanitizeTimestamp(generatedAt)
    );
  const resourcesDir = path.join(outputDir, 'resources');

  ensureDir(resourcesDir);

  const results = buildQueries().map((probe) => {
    console.log(`Auditing ${probe.name}...`);
    const result = safeQuery(args.store, probe.name, probe.query);
    writeJson(path.join(resourcesDir, `${probe.name}.json`), result);
    return result;
  });

  const coverage = classifyCoverage(results);
  const inventory = {
    generatedAt,
    store: args.store,
    outputDir,
    probes: results.map((result) => ({
      name: result.name,
      ok: result.ok,
      error: result.error || null,
    })),
    coverageSummary: coverage.surfaces.reduce(
      (summary, surface) => {
        if (surface.auditStatus === 'unknown') {
          summary.unknown += 1;
        }
        if (surface.usedBySource) {
          summary.used += 1;
        }
        if (surface.currentCliSupport === 'missing' || surface.currentCliSupport === 'missing-in-cli') {
          summary.missingSupport += 1;
        }
        if (surface.recommendation.includes('sync')) {
          summary.syncRelevant += 1;
        }
        return summary;
      },
      {
        used: 0,
        unknown: 0,
        missingSupport: 0,
        syncRelevant: 0,
        total: coverage.surfaces.length,
      }
    ),
  };

  writeJson(path.join(outputDir, 'inventory.json'), inventory);
  writeJson(path.join(outputDir, 'coverage.json'), coverage);

  console.log(`Inventory written to ${outputDir}`);
  console.log(JSON.stringify(inventory.coverageSummary, null, 2));
}

main();
