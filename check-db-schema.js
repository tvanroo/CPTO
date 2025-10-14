const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(process.cwd(), 'data', 'cpto_analysis.db');
console.log(`🔍 Checking database schema at: ${dbPath}`);

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('❌ Error opening database:', err.message);
    process.exit(1);
  }
  console.log('✅ Connected to database');
});

// Check if database file exists
const fs = require('fs');
if (!fs.existsSync(dbPath)) {
  console.log('❌ Database file does not exist');
  process.exit(1);
}

db.all("PRAGMA table_info(processed_content)", (err, rows) => {
  if (err) {
    console.error('❌ Error getting table info:', err.message);
    process.exit(1);
  }
  
  console.log('\n📋 processed_content table schema:');
  console.log('┌─────┬─────────────────────────┬──────────────┬─────────┬─────────────┬────┐');
  console.log('│ cid │ name                    │ type         │ notnull │ dflt_value  │ pk │');
  console.log('├─────┼─────────────────────────┼──────────────┼─────────┼─────────────┼────┤');
  
  rows.forEach(row => {
    const cid = String(row.cid).padEnd(4);
    const name = String(row.name).padEnd(24);
    const type = String(row.type).padEnd(13);
    const notnull = String(row.notnull).padEnd(8);
    const dfltValue = String(row.dflt_value || '').padEnd(12);
    const pk = String(row.pk).padEnd(3);
    console.log(`│ ${cid}│ ${name}│ ${type}│ ${notnull}│ ${dfltValue}│ ${pk}│`);
  });
  
  console.log('└─────┴─────────────────────────┴──────────────┴─────────┴─────────────┴────┘');
  
  const hasReuseCount = rows.some(row => row.name === 'reuse_count');
  console.log(`\n${hasReuseCount ? '✅' : '❌'} reuse_count column ${hasReuseCount ? 'EXISTS' : 'MISSING'}`);
  
  db.close();
});