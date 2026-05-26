console.log('# Daily digest');
console.log('');
console.log('- agenda generated');
console.log('- report mailed');
console.log('');
console.log('| Job | Status |');
console.log('| --- | --- |');
console.log('| Agenda | Ready |');
console.log('| Report | Sent |');
console.error(
  JSON.stringify({
    level: 30,
    timestamp: '2026-01-02T12:34:56Z',
    msg: 'success stderr should be omitted',
  }),
);
