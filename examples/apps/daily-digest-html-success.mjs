console.log('<h1>Daily digest</h1>');
console.log('<ul><li>agenda generated</li><li>report mailed</li></ul>');
console.log('<table><thead><tr><th>Job</th><th>Status</th></tr></thead>');
console.log(
  '<tbody><tr><td>Agenda</td><td>Ready</td></tr><tr><td>Report</td><td>Sent</td></tr></tbody></table>',
);
console.log('<pre><code>daily-report --send</code></pre>');
console.error(
  JSON.stringify({
    level: 30,
    timestamp: '2026-01-02T12:34:56Z',
    msg: 'success stderr should be omitted',
  }),
);
