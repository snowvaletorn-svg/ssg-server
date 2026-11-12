const fs = require('fs');
let c = fs.readFileSync('public/js/dashboard.js', 'utf8');

// Remove the stock-observations handler from showSection
const pattern = /if \(sectionId === 'stock-observations'\) \{ loadStockObservations\(\); \}\s*/g;
c = c.replace(pattern, '');

fs.writeFileSync('public/js/dashboard.js', c, 'utf8');
console.log('Done: Stock Observations showSection handler removed');