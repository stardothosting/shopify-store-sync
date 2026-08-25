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
    `shopify-cli-blog-sync-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
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

function normalizeBlog(blog) {
  const payload = {
    title: blog.title,
    handle: blog.handle,
  };

  if (blog.templateSuffix) {
    payload.templateSuffix = blog.templateSuffix;
  }
  if (blog.commentPolicy) {
    payload.commentPolicy = blog.commentPolicy;
  }

  return payload;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const sourceDir = path.resolve(args.source);
  const destinationStore = args.destination;

  const sourceBlogs = readJson(path.join(sourceDir, 'blogs.json'));
  const destinationBlogs = fetchDestinationBlogs(destinationStore);
  const destinationMap = buildBlogMap(destinationBlogs);

  const missingBlogs = sourceBlogs.filter((blog) => !destinationMap.has(blog.handle));
  const blogsToProcess =
    typeof args.limit === 'number' ? missingBlogs.slice(0, args.limit) : missingBlogs;

  if (!args.live) {
    console.log(
      JSON.stringify(
        {
          mode: 'dry-run',
          destinationStore,
          missingBlogs: missingBlogs.length,
          blogsToProcess: blogsToProcess.length,
          sampleHandles: blogsToProcess.slice(0, 10).map((blog) => blog.handle),
        },
        null,
        2
      )
    );
    return;
  }

  const query = `
    mutation CreateBlog($blog: BlogCreateInput!) {
      blogCreate(blog: $blog) {
        blog {
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
  logProgress('blogs', 0, blogsToProcess.length, null, startedAt);

  blogsToProcess.forEach((blog, index) => {
    const response = executeStoreMutation(destinationStore, query, {
      blog: normalizeBlog(blog),
    });

    const result = response.blogCreate;
    if (result.userErrors && result.userErrors.length > 0) {
      throw new Error(`Failed to create blog ${blog.handle}: ${JSON.stringify(result.userErrors)}`);
    }

    results.push(result.blog);
    logProgress('blogs', index + 1, blogsToProcess.length, blog.handle, startedAt);
  });

  console.log(
    JSON.stringify(
      {
        mode: 'live',
        destinationStore,
        createdCount: results.length,
        createdHandles: results.map((blog) => blog.handle),
      },
      null,
      2
    )
  );
  logCompletion('blogs', results.length, startedAt);
}

main();
