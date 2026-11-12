const fs = require('fs');
let c = fs.readFileSync('public/js/dashboard.js', 'utf8');

// Remove the loadStockObservations and renderStockObservations functions
// These are specifically for the Stock Observations tab which we're removing
const pattern1 = /async function loadStockObservations() {[\s\S]*?^\}/m;
const pattern2 = /function renderStockObservations\(data\) {[\s\S]*?^\}/m;

c = c.replace(pattern1, '');
c = c.replace(pattern2, '');

fs.writeFileSync('public/js/dashboard.js', c, 'utf8');
console.log('Done: Stock Observations functions removed from dashboard.js');