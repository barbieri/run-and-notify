console.log(JSON.stringify({ level: 'info', message: 'built', count: 2 }));
console.log('not json');
console.error(JSON.stringify({ level: 'warn', message: 'stderr' }));
