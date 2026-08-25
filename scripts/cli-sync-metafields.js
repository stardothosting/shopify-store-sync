/* eslint-env node */
/* global require, process, console */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const BATCH_SIZE = 25;

function parseArgs(argv) {
  const args = {
    source: null,
    destination: null,
    live: false,
    limit: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--source') {
      args.source = argv[i + 1];
      i += 1;
    } else if (arg === '--destination') {
      args.destination = argv[i + 1];
      i += 1;
    } else if (arg === '--live') {
      args.live = true;
    } else if (arg === '--limit') {
      args.limit = parseInt(argv[i + 1], 10);
      i += 1;
    }
  }

  if (!args.source || !args.destination) {
    throw new Error('Missing required --source and/or --destination arguments.');
  }

  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function formatDuration(milliseconds) {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

function renderProgressBar(current, total) {
  const safeTotal = Math.max(total, 1);
  const percent = current / safeTotal;
  const width = 20;
  const filled = Math.round(percent * width);
  return `[${'#'.repeat(filled)}${'-'.repeat(width - filled)}]`;
}

function logProgress(label, current, total, latestHandle, startedAt) {
  const elapsed = Date.now() - startedAt;
  const eta =
    current > 0 && current < total ? Math.round((elapsed / current) * (total - current)) : 0;
  const percent = ((current / Math.max(total, 1)) * 100).toFixed(1);
  const suffix = latestHandle ? ` latest=${latestHandle}` : '';
  console.log(
    `${label} ${renderProgressBar(current, total)} ${current}/${total} ${percent}% elapsed=${formatDuration(elapsed)} eta=${formatDuration(eta)}${suffix}`
  );
}

function executeStoreCommand(store, query, variables, allowMutations) {
  const outputFile = path.join(
    os.tmpdir(),
    `shopify-cli-metafield-sync-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
  );

  const command = [
    'store',
    'execute',
    '--store',
    store,
    '--json',
    '--query',
    query,
    '--output-file',
    outputFile,
  ];

  if (variables) {
    command.push('--variables', JSON.stringify(variables));
  }

  if (allowMutations) {
    command.push('--allow-mutations');
  }

  try {
    execFileSync('shopify', command, {
      stdio: 'pipe',
      encoding: 'utf8',
    });

    return JSON.parse(fs.readFileSync(outputFile, 'utf8'));
  } finally {
    if (fs.existsSync(outputFile)) {
      fs.unlinkSync(outputFile);
    }
  }
}

function executeStoreQuery(store, query) {
  return executeStoreCommand(store, query, null, false);
}

function executeStoreMutation(store, query, variables) {
  return executeStoreCommand(store, query, variables, true);
}

function selectedOptionsKey(selectedOptions) {
  return (selectedOptions || [])
    .map((option) => `${option.name}:${option.value}`)
    .sort()
    .join('|');
}

function variantKey(variant) {
  if (variant.sku) {
    return `sku:${variant.sku}`;
  }

  const optionsKey = selectedOptionsKey(variant.selectedOptions);
  return optionsKey ? `options:${optionsKey}` : `title:${variant.title}`;
}

function buildProductMap(products) {
  const map = new Map();
  products.forEach((product) => {
    if (!product.handle) {
      return;
    }

    map.set(product.handle, {
      ...product,
      variantsByKey: new Map((product.variants?.nodes || []).map((variant) => [variantKey(variant), variant])),
    });
  });
  return map;
}

function fetchDestinationProducts(store) {
  const products = [];
  let cursor = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const afterClause = cursor ? `, after: ${JSON.stringify(cursor)}` : '';
    const response = executeStoreQuery(
      store,
      `query {
        products(first: 100${afterClause}) {
          nodes {
            id
            handle
            variants(first: 100) {
              nodes {
                id
                title
                sku
                selectedOptions {
                  name
                  value
                }
              }
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }`
    );

    response.products.nodes.forEach((product) => products.push(product));
    hasNextPage = response.products.pageInfo.hasNextPage;
    cursor = response.products.pageInfo.endCursor;
  }

  return products;
}

function isPortableMetafield(metafield) {
  if (!metafield?.namespace || !metafield.key || !metafield.type) {
    return {
      ok: false,
      reason: 'missing-required-fields',
    };
  }

  if (typeof metafield.value !== 'string' || metafield.value.length === 0) {
    return {
      ok: false,
      reason: 'empty-value',
    };
  }

  if (metafield.namespace.startsWith('app--')) {
    return {
      ok: false,
      reason: 'app-owned-namespace',
    };
  }

  if (metafield.value.includes('gid://shopify/')) {
    return {
      ok: false,
      reason: 'source-gid-reference',
    };
  }

  return {
    ok: true,
    reason: null,
  };
}

function toMetafieldsSetInput(ownerId, metafield) {
  return {
    ownerId,
    namespace: metafield.namespace,
    key: metafield.key,
    type: metafield.type,
    value: metafield.value,
  };
}

function incrementCounter(counters, key) {
  counters[key] = (counters[key] || 0) + 1;
}

function collectMetafields(sourceProducts, destinationMap) {
  const entries = [];
  const skipped = {};
  const missingProducts = [];
  const missingVariants = [];

  sourceProducts.forEach((sourceProduct) => {
    const destinationProduct = destinationMap.get(sourceProduct.handle);
    if (!destinationProduct) {
      missingProducts.push(sourceProduct.handle);
      return;
    }

    (sourceProduct.metafields?.nodes || []).forEach((metafield) => {
      const portability = isPortableMetafield(metafield);
      if (!portability.ok) {
        incrementCounter(skipped, `product:${portability.reason}`);
        return;
      }

      entries.push({
        ownerType: 'product',
        productHandle: sourceProduct.handle,
        key: `${metafield.namespace}.${metafield.key}`,
        input: toMetafieldsSetInput(destinationProduct.id, metafield),
      });
    });

    (sourceProduct.variants?.nodes || []).forEach((sourceVariant) => {
      const destinationVariant = destinationProduct.variantsByKey.get(variantKey(sourceVariant));
      if (!destinationVariant) {
        missingVariants.push({
          productHandle: sourceProduct.handle,
          variant: variantKey(sourceVariant),
        });
        return;
      }

      (sourceVariant.metafields?.nodes || []).forEach((metafield) => {
        const portability = isPortableMetafield(metafield);
        if (!portability.ok) {
          incrementCounter(skipped, `variant:${portability.reason}`);
          return;
        }

        entries.push({
          ownerType: 'variant',
          productHandle: sourceProduct.handle,
          variant: variantKey(sourceVariant),
          key: `${metafield.namespace}.${metafield.key}`,
          input: toMetafieldsSetInput(destinationVariant.id, metafield),
        });
      });
    });
  });

  return {
    entries,
    skipped,
    missingProducts,
    missingVariants,
  };
}

function chunks(items, size) {
  const grouped = [];
  for (let i = 0; i < items.length; i += size) {
    grouped.push(items.slice(i, i + size));
  }
  return grouped;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const sourceDir = path.resolve(args.source);
  const destinationStore = args.destination;
  const allSourceProducts = readJson(path.join(sourceDir, 'products.json'));
  const sourceProducts =
    typeof args.limit === 'number' ? allSourceProducts.slice(0, args.limit) : allSourceProducts;
  const destinationProducts = fetchDestinationProducts(destinationStore);
  const destinationMap = buildProductMap(destinationProducts);
  const collected = collectMetafields(sourceProducts, destinationMap);

  if (!args.live) {
    console.log(
      JSON.stringify(
        {
          mode: 'dry-run',
          destinationStore,
          sourceProducts: sourceProducts.length,
          metafieldsToSet: collected.entries.length,
          productMetafields: collected.entries.filter((entry) => entry.ownerType === 'product').length,
          variantMetafields: collected.entries.filter((entry) => entry.ownerType === 'variant').length,
          skipped: collected.skipped,
          missingProducts: collected.missingProducts.slice(0, 10),
          missingVariants: collected.missingVariants.slice(0, 10),
          sample: collected.entries.slice(0, 10).map((entry) => ({
            ownerType: entry.ownerType,
            productHandle: entry.productHandle,
            variant: entry.variant || null,
            key: entry.key,
          })),
        },
        null,
        2
      )
    );
    return;
  }

  const query = `
    mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields {
          id
          namespace
          key
          ownerType
        }
        userErrors {
          field
          message
          code
        }
      }
    }
  `;

  const batches = chunks(collected.entries, BATCH_SIZE);
  const startedAt = Date.now();
  let setCount = 0;
  logProgress('metafields', 0, batches.length, null, startedAt);

  batches.forEach((batch, index) => {
    const response = executeStoreMutation(destinationStore, query, {
      metafields: batch.map((entry) => entry.input),
    });

    const result = response.metafieldsSet;
    if (result.userErrors && result.userErrors.length > 0) {
      throw new Error(`Failed to set metafields: ${JSON.stringify(result.userErrors)}`);
    }

    setCount += result.metafields.length;
    logProgress(
      'metafields',
      index + 1,
      batches.length,
      batch[batch.length - 1]?.productHandle,
      startedAt
    );
  });

  console.log(
    JSON.stringify(
      {
        mode: 'live',
        destinationStore,
        sourceProducts: sourceProducts.length,
        setCount,
        skipped: collected.skipped,
        missingProducts: collected.missingProducts,
        missingVariants: collected.missingVariants,
      },
      null,
      2
    )
  );
}

main();
