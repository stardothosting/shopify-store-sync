/* eslint-env node */
/* global require, process, console */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

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

function buildProductMap(items) {
  const map = new Map();
  items.forEach((item) => {
    if (item?.handle) {
      map.set(item.handle, item);
    }
  });
  return map;
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

function logCompletion(label, total, startedAt) {
  const elapsed = Date.now() - startedAt;
  const rate = total > 0 ? ((total / Math.max(elapsed, 1)) * 60000).toFixed(2) : '0.00';
  console.log(`${label} complete total=${total} elapsed=${formatDuration(elapsed)} rate=${rate}/min`);
}

function executeStoreCommand(store, query, variables, allowMutations) {
  const outputFile = path.join(
    os.tmpdir(),
    `shopify-cli-product-sync-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
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
            title
            handle
            totalVariants
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

function buildOptionInputs(options) {
  if (!Array.isArray(options) || options.length === 0) {
    return [];
  }

  return options.map((option) => ({
    name: option.name,
    position: option.position,
    values: (option.optionValues || []).map((value) => ({
      name: value.name,
    })),
  }));
}

function buildWeightInput(weight) {
  if (!weight || typeof weight.value !== 'number' || weight.value <= 0 || !weight.unit) {
    return null;
  }

  return {
    value: weight.value,
    unit: weight.unit,
  };
}

function buildInventoryItemInput(inventoryItem, sku) {
  if (!inventoryItem && !sku) {
    return null;
  }

  const input = {};
  if (sku) {
    input.sku = sku;
  }

  if (inventoryItem) {
    if (typeof inventoryItem.tracked === 'boolean') {
      input.tracked = inventoryItem.tracked;
    }
    if (typeof inventoryItem.requiresShipping === 'boolean') {
      input.requiresShipping = inventoryItem.requiresShipping;
    }
    if (inventoryItem.countryCodeOfOrigin) {
      input.countryCodeOfOrigin = inventoryItem.countryCodeOfOrigin;
    }
    if (inventoryItem.provinceCodeOfOrigin) {
      input.provinceCodeOfOrigin = inventoryItem.provinceCodeOfOrigin;
    }
    if (inventoryItem.harmonizedSystemCode) {
      input.harmonizedSystemCode = inventoryItem.harmonizedSystemCode;
    }

    const weight = buildWeightInput(inventoryItem.measurement?.weight);
    if (weight) {
      input.measurement = {
        weight,
      };
    }
  }

  return Object.keys(input).length > 0 ? input : null;
}

function buildVariantInputs(variants) {
  return (variants || []).map((variant, index) => {
    const input = {
      position: index + 1,
      optionValues: (variant.selectedOptions || []).map((option) => ({
        optionName: option.name,
        name: option.value,
      })),
      price: variant.price,
      taxable: !!variant.taxable,
      inventoryPolicy: variant.inventoryPolicy,
    };

    if (variant.sku) {
      input.sku = variant.sku;
    }
    if (variant.barcode) {
      input.barcode = variant.barcode;
    }
    if (variant.compareAtPrice) {
      input.compareAtPrice = variant.compareAtPrice;
    }

    const inventoryItem = buildInventoryItemInput(variant.inventoryItem, variant.sku);
    if (inventoryItem) {
      input.inventoryItem = inventoryItem;
    }

    return input;
  });
}

function buildFileInput(url, altText) {
  if (!url) {
    return null;
  }

  const filename = path.basename(new URL(url).pathname) || 'product-image';
  return {
    originalSource: url,
    contentType: 'IMAGE',
    filename,
    alt: altText || '',
  };
}

function buildFileInputs(product) {
  const files = [];
  const seen = new Set();

  (product.media?.nodes || []).forEach((mediaNode) => {
    if (mediaNode.mediaContentType !== 'IMAGE') {
      return;
    }

    const fileInput = buildFileInput(mediaNode.image?.url, mediaNode.alt);
    if (!fileInput || seen.has(fileInput.originalSource)) {
      return;
    }

    seen.add(fileInput.originalSource);
    files.push(fileInput);
  });

  return files;
}

function normalizeSeo(seo) {
  if (!seo || (!seo.title && !seo.description)) {
    return null;
  }

  return {
    title: seo.title || '',
    description: seo.description || '',
  };
}

function normalizeProduct(product) {
  const input = {
    title: product.title,
    handle: product.handle,
    descriptionHtml: product.descriptionHtml || '',
    vendor: product.vendor || '',
    productType: product.productType || '',
    tags: product.tags || [],
    status: product.status,
    productOptions: buildOptionInputs(product.options),
    variants: buildVariantInputs(product.variants?.nodes || []),
    files: buildFileInputs(product),
  };

  const seo = normalizeSeo(product.seo);
  if (seo) {
    input.seo = seo;
  }

  return input;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const sourceDir = path.resolve(args.source);
  const destinationStore = args.destination;

  const sourceProducts = readJson(path.join(sourceDir, 'products.json'));
  const destinationProducts = fetchDestinationProducts(destinationStore);
  const destinationMap = buildProductMap(destinationProducts);

  const missingProducts = sourceProducts.filter((product) => !destinationMap.has(product.handle));
  const productsToProcess =
    typeof args.limit === 'number' ? missingProducts.slice(0, args.limit) : missingProducts;

  if (!args.live) {
    const multiVariantProducts = missingProducts.filter((product) => product.totalVariants > 1);
    console.log(
      JSON.stringify(
        {
          mode: 'dry-run',
          destinationStore,
          missingProducts: missingProducts.length,
          productsToProcess: productsToProcess.length,
          singleVariantCount: missingProducts.length - multiVariantProducts.length,
          multiVariantCount: multiVariantProducts.length,
          sampleHandles: productsToProcess.slice(0, 10).map((product) => product.handle),
        },
        null,
        2
      )
    );
    return;
  }

  const query = `
    mutation ProductSet($input: ProductSetInput!, $identifier: ProductSetIdentifiers) {
      productSet(input: $input, identifier: $identifier, synchronous: true) {
        product {
          id
          title
          handle
          status
          totalVariants
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const results = [];
  const startedAt = Date.now();
  logProgress('products', 0, productsToProcess.length, null, startedAt);

  productsToProcess.forEach((product, index) => {
    const response = executeStoreMutation(destinationStore, query, {
      identifier: {
        handle: product.handle,
      },
      input: normalizeProduct(product),
    });

    const result = response.productSet;
    if (result.userErrors && result.userErrors.length > 0) {
      throw new Error(
        `Failed to sync product ${product.handle}: ${JSON.stringify(result.userErrors)}`
      );
    }

    results.push(result.product);
    logProgress('products', index + 1, productsToProcess.length, product.handle, startedAt);
  });

  console.log(
    JSON.stringify(
      {
        mode: 'live',
        destinationStore,
        syncedCount: results.length,
        syncedHandles: results.map((product) => product.handle),
      },
      null,
      2
    )
  );
  logCompletion('products', results.length, startedAt);
}

main();
