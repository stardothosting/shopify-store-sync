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

function buildCollectionMap(items) {
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

function executeStoreMutation(store, query, variables) {
  const outputFile = path.join(
    os.tmpdir(),
    `shopify-cli-collection-sync-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
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
        '--allow-mutations',
        '--query',
        query,
        '--variables',
        JSON.stringify(variables),
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

function executeStoreQuery(store, query) {
  const outputFile = path.join(
    os.tmpdir(),
    `shopify-cli-collection-query-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
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

function fetchDestinationCollections(store) {
  const collections = [];
  let cursor = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const afterClause = cursor ? `, after: ${JSON.stringify(cursor)}` : '';
    const response = executeStoreQuery(
      store,
      `query {
        collections(first: 100${afterClause}) {
          nodes {
            id
            title
            handle
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }`
    );

    response.collections.nodes.forEach((collection) => collections.push(collection));
    hasNextPage = response.collections.pageInfo.hasNextPage;
    cursor = response.collections.pageInfo.endCursor;
  }

  return collections;
}

function normalizeLegacyRuleSet(ruleSet) {
  if (!ruleSet || !Array.isArray(ruleSet.rules) || ruleSet.rules.length === 0) {
    return null;
  }

  return {
    appliedDisjunctively: !!ruleSet.appliedDisjunctively,
    rules: ruleSet.rules.map((rule) => ({
      column: rule.column,
      relation: rule.relation,
      condition: rule.condition,
    })),
  };
}

function normalizeCollection(collection) {
  const payload = {
    title: collection.title,
    handle: collection.handle,
    descriptionHtml: collection.descriptionHtml || '',
  };

  const normalizedRuleSet = normalizeLegacyRuleSet(collection.ruleSet);
  if (normalizedRuleSet) {
    payload.ruleSet = normalizedRuleSet;
  }

  return payload;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const sourceDir = path.resolve(args.source);
  const destinationStore = args.destination;

  const sourceCollections = readJson(path.join(sourceDir, 'collections.json'));
  const destinationCollections = fetchDestinationCollections(destinationStore);

  const destinationMap = buildCollectionMap(destinationCollections);
  const missingCollections = sourceCollections.filter((collection) => !destinationMap.has(collection.handle));
  const collectionsToProcess =
    typeof args.limit === 'number' ? missingCollections.slice(0, args.limit) : missingCollections;

  if (!args.live) {
    console.log(
      JSON.stringify(
        {
          mode: 'dry-run',
          destinationStore,
          missingCollections: missingCollections.length,
          collectionsToProcess: collectionsToProcess.length,
          sampleHandles: collectionsToProcess.slice(0, 10).map((collection) => collection.handle),
        },
        null,
        2
      )
    );
    return;
  }

  const query = `
    mutation CreateCollection($input: CollectionInput!) {
      collectionCreate(input: $input) {
        collection {
          id
          title
          handle
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
  logProgress('collections', 0, collectionsToProcess.length, null, startedAt);

  collectionsToProcess.forEach((collection, index) => {
    const response = executeStoreMutation(destinationStore, query, {
      input: normalizeCollection(collection),
    });

    const result = response.collectionCreate;
    if (result.userErrors && result.userErrors.length > 0) {
      throw new Error(
        `Failed to create collection ${collection.handle}: ${JSON.stringify(result.userErrors)}`
      );
    }

    results.push(result.collection);
    logProgress('collections', index + 1, collectionsToProcess.length, collection.handle, startedAt);
  });

  console.log(
    JSON.stringify(
      {
        mode: 'live',
        destinationStore,
        createdCount: results.length,
        createdHandles: results.map((collection) => collection.handle),
      },
      null,
      2
    )
  );
  logCompletion('collections', results.length, startedAt);
}

main();
