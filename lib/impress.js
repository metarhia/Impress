'use strict';

// Impress Application Server
//
require('./api.registry');
api.registry.load();

global.impress = new api.events.EventEmitter();
impress.isImpress = true;
require('./impress.constants');
impress.dir = process.cwd().replace(impress.BACKSLASH_REGEXP, '/');
impress.applicationsDir = impress.dir + '/applications';
impress.moduleDir = api.path.dirname(__dirname);

// Mixin to process
process.isWin = !!process.platform.match(/^win/);
process.isWorker = ('WORKER_SERVER_NAME' in process.env);
process.isMaster = !process.isWorker;

// Node.js process fork
//
process.fork = function(env) {
  var modulePath = process.argv[1],
      args = process.argv.slice(2);
  var opt = {
   env: api.util._extend(process.env, env)
   // Object.assign(process.env, env)
  };
  return api.cp.fork(modulePath, args, opt);
};

// Load configuration definition
//
impress.serverConfigDefinition = api.definition.require('config.impress.definition');
impress.applicationConfigDefinition = api.definition.require('config.application.definition');

// Intercept uncaught exception
//
process.on('uncaughtException', function(err) {
  if (err.code === 'EINVAL') impress.fatalError('Can`t bind to host/port');
  else api.impress.logException(err);
  impress.shutdown(1);
});

// Parse command line to extract memory limit
//
process.execArgv.forEach(function(val) {
  if (val.indexOf('--max_old_space_size') === 0) {
    var sp = val.split('=');
    if (sp[1]) impress.memoryLimit = parseInt(sp[1], 10) * 900000;
  }
});

// If memory limit detected we can check it periodically (5s by default)
//
if (impress.memoryLimit) {
  api.timers.setInterval(function() {
    var mu = process.memoryUsage();
    if (mu.heapTotal > impress.memoryLimit) {
      impress.cache.clear();
      var application, appName;
      for (appName in impress.applications) {
        application = impress.applications[appName];
        application.cache.clear();
      }
      mu = process.memoryUsage();
      if (mu.heapTotal > impress.memoryLimit) {
        impress.fatalError(
          'Memory limit exceeded: ' +
          api.common.bytesToSize(mu.heapTotal) +
          ', restarting'
        );
      }
    }
  }, impress.MEMORY_LIMIT_CHECK_INTERVAL);
}

impress.stat = {
  forkCount: 0,
  eventCount: 0,
  requestCount:  0,
  responseCount: 0
};

impress.applications = {};
impress.server = new api.events.EventEmitter();
impress.nextWorkerId = 1;

// Load plugins
//
impress.loadPlugins = function() {
  var plugin, pluginName, pluginPath;
  for (var i = 0, len = impress.CORE_PLUGINS.length; i < len; i++) {
    pluginName = impress.CORE_PLUGINS[i];
    pluginPath = './impress.' + pluginName + '.js';
    impress[pluginName] = {};
    require(pluginPath);
    plugin = impress[pluginName];
    if (plugin.mixImpress) plugin.mixin(impress);
  }
};

// Mixin plugins
//
impress.mixinPlugins = function(application) {
  var plugin, pluginName;
  for (var i = 0, len = impress.CORE_PLUGINS.length; i < len; i++) {
    pluginName = impress.CORE_PLUGINS[i];
    plugin = impress[pluginName];
    application[pluginName] = {};
    if (plugin.mixin) plugin.mixin(application);
  }
};

// Compare masks
//
impress.compareMasks = function(m1, m2) {
  return (m1 === m2 || m1 === '*' || m2 === '*');
};

// Compare hosts
//
impress.compareHosts = function() {
  var config, hosts, appName, cmp = [];
  for (appName in impress.applications) {
    config = impress.applications[appName].config;
    if (config) {
      hosts = config.hosts;
      if (hosts) {
        for (var i = 0, ilen = hosts.length; i < ilen; i++) {
          for (var j = 0, jlen = cmp.length; j < jlen; j++) {
            if (impress.compareMasks(hosts[i], cmp[j])) {
              impress.log.warning(
                'Hosts mask overlapping: "' + hosts[i] + '" and "' + cmp[j] + '"'
              );
            }
          }
        }
        for (var k = 0, klen = hosts.length; k < klen; k++) {
          if (cmp.indexOf(hosts[k]) === -1) cmp.push(hosts[k]);
        }
      }
    }
  }
};

// Fatal error with process termination
//   msg - fatal error message
//
impress.fatalError = function(msg) {
  if (impress.log && impress.log.error) {
    impress.log.server('Crashed');
    impress.log.error(msg);
    impress.log.close(function() {
      process.exit(1);
    });
  } else {
    console.log(msg.red.bold);
    process.exit(1);
  }
};

// Detect application directory
//   appName - application name
//   callback - function(dir)
//     dir - path to directory or null
//
impress.detectAppDir = function(appName, callback) {
  var dir, linkFile;
  dir = impress.applicationsDir + '/' + appName;
  linkFile = dir + '/application.link';
  api.fs.stat(dir, function(err, stats) {
    if (!err && stats.isDirectory()) {
      api.fs.exists(linkFile, function(existsLink) {
        if (existsLink) {
          api.fs.readFile(linkFile, function(err, appLink) {
            dir = api.impress.removeBOM(appLink);
            dir = api.path.resolve(impress.dir, dir);
            callback(dir);
          });
        } else callback(dir);
      });
    } else callback(null);
  });
};


// Load applications
//   callback - function on finish
//
impress.loadApplications = function(callback) {
  if (process.isMaster) callback();
  else if (impress.workerApplications) {
    impress.loadApplicationsList(callback);
  } else {
    var server = impress.config.servers[impress.serverName];
    if (server && server.applications) {
      impress.workerApplications = server.applications;
      impress.loadApplicationsList(callback);
    } else {
      api.fs.readdir(impress.applicationsDir, function(err, apps) {
        if (err) {
          impress.fatalError(impress.CANT_READ_DIR + impress.applicationsDir);
          callback();
        } else {
          impress.workerApplications = apps;
          impress.loadApplicationsList(callback);
        }
      });
    }
  }
};

// Load applications from impress.workerApplications
//   callback - function on finish
//
impress.loadApplicationsList = function(callback) {
  api.metasync.each(impress.workerApplications, function(appName, cb) {
    impress.detectAppDir(appName, function(dir) {
      if (dir) impress.loadApplication(appName, dir, callback);
      else cb();
    });
  }, function() {
    impress.linkNamespaces();
    callback();
  });
};

// Load application
//   appName - application name
//   dir - application directory
//   callback - function on finish
//
impress.loadApplication = function(appName, dir, callback) {
  var application = new api.events.EventEmitter();
  application.name = appName;
  application.dir = dir;
  impress.mixinPlugins(application);
  impress.applications[application.name] = application;
  application.createSandbox(function() {
    application.loadConfig(function() {
      application.preprocessConfig();
      application.log.init();
      application.log.open(function() {
        application.emit('start');
        api.db.openApplicationDatabases(application, function() {
          application.loadPlaces(function() {
            application.loadApi(function() {
              application.emit('started');
              callback();
            });
          });
        });
      });
    });
  });
};

// Import/export namespaces after all applications loaded
//
impress.linkNamespaces = function() {
  var appName, application, exp, imp, impHash, impAppName, impApp, impObjName, expObjName, impObj;
  for (appName in impress.applications) {
    application = impress.applications[appName];
    imp = api.common.getByPath(application, 'config.sandbox.import');
    if (imp) {
      for (impAppName in imp) {
        impHash = imp[impAppName];
        impApp = impress.applications[impAppName];
        exp = api.common.getByPath(impApp , 'config.sandbox.export');
        if (impApp && impHash && exp) {
          for (expObjName in impHash) {
            impObjName = impHash[expObjName];
            impObj = api.common.getByPath(impApp.sandbox, expObjName);
            if (exp.indexOf(expObjName) !== -1) {
              api.common.setByPath(application.sandbox, impObjName, impObj);
            } else {
              application.log.warning(
                'Application ' + appName + ' imports namespace ' + expObjName +
                ' from ' + impAppName +
                ' as ' + impObjName + ' but it is not exported'
              );
            }
          }
        }
      }
    }
  }
};

impress.firstStart = true;

// Start servers
//
impress.server.start = function() {
  impress.loadPlugins();
  impress.mode = process.env.IMPRESS_MODE || '';
  impress.workerId = process.isMaster ? 0 : process.env.WORKER_ID;
  impress.workerType = process.env.WORKER_TYPE;
  impress.serverName = process.env.WORKER_SERVER_NAME;
  if (process.isMaster) {
    console.log(
      'Impress Application Server'.green.bold +
      ' starting, reading configuration'.green
    );
  }
  impress.createSandbox(function() {
    impress.loadConfig(function() {
      impress.preprocessConfig();
      impress.log.init();
      impress.log.open(function() {
        if (impress.workerType === 'long') {
          impress.nodeId = impress.config.scale.server + 'L' + impress.workerId;
          process.title = 'impress ' + impress.nodeId;
          impress.workerApplications = [process.env.WORKER_APPNAME];
          impress.workerApplicationName = process.env.WORKER_APPNAME;
          impress.workerApplicationFile = process.env.WORKER_FILE;
          impress.workerApplicationClient = api.json.parse(process.env.WORKER_CLIENT);
          impress.workerApplicationClient.runScript = impress.Client.prototype.runScript;
        } else {
          impress.nodeId = impress.config.scale.server + 'N' + impress.workerId;
          process.title = 'impress ' + (process.isMaster ? 'srv' : impress.nodeId);
        }
        impress.processMarker = (
          (process.isMaster ? 'Master' : 'Worker') +
          '(' + process.pid + '/' + impress.nodeId + ')'
        );
        if (process.isMaster && impress.config.scale && impress.config.scale.check) {
          console.log('Startup check: '.green + impress.config.scale.check);
          api.http.get(impress.config.scale.check, function(res) {
            if (res.statusCode === 404) {
              impress.server.load();
            } else {
              impress.fatalError(impress.ALREADY_STARTED);
            }
          }).on('error', impress.server.load);
        } else {
          impress.server.load();
        }
      });
    });
  });
};

// Load server
//
impress.server.load = function() {
  impress.ipc();
  impress.loadApplications(function() {
    if (process.isMaster) {
      impress.log.server('Started server');
    } else {
      process.send({ name: 'impress:start', id: impress.workerId });
      impress.log.server('Forked worker');
    }
    if (impress.workerApplicationName) {
      var application = impress.applications[impress.workerApplicationName];
      impress.workerApplicationClient.application = application;
      impress.workerApplicationClient.access = { allowed: true };
      impress.workerApplicationClient.runScript(
        'worker',
        impress.workerApplicationFile,
        function() {
          impress.log.close(function() {
            process.exit(0);
          });
        }
      );
    }
  });
  if (!impress.workerApplicationName) {
    impress.startServers();
    impress.health.init();
    impress.cloud.init();
  }
  // Set garbage collection interval
  if (typeof(global.gc) === 'function' && impress.config.scale.gc > 0) {
    api.timers.setInterval(global.gc, impress.config.scale.gc);
  }
  impress.firstStart = false;
};

// Establish IPC processing
//
impress.ipc = function() {
  process.on('SIGINT', impress.shutdown);
  process.on('SIGTERM', impress.shutdown);

  if (process.isWorker) {
    process.on('message', function(message) {
      // Message is a first parameter
      // Second parameter usually used for socket handle
      var application = impress.applications[message.appName];
      if (message.name === 'impress:forklongworker') {
        delete message.name;
        if (application) application.workers[message.nodeId] = message;
      } else if (message.name === 'impress:exitlongworker') {
        if (application) delete application.workers[message.nodeId];
      }
    });
    process.on('beforeExit', function(code) {
      process.send({ name:'impress:exit', code: code });
      impress.log.server('Terminated worker');
    });
  }
};

// Unload configuration and stop server
//
impress.server.stop = function() {
  var servers = impress.config.servers;
  impress.cache.clear();
  if (servers) {
    var keys = Object.keys(servers);
    keys.forEach(function(serverName) {
      var server = servers[serverName];
      if (server.instance) server.instance.close(function() {
        var application, appName;
        for (appName in impress.applications) {
          application = impress.applications[appName];
          application.emit('stop');
          application.stopTasks();
          application.cache.clear();
        }
      });
    });
  } else impress.log.warning('No servers active');
};

// Shutdown IAS
//
impress.shutdown = function(code) {
  if (code === undefined) code = 0;
  if (process.isMaster) {
    impress.log.server('Stopped server');
    impress.server.stop();
    console.log('Impress shutting down'.green.bold);
  } else {
    impress.log.server('Terminated worker');
  }
  impress.log.close(function() {
    process.exit(code);
  });
};

// Start JSTP, JSTPS, HTTP and HTTPS servers
//
impress.startServers = function() {
  var server, servers = impress.config.servers,
      workerId = 0;

  var msg, serverName, serverNames = Object.keys(servers);
  impress.serversCount = serverNames.length;
  impress.serversStarted = 1;
  for (var n = 0, len = serverNames.length; n < len; n++) {
    serverName = serverNames[n];
    server = servers[serverName];
    server.name = serverName;
    if (process.isMaster) {
      if (serverName === 'master') {
        var certificate;
        if (server.protocol === 'jspts') {
          certificate = impress.loadCertificates(server);
        }
        server.instance = api.jstp.createServer(certificate);
      } else if (impress.firstStart) {
        impress.forkWorker(workerId++, serverName);
      }
    } else if (impress.serverName === serverName) {
      if (server.protocol === 'jstp') {
        server.instance = api.jstp.createServer();
      } else if (server.protocol === 'jstps') {
        server.instance = api.jstp.createServer(impress.loadCertificates(server));
      } else {
        if (server.protocol === 'https') {
          server.instance = api.https.createServer(
            impress.loadCertificates(server),
            impress.dispatcher
          );
        } else {
          server.instance = api.http.createServer(impress.dispatcher);
        }
        impress.websocket.upgradeServer(server.instance);
      }
    }
    if (server.instance) {
      msg = (
        server.protocol.toUpperCase() +
        ' listen on ' + server.address + ':' + server.port +
        ' by ' + impress.processMarker
      );
      if (serverName === 'master') msg += ' Cloud Controller';
      console.log('  ' + msg);
      impress.log.server(msg);

      impress.setListenerError(
        server.instance,
        server.address + ':' + server.port
      );
      if (server.instance.setTimeout) {
        server.instance.keepAlive = server.keepAlive;
        server.instance.setTimeout(server.timeout, impress.serverOnTimeout);
      }
      server.instance.serverName = serverName;
      if (!server.nagle) {
        server.instance.on('connection', impress.serverSetNoDelay);
      }
      if (server.address === '*') {
        server.instance.listen(server.port);
      } else {
        server.instance.listen(server.port, server.address);
      }
    }
  }
};

// Load SSL certificates
//
impress.loadCertificates = function(server) {
  if (server.key && server.cert) {
    var certDir = impress.dir + '/config/ssl/';
    return {
      key: api.fs.readFileSync(certDir + server.key),
      cert: api.fs.readFileSync(certDir + server.cert)
    };
  } else {
    impress.fatalError('SSL certificate is not configured for HTTPS');
  }
};

// Detect bind error (note: some node.js versions have error in constant name)
//
impress.serverOnError = function(err) {
  if (['EADDRINUSE', 'EACCESS', 'EACCES'].indexOf(err.code) > -1) {
    var msg = 'Can`t bind to host/port ' + err.address;
    if (process.isWorker) {
      process.send({ name: 'impress:exit', error: msg });
    } else {
      impress.fatalError(msg);
    }
  }
};

// Add error handler for certain address
//
impress.setListenerError = function(listener, address) {
  listener.on('error', function(err) {
    err.address = address;
    impress.serverOnError(err);
  });
};

// Send request timeout
//
impress.serverOnTimeout = function(socket) {
  if (socket.client && !socket.client.finished) {
    socket.client.timedOut = true;
    socket.client.error(408);
  } else socket.destroy();
};

// Disable nagle's algorithm
//
impress.serverSetNoDelay = function(socket) {
  socket.setNoDelay();
};

// Fork new worker
// bind worker to serverName from config if serverName defined
//
impress.forkWorker = function(workerId, serverName) {
  var worker, env = {};
  env.WORKER_ID = workerId + 1;
  env.WORKER_TYPE = 'server';
  if (serverName !== undefined) env.WORKER_SERVER_NAME = serverName;
  impress.nextWorkerId++;
  worker = process.fork(env);
  worker.nodeId = impress.config.scale.server + 'N' + (workerId + 1);
  impress.stat.forkCount++;
  worker.on('exit', function(code, signal) {
    impress.stat.forkCount--;
    if (code > 0) api.timers.setTimeout(function() {
      impress.forkWorker(workerId, serverName);
    });
  });
  impress.listenWorker(worker);
};

// Fork long worker
//   appName    - application name to run worker in application context (config and database connections)
//   workerFile - filename with path
//   clientData - JSON serialized client request data
//
impress.forkLongWorker = function(appName, workerFile, clientData) {
  var application = impress.applications[appName];
  if (application) {
    if (process.isMaster) {
      var env = {},
          workerId = impress.nextWorkerId;
      env.WORKER_ID = workerId;
      env.WORKER_TYPE = 'long';
      env.WORKER_FILE = workerFile;
      env.WORKER_APPNAME = appName;
      env.WORKER_CLIENT = clientData;
      impress.nextWorkerId++;
      var worker = process.fork(env);
      worker.file = workerFile;
      worker.nodeId = impress.config.scale.server + 'L' + workerId;
      impress.listenWorker(worker);
      application.longWorkers[worker.id] = worker;
      impress.stat.forkCount++;
      worker.on('exit', function(code, signal) {
        impress.retranslateEvent(-1, {
          name: 'impress:exitlongworker',
          appName: appName,
          nodeId: worker.nodeId
        });
        impress.stat.forkCount--;
        delete application.longWorkers[worker.id];
        delete application.workers[worker.nodeId];
      });
      return worker;
    } else {
      process.send({
        name: 'impress:forklongworker',
        appName: appName,
        workerFile: workerFile,
        clientData: clientData
      });
    }
  }
};

// Kill long worker
//   appName    - application name
//   workerFile - filename with path
//   nodeId     - kill worker by id
//
impress.killLongWorker = function(appName, workerFile, nodeId) {
  var application = impress.applications[appName];
  if (application) {
    if (process.isMaster) {
      var worker;
      for (var workerId in application.longWorkers) {
        worker = application.longWorkers[workerId];
        if (worker.file === workerFile && (!nodeId || (worker.nodeId === nodeId))) {
          worker.emit('exit', worker);
          worker.removeAllListeners('exit');
          impress.log.server('Kill ' + worker.pid + '/' + worker.nodeId);
          worker.kill();
          impress.stat.forkCount++;
        }
      }
    } else {
      process.send({
        name: 'impress:killlongworker',
        appName: appName,
        workerFile: workerFile
      });
    }
  }
};

// Initialize IPC for interprocess event routing
// Master receive events from workers here
//
impress.listenWorker = function(worker) {
  worker.on('message', function(message) {
    if (message.name === 'impress:exit') {
      impress.fatalError(message.error);
    }
    if (message.name === 'impress:start') {
      impress.serversStarted++;
      if (impress.serversStarted >= impress.serversCount) {
        impress.server.emit('started');
      }
    }
    var application = impress.applications[message.appName];
    if (application) {
      if (message.name === 'impress:forklongworker') {
        var longWorker = impress.forkLongWorker(
          message.appName,
          message.workerFile,
          message.clientData
        );
        message.pid = longWorker.pid;
        message.nodeId = longWorker.nodeId;
        impress.retranslateEvent(-1, message);
        delete message.name;
        application.workers[message.nodeId] = message;
      } else if (message.name === 'impress:killlongworker') {
        impress.killLongWorker(message.appName, message.workerFile);
      }
    }
  });
};

// Retranslate IPC event to all workers except one
//
impress.retranslateEvent = function(exceptWorkerId, message) {
  var worker;
  exceptWorkerId = exceptWorkerId + '';
  for (var workerId in api.impress.workers) {
    worker = api.impress.workers[workerId];
    if (workerId !== exceptWorkerId) worker.send(message);
  }
};

// Dispatch requests
//   req - request is an instance of http.IncomingMessage
//   res - rsponse is an instance of http.ServerResponse
//
impress.dispatcher = function(req, res) {
  impress.stat.requestCount++;
  var application, appName,
      host = api.impress.parseHost(req.headers.host);
  for (appName in impress.applications) {
    application = impress.applications[appName];
    if (application.config.hosts) {
      if (application && application.hostsRx) {
        if (application.hostsRx.test(host)) {
          return application.dispatch(req, res);
        }
      } else if (application.config.hosts.indexOf(host) > -1) {
        return application.dispatch(req, res);
      }
    }
  }
  // No application detected to dispatch request
  var client = new impress.Client(impress, req, res);
  client.error(404);
};
