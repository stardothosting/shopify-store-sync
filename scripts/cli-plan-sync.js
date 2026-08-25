/* eslint-env node */
/* global require, process, console */
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

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function normalizeByHandle(items) {
  const map = new Map();
  items.forEach((item) => {
    if (item && item.handle) {
      map.set(item.handle, item);
    }
  });
  return map;
}

function compareResource(resourceName, sourceItems, destinationItems) {
  const sourceMap = normalizeByHandle(sourceItems);
  const destinationMap = normalizeByHandle(destinationItems);
  const create = [];
  const alreadyPresent = [];

  sourceMap.forEach((_, handle) => {
    if (destinationMap.has(handle)) {
      alreadyPresent.push(handle);
    } else {
      create.push(handle);
    }
  });

  const destinationOnly = [];
  destinationMap.forEach((_, handle) => {
    if (!sourceMap.has(handle)) {
      destinationOnly.push(handle);
    }
  });

  return {
    resource: resourceName,
    sourceCount: sourceItems.length,
    destinationCount: destinationItems.length,
    createCount: create.length,
    alreadyPresentCount: alreadyPresent.length,
    destinationOnlyCount: destinationOnly.length,
    sampleCreate: create.slice(0, 10),
    sampleAlreadyPresent: alreadyPresent.slice(0, 10),
    sampleDestinationOnly: destinationOnly.slice(0, 10),
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const sourceDir = path.resolve(args.source);
  const destinationDir = path.resolve(args.destination);

  const sourceSummary = readJson(path.join(sourceDir, 'summary.json'));
  const destinationSummary = readJson(path.join(destinationDir, 'summary.json'));

  const comparisons = [
    compareResource(
      'products',
      readJson(path.join(sourceDir, 'products.json')),
      readJson(path.join(destinationDir, 'products.json'))
    ),
    compareResource(
      'collections',
      readJson(path.join(sourceDir, 'collections.json')),
      readJson(path.join(destinationDir, 'collections.json'))
    ),
    compareResource(
      'pages',
      readJson(path.join(sourceDir, 'pages.json')),
      readJson(path.join(destinationDir, 'pages.json'))
    ),
    compareResource(
      'blogs',
      readJson(path.join(sourceDir, 'blogs.json')),
      readJson(path.join(destinationDir, 'blogs.json'))
    ),
    compareResource(
      'articles',
      readJson(path.join(sourceDir, 'articles.json')),
      readJson(path.join(destinationDir, 'articles.json'))
    ),
  ];

  const report = {
    generatedAt: new Date().toISOString(),
    sourceStore: sourceSummary.store,
    destinationStore: destinationSummary.store,
    comparisons,
  };

  console.log(JSON.stringify(report, null, 2));
}

main();
