console.log(
  JSON.stringify({
    level: 30,
    time: 1767357296000,
    pid: process.pid,
    hostname: 'worker-1',
    reqId: 'abc',
    msg: 'stdout pino message',
  }),
);
console.error(
  JSON.stringify({
    level: 50,
    time: 1767357297000,
    pid: process.pid,
    hostname: 'worker-1',
    err: { message: 'boom' },
    msg: 'stderr pino error',
  }),
);
