'use strict';

const { metarhia } = require('./deps.js');

const prepare = (unit, application) => {
  const namespaces = application.schemas ? [application.schemas.model] : [];
  const { parameters, returns } = unit;
  const { Schema } = metarhia.metaschema;
  const validation = {
    parameters: parameters ? Schema.from(parameters, namespaces) : null,
    returns: returns ? Schema.from(returns, namespaces) : null,
  };
  const method = async (args) => {
    const { parameters, returns } = validation;
    if (parameters) {
      const { valid, errors } = parameters.check(args);
      const problems = errors.join('; ');
      if (!valid) return new Error('Invalid parameters type: ' + problems);
    }
    const service = method.parent['.service'];
    const verb = unit.method.get ? 'get' : 'post';
    const target = [service.url, unit.method[verb]];
    if (unit.method.path) {
      target.push(...unit.method.path.map((arg) => args[arg]));
    }
    const body = metarhia.metautil.serializeArguments(unit.method.body, args);
    const url = target.join('/');
    const options = { method: verb.toUpperCase(), headers: unit.headers, body };
    const result = await metarhia.metautil.httpApiCall(url, options);
    if (returns) {
      const { valid, errors } = returns.check(result);
      const problems = errors.join('; ');
      if (!valid) return new Error('Invalid result type: ' + problems);
    }
    return result;
  };
  return Object.assign(method, unit);
};

module.exports = { prepare };
