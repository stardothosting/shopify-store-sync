/* eslint-env node */
/* global require, process, console, module */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function parseArgs(argv) {
  const args = {
    source: null,
    destination: null,
    live: false,
    limit: null,
    all: false,
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
    } else if (arg === '--all') {
      args.all = true;
    }
  }

  if (!args.source || !args.destination) {
    throw new Error('Missing required --source and/or --destination arguments.');
  }

  return args;
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function detectResources(sourceDir) {
  const resources = [
    {
      name: 'blogs',
      file: 'blogs.json',
      script: 'cli-sync-blogs.js',
    },
    {
      name: 'collections',
      file: 'collections.json',
      script: 'cli-sync-collections.js',
    },
    {
      name: 'pages',
      file: 'pages.json',
      script: 'cli-sync-pages.js',
    },
    {
      name: 'articles',
      file: 'articles.json',
      script: 'cli-sync-articles.js',
    },
    {
      name: 'products',
      file: 'products.json',
      script: 'cli-sync-products.js',
    },
    {
      name: 'metafields',
      file: 'products.json',
      script: 'cli-sync-metafields.js',
    },
    {
      name: 'menus',
      file: 'menus.json',
      script: 'cli-sync-menus.js',
    },
    {
      name: 'redirects',
      file: 'redirects.json',
      script: 'cli-sync-redirects.js',
    },
  ];

  return resources
    .map((resource) => {
      const payload = readJsonIfExists(path.join(sourceDir, resource.file));
      return payload
        ? {
            ...resource,
            count: Array.isArray(payload) ? payload.length : null,
          }
        : null;
    })
    .filter(Boolean);
}

function runStep(scriptPath, args) {
  const commandArgs = [scriptPath, '--source', args.source, '--destination', args.destination];

  if (args.live) {
    commandArgs.push('--live');
  }
  if (typeof args.limit === 'number') {
    commandArgs.push('--limit', String(args.limit));
  }

  execFileSync('node', commandArgs, {
    stdio: 'inherit',
    cwd: process.cwd(),
  });
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const sourceDir = path.resolve(args.source);
  const supportedResources = detectResources(sourceDir);

  console.log(
    JSON.stringify(
      {
        mode: args.live ? 'live' : 'dry-run',
        all: true,
        source: sourceDir,
        destination: args.destination,
        detectedResources: supportedResources.map((resource) => ({
          resource: resource.name,
          count: resource.count,
        })),
      },
      null,
      2
    )
  );

  supportedResources.forEach((resource) => {
    console.log(`\n=== syncing ${resource.name} ===`);
    runStep(path.join(__dirname, resource.script), args);
  });
}

module.exports = {
  detectResources,
  parseArgs,
  readJsonIfExists,
  runStep,
};

if (require.main === module) {
  main();
}
