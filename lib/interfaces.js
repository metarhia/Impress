'use strict';

const { node, metarhia } = require('./dependencies.js');
const { fsp, path } = node;
const { metavm, metautil } = metarhia;
const { Procedure } = require('./procedure.js');

const { Cache } = require('./cache.js');

const getSignature = (method) => {
  const src = method.toString();
  const signature = metautil.between(src, '({', '})');
  if (signature === '') return [];
  return signature.split(',').map((s) => s.trim());
};

class Interfaces extends Cache {
  constructor(place, application) {
    super(place, application);
    this.collection = {};
    this.signatures = {};
  }

  async createScript(fileName) {
    try {
      const code = await fsp.readFile(fileName, 'utf8');
      if (!code) return null;
      const src = 'context => ' + code;
      const options = { context: this.application.sandbox };
      const { exports } = new metavm.MetaScript(fileName, src, options);
      return exports;
    } catch (err) {
      if (err.code !== 'ENOENT') {
        this.application.console.error(err.stack);
      }
      return null;
    }
  }

  cacheSignature(interfaceName, methodName, method) {
    const name = path.basename(interfaceName, '.js');
    let interfaceMethods = this.signatures[name];
    if (!interfaceMethods) {
      this.signatures[name] = interfaceMethods = {};
    }
    interfaceMethods[methodName] = getSignature(method);
  }

  delete(filePath) {
    const relPath = filePath.substring(this.path.length + 1);
    if (!relPath.includes(path.sep)) return;
    const [interfaceName, methodFile] = relPath.split(path.sep);
    if (!methodFile.endsWith('.js')) return;
    const name = path.basename(methodFile, '.js');
    const [iname, ver] = interfaceName.split('.');
    const version = parseInt(ver, 10);
    const iface = this.collection[iname];
    if (!iface) return null;
    const methods = iface[version.toString()];
    if (methods) delete methods[name];
    const internalInterface = this.application.sandbox.api[iname];
    if (internalInterface) delete internalInterface[name];
  }

  async change(filePath) {
    if (!filePath.endsWith('.js')) return;
    let script = await this.createScript(filePath);
    if (!script) return;
    const proc = new Procedure(script, 'method', this.application);
    let iface = proc.exports;
    const relPath = filePath.substring(this.path.length + 1);
    const [interfaceName, methodFile] = relPath.split(path.sep);
    const { internalInterface, methods } = this.prepareInterface(interfaceName);
    if (methodFile) {
      const name = path.basename(methodFile, '.js');
      methods[name] = proc;
      if (proc.method) {
        internalInterface[name] = proc.method;
        this.cacheSignature(interfaceName, name, proc.method);
      } else {
        internalInterface[name] = proc.exports;
      }
      return;
    }
    if (iface.plugin) {
      const [library, name] = iface.plugin.split('/');
      const plugin = metarhia[library].plugins[name];
      if (!plugin) return;
      script = plugin(iface);
      iface = script();
    }
    for (const name of Object.keys(iface)) {
      const proc = new Procedure(script, name, this.application);
      methods[name] = proc;
      internalInterface[name] = proc.method;
      this.cacheSignature(interfaceName, name, proc.method);
    }
  }

  prepareInterface(interfaceName) {
    const [iname, ver] = interfaceName.split('.');
    const version = parseInt(ver, 10);
    let iface = this.collection[iname];
    const { api } = this.application.sandbox;
    let internalInterface = api[iname];
    if (!iface) {
      this.collection[iname] = iface = { default: version };
      api[iname] = internalInterface = {};
    }
    if (version > iface.default) iface.default = version;
    let methods = iface[ver];
    if (!methods) iface[ver] = methods = {};
    return { internalInterface, methods };
  }
}

module.exports = { Interfaces };
