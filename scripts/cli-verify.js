/* eslint-env node */
/* global require, process, console, module */
const fs = require('node:fs');
const path = require('node:path');

function parseArgs(argv) {
  const args = {
    source: null,
    destination: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--source') {
      args.source = argv[i + 1];
      i += 1;
    } else if (arg === '--destination') {
      args.destination = argv[i + 1];
      i += 1;
    }
  }

  if (!args.source || !args.destination) {
    throw new Error('Missing required --source and/or --destination arguments.');
  }

  return args;
}

function readJsonIfExists(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }

  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function collectionKey(item, extraKey) {
  if (extraKey) {
    return extraKey(item);
  }

  return item.handle;
}

function compareByKey(label, sourceItems, destinationItems, extraKey) {
  const destinationMap = new Map(
    destinationItems.map((item) => [collectionKey(item, extraKey), item]).filter(([key]) => !!key)
  );
  const missing = [];

  sourceItems.forEach((item) => {
    const key = collectionKey(item, extraKey);
    if (key && !destinationMap.has(key)) {
      missing.push(key);
    }
  });

  return {
    label,
    sourceCount: sourceItems.length,
    destinationCount: destinationItems.length,
    missingCount: missing.length,
    sampleMissing: missing.slice(0, 10),
    passed: missing.length === 0,
  };
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

function metafieldKey(metafield) {
  return `${metafield.namespace}.${metafield.key}`;
}

function metafieldMap(owner) {
  return new Map((owner.metafields?.nodes || []).map((metafield) => [metafieldKey(metafield), metafield]));
}

function isPortableMetafield(metafield) {
  return (
    metafield?.namespace &&
    metafield.key &&
    metafield.type &&
    typeof metafield.value === 'string' &&
    metafield.value.length > 0 &&
    !metafield.namespace.startsWith('app--') &&
    !metafield.value.includes('gid://shopify/')
  );
}

function compareMetafields(sourceProducts, destinationProducts) {
  const destinationMap = new Map(destinationProducts.map((product) => [product.handle, product]));
  const missing = [];
  const mismatched = [];
  let expected = 0;
  let skipped = 0;

  sourceProducts.forEach((sourceProduct) => {
    const destinationProduct = destinationMap.get(sourceProduct.handle);
    if (!destinationProduct) {
      return;
    }

    const destinationProductMetafields = metafieldMap(destinationProduct);
    (sourceProduct.metafields?.nodes || []).forEach((sourceMetafield) => {
      if (!isPortableMetafield(sourceMetafield)) {
        skipped += 1;
        return;
      }

      expected += 1;
      const target = destinationProductMetafields.get(metafieldKey(sourceMetafield));
      if (!target) {
        missing.push({ owner: 'product', handle: sourceProduct.handle, key: metafieldKey(sourceMetafield) });
      } else if (target.type !== sourceMetafield.type || target.value !== sourceMetafield.value) {
        mismatched.push({ owner: 'product', handle: sourceProduct.handle, key: metafieldKey(sourceMetafield) });
      }
    });

    const destinationVariants = new Map(
      (destinationProduct.variants?.nodes || []).map((variant) => [variantKey(variant), variant])
    );
    (sourceProduct.variants?.nodes || []).forEach((sourceVariant) => {
      const destinationVariant = destinationVariants.get(variantKey(sourceVariant));
      if (!destinationVariant) {
        return;
      }

      const destinationVariantMetafields = metafieldMap(destinationVariant);
      (sourceVariant.metafields?.nodes || []).forEach((sourceMetafield) => {
        if (!isPortableMetafield(sourceMetafield)) {
          skipped += 1;
          return;
        }

        expected += 1;
        const target = destinationVariantMetafields.get(metafieldKey(sourceMetafield));
        if (!target) {
          missing.push({
            owner: 'variant',
            handle: sourceProduct.handle,
            variant: variantKey(sourceVariant),
            key: metafieldKey(sourceMetafield),
          });
        } else if (target.type !== sourceMetafield.type || target.value !== sourceMetafield.value) {
          mismatched.push({
            owner: 'variant',
            handle: sourceProduct.handle,
            variant: variantKey(sourceVariant),
            key: metafieldKey(sourceMetafield),
          });
        }
      });
    });
  });

  return {
    label: 'portable product and variant metafields',
    expectedCount: expected,
    skippedNonPortable: skipped,
    missingCount: missing.length,
    mismatchedCount: mismatched.length,
    sampleMissing: missing.slice(0, 10),
    sampleMismatched: mismatched.slice(0, 10),
    passed: missing.length === 0 && mismatched.length === 0,
  };
}

function normalizeUrl(url) {
  if (!url) {
    return null;
  }

  return url.replace(/^https?:\/\/[^/]+/, '');
}

function normalizeMenuItem(item) {
  return {
    title: item.title,
    type: item.type,
    url: normalizeUrl(item.url),
    tags: (item.tags || []).sort(),
    items: (item.items || []).map(normalizeMenuItem),
  };
}

function normalizeMenu(menu) {
  return {
    title: menu.title,
    handle: menu.handle,
    items: (menu.items || []).map(normalizeMenuItem),
  };
}

function compareMenus(sourceMenus, destinationMenus) {
  const skippedHandles = new Set(['customer-account-main-menu']);
  const destinationMap = new Map(destinationMenus.map((menu) => [menu.handle, menu]));
  const missing = [];
  const mismatched = [];

  sourceMenus.forEach((sourceMenu) => {
    if (skippedHandles.has(sourceMenu.handle)) {
      return;
    }

    const destinationMenu = destinationMap.get(sourceMenu.handle);
    if (!destinationMenu) {
      missing.push(sourceMenu.handle);
      return;
    }

    if (JSON.stringify(normalizeMenu(sourceMenu)) !== JSON.stringify(normalizeMenu(destinationMenu))) {
      mismatched.push(sourceMenu.handle);
    }
  });

  return {
    label: 'storefront menus',
    checkedCount: sourceMenus.filter((menu) => !skippedHandles.has(menu.handle)).length,
    skippedHandles: [...skippedHandles],
    missingCount: missing.length,
    mismatchedCount: mismatched.length,
    sampleMissing: missing.slice(0, 10),
    sampleMismatched: mismatched.slice(0, 10),
    passed: missing.length === 0 && mismatched.length === 0,
  };
}

function compareRedirects(sourceRedirects, destinationRedirects) {
  const destinationMap = new Map(destinationRedirects.map((redirect) => [redirect.path, redirect]));
  const missing = [];
  const mismatched = [];

  sourceRedirects.forEach((sourceRedirect) => {
    const destinationRedirect = destinationMap.get(sourceRedirect.path);
    if (!destinationRedirect) {
      missing.push(sourceRedirect.path);
    } else if (destinationRedirect.target !== sourceRedirect.target) {
      mismatched.push(sourceRedirect.path);
    }
  });

  return {
    label: 'url redirects',
    checkedCount: sourceRedirects.length,
    missingCount: missing.length,
    mismatchedCount: mismatched.length,
    sampleMissing: missing.slice(0, 10),
    sampleMismatched: mismatched.slice(0, 10),
    passed: missing.length === 0 && mismatched.length === 0,
  };
}

function loadAudit(dir) {
  return {
    summary: readJsonIfExists(path.join(dir, 'summary.json'), null),
    products: readJsonIfExists(path.join(dir, 'products.json'), []),
    collections: readJsonIfExists(path.join(dir, 'collections.json'), []),
    pages: readJsonIfExists(path.join(dir, 'pages.json'), []),
    blogs: readJsonIfExists(path.join(dir, 'blogs.json'), []),
    articles: readJsonIfExists(path.join(dir, 'articles.json'), []),
    menus: readJsonIfExists(path.join(dir, 'menus.json'), []),
    redirects: readJsonIfExists(path.join(dir, 'redirects.json'), []),
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const sourceDir = path.resolve(args.source);
  const destinationDir = path.resolve(args.destination);
  const source = loadAudit(sourceDir);
  const destination = loadAudit(destinationDir);
  const checks = [
    compareByKey('products', source.products, destination.products),
    compareByKey('collections', source.collections, destination.collections),
    compareByKey('pages', source.pages, destination.pages),
    compareByKey('blogs', source.blogs, destination.blogs),
    compareByKey('articles', source.articles, destination.articles, (article) => `${article.blog?.handle}/${article.handle}`),
    compareMetafields(source.products, destination.products),
    compareMenus(source.menus, destination.menus),
    compareRedirects(source.redirects, destination.redirects),
  ];

  console.log(
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        source: source.summary?.store || sourceDir,
        destination: destination.summary?.store || destinationDir,
        passed: checks.every((check) => check.passed),
        checks,
      },
      null,
      2
    )
  );
}

module.exports = {
  compareByKey,
  compareMetafields,
  compareMenus,
  compareRedirects,
  isPortableMetafield,
  loadAudit,
  metafieldKey,
  normalizeMenu,
  normalizeUrl,
  parseArgs,
  readJsonIfExists,
  selectedOptionsKey,
  variantKey,
};

if (require.main === module) {
  main();
}
