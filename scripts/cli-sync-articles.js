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

function articleKey(article) {
  return `${article.blog.handle}::${article.handle}`;
}

function buildArticleMap(items) {
  const map = new Map();
  items.forEach((item) => {
    if (item?.handle && item?.blog?.handle) {
      map.set(articleKey(item), item);
    }
  });
  return map;
}

function buildBlogMap(items) {
  const map = new Map();
  items.forEach((item) => {
    if (item?.handle) {
      map.set(item.handle, item);
    }
  });
  return map;
}

function executeStoreCommand(store, query, variables, allowMutations) {
  const outputFile = path.join(
    os.tmpdir(),
    `shopify-cli-article-sync-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
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

function fetchDestinationBlogs(store) {
  const blogs = [];
  let cursor = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const afterClause = cursor ? `, after: ${JSON.stringify(cursor)}` : '';
    const response = executeStoreQuery(
      store,
      `query {
        blogs(first: 100${afterClause}) {
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

    response.blogs.nodes.forEach((blog) => blogs.push(blog));
    hasNextPage = response.blogs.pageInfo.hasNextPage;
    cursor = response.blogs.pageInfo.endCursor;
  }

  return blogs;
}

function fetchArticlesForBlog(store, blog) {
  const articles = [];
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

  return articles;
}

function fetchDestinationArticles(store) {
  const blogs = fetchDestinationBlogs(store);
  const articles = [];

  blogs.forEach((blog) => {
    fetchArticlesForBlog(store, blog).forEach((article) => articles.push(article));
  });

  return {
    blogs,
    articles,
  };
}

function normalizeArticle(article, destinationBlogId) {
  const payload = {
    blogId: destinationBlogId,
    title: article.title,
    handle: article.handle,
    body: article.body || '',
    summary: article.summary || '',
    tags: article.tags || [],
    isPublished: !!article.isPublished,
    author: {
      name: article.author?.name || 'Store Duplicator',
    },
  };

  if (article.publishedAt) {
    payload.publishDate = article.publishedAt;
  }
  if (article.templateSuffix) {
    payload.templateSuffix = article.templateSuffix;
  }
  if (article.image?.url) {
    payload.image = {
      altText: article.image.altText || '',
      url: article.image.url,
    };
  }

  return payload;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const sourceDir = path.resolve(args.source);
  const destinationStore = args.destination;

  const sourceArticles = readJson(path.join(sourceDir, 'articles.json'));
  const destinationData = fetchDestinationArticles(destinationStore);
  const destinationArticleMap = buildArticleMap(destinationData.articles);
  const destinationBlogMap = buildBlogMap(destinationData.blogs);

  const missingArticles = sourceArticles.filter((article) => !destinationArticleMap.has(articleKey(article)));
  const articlesToProcess =
    typeof args.limit === 'number' ? missingArticles.slice(0, args.limit) : missingArticles;

  if (!args.live) {
    console.log(
      JSON.stringify(
        {
          mode: 'dry-run',
          destinationStore,
          missingArticles: missingArticles.length,
          articlesToProcess: articlesToProcess.length,
          sampleArticles: articlesToProcess
            .slice(0, 10)
            .map((article) => `${article.blog.handle}::${article.handle}`),
        },
        null,
        2
      )
    );
    return;
  }

  const query = `
    mutation CreateArticle($article: ArticleCreateInput!) {
      articleCreate(article: $article) {
        article {
          id
          title
          handle
          blog {
            handle
          }
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
  logProgress('articles', 0, articlesToProcess.length, null, startedAt);

  articlesToProcess.forEach((article, index) => {
    const destinationBlog = destinationBlogMap.get(article.blog.handle);
    if (!destinationBlog) {
      throw new Error(`Missing destination blog for article ${articleKey(article)}`);
    }

    const response = executeStoreMutation(destinationStore, query, {
      article: normalizeArticle(article, destinationBlog.id),
    });

    const result = response.articleCreate;
    if (result.userErrors && result.userErrors.length > 0) {
      throw new Error(`Failed to create article ${articleKey(article)}: ${JSON.stringify(result.userErrors)}`);
    }

    results.push(result.article);
    logProgress('articles', index + 1, articlesToProcess.length, articleKey(article), startedAt);
  });

  console.log(
    JSON.stringify(
      {
        mode: 'live',
        destinationStore,
        createdCount: results.length,
        createdHandles: results.map((article) => `${article.blog.handle}::${article.handle}`),
      },
      null,
      2
    )
  );
  logCompletion('articles', results.length, startedAt);
}

main();
