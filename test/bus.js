'use strict';

const path = require('node:path');
const metatests = require('metatests');
const { Code } = require('../lib/code.js');

const root = process.cwd();

const application = {
  path: path.join(root, 'test'),
  console,
  starts: [],
  watcher: { watch() {} },
  absolute(relative) {
    return path.join(this.path, relative);
  },
};

metatests.testAsync('lib/bus', async (test) => {
  const bus = new Code('bus', application);
  test.strictSame(bus.name, 'bus');
  test.strictSame(bus.path, path.join(root, 'test/bus'));
  test.strictSame(typeof bus.application, 'object');
  test.strictSame(bus.tree, {});
  await bus.load();
  test.strictSame(Object.keys(bus.tree), ['fakerapi', 'math', 'worldTime']);
  test.strictSame(bus.tree.math.parent, bus.tree);
  test.strictSame(typeof bus.tree.math, 'object');
  test.strictSame(typeof bus.tree.math.eval, 'function');
  test.strictSame(bus.tree.math.eval.constructor.name, 'AsyncFunction');
  test.strictSame(typeof bus.tree.math['.service'], 'function');
  test.strictSame(bus.tree.math['.service'].url, 'https://api.mathjs.org');
  test.end();
});
