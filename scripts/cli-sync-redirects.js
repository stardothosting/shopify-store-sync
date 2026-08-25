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

function executeStoreCommand(store, query, variables, allowMutations) {
  const outputFile = path.join(
    os.tmpdir(),
    `shopify-cli-redirect-sync-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
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

function fetchDestinationRedirects(store) {
  const redirects = [];
  let cursor = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const afterClause = cursor ? `, after: ${JSON.stringify(cursor)}` : '';
    const response = executeStoreQuery(
      store,
      `query {
        urlRedirects(first: 100${afterClause}) {
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
      }`
    );

    response.urlRedirects.nodes.forEach((redirect) => redirects.push(redirect));
    hasNextPage = response.urlRedirects.pageInfo.hasNextPage;
    cursor = response.urlRedirects.pageInfo.endCursor;
  }

  return redirects;
}

function buildRedirectMap(redirects) {
  const map = new Map();
  redirects.forEach((redirect) => {
    if (redirect?.path) {
      map.set(redirect.path, redirect);
    }
  });
  return map;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const sourceDir = path.resolve(args.source);
  const destinationStore = args.destination;
  const sourceRedirects = readJson(path.join(sourceDir, 'redirects.json'));
  const redirectsToProcess =
    typeof args.limit === 'number' ? sourceRedirects.slice(0, args.limit) : sourceRedirects;
  const destinationRedirects = fetchDestinationRedirects(destinationStore);
  const destinationMap = buildRedirectMap(destinationRedirects);
  const normalizedRedirects = redirectsToProcess.map((redirect) => ({
    source: redirect,
    existingRedirect: destinationMap.get(redirect.path),
    input: {
      path: redirect.path,
      target: redirect.target,
    },
  }));

  if (!args.live) {
    console.log(
      JSON.stringify(
        {
          mode: 'dry-run',
          destinationStore,
          redirectsToProcess: normalizedRedirects.length,
          createCount: normalizedRedirects.filter((redirect) => !redirect.existingRedirect).length,
          updateCount: normalizedRedirects.filter((redirect) => !!redirect.existingRedirect).length,
          sample: normalizedRedirects.slice(0, 10).map((redirect) => ({
            path: redirect.input.path,
            target: redirect.input.target,
            action: redirect.existingRedirect ? 'update' : 'create',
          })),
        },
        null,
        2
      )
    );
    return;
  }

  const createMutation = `
    mutation UrlRedirectCreate($urlRedirect: UrlRedirectInput!) {
      urlRedirectCreate(urlRedirect: $urlRedirect) {
        urlRedirect {
          id
          path
          target
        }
        userErrors {
          field
          message
        }
      }
    }
  `;
  const updateMutation = `
    mutation UrlRedirectUpdate($id: ID!, $urlRedirect: UrlRedirectInput!) {
      urlRedirectUpdate(id: $id, urlRedirect: $urlRedirect) {
        urlRedirect {
          id
          path
          target
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const results = [];
  normalizedRedirects.forEach((redirect) => {
    const response = executeStoreMutation(
      destinationStore,
      redirect.existingRedirect ? updateMutation : createMutation,
      redirect.existingRedirect
        ? {
            id: redirect.existingRedirect.id,
            urlRedirect: redirect.input,
          }
        : {
            urlRedirect: redirect.input,
          }
    );

    const result = redirect.existingRedirect ? response.urlRedirectUpdate : response.urlRedirectCreate;
    if (result.userErrors && result.userErrors.length > 0) {
      throw new Error(`Failed to sync redirect ${redirect.input.path}: ${JSON.stringify(result.userErrors)}`);
    }
    results.push(result.urlRedirect);
  });

  console.log(
    JSON.stringify(
      {
        mode: 'live',
        destinationStore,
        syncedCount: results.length,
        syncedPaths: results.map((redirect) => redirect.path),
      },
      null,
      2
    )
  );
}

main();
