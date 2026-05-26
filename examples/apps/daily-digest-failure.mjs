console.log('# Daily digest');
console.error(
  JSON.stringify({
    level: 50,
    timestamp: '2026-01-02T12:34:56Z',
    msg: 'report failed because *input* contained <tags>',
  }),
);
console.error(
  JSON.stringify({
    level: 40,
    timestamp: '2026-01-02T12:35:20Z',
    code: 'DIGEST_RETRY',
  }),
);
console.error('not-json stderr fallback');
process.exit(2);
