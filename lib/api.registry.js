'use strict';

// Global API namespace for Impress Application Server

global.api = {};

// API registry for Impress Application Server

api.registry = {};

// This registry included node.js core modules, Impress Application Server
// modules and external modules tested with Impress, wrapped as plugin or
// added to global "api" namespace to be visible without require

api.registry.modules = {

  common: { type: 'preload', default: true },
  registry: { type: 'preload', default: true },

  require: { name: 'require', type: 'global' },
  console: { name: 'console', type: 'global', default: true },

  os: { npm: 'os', type: 'node', default: true },
  v8: { npm: 'v8', type: 'node' },
  vm: { npm: 'vm', type: 'node' },
  fs: { npm: 'fs', type: 'node', default: true },
  cp: { npm: 'child_process', type: 'node' },
  sd: { npm: 'string_decoder', type: 'node', default: true },
  tls: { npm: 'tls', type: 'node', default: true },
  net: { npm: 'net', type: 'node', default: true },
  dns: { npm: 'dns', type: 'node', default: true },
  url: { npm: 'url', type: 'node', default: true },
  util: { npm: 'util', type: 'node', default: true },
  path: { npm: 'path', type: 'node', default: true },
  zlib: { npm: 'zlib', type: 'node', default: true },
  http: { npm: 'http', type: 'node', default: true },
  https: { npm: 'https', type: 'node', default: true },
  dgram: { npm: 'dgram', type: 'node', default: true },
  timers: { npm: 'timers', type: 'node', default: true },
  stream: { npm: 'stream', type: 'node', default: true },
  buffer: { npm: 'buffer', type: 'node', default: true },
  crypto: { npm: 'crypto', type: 'node', default: true },
  events: { npm: 'events', type: 'node', default: true },
  readline: { npm: 'readline', type: 'node' },
  querystring: { npm: 'querystring', type: 'node', default: true },

  csv: { npm: 'csv', type: 'npm', default: true },
  zmq: { npm: 'zmq', type: 'npm' },
  jstp: { npm: 'metarhia-jstp', type: 'npm', default: true },
  sass: { npm: 'node-sass', type: 'npm' },
  geoip: { npm: 'geoip-lite', type: 'npm' },
  iconv: { npm: 'iconv-lite', type: 'npm', default: true },
  async: { npm: 'async', type: 'npm' },
  uglify: { npm: 'uglify-js', type: 'npm' },
  mkdirp: { npm: 'mkdirp', type: 'npm' },
  request: { npm: 'request', type: 'npm' },
  metasync: { npm: 'metasync', type: 'npm', default: true },
  zipStream: { npm: 'zip-stream', type: 'npm' },
  websocket: { npm: 'websocket', type: 'npm' },
  multiparty: { npm: 'multiparty', type: 'npm' },
  nodemailer: { npm: 'nodemailer', type: 'npm' },
  serialport: { npm: 'serialport', type: 'npm' },
  acceptLanguage: { npm: 'accept-language', type: 'npm' },

  gs: { npm: 'globalstorage', type: 'npm', dependencies: 'db' },
  bcrypt: { npm: 'bcrypt', type: 'npm', default: true },
  mongodb: { npm: 'mongodb', type: 'npm', dependencies: 'db' },
  pgsql: { npm: 'pg', type: 'npm', dependencies: 'db' },
  mysql: { npm: 'mysql', type: 'npm', dependencies: 'db' },
  mysqlUtilities: {
    npm: 'mysql-utilities', type: 'npm', dependencies: 'mysql'
  },

  concolor: { npm: 'concolor', type: 'npm', default: true },
  con: { type: 'impress', default: true },
  test: { type: 'impress', default: true },
  json: { type: 'global', default: true },
  definition: { type: 'impress', default: true },
  db: { type: 'impress', default: true }

};

if (process.env.IMPRESS_MODE === 'test') {
  api.registry.modules.tap = { npm: 'tap', type: 'npm', default: true };
}

api.registry.buildIndex = (
  // Build indexes in api.registry:
  //   modules - initial api registry records
  //   names - api module names array of string
  //   default - default api modules for application sandbox
  //   defaultNames - default api modules names array of string
  //   indexByNpm - hash keyed by npm module name
  //   indexByType - hash keyed by api module name, hash values: array of string
) => {
  api.registry.default = {};
  api.registry.indexByNpm = {};
  api.registry.indexByType = {};

  let m, name;
  for (name in api.registry.modules) {
    m = api.registry.modules[name];
    m.name = name;
    api.registry.indexByNpm[m.npm] = m;
    if (!api.registry.indexByType[m.type]) {
      api.registry.indexByType[m.type] = [];
    }
    api.registry.indexByType[m.type].push(name);
    if (m.default) {
      api.registry.default[name] = m;
    }
  }

  api.registry.names = Object.keys(api.registry.modules);
  api.registry.defaultNames = Object.keys(api.registry.default);
};
api.registry.buildIndex();

api.registry.npmNameToApiName = (
  npmName // api module name
  // Return: npm module name
) => {
  const m = api.registry.indexByNpm[npmName];
  return m ? m.name : undefined;
};

api.registry.apiNameToNpmName = (
  apiName // npm module name
  // Return: api module name
) => {
  const m = api.registry.modules[apiName];
  return m ? m.npm : undefined;
};

api.registry.find = (
  name // npm name string or api name string
  // Return: api module name
) => (
  api.registry.modules[name] || api.registry.indexByNpm[name]
);

api.registry.require = (
  // Impress safe require
  moduleName, // name or alias of required module
  soft // do not show warning on loading error
) => {
  const mr = api.registry.find(moduleName);
  const npmName = mr ? (mr.npm || mr.name) : moduleName;
  let lib = null;
  try {
    lib = require(npmName);
  } catch (err) {
    if (process.workerId === 1 && !soft) {
      let msg = 'Module "' + (npmName || moduleName) + ' can\'t be loaded';
      if (err.message.includes('Cannot find module')) {
        msg += ', you need to install it using npm';
      } else {
        msg += err.stack || err.toString();
        err.isWarning = true;
      }
      if (!global.impress) {
        console.log(api.concolor('b,red')(msg));
        return;
      }
      if (err.isWarning) {
        impress.logException(err);
      } else if (impress.log && impress.log.warning) {
        impress.log.warning(msg);
      } else {
        console.log(msg);
      }
    }
  }
  return lib;
};

api.registry.load = () => {

  api.common = require('metarhia-common');
  api.json = JSON;

  let moduleName, moduleData;
  for (moduleName in api.registry.modules) {
    moduleData = api.registry.modules[moduleName];
    if (moduleData.type === 'impress') {
      api[moduleName] = {};
      require('./api.' + moduleName);
    } else if (moduleData.type === 'node') {
      api[moduleName] = api.registry.require(moduleName);
    } else if (moduleData.type === 'npm') {
      api[moduleName] = api.registry.require(moduleName, true);
    }
  }

};

api.registry.deprecated = {
  require: 'Function "require" is deprecated, use namespaces instead',
  clearImmediate: 'Specify namespace api.timers.clearImmediate()',
  clearInterval: 'Specify namespace api.timers.clearInterval()',
  clearTimeout: 'Specify namespace api.timers.clearTimeout()',
  setImmediate: 'Specify namespace api.timers.setImmediate()',
  setInterval: 'Specify namespace api.timers.setInterval()',
  setTimeout: 'Specify namespace api.timers.setTimeout()',
  //console: 'Specify namespace api.con, example: api.con.log()'
};

api.registry.deprecate = (fn, msg) => {
  let warned = false;
  function deprecated(...args) {
    if (!warned) {
      const err = new Error(msg);
      err.isWarning = true;
      impress.logException(err);
      warned = true;
    }
    return fn(...args);
  }
  return deprecated;
};
