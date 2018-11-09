'use strict';

// MySQL database plugin for Impress Application Server

if (api.mysql) {

  api.db.mysql = {};
  api.db.mysql.schema = {};
  api.db.drivers.mysql = api.mysql;

  if (api.mysqlUtilities) {
    api.db.mysql.upgrade = api.mysqlUtilities.upgrade;
    api.db.mysql.introspection = api.mysqlUtilities.introspection;
  }

  // Open Database
  //   database <Object> { name, url, tables }
  //   callback <Function> callback after connection established
  api.db.mysql.open = (database, callback) => {
    database.retryCounter++;
    const connection = api.mysql.createConnection(database.url);
    connection.slowTime = database.slowTime;

    api.db.mysql.upgrade(connection);
    if (api.db.mysql.introspection) api.db.mysql.introspection(connection);

    connection.connect(err => {
      if (err) {
        impress.log.error(api.json.stringify(err));
        api.timers.setTimeout(() => {
          if (database.retryCounter <= database.retryCount) {
            api.db.mysql.open(database, callback);
          }
        }, database.retryInterval);
      }
      database.retryCounter = 0;
    });

    connection.on('query', (err, res, fields, query) => {
      if (err) {
        impress.log.error(
          `MySQL Error[${err.errno}]: ${err.code}\t${query.sql}`
        );
      }
      impress.log.debug(query.sql);
    });

    connection.on('slow', (err, res, fields, query, executionTime) => {
      impress.log.slow(`${executionTime}ms\t${query.sql}`);
    });

    connection.on('error', err => {
      impress.log.error(api.json.stringify(err));
      if (err.code === 'PROTOCOL_CONNECTION_LOST') {
        if (database.retryCounter <= database.retryCount) {
          api.db.mysql.open(database, callback);
        }
      }
    });

    database.connection = connection;
    callback();
  };

  const crlf = '\r\n';
  const cmnt = '-- ';
  const line = cmnt + new Array(50).join('-') + crlf;
  const altr = 'ALTER TABLE ';

  const fieldTypes = {
    id:       { type: 'bigint', signed: false, nullable: false },
    tree:     { type: 'bigint', signed: false, nullable: true },
    uid:      { type: 'bigint', signed: false },
    guid:     { type: 'binary', size: 16, signed: false },
    ip:       { type: 'int', signed: false },
    hash:     { type: 'binary', size: 32 },
    int:      { type: 'int',    size: 10 },
    float:    { type: 'double' },
    str:      { type: 'varchar' },
    char:     { type: 'char' },
    date:     { type: 'date' },
    time:     { type: 'time' },
    datetime: { type: 'timestamp' },
    money:    { type: 'decimal', size: '10,2' },
    bool:     { type: 'bool' },
    text:     { type: 'text' }
    // add other native data types for mysql
  };

  // Generate Script
  //   databaseSchema <Object> relational database schema for MySQL
  //   consoleOutput <boolean>
  api.db.mysql.schema.generateScript = (databaseSchema, consoleOutput) => {
    const validationResult = api.db.schema.validate(
      databaseSchema, consoleOutput
    );
    let sqlScript = '';
    if (consoleOutput) {
      if (validationResult.valid) {
        impress.log.info('Schema validation: OK');
      } else {
        impress.log.error('Schema validation: ERROR');
      }
    }
    if (validationResult.valid) {
      sqlScript = (
        line + cmnt + databaseSchema.caption + crlf + cmnt +
        'Version: ' + databaseSchema.version + crlf + line + crlf
      );
      for (const tableName in databaseSchema) {
        if (tableName !== 'caption' && tableName !== 'version') {
          const table = databaseSchema[tableName];
          const primaryKey = [];
          const indexes = [];
          const references = [];
          let referenceStatement, reference;
          let fieldsDef = '';
          let primaryFieldDef = '';
          let fieldIndex = 1;
          let fieldNameMaxLength = 0;
          sqlScript += 'CREATE TABLE ' + tableName + ' (' + crlf;
          for (const fieldName in table.fields) {
            fieldNameMaxLength = Math.max(fieldNameMaxLength, fieldName.length);
          }
          for (const fieldName in table.fields) {
            const field = table.fields[fieldName];
            if (field.signed === undefined) field.signed = false;
            if (field.nullable === undefined) field.nullable = false;
            let fieldDef = '';
            const fieldType = fieldTypes[field.type];
            for (const fieldAttribute in fieldType) {
              if (!(fieldAttribute in field)) {
                field[fieldAttribute] = fieldType[fieldAttribute];
              }
            }
            fieldDef = fieldType.type;
            if (field.size) fieldDef += '(' + field.size + ')';
            fieldDef += ' ';
            if (!field.signed) fieldDef += 'unsigned ';
            if (!field.nullable || field.master) fieldDef += 'NOT NULL ';
            if (field.default) {
              if (field.type === 'datetime' && field.default === 'now') {
                field.default = 'CURRENT_TIMESTAMP';
              } else {
                field.default = '"' + field.default + '"';
              }
              fieldDef += 'DEFAULT ' + field.default + ' ';
            }
            if (field.comment) {
              fieldDef += 'COMMENT "' + field.comment + '" ';
            }
            if (fieldDef.length > 0) fieldDef = fieldDef.slice(0, -1);
            if (
              field.primary ||
              (
                fieldIndex === 1 &&
                ['id', 'uid'].includes(field.type)
              )
            ) {
              primaryKey.push(fieldName);
            }
            if (field.index) {
              if (field.index.unique) {
                indexes.push(
                  'CREATE UNIQUE INDEX ak' + tableName + fieldName +
                  ' ON ' + tableName + ' (' + fieldName + ');'
                );
              } else {
                indexes.push(
                  'CREATE INDEX idx' + tableName + fieldName +
                  ' ON ' + tableName + ' (' + fieldName + ');'
                );
              }
            }
            if (
              field.master ||
              field.link ||
              (field.lookup && field.lookup.dataset)
            ) {
              reference = (
                field.lookup ? field.lookup : (
                  field.master ? field.master : field.link
                )
              );
              const referenceKey = reference.key || fieldName;
              referenceStatement = (
                altr + tableName + ' ADD CONSTRAINT fk' + tableName +
                fieldName + ' FOREIGN KEY (' + fieldName + ') REFERENCES ' +
                reference.dataset + ' (' + referenceKey + ') ON DELETE '
              );
              if (!reference.deletion) {
                if (field.master) reference.deletion = 'cascade';
                else if (!field.nullable) reference.deletion = 'restrict';
              }
              if (reference.deletion) {
                referenceStatement += reference.deletion.toUpperCase();
              } else {
                referenceStatement += 'SET NULL';
              }
              references.push(referenceStatement + ';');
            }
            fieldsDef += (
              '  ' + api.common.rpad(fieldName, ' ', fieldNameMaxLength + 1) +
              ' ' + fieldDef + ',' + crlf
            );
            if (fieldIndex === 1) primaryFieldDef = fieldDef;
            fieldIndex++;
          }
          if (fieldsDef.length > 3) fieldsDef = fieldsDef.slice(0, -3) + crlf;
          sqlScript += fieldsDef + ');' + crlf + crlf;
          if (table.comment) {
            sqlScript += (
              altr + tableName + ' COMMENT = "' +
              table.comment + '";' + crlf + crlf
            );
          }
          if (primaryKey.length > 0) {
            sqlScript += (
              altr + tableName + ' ADD CONSTRAINT pk' + tableName +
              ' PRIMARY KEY (' + primaryKey.join(', ') + ');' + crlf
            );
          }
          if (primaryKey.length === 1) {
            sqlScript += (
              altr + tableName + ' CHANGE ' + primaryKey[0] + ' ' +
              primaryKey[0] + ' ' + primaryFieldDef + ' auto_increment;' +
              crlf + crlf
            );
          }
          if (indexes.length > 0) {
            sqlScript += indexes.join(crlf) + crlf + crlf;
          }
          if (references.indexes) {
            for (const indexName in references.indexes) {
              const compositeIndex = references.indexes[indexName];
              sqlScript += (
                'CREATE ' + (compositeIndex.unique ? 'UNIQUE ' : '') +
                'INDEX ' + (compositeIndex.unique ? 'ak' : 'idx') +
                indexName + ' ON ' + tableName +
                ' (' + compositeIndex.fields.join(', ') + ');' + crlf
              );
            }
            sqlScript += crlf;
          }
          if (references.length > 0) {
            sqlScript += references.join(crlf) + crlf + crlf;
          }
        }
      }
    } else if (consoleOutput) {
      const errors = validationResult.errors.join('; ');
      impress.log.error('Errors: ' + errors);
    }
    return {
      success: !!sqlScript,
      script: sqlScript,
      validation: validationResult
    };
  };

  api.db.mysql.schema.executeScript = (target, script, callback) => {
    const connection = api.db.drivers.mysql.createConnection(
      target.url, { multipleStatements: true }
    );
    connection.on('error', api.db.mysql.onError);
    api.db.mysql.upgrade(connection);
    connection.connect();
    connection.query(script, [], callback);
  };

}
