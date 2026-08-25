/* eslint-env node */
/* global require, process, console */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

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

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function executeStoreQuery(store, query) {
  const outputFile = path.join(
    os.tmpdir(),
    `shopify-cli-audit-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
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

function buildConnectionQuery(resourceName, fields, cursor) {
  const afterClause = cursor ? `, after: ${JSON.stringify(cursor)}` : '';
  return `query Paginate${resourceName} {
    ${resourceName}(first: 100${afterClause}) {
      nodes {
        ${fields.join('\n        ')}
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }`;
}

function fetchAllConnectionNodes(store, resourceName, fields) {
  const nodes = [];
  let cursor = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const query = buildConnectionQuery(resourceName, fields, cursor);
    const response = executeStoreQuery(store, query);
    const connection = response[resourceName];

    connection.nodes.forEach((node) => nodes.push(node));
    hasNextPage = connection.pageInfo.hasNextPage;
    cursor = connection.pageInfo.endCursor;
  }

  return nodes;
}

function fetchAllBlogArticles(store, blogs) {
  const articles = [];

  blogs.forEach((blog) => {
    let cursor = null;
    let hasNextPage = true;

    while (hasNextPage) {
      const afterClause = cursor ? `, after: ${JSON.stringify(cursor)}` : '';
      const response = executeStoreQuery(
        store,
        `query {
          node(id: ${JSON.stringify(blog.id)}) {
            ... on Blog {
              id
              handle
              title
              articles(first: 100${afterClause}) {
                nodes {
                  id
                  title
                  handle
                  body
                  summary
                  tags
                  isPublished
                  publishedAt
                  templateSuffix
                  image {
                    altText
                    url
                  }
                  author {
                    name
                  }
                  updatedAt
                }
                pageInfo {
                  hasNextPage
                  endCursor
                }
              }
            }
          }
        }`
      );

      const blogNode = response.node;
      blogNode.articles.nodes.forEach((article) => {
        articles.push({
          ...article,
          blog: {
            id: blogNode.id,
            handle: blogNode.handle,
            title: blogNode.title,
          },
        });
      });
      hasNextPage = blogNode.articles.pageInfo.hasNextPage;
      cursor = blogNode.articles.pageInfo.endCursor;
    }
  });

  return articles;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const outputDir =
    args.outputDir ||
    path.resolve(process.cwd(), 'audit', sanitizeStoreName(args.store));

  ensureDir(outputDir);

  const summary = executeStoreQuery(
    args.store,
    `query AuditSummary {
      shop {
        name
        id
        primaryDomain {
          url
        }
      }
      productsCount {
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
      blogs(first: 50) {
        nodes {
          id
          handle
          title
        }
      }
    }`
  );

  const products = fetchAllConnectionNodes(args.store, 'products', [
    'id',
    'title',
    'handle',
    'status',
    'descriptionHtml',
    'vendor',
    'productType',
    'tags',
    'totalInventory',
    'totalVariants',
    'seo { title description }',
    'options { id name position optionValues { name hasVariants } }',
    'metafields(first: 100) { nodes { id namespace key type value updatedAt } }',
    'featuredMedia { preview { image { url } } }',
    'media(first: 20) { nodes { alt mediaContentType ... on MediaImage { image { url } } } }',
    'variants(first: 20) { nodes { id title sku barcode price compareAtPrice taxable inventoryPolicy inventoryQuantity selectedOptions { name value } metafields(first: 100) { nodes { id namespace key type value updatedAt } } inventoryItem { tracked requiresShipping measurement { weight { unit value } } countryCodeOfOrigin provinceCodeOfOrigin harmonizedSystemCode } } }',
    'updatedAt',
  ]);

  const collections = fetchAllConnectionNodes(args.store, 'collections', [
    'id',
    'title',
    'handle',
    'descriptionHtml',
    'ruleSet { appliedDisjunctively rules { column relation condition } }',
    'updatedAt',
  ]);

  const pages = fetchAllConnectionNodes(args.store, 'pages', [
    'id',
    'title',
    'handle',
    'body',
    'templateSuffix',
    'isPublished',
    'updatedAt',
  ]);

  const blogs = fetchAllConnectionNodes(args.store, 'blogs', [
    'id',
    'title',
    'handle',
    'commentPolicy',
    'templateSuffix',
  ]);
  const articles = fetchAllBlogArticles(args.store, blogs);
  const menus = fetchAllConnectionNodes(args.store, 'menus', [
    'id',
    'title',
    'handle',
    'items { id title type url resourceId tags items { id title type url resourceId tags items { id title type url resourceId tags } } }',
  ]);
  const redirects = fetchAllConnectionNodes(args.store, 'urlRedirects', [
    'id',
    'path',
    'target',
  ]);

  const audit = {
    generatedAt: new Date().toISOString(),
    store: args.store,
    summary,
    exported: {
      products: products.length,
      collections: collections.length,
      pages: pages.length,
      blogs: blogs.length,
      articles: articles.length,
      menus: menus.length,
      redirects: redirects.length,
    },
  };

  writeJson(path.join(outputDir, 'summary.json'), audit);
  writeJson(path.join(outputDir, 'products.json'), products);
  writeJson(path.join(outputDir, 'collections.json'), collections);
  writeJson(path.join(outputDir, 'pages.json'), pages);
  writeJson(path.join(outputDir, 'blogs.json'), blogs);
  writeJson(path.join(outputDir, 'articles.json'), articles);
  writeJson(path.join(outputDir, 'menus.json'), menus);
  writeJson(path.join(outputDir, 'redirects.json'), redirects);

  console.log(`Audit written to ${outputDir}`);
  console.log(
    JSON.stringify(
      {
        store: args.store,
        products: products.length,
        collections: collections.length,
        pages: pages.length,
        blogs: blogs.length,
        articles: articles.length,
        menus: menus.length,
        redirects: redirects.length,
      },
      null,
      2
    )
  );
}

main();
