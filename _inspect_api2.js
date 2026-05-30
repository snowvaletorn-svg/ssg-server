const https = require('https');
https.get('https://ffscouter.com/api-docs', (r) => {
  let d = '';
  r.on('data', c => d += c);
  r.on('end', () => {
    // Look for the actual endpoints listed after get-stats
    const quickLinksEnd = d.indexOf('<div id="get-stats"');
    
    // Find all endpoint div sections
    const sections = [];
    let pos = quickLinksEnd;
    while ((pos = d.indexOf('<h2 class="text-2xl', pos)) !== -1) {
      const endTag = d.indexOf('</div>', pos + 100);
      const sectionDivEnd = d.indexOf('</div>', endTag + 6);
      sections.push({
        pos,
        end: sectionDivEnd,
        text: d.substring(pos, sectionDivEnd + 6)
      });
      pos = sectionDivEnd + 6;
    }
    
    console.log('Found', sections.length, 'sections');
    sections.forEach((s, i) => {
      const titleMatch = s.text.match(/text-\[#00ADB5\]">([^<]+)</);
      const endpointMatch = s.text.match(/(\/api\/v1\/[^\s<]+)/);
      console.log(`\nSection ${i + 1}:`, titleMatch ? titleMatch[1] : 'no title');
      console.log('First 200 chars:', s.text.substring(0, 200));
      if (endpointMatch) console.log('Endpoint:', endpointMatch[1]);
    });
  });
}).on('error', e => console.error(e.message));