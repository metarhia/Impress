'use strict';

// Application interface for Impress Application Server

// Directories for application
//
//impress.application.dirs = [
//  'www', 'static', 'config',
//  'tasks', 'init', 'setup', 'model', 'lib',
//  'files', 'templates'
//];
impress.application.places = ['tasks', 'init', 'setup', 'model', 'lib', 'api'];
impress.application.templates = ['error', 'index', 'introspection'];

// This plugin should be mixed to impress application
//
impress.application.mixImpress = true;

// Mixin application methods to given object
// Application should have:
//   .dir - application root
//
impress.application.mixin = function(application) {

  application.isInitialized = false;
  application.backend = api.common.eventEmitter();
  application.frontend = api.common.eventEmitter();

  // Initialize properties after config loaded
  //
  application.on('start', function() {
    application.nodeId = impress.nodeId;
    application.serverId = impress.config.scale.server;
    application.cloudInstance = impress.config.scale.instance;
  });

  application.config = {}; // key is file name, value is object
  application.tasks = {}; // key is task name, value is scheduled Function
  application.model = {}; // key is model name, value is object
  application.users = {}; // key is login, value is instance of User class
  application.sessions = {}; // key is sid, value is instance of Session class
  application.channels = {};
  application.workers = {};
  application.longWorkers = {};
  application.api = {}; // all APIs will be loaded here on start

  if (application !== impress) {
    impress.firewall.addApplication(application);
  }

  // Refactor: remove .domain from application
  application.domain = api.domain.create();

  // Create execution domain
  //
  application.catchException = function(err) {
    if (application.domain.client) {
      // Refactor: remove .client from domain
      application.domain.client.error(500, err);
      application.domain.client = null;
    }
    application.logException(err);
  };

  application.domain.on('error', application.catchException);

  // Log application error with stack trace
  //
  application.logException = function(err) {
    var stack = err.stack;
    if (!stack) stack = err.toString();
    impress.STACK_REGEXP.map(function(rx) {
      stack = stack.replace(rx[0], rx[1]);
    });
    if (err.isWarning && application.log && application.log.warning) {
      stack = stack.replace(/^Error: /, 'Warning: ');
      application.log.warning(stack);
    } else if (application.log && application.log.error) {
      application.log.error(stack);
    } else {
      console.log(err.stack);
    }
  };

  // Check system templates
  //
  function checkTemplate(templateName, templatePath) {
    api.fs.exists(templatePath, function(exists) {
      if (exists) application.systemTemplates[templateName] = templatePath;
    });
  }

  application.systemTemplates = {};
  var templateName, templatePath;
  for (var j = 0, jlen = impress.application.templates.length; j < jlen; j++) {
    templateName = impress.application.templates[j];
    templatePath = application.dir + '/templates/' + templateName + '.template';
    application.systemTemplates[templateName] = (
      impress.moduleDir + '/templates/' + templateName + '.template'
    );
    checkTemplate(templateName, templatePath);
  }

  // Convert absolute path to relative
  //
  application.relative = function(path) {
    return path.substr(application.dir.length);
  };

  function apiWrap(source) {
    return impress.USE_STRICT + '(connection => (' + source + '))';
  }

  function codeWrap(source) {
    var isObj = source[0] === impress.ASCII_BRACE_OPENING;
    var code = isObj ? '(' + source + ')' : source;
    return impress.USE_STRICT + code;
  }

  // Compile, execute and save script exports to cache or get exports from cache
  //   fileName - file name (absolute path)
  //   code - JavaScript code
  //   return - exported function or object exported from script
  //
  application.prepareScript = function(fileName, source) {
    var fn, exports, code, wrapper,
        scriptName, scriptDir, script;
    try {
      fn = application.relative(fileName);
      scriptDir = application.isImpress ? impress.dir : impress.applicationsDir;
      scriptName = fileName.replace(scriptDir, '');
      wrapper = fn.startsWith('/api/') ? apiWrap : codeWrap;
      code = wrapper(source);
      script = api.vm.createScript(code, scriptName);
      exports = script.runInNewContext(application.sandbox);
      application.cache.scripts[application.relative(fileName)] = exports;
      return exports;
    } catch (err) {
      err.stack = err.toString() + ' in ' + scriptName;
      application.logException(err);
      return null;
    }
  };

  // Compile, execute and save script exports to cache or get exports from cache
  //   fileName - file name (absolute path)
  //   callback(err, exports)
  //     exports - function or object exported from script
  //
  application.createScript = function(fileName, callback) {
    var exports = application.cache.scripts[application.relative(fileName)];
    if (exports && callback) callback(null, exports);
    else api.fs.readFile(fileName, function(err, code) {
      if (err) {
        application.log.error(impress.CANT_READ_FILE + fileName);
        callback(err);
      } else {
        exports = application.prepareScript(fileName, code);
        callback(null, exports);
      }
    });
  };

  // Synchronous version of application.createScript
  //   fileName - file name (absolute path)
  //   return module exports
  //
  application.require = application.require || function(fileName) {
    var exports = application.cache.scripts[application.relative(fileName)];
    if (!exports) {
      try {
        var code = api.fs.readFileSync(fileName);
        if (!code) application.log.error(impress.CANT_READ_FILE + fileName);
        else exports = application.prepareScript(fileName, code);
      } catch (err) {
        err.stack = err.toString() + ' in ' + fileName;
        application.logException(err);
      }
    }
    return exports;
  };

  // Global require for sandbox
  //
  function gobalRequire(moduleName) {
    var exports;
    if (moduleName.indexOf('..') === -1) {
      var path = application.dir + '/node_modules/' + moduleName;
      try {
        exports = require(path);
      } catch (err) {
        application.logException(err);
      }
    } else {
      application.logException(new Error(
        'Access denied. Application can`t require module: ' + moduleName
      ));
    }
    return exports;
  }

  // Create application sandbox
  //
  application.createSandbox = function(callback) {
    var sandbox = {
      api: {},
      callInContext: impress.callInContextMethod
    };
    sandbox.global = sandbox;
    sandbox.application = application;
    application.sandbox = api.vm.createContext(sandbox);
    application.getSandboxConfig(function() {
      var moduleLink, moduleName, msg;
      var globals = (
        application.config.sandbox.global || impress.DEFAULT_SANDBOX
      );
      for (var i = 0, len = globals.length; i < len; i++) {
        moduleName = globals[i];
        if (moduleName === 'require') moduleLink = gobalRequire;
        else moduleLink = global[moduleName];
        if (moduleLink) {
          if (moduleName in api.registry.deprecated) {
            msg = api.registry.deprecated[moduleName];
            moduleLink = api.registry.deprecate(moduleLink, msg);
          }
          application.sandbox[moduleName] = moduleLink;
        }
      }
      var apis = application.config.sandbox.api || api.registry.defaultNames;
      for (var j = 0, jlen = apis.length; j < jlen; j++) {
        moduleName = apis[j];
        moduleLink = api[moduleName];
        if (!moduleLink) moduleLink = api.registry.require(moduleName);
        moduleName = api.common.spinalToCamel(moduleName);
        if (moduleLink) application.sandbox.api[moduleName] = moduleLink;
      }
      callback();
    });
  };

  // Create application sandbox
  //
  application.getSandboxConfig = function(callback) {
    if (application === impress) {
      application.config.sandbox = impress.DEFAULT_API;
      callback();
    } else {
      application.loadConfigFile('sandbox.js', function() {
        if (!application.config.sandbox) {
          application.config.sandbox = impress.DEFAULT_API;
        }
        callback();
      });
    }
  };

  // Call given function in application sandbox context
  // Context will be single parameter of the call
  //
  application.callInContext = function(fn) {
    application.sandbox.__callInContext = fn;
    impress.callInContextScript.runInNewContext(application.sandbox);
    delete application.sandbox.__callInContext;
  };

  // Preload all handlers in directory
  //   relPath - relative path from /www
  //   depth - recursion depth, 0 - maximum, 1 - one level (no recursion), etc.
  //   callback(err, directories) - preload finish
  //
  application.preloadDirectory = function(relPath, depth, callback) {
    if (!callback) callback = api.common.emptyness;
    if (depth === undefined) depth = 0;
    var absPath = application.dir + '/www' + relPath;
    api.fs.readdir(absPath, function(err, files) {
      var directories = [];
      if (err) {
        application.log.error(impress.CANT_READ_DIR + absPath);
        callback(err);
      } else if (files.length > 0) {
        api.metasync.each(files, function(fileName, cb) {
          var fileExt = api.common.fileExt(fileName),
              filePath = api.common.addTrailingSlash(absPath) + fileName;
          api.fs.stat(filePath, function(err, stats) {
            if (!err) {
              if (stats.isDirectory() && (depth === 0 || depth > 1)) {
                directories.push(fileName);
                application.preloadDirectory(
                  api.common.addTrailingSlash(relPath) + fileName, depth - 1, cb
                );
              } else if (fileExt === 'js') {
                application.createScript(filePath, cb);
              } else cb();
            } else cb();
          });
        }, function() {
          callback(null, directories);
        });
        application.cache.watch(relPath);
      } else callback(null, directories);
    });
  };

  // Load API to memory
  //   callback - on finish
  //
  application.loadApi = function(callback) {
    var relPath = '/api/',
        absPath = application.dir + relPath;
    api.fs.readdir(absPath, function(err, files) {
      if (err) {
        application.log.error(impress.CANT_READ_DIR + absPath);
        callback(err);
      } else if (files.length > 0) {
        api.metasync.each(files, function(fileName, cb) {
          var filePath = absPath + fileName;
          api.fs.stat(filePath, function(err, stats) {
            if (!err && stats.isDirectory()) {
              application.loadApiInterface(fileName, filePath, cb);
              // api.common.addTrailingSlash(relPath) + fileName
              // if (fileExt === 'js') application.createScript(filePath, cb);
            } else cb();
          });
        }, callback);
        application.cache.watch(relPath);
      } else callback(null);
    });
  };

  // Load API interface to memory
  //   callback - on finish
  //
  application.loadApiInterface = function(interfaceName, path, callback) {
    var relPath = '/api/' + interfaceName,
        apiInterface = {};
    application.api[interfaceName] = apiInterface;
    api.fs.readdir(path, function(err, files) {
      if (err) {
        application.log.error(impress.CANT_READ_DIR + relPath);
        callback(err);
      } else if (files.length > 0) {
        api.metasync.each(files, function(fileName, cb) {
          var fileExt = api.common.fileExt(fileName),
              methodName = fileName.substr(0, fileName.length - 3),
              filePath = path + '/' + fileName;
          api.fs.stat(filePath, function(err, stats) {
            if (!err && stats.isFile() && fileExt === 'js') {
              application.createScript(filePath, function(err, exports) {
                apiInterface[methodName] = exports;
                cb();
              });
            } else cb();
          });
        }, callback);
        application.cache.watch(relPath);
      } else callback(null);
    });
  };

  // Load configuration files
  //
  application.loadConfig = function(callback) {
    api.fs.readdir(application.dir + '/config', function(err, files) {
      if (err) {
        application.log.error(
          impress.CANT_READ_DIR + application.dir + '/config'
        );
        callback();
      } else {
        files.sort(api.common.sortCompareConfig);
        api.metasync.filter(files, function(file, cb) {
          var fileExt = api.path.extname(file),
              fileName = api.path.basename(file, fileExt);
          if (!impress.mode) cb(!api.common.contains(fileName, '.'));
          else {
            var modeName = api.path.extname(fileName);
            var fName = fileName + '.' + impress.mode + fileExt;
            cb(
              !api.common.inArray(files, fName) &&
              (modeName === '' || modeName === '.' + impress.mode)
            );
          }
        }, function(files) {
          api.metasync.series(files, application.loadConfigFile, callback);
        });
      }
    });
    application.cache.watch('/config');
  };

  // Load single configuration file
  //
  application.loadConfigFile = function(file, callback) {
    var configFile = application.dir + '/config/' + file;
    var configDefinition = (
      application === impress ?
      impress.serverConfigDefinition : impress.applicationConfigDefinition
    );
    var sectionName, validationResult;
    var fileExt = api.path.extname(file);
    var fileName = api.path.basename(file, fileExt);
    if (impress.mode) {
      sectionName = api.path.basename(fileName, '.' + impress.mode);
    } else sectionName = fileName;
    if (fileExt === '.js') {
      if (!application.config[sectionName]) {
        application.createScript(configFile, function(err, exports) {
          application.config[sectionName] = exports;
          // Validate configuration
          if (configDefinition[sectionName]) {
            validationResult = api.definition.validate(
              exports, configDefinition, sectionName, true
            );
            if (process.isMaster) {
              api.definition.printErrors(
                'Error(s) in configuration found:\n'.red.bold +
                'Application: ' + application.name.yellow.bold +
                ' Config file: ' + (sectionName + '.js').yellow.bold,
                validationResult
              );
            }
          }
          callback();
        });
      } else callback();
    } else callback();
  };

  // Preprocess application configuration
  //
  application.preprocessConfig = function() {
    var config = application.config;
    if (Array.isArray(config.hosts)) {
      if (config.hosts.join('').indexOf('*') > -1) {
        application.hostsRx = api.common.arrayRegExp(config.hosts);
      }
    } else if (application !== impress) {
      application.log.error('Configuration error: empty or wrong hosts.js');
    }

    var server, serverName, serviceName, cpus, i, ilen, srv, port,
        servers = config.servers;
    config.servers = {};
    for (serverName in servers) {
      server = servers[serverName];
      if (server.ports.length > 1) {
        cpus = api.os.cpus().length;
        server.ports = api.common.sequence(server.ports, cpus);
      }
      for (i = 0, ilen = server.ports.length; i < ilen; i++) {
        port = server.ports[i];
        srv = api.common.clone(server);
        srv.port = port;
        serviceName = serverName === 'master' ? serverName : serverName + port;
        if (srv.inspect) srv.inspect += i;
        config.servers[serviceName] = srv;
      }
    }

    if (!application.isInitialized && application !== impress) {
      application.isInitialized = true;
      if (config.routes) { // Prepare application routes
        var j, jlen, route, rx, routes = config.routes;
        for (j = 0, jlen = routes.length; j < jlen; j++) {
          route = routes[j];
          rx = !route.escaping ? route.url : ('^' + route.url
            .replace(/(\/|\?|\.)/g, '\\$1')
            .replace(/\(\\\.\*\)/, '(.*)') + '$'
          );
          route.urlRx = new RegExp(rx);
        }
      }
    }
  };

  // Load application places
  //
  application.loadPlaces = function(callback) {
    api.metasync.each(impress.application.places, function(placeName, cb) {
      application.loadPlaceScripts(placeName, cb);
    }, callback);
    application.cache.watch('/model');
  };

  // Load single place scripts
  //
  application.loadPlaceScripts = function(placeName, callback) {
    var path = application.dir + '/' + placeName;
    api.fs.exists(path, function(exists) {
      if (exists) {
        api.fs.readdir(path, function(err, files) {
          if (err) {
            application.log.error(
              impress.CANT_READ_DIR + application.dir + '/config'
            );
            callback();
          } else {
            api.metasync.each(files, function(file, cb) {
              application.processPlaceFile(placeName, path, file,
                function() {
                  application.loadPlaceFile(placeName, path, file, cb);
                }, cb
              );
            }, callback);
          }
        });
        if (placeName !== 'setup') application.cache.watch('/' + placeName);
      } else callback();
    });
  };

  // Check if a place file needs to be loaded and invoke
  // the corresponding callback
  //
  application.processPlaceFile = function(placeName, path, file, load, pass) {
    if (!api.common.endsWith(file, '.js')) return pass();
    if (placeName === 'setup') {
      if (impress.workerId !== '1') return pass();
      application.setupScriptChanged(path, file, function(changed) {
        if (!changed) pass();
        else load();
      });
    } else load();
  };

  // Сheck if a setup script has changed since last run
  // (or has not been run yet)
  //
  application.setupScriptChanged = function(path, file, callback) {
    var scriptName = api.path.basename(file, '.js'),
        scriptPath = path + '/' + file,
        doneFilePath = path + '/' + scriptName + '.done';
    api.fs.readFile(doneFilePath, function(err, data) {
      if (err) return callback(true);
      var doneDate = new Date(data.toString());
      api.fs.stat(scriptPath, function(err, stat) {
        callback(doneDate < stat.mtime);
      });
    });
  };

  // Load place file
  //   placeName - place name (subdirectory name in application base directory)
  //   path - directory path
  //   file - file name in place directory
  //   callback - call after file loaded
  //
  application.loadPlaceFile = function(placeName, path, file, callback) {
    var sectionName = api.path.basename(file, '.js');
    application.createScript(path + '/' + file, function(err, exports) {
      if (!err) {
        if (placeName === 'tasks') {
          application.setTask(sectionName, exports);
        } else if (placeName === 'model') {
          application.model[sectionName] = exports;
        } else if (placeName === 'setup') {
          api.fs.writeFile(
            path + '/' + sectionName + '.done', new Date().toISOString()
          );
        }
      }
      callback();
    });
  };

  // Start or restart application tasks
  //
  application.setTask = function(taskName, exports) {
    application.stopTask(taskName);
    application.tasks[taskName] = exports;
    var task = application.tasks[taskName];
    if (task) {
      task.name = taskName;
      task.success = null;
      task.error = null;
      task.lastStart = null;
      task.lastEnd = null;
      task.executing = false;
      task.active = false;
      task.count = 0;
      application.startTask(taskName);
    }
  };

  // Start task
  //   taskName - task name in application.tasks hash
  //
  application.startTask = function(taskName) {
    var task = application.tasks[taskName];
    if (task && !task.active) {
      task.active = true;
      task.interval = api.common.duration(task.interval);
      task.timer = api.timers.setInterval(function() {
        if (!task.executing) {
          task.lastStart = Date.now();
          task.executing = true;
          task.run(task, function(taskResult) {
            task.error = taskResult;
            task.success = taskResult === null;
            task.lastEnd = Date.now();
            task.executing = false;
            task.count++;
          });
        }
      }, task.interval);
    }
  };

  // Stop task
  //   taskName - task name in application.tasks hash
  //
  application.stopTask = function(taskName) {
    var task = application.tasks[taskName];
    if (task && task.timer) api.timers.clearInterval(task.timer);
    delete application.tasks[taskName];
  };

  // Stop application tasks
  //
  application.stopTasks = function() {
    var tasks = application.tasks,
        taskNames = Object.keys(tasks);
    taskNames.map(application.stopTask);
  };

  // Dispatch requests
  //   req - request is an instance of http.IncomingMessage
  //   res - rsponse is an instance of http.ServerResponse
  //
  application.dispatch = function(req, res) {
    var route, match, form,
        client = new impress.Client(application, req, res);

    if (application.config.application.slowTime) {
      client.slowTime = application.config.application.slowTime;
    }

    var routes = application.config.routes;
    if (routes) {
      for (var iRoute = 0, len = routes.length; iRoute < len; iRoute++) {
        route = routes[iRoute];
        match = req.url.match(route.urlRx);
        if (match) {
          return application.dispatchRoute(
            client, route, match, iRoute
          );
        }
      }
    }

    client.static(function() {
      if (impress.HTTP_VEBS.indexOf(client.method) > 0) {
        var contentType = req.headers['content-type'];
        if (contentType && api.common.startsWith(contentType, 'multipart')) {
          form = new api.multiparty.Form();
          form.parse(req, function(err, fields, files) {
            if (err) client.error(400);
            else {
              client.files = files;
              client.fields = fields;
              api.common.extend(client.parameters, client.fields);
              client.dispatch();
            }
          });
        } else {
          req.on('data', function(chunk) {
            client.chunks.push(chunk);
          });
          req.on('end', function() {
            client.data = Buffer.concat(client.chunks).toString();
            var json = false;
            if (contentType) {
              json = api.common.startsWith(contentType, 'application/json');
            }
            if (json) {
              client.fields = api.json.parse(client.data);
            } else {
              client.fields = api.querystring.parse(client.data);
            }
            api.common.extend(client.parameters, client.fields);
            client.dispatch();
          });
        }
      } else client.dispatch();
    });
    return client;
  };

  // Dispatch route
  //   client - instance of Client
  //   route - route name
  //   match - Array of URL elements mached route.urlRx
  //   iRoute - route index in application.config.routes
  //
  application.dispatchRoute = function(client, route, match, iRoute) {
    client.slowTime = route.slowTime;
    var req = client.req,
        res = client.res,
        urlRoute = req.url;
    if (route.rewrite && match.length > 1) {
      urlRoute = route.rewrite.replace(
        impress.ROUTE_NUM_REGEXP, function(s, key) {
          return match[key] || '';
        }
      );
    } else urlRoute = route.rewrite;
    req.usedRoutes = req.usedRoutes || [];
    if (route.host) client.proxy(route.host, route.port || 80, urlRoute);
    else if (api.common.inArray(req.usedRoutes, iRoute)) client.error(508);
    else {
      req.url = urlRoute;
      req.usedRoutes.push(iRoute);
      impress.dispatcher(req, res);
    }
  };

  // Refresh static in memory cache with compression and minification
  //   filePath - compressing file path
  //   stats - instance of fs.Stats
  //   callback - function(err, data, compressed)
  //
  application.compress = function(filePath, stats, callback) {
    api.fs.readFile(filePath, function(err, data) {
      if (err) {
        if (callback) callback(err);
      } else {
        var relPath = application.relative(filePath),
            ext = api.common.fileExt(filePath),
            lst = api.common.inArray(application.config.files.preprocess, ext),
            minifyed = api.common.endsWith(filePath, '.min.js');
        minifyed = (ext === 'js') && minifyed;
        if (lst && !minifyed) {
          var pre = impress.preprocess[ext];
          if (pre) {
            data = pre(data);
            if (data) stats.size = data.length;
            else {
              if (callback) {
                callback(new Error(ext + ' parse/preprocess error'));
              }
              application.cache.static[relPath] = impress.FILE_PARSE_ERROR;
              return application.cache.watch(api.path.dirname(relPath));
            }
          }
        }
        if (
          application.config.files.gzip &&
          !api.common.inArray(impress.COMPRESSED_EXT, ext) &&
          stats.size > impress.COMPRESS_ABOVE
        ) {
          api.zlib.gzip(data, function(err, data) {
            if (!err) stats.size = data.length;
            if (callback) callback(err, data, true);
            var cache = { stats: stats, compressed: true, data: data };
            if (!err) application.cache.add(relPath, cache);
          });
        } else {
          if (callback) callback(null, data, false);
          var cache = { stats: stats, compressed: false, data: data };
          application.cache.add(relPath, cache);
        }
        application.cache.watch(api.path.dirname(relPath));
      }
    });
  };

  // Shutdown application
  //
  application.shutdownLongWorkers = function() {
    for (var workerId in application.longWorkers) {
      application.longWorkers[workerId].kill();
    }
  };

  // Programmatically create handler
  //   method - http verb (get, post...)
  //   path - path for handler
  //   handler - impress 2 parameter functon or 3 parameter middleware
  //   meta - metadata to be set as handler.handler (optional)
  //
  application.handler = function(method, path, handler, meta) {
    var dirPath = '/www' + api.common.addTrailingSlash(path),
        filePath = dirPath + method + '.js';
    if (meta) handler.meta = meta;

    application.cache.scripts[filePath] = handler;
    application.cache.files[filePath] = impress.FILE_EXISTS;
    application.cache.folders[dirPath] = impress.DIR_EXISTS;
  };

  // Programmatically create handlers for http verbs
  //   application.get(path, handler, meta)
  //   application.post(path, handler, meta)
  //   application.put(path, handler, meta)
  //   application.delete(path, handler, meta)
  //
  impress.HTTP_VEBS.forEach(function(verb) {
    application[verb] = function(path, handler, meta) {
      application.handler(verb, path, handler, meta);
    };
  });

};
