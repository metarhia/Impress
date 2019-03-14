'use strict';

// Oracle database connector for Impress Application Server

const setupConnection = (database, pool, connection) => {
  connection.query = (sql, values, callback) => {
    if (typeof values === 'function') {
      callback = values;
      values = [];
    }
    pool.getConnection((err, connection) => {
      if (err) {
        database.application.logException(err);
        callback(err);
        return;
      }
      const startTime = Date.now();
      connection.execute(sql, values, (err, res) => {
        if (err) {
          database.application.logException(err);
          callback(err);
          return;
        }
        const endTime = Date.now();
        const executionTime = endTime - startTime;

        pool.emit('query', err, res, sql);
        if (database.slowTime && executionTime >= database.slowTime) {
          pool.emit('slow', err, res, sql, executionTime);
        }
        if (callback) callback(err, res);
        connection.release();
      });
    });
  };

};

if (api.oracle) {

  api.db.oracle = {};
  api.db.drivers.oracle = api.oracle;

  // Open Database
  //   database <Object> { name, url }
  //   callback <Function> callback after connection established
  api.db.oracle.open = (database, callback) => {
    const url = database.url.substring('oracle://'.length);
    const [auth, connectString] = url.split('@');
    const [user, password] = auth.split(':');
    const { poolMax } = database.config;
    database.retryCounter++;
    api.oracle.createPool({
      user, password, connectString, poolMax
    }, (err, pool) => {
      if (err) {
        database.application.logException(err);
        setTimeout(() => {
          if (database.retryCounter <= database.retryCount) {
            api.db.oracle.open(database, callback);
          } else {
            callback(new Error('Cannot open connection'));
          }
        }, database.retryInterval);
        return;
      }
      database.retryCounter = 0;
      const connection = {};
      setupConnection(database, pool, connection);
      database.pool = pool;
      database.connection = connection;
      callback();
    });
  };

  api.db.oracle.close = (database, callback) => {
    database.pool.close(callback);
  };

}
