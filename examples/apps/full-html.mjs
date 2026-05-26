console.log('<h1>Backup report</h1>');
console.log('<ul>');
console.log('<li>copied <code>/var/data</code></li>');
console.log('<li>verified checksum</li>');
console.log('</ul>');
console.log('<table><thead><tr><th>Step</th><th>Result</th></tr></thead>');
console.log(
  '<tbody><tr><td>Copy</td><td>OK</td></tr><tr><td>Verify</td><td>OK</td></tr></tbody></table>',
);
console.log(
  '<pre><code>rsync -a /var/data /backup/data\nsha256sum /backup/data/archive.tar</code></pre>',
);
console.error('<p><strong>warning:</strong> slow disk</p>');
console.error('<pre><code>iostat: await &gt; 50ms</code></pre>');
