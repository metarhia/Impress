'use strict';

// PgSQL database connector for Impress Application Server

if (api.pgsql) {

  api.db.pgsql = {};
  api.db.drivers.pgsql = api.pgsql;

  // Open Database
  //   database <Object> { name, url }
  //   callback <Function> callback after connection established
  api.db.pgsql.open = (database, callback) => {
    database.retryCounter++;
    const connection = new api.pgsql.Client(database.url);
    const slowTime = database.slowTime || 2000;
    const { query } = connection;

    connection.query = (sql, values, callback) => {
      const startTime = Date.now();
      if (typeof values === 'function') {
        callback = values;
        values = [];
      }
      const aQuery = query(sql, values, (err, res) => {
        const endTime = Date.now();
        const executionTime = endTime - startTime;
        connection.emit('query', err, res, aQuery);
        if (slowTime && executionTime >= slowTime) {
          connection.emit('slow', err, res, aQuery, executionTime);
        }
        if (callback) callback(err, res);
      });
      return aQuery;
    };

    connection.connect(err => {
      if (err) {
        impress.log.error(err);
        setTimeout(() => {
          if (database.retryCounter <= database.retryCount) {
            api.db.pgsql.open(database, callback);
          }
        }, database.retryInterval);
      }
      database.retryCounter = 0;
    });

    connection.on('query', (err, res, query) => {
      if (err) {
        const error = err.stack || err.toString();
        impress.log.error(
          `PgSQL Error[${err.code}]: ${error}\t${query.text}`
        );
      }
      impress.log.debug(query.text);
    });

    connection.on('slow', (err, res, query, executionTime) => {
      impress.log.slow(executionTime + 'ms\t' + query.text);
    });

    connection.on('error', err => {
      impress.log.error(err);
    });

    database.connection = connection;
    callback();
  };

}
