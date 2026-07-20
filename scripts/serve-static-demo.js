'use strict';

const path = require('node:path');
const express = require('express');

const projectRoot = path.join(__dirname, '..');
const port = Number.parseInt(process.env.STATIC_DEMO_PORT || '8090', 10);
const app = express();

app.disable('x-powered-by');

// Serve only browser assets. Backend source, policies, data and tests remain
// inaccessible even though the local demo is launched from the repository.
app.get(['/', '/index.html'], (_request, response) => {
  response.sendFile(path.join(projectRoot, 'index.html'));
});
app.get(['/vehicle', '/vehicle.html'], (_request, response) => {
  response.sendFile(path.join(projectRoot, 'vehicle.html'));
});
app.get('/styles.css', (_request, response) => {
  response.sendFile(path.join(projectRoot, 'styles.css'));
});
app.use('/styles', express.static(path.join(projectRoot, 'styles'), { fallthrough: false }));
app.use('/js', express.static(path.join(projectRoot, 'js'), { fallthrough: false }));
app.use('/assets', express.static(path.join(projectRoot, 'assets'), { fallthrough: false }));

app.use((_request, response) => {
  response.status(404).type('text/plain').send('Not found');
});

app.listen(port, '127.0.0.1', () => {
  console.log(`Kopilotti Sales static demo http://localhost:${port}`);
});
