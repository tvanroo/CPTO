const { dataStorageService } = require('./build/src/services/dataStorageService.js');

(async () => {
  try {
    console.log('🔄 Running database migration...');
    await dataStorageService.initialize();
    console.log('✅ Database migration completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
})();