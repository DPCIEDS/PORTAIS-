const fs = require('fs');
const { google } = require('googleapis');

const creds = JSON.parse(fs.readFileSync('./credentials_MCP.json', 'utf8'));
const auth = new google.auth.GoogleAuth({
  credentials: creds,
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
});

const ID = '18jG66Q8Lf4jKoeMll2waMuf5QW4CxinIEYobw4NvFaw';

(async () => {
  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });

  const meta = await sheets.spreadsheets.get({ spreadsheetId: ID });
  console.log('Titulo:', meta.data.properties.title);
  console.log('Abas:', meta.data.sheets.map(s => s.properties.title + ' (' + s.properties.gridProperties.rowCount + 'x' + s.properties.gridProperties.columnCount + ')').join('\n  '));

  // pega amostra da primeira aba (ou a que tiver gid 852225575)
  const primeiraAba = meta.data.sheets[0].properties.title;
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: ID, range: primeiraAba + '!A1:P8' });
  console.log('\n=== Amostra da aba "' + primeiraAba + '" ===');
  (res.data.values || []).forEach((row, i) => console.log(i+1, JSON.stringify(row)));
})().catch(e => { console.error('ERRO', e.message); process.exit(1); });
