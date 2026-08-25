const test = require('node:test');
const assert = require('node:assert/strict');

const {
  compareByKey,
  compareMenus,
  compareMetafields,
  compareRedirects,
  isPortableMetafield,
  selectedOptionsKey,
  variantKey,
} = require('../scripts/cli-verify.js');

test('compareByKey reports missing source handles only', () => {
  const result = compareByKey(
    'products',
    [{ handle: 'alpha' }, { handle: 'beta' }],
    [{ handle: 'alpha' }, { handle: 'beta' }, { handle: 'extra' }]
  );

  assert.equal(result.passed, true);
  assert.equal(result.missingCount, 0);
  assert.equal(result.destinationCount, 3);
});

test('selectedOptionsKey and variantKey normalize fallback keys', () => {
  assert.equal(
    selectedOptionsKey([
      { name: 'Size', value: 'Large' },
      { name: 'Color', value: 'Blue' },
    ]),
    'Color:Blue|Size:Large'
  );

  assert.equal(
    variantKey({
      title: 'Default Title',
      selectedOptions: [
        { name: 'Color', value: 'Blue' },
        { name: 'Size', value: 'Large' },
      ],
    }),
    'options:Color:Blue|Size:Large'
  );
});

test('isPortableMetafield rejects app namespaces and source gid references', () => {
  assert.equal(
    isPortableMetafield({
      namespace: 'custom',
      key: 'material',
      type: 'single_line_text_field',
      value: 'kraft',
    }),
    true
  );

  assert.equal(
    isPortableMetafield({
      namespace: 'app--12345',
      key: 'material',
      type: 'single_line_text_field',
      value: 'kraft',
    }),
    false
  );

  assert.equal(
    isPortableMetafield({
      namespace: 'custom',
      key: 'related_product',
      type: 'product_reference',
      value: 'gid://shopify/Product/123',
    }),
    false
  );
});

test('compareMetafields passes when portable product and variant metafields match', () => {
  const sourceProducts = [
    {
      handle: 'sample-product',
      metafields: {
        nodes: [
          {
            namespace: 'custom',
            key: 'material',
            type: 'single_line_text_field',
            value: 'kraft',
          },
          {
            namespace: 'custom',
            key: 'ignore_gid',
            type: 'product_reference',
            value: 'gid://shopify/Product/123',
          },
        ],
      },
      variants: {
        nodes: [
          {
            sku: 'SKU-1',
            selectedOptions: [{ name: 'Size', value: '12oz' }],
            metafields: {
              nodes: [
                {
                  namespace: 'custom',
                  key: 'case_pack',
                  type: 'number_integer',
                  value: '250',
                },
              ],
            },
          },
        ],
      },
    },
  ];
  const destinationProducts = [
    {
      handle: 'sample-product',
      metafields: {
        nodes: [
          {
            namespace: 'custom',
            key: 'material',
            type: 'single_line_text_field',
            value: 'kraft',
          },
        ],
      },
      variants: {
        nodes: [
          {
            sku: 'SKU-1',
            selectedOptions: [{ name: 'Size', value: '12oz' }],
            metafields: {
              nodes: [
                {
                  namespace: 'custom',
                  key: 'case_pack',
                  type: 'number_integer',
                  value: '250',
                },
              ],
            },
          },
        ],
      },
    },
  ];

  const result = compareMetafields(sourceProducts, destinationProducts);

  assert.equal(result.passed, true);
  assert.equal(result.expectedCount, 2);
  assert.equal(result.skippedNonPortable, 1);
  assert.equal(result.missingCount, 0);
  assert.equal(result.mismatchedCount, 0);
});

test('compareMenus ignores customer account menu and normalizes absolute urls', () => {
  const sourceMenus = [
    {
      handle: 'main-menu',
      title: 'Main menu',
      items: [
        {
          title: 'Contact',
          type: 'PAGE',
          url: '/pages/contact-us',
          tags: [],
          items: [],
        },
      ],
    },
    {
      handle: 'customer-account-main-menu',
      title: 'Customer account main menu',
      items: [],
    },
  ];
  const destinationMenus = [
    {
      handle: 'main-menu',
      title: 'Main menu',
      items: [
        {
          title: 'Contact',
          type: 'PAGE',
          url: 'https://shift8-encorecanada.myshopify.com/pages/contact-us',
          tags: [],
          items: [],
        },
      ],
    },
  ];

  const result = compareMenus(sourceMenus, destinationMenus);

  assert.equal(result.passed, true);
  assert.deepEqual(result.skippedHandles, ['customer-account-main-menu']);
  assert.equal(result.missingCount, 0);
  assert.equal(result.mismatchedCount, 0);
});

test('compareRedirects reports mismatched redirect targets', () => {
  const result = compareRedirects(
    [{ path: '/pages/contact', target: '/pages/contact-us' }],
    [{ path: '/pages/contact', target: '/pages/contact' }]
  );

  assert.equal(result.passed, false);
  assert.equal(result.missingCount, 0);
  assert.equal(result.mismatchedCount, 1);
  assert.deepEqual(result.sampleMismatched, ['/pages/contact']);
});
