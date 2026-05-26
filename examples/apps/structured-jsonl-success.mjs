console.log(
  JSON.stringify({
    title: 'Structured report',
    items: ['item 1', 'item 2'],
    table: [
      ['col-1-row-1', 'col-2-row-1'],
      ['col-1-row-2', 'col-2-row-2'],
    ],
    date: '2026-01-02T12:34:56Z',
    time: '2026-01-02T12:34:56Z',
    datetime: '2026-01-02T12:34:56Z',
    childHtml: '<p>some html</p>',
    childMarkdown: '**some markdown**',
    childRaw: 'raw text escapes <tags>',
  }),
);
console.error(
  JSON.stringify({
    level: 30,
    timestamp: '2026-01-02T12:34:56Z',
    msg: 'structured report completed',
  }),
);
