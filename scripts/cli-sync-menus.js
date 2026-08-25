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
    `shopify-cli-menu-sync-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
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

function fetchAllConnectionNodes(store, resourceName, fields) {
  const nodes = [];
  let cursor = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const afterClause = cursor ? `, after: ${JSON.stringify(cursor)}` : '';
    const response = executeStoreQuery(
      store,
      `query {
        ${resourceName}(first: 100${afterClause}) {
          nodes {
            ${fields.join('\n            ')}
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }`
    );

    response[resourceName].nodes.forEach((node) => nodes.push(node));
    hasNextPage = response[resourceName].pageInfo.hasNextPage;
    cursor = response[resourceName].pageInfo.endCursor;
  }

  return nodes;
}

function buildHandleMap(items) {
  const map = new Map();
  items.forEach((item) => {
    if (item?.handle) {
      map.set(item.handle, item);
    }
  });
  return map;
}

function buildResourceMaps(store) {
  return {
    collections: buildHandleMap(fetchAllConnectionNodes(store, 'collections', ['id', 'handle'])),
    pages: buildHandleMap(fetchAllConnectionNodes(store, 'pages', ['id', 'handle'])),
    blogs: buildHandleMap(fetchAllConnectionNodes(store, 'blogs', ['id', 'handle'])),
    products: buildHandleMap(fetchAllConnectionNodes(store, 'products', ['id', 'handle'])),
    menus: buildHandleMap(fetchAllConnectionNodes(store, 'menus', ['id', 'handle', 'title'])),
  };
}

function extractHandleFromUrl(url, resourcePath) {
  if (!url) {
    return null;
  }

  const match = url.match(new RegExp(`/${resourcePath}/([^/?#]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function extractCollectionTags(url, collectionHandle) {
  if (!url || !collectionHandle) {
    return [];
  }

  const match = url.match(new RegExp(`/collections/${collectionHandle}/([^?#]+)`));
  if (!match) {
    return [];
  }

  return match[1]
    .split('+')
    .map((tag) => decodeURIComponent(tag).replace(/-/g, ' '))
    .filter(Boolean);
}

function normalizeMenuItem(item, resourceMaps, issues) {
  if (item.type === 'CUSTOMER_ACCOUNT_PAGE') {
    issues.push({
      title: item.title,
      type: item.type,
      reason: 'customer-account-page-menu-items-require-store-specific-resources',
    });
    return null;
  }

  const payload = {
    title: item.title,
    type: item.type,
  };

  if (item.type === 'COLLECTION') {
    const handle = extractHandleFromUrl(item.url, 'collections');
    const collection = resourceMaps.collections.get(handle);
    if (!collection) {
      issues.push({ title: item.title, type: item.type, url: item.url, reason: 'missing-collection' });
      return null;
    }
    payload.resourceId = collection.id;
    const tags = item.tags?.length ? item.tags : extractCollectionTags(item.url, handle);
    if (tags.length > 0) {
      payload.tags = tags;
    }
  } else if (item.type === 'PAGE') {
    const handle = extractHandleFromUrl(item.url, 'pages');
    const page = resourceMaps.pages.get(handle);
    if (!page) {
      issues.push({ title: item.title, type: item.type, url: item.url, reason: 'missing-page' });
      return null;
    }
    payload.resourceId = page.id;
  } else if (item.type === 'BLOG') {
    const handle = extractHandleFromUrl(item.url, 'blogs');
    const blog = resourceMaps.blogs.get(handle);
    if (!blog) {
      issues.push({ title: item.title, type: item.type, url: item.url, reason: 'missing-blog' });
      return null;
    }
    payload.resourceId = blog.id;
  } else if (item.type === 'PRODUCT') {
    const handle = extractHandleFromUrl(item.url, 'products');
    const product = resourceMaps.products.get(handle);
    if (!product) {
      issues.push({ title: item.title, type: item.type, url: item.url, reason: 'missing-product' });
      return null;
    }
    payload.resourceId = product.id;
  } else if (item.url) {
    payload.url = item.url;
  }

  const childItems = (item.items || [])
    .map((childItem) => normalizeMenuItem(childItem, resourceMaps, issues))
    .filter(Boolean);
  if (childItems.length > 0) {
    payload.items = childItems;
  }

  return payload;
}

function normalizeMenu(menu, resourceMaps) {
  const issues = [];
  if (menu.handle.startsWith('customer-account')) {
    return {
      menu: {
        title: menu.title,
        handle: menu.handle,
        items: [],
      },
      skip: true,
      issues: [
        {
          title: menu.title,
          type: 'MENU',
          reason: 'customer-account-menus-are-store-specific',
        },
      ],
    };
  }

  const items = (menu.items || [])
    .map((item) => normalizeMenuItem(item, resourceMaps, issues))
    .filter(Boolean);

  return {
    menu: {
      title: menu.title,
      handle: menu.handle,
      items,
    },
    issues,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const sourceDir = path.resolve(args.source);
  const destinationStore = args.destination;
  const sourceMenus = readJson(path.join(sourceDir, 'menus.json'));
  const menusToProcess =
    typeof args.limit === 'number' ? sourceMenus.slice(0, args.limit) : sourceMenus;
  const resourceMaps = buildResourceMaps(destinationStore);
  const normalizedMenus = menusToProcess.map((menu) => {
    const normalized = normalizeMenu(menu, resourceMaps);
    const existingMenu = resourceMaps.menus.get(menu.handle);
    return {
      source: menu,
      existingMenu,
      ...normalized,
    };
  });
  const syncableMenus = normalizedMenus.filter((menu) => !menu.skip);

  if (!args.live) {
    console.log(
      JSON.stringify(
        {
          mode: 'dry-run',
          destinationStore,
          menusToProcess: syncableMenus.length,
          skippedMenus: normalizedMenus.filter((menu) => menu.skip).map((menu) => menu.menu.handle),
          createCount: syncableMenus.filter((menu) => !menu.existingMenu).length,
          updateCount: syncableMenus.filter((menu) => !!menu.existingMenu).length,
          issueCount: normalizedMenus.reduce((count, menu) => count + menu.issues.length, 0),
          menus: normalizedMenus.map((menu) => ({
            handle: menu.menu.handle,
            title: menu.menu.title,
            itemCount: menu.menu.items.length,
            skipped: !!menu.skip,
            action: menu.existingMenu ? 'update' : 'create',
            issues: menu.issues,
          })),
        },
        null,
        2
      )
    );
    return;
  }

  const createMutation = `
    mutation MenuCreate($title: String!, $handle: String!, $items: [MenuItemCreateInput!]!) {
      menuCreate(title: $title, handle: $handle, items: $items) {
        menu {
          id
          handle
          title
        }
        userErrors {
          field
          message
        }
      }
    }
  `;
  const updateMutation = `
    mutation MenuUpdate($id: ID!, $title: String!, $handle: String, $items: [MenuItemUpdateInput!]!) {
      menuUpdate(id: $id, title: $title, handle: $handle, items: $items) {
        menu {
          id
          handle
          title
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const results = [];
  syncableMenus.forEach((menu) => {
    const variables = menu.existingMenu
      ? {
          id: menu.existingMenu.id,
          title: menu.menu.title,
          handle: menu.menu.handle,
          items: menu.menu.items,
        }
      : {
          title: menu.menu.title,
          handle: menu.menu.handle,
          items: menu.menu.items,
        };
    const response = executeStoreMutation(
      destinationStore,
      menu.existingMenu ? updateMutation : createMutation,
      variables
    );
    const result = menu.existingMenu ? response.menuUpdate : response.menuCreate;
    if (result.userErrors && result.userErrors.length > 0) {
      throw new Error(`Failed to sync menu ${menu.menu.handle}: ${JSON.stringify(result.userErrors)}`);
    }
    results.push(result.menu);
  });

  console.log(
    JSON.stringify(
      {
        mode: 'live',
        destinationStore,
        syncedCount: results.length,
        syncedHandles: results.map((menu) => menu.handle),
        skippedMenus: normalizedMenus.filter((menu) => menu.skip).map((menu) => menu.menu.handle),
        issueCount: normalizedMenus.reduce((count, menu) => count + menu.issues.length, 0),
      },
      null,
      2
    )
  );
}

main();
