(client, callback) => {
  client.cache('10s');
  console.log('JSON response stored in cache for 10 sec');
  callback(null, { field: 'value' });
}
