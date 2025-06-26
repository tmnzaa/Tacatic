const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = 5000;

const sewaPath = path.join(__dirname, 'sewa.json');

app.use(express.static(__dirname));
app.use(express.json());

// Toggle fitur welcome / antilink / lainnya
app.post('/toggle', (req, res) => {
  const { id, fitur } = req.body;
  const data = JSON.parse(fs.readFileSync(sewaPath));
  if (data[id] && data[id].features[fitur] !== undefined) {
    data[id].features[fitur] = !data[id].features[fitur];
    fs.writeFileSync(sewaPath, JSON.stringify(data, null, 2));
    console.log(`[OWNER PANEL] ${fitur} di ${id} -> ${data[id].features[fitur]}`);
    return res.sendStatus(200);
  }
  res.sendStatus(400);
});

// Endpoint baca sewa.json
app.get('/sewa.json', (req, res) => {
  res.sendFile(path.join(__dirname, 'sewa.json'));
});

app.listen(PORT, () => {
  console.log(`✅ Panel Owner aktif di http://localhost:${PORT}`);
});
