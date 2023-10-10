'use strict';

const { node, metarhia, notLoaded, wt } = require('./deps.js');
const application = require('./application.js');

const logError = (type) => async (err) => {
  const error = metarhia.metautil.isError(err) ? err : new Error('Unknown');
  if (error.name === 'ExperimentalWarning') return;
  const msg = error.stack || error.message || 'no stack trace';
  console.error(type + ': ' + msg);
  if (application.initialization) {
    console.info(`Initialization failed in worker ${wt.threadId}`);
    await application.shutdown();
    process.exit(0);
  }
};

process.removeAllListeners('warning');
process.on('warning', logError('warning'));
process.on('uncaughtException', logError('uncaughtException'));
process.on('unhandledRejection', logError('unhandledRejection'));

(async () => {
  const cfgPath = node.path.join(application.path, 'config');
  const context = metarhia.metavm.createContext({ process });
  const cfgOptions = { mode: process.env.MODE, context };
  const { Config } = metarhia.metaconfiguration;
  const config = await new Config(cfgPath, cfgOptions);
  const logPath = node.path.join(application.root, 'log');
  const home = application.root;
  const workerId = wt.threadId;
  const logOptions = { path: logPath, workerId, ...config.log, home };
  const logger = await new metarhia.metalog.Logger(logOptions);
  logger.on('error', logError('logger error'));
  if (logger.active) global.console = logger.console;
  Object.assign(application, { config, logger, console });

  if (notLoaded.size > 0) {
    if (wt.threadId === 1) {
      const libs = Array.from(notLoaded).join(', ');
      console.error(`Can not load modules: ${libs}`);
    }
    process.exit(0);
  }

  const ready = async () => {
    application.emit('ready');
  };

  const stop = async () => {
    if (application.finalization) return;
    console.info(`Graceful shutdown in worker ${wt.threadId}`);
    await application.shutdown();
    process.exit(0);
  };

  const invoke = async ({ exclusive, data, port }) => {
    const { method, args } = data;
    const { sandbox } = application;
    const handler = metarhia.metautil.namespaceByPath(sandbox, method);
    if (!handler) {
      const error = new Error('Handler not found');
      return void port.postMessage({ name: 'error', error });
    }
    const msg = { name: 'invoke', status: 'done' };
    try {
      const result = await handler(args);
      port.postMessage({ ...msg, data: result });
    } catch (error) {
      port.postMessage({ name: 'error', error });
      application.console.error(error.stack);
    } finally {
      if (exclusive) wt.parentPort.postMessage(msg);
    }
  };

  const handlers = { ready, stop, invoke };
  wt.parentPort.on('message', async (msg) => {
    const handler = handlers[msg.name];
    if (handler) handler(msg);
  });

  await application.load();
  await application.start();
  console.info(`Application started in worker ${wt.threadId}`);
  wt.parentPort.postMessage({ name: 'started', kind: wt.workerData.kind });
})().catch(logError(`Can not start worker ${wt.threadId}`));
