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

function buildPageMap(items) {
  const map = new Map();
  items.forEach((item) => {
    if (item && item.handle) {
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
    `shopify-cli-page-sync-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
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
    `shopify-cli-page-query-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
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

function fetchDestinationPages(store) {
  const pages = [];
  let cursor = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const afterClause = cursor ? `, after: ${JSON.stringify(cursor)}` : '';
    const response = executeStoreQuery(
      store,
      `query {
        pages(first: 100${afterClause}) {
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

    response.pages.nodes.forEach((page) => pages.push(page));
    hasNextPage = response.pages.pageInfo.hasNextPage;
    cursor = response.pages.pageInfo.endCursor;
  }

  return pages;
}

function normalizePage(page) {
  return {
    title: page.title,
    handle: page.handle,
    body: page.body || '',
    isPublished: !!page.isPublished,
    templateSuffix: page.templateSuffix || null,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const sourceDir = path.resolve(args.source);
  const destinationStore = args.destination;

  const sourcePages = readJson(path.join(sourceDir, 'pages.json'));
  const destinationPages = fetchDestinationPages(destinationStore);

  const destinationMap = buildPageMap(destinationPages);
  const missingPages = sourcePages.filter((page) => !destinationMap.has(page.handle));
  const pagesToProcess =
    typeof args.limit === 'number' ? missingPages.slice(0, args.limit) : missingPages;

  if (!args.live) {
    console.log(
      JSON.stringify(
        {
          mode: 'dry-run',
          destinationStore,
          missingPages: missingPages.length,
          pagesToProcess: pagesToProcess.length,
          sampleHandles: pagesToProcess.slice(0, 10).map((page) => page.handle),
        },
        null,
        2
      )
    );
    return;
  }

  const query = `
    mutation CreatePage($page: PageCreateInput!) {
      pageCreate(page: $page) {
        page {
          id
          title
          handle
        }
        userErrors {
          code
          field
          message
        }
      }
    }
  `;

  const results = [];
  const startedAt = Date.now();
  logProgress('pages', 0, pagesToProcess.length, null, startedAt);

  pagesToProcess.forEach((page, index) => {
    const response = executeStoreMutation(destinationStore, query, {
      page: normalizePage(page),
    });

    const result = response.pageCreate;
    if (result.userErrors && result.userErrors.length > 0) {
      throw new Error(
        `Failed to create page ${page.handle}: ${JSON.stringify(result.userErrors)}`
      );
    }

    results.push(result.page);
    logProgress('pages', index + 1, pagesToProcess.length, page.handle, startedAt);
  });

  console.log(
    JSON.stringify(
      {
        mode: 'live',
        destinationStore,
        createdCount: results.length,
        createdHandles: results.map((page) => page.handle),
      },
      null,
      2
    )
  );
  logCompletion('pages', results.length, startedAt);
}

main();
