const fs = require('fs');
let c = fs.readFileSync('views/dashboard.ejs', 'utf8');

// Remove the STOCK OBSERVATIONS section (ifEmployee + else branches)
const pattern = /<!-- .*? STOCK OBSERVATIONS .*? -->\s*<% if \(!isEmployee\) \{ %>[\s\S]*?<% } else \{ %>[\s\S]*?<% \} %>\s*/g;
c = c.replace(pattern, '');

fs.writeFileSync('views/dashboard.ejs', c, 'utf8');
console.log('Done: Stock Observations section removed from dashboard.ejs');