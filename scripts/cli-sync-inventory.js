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

function executeStoreCommand(store, query, variables, allowMutations) {
  const outputFile = path.join(
    os.tmpdir(),
    `shopify-cli-inventory-sync-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
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

function fetchPrimaryLocation(store) {
  const response = executeStoreQuery(
    store,
    `query {
      locations(first: 1) {
        nodes {
          id
          name
        }
      }
    }`
  );

  const location = response.locations.nodes[0];
  if (!location) {
    throw new Error('Destination store has no location for inventory sync.');
  }

  return location;
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
            handle
            variants(first: 100) {
              nodes {
                title
                sku
                inventoryQuantity
                selectedOptions {
                  name
                  value
                }
                inventoryItem {
                  id
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

function collectQuantityUpdates(sourceProducts, destinationMap, locationId) {
  const updates = [];
  const missingProducts = [];
  const missingVariants = [];

  sourceProducts.forEach((sourceProduct) => {
    const destinationProduct = destinationMap.get(sourceProduct.handle);
    if (!destinationProduct) {
      missingProducts.push(sourceProduct.handle);
      return;
    }

    (sourceProduct.variants?.nodes || []).forEach((sourceVariant) => {
      if (typeof sourceVariant.inventoryQuantity !== 'number') {
        return;
      }

      const destinationVariant = destinationProduct.variantsByKey.get(variantKey(sourceVariant));
      if (!destinationVariant) {
        missingVariants.push({
          productHandle: sourceProduct.handle,
          variant: variantKey(sourceVariant),
        });
        return;
      }

      if (sourceVariant.inventoryQuantity === destinationVariant.inventoryQuantity) {
        return;
      }

      updates.push({
        productHandle: sourceProduct.handle,
        variant: variantKey(sourceVariant),
        sourceQuantity: sourceVariant.inventoryQuantity,
        destinationQuantity: destinationVariant.inventoryQuantity,
        quantity: {
          inventoryItemId: destinationVariant.inventoryItem.id,
          locationId,
          quantity: sourceVariant.inventoryQuantity,
        },
      });
    });
  });

  return {
    updates,
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
  const location = fetchPrimaryLocation(destinationStore);
  const destinationProducts = fetchDestinationProducts(destinationStore);
  const destinationMap = buildProductMap(destinationProducts);
  const collected = collectQuantityUpdates(sourceProducts, destinationMap, location.id);

  if (!args.live) {
    console.log(
      JSON.stringify(
        {
          mode: 'dry-run',
          destinationStore,
          destinationLocation: location,
          sourceProducts: sourceProducts.length,
          updatesToApply: collected.updates.length,
          missingProducts: collected.missingProducts.slice(0, 10),
          missingVariants: collected.missingVariants.slice(0, 10),
          sample: collected.updates.slice(0, 10).map((update) => ({
            productHandle: update.productHandle,
            variant: update.variant,
            sourceQuantity: update.sourceQuantity,
            destinationQuantity: update.destinationQuantity,
          })),
        },
        null,
        2
      )
    );
    return;
  }

  const query = `
    mutation InventorySetQuantities($input: InventorySetQuantitiesInput!) {
      inventorySetQuantities(input: $input) {
        inventoryAdjustmentGroup {
          createdAt
          reason
        }
        userErrors {
          field
          message
          code
        }
      }
    }
  `;
  const batches = chunks(collected.updates, BATCH_SIZE);
  batches.forEach((batch) => {
    const response = executeStoreMutation(destinationStore, query, {
      input: {
        name: 'available',
        reason: 'correction',
        referenceDocumentUri: 'gid://shopify/ShopifyStoreSync/InventoryParity',
        quantities: batch.map((update) => update.quantity),
      },
    });

    const result = response.inventorySetQuantities;
    if (result.userErrors && result.userErrors.length > 0) {
      throw new Error(`Failed to sync inventory quantities: ${JSON.stringify(result.userErrors)}`);
    }
  });

  console.log(
    JSON.stringify(
      {
        mode: 'live',
        destinationStore,
        destinationLocation: location,
        updatedCount: collected.updates.length,
        missingProducts: collected.missingProducts,
        missingVariants: collected.missingVariants,
      },
      null,
      2
    )
  );
}

main();
