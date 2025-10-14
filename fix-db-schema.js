const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(process.cwd(), 'data', 'cpto_analysis.db');
console.log(`🔧 Fixing database schema at: ${dbPath}`);

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('❌ Error opening database:', err.message);
    process.exit(1);
  }
  console.log('✅ Connected to database');
});

// Check if reuse_count column exists first
db.all("PRAGMA table_info(processed_content)", (err, rows) => {
  if (err) {
    console.error('❌ Error getting table info:', err.message);
    process.exit(1);
  }
  
  const hasReuseCount = rows.some(row => row.name === 'reuse_count');
  
  if (hasReuseCount) {
    console.log('✅ reuse_count column already exists');
    db.close();
    return;
  }
  
  console.log('🔧 Adding reuse_count column...');
  
  db.run("ALTER TABLE processed_content ADD COLUMN reuse_count INTEGER NOT NULL DEFAULT 0", (err) => {
    if (err) {
      console.error('❌ Error adding column:', err.message);
      process.exit(1);
    }
    
    console.log('✅ Successfully added reuse_count column');
    
    // Verify the column was added
    db.all("PRAGMA table_info(processed_content)", (err, rows) => {
      if (err) {
        console.error('❌ Error verifying table info:', err.message);
        process.exit(1);
      }
      
      const hasReuseCount = rows.some(row => row.name === 'reuse_count');
      console.log(`${hasReuseCount ? '✅' : '❌'} Verification: reuse_count column ${hasReuseCount ? 'EXISTS' : 'MISSING'}`);
      
      db.close();
    });
  });
});