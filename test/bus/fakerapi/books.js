({
  method: {
    get: 'api/v1/books',
  },

  query: {
    prefix: '_',
    params: {
      quantity: '?number',
    },
  },

  returns: {
    status: 'string',
    code: 'number',
    total: 'number',
    data: {
      type: 'array',
      value: {
        id: 'number',
        title: 'string',
        author: 'string',
        genre: 'string',
        description: 'string',
        isbn: 'string',
        image: 'string',
        published: 'string',
        publisher: 'string',
      },
    },
  },
});
