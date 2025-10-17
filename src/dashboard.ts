#!/usr/bin/env node
/**
 * DEPRECATED: This entry point is no longer used.
 * The dashboard is now integrated into the main application (src/index.ts)
 * 
 * This file redirects to the unified application for backward compatibility.
 */

console.warn('⚠️  DEPRECATED: src/dashboard.ts is no longer used.');
console.warn('   The dashboard is now part of the main CPTO application.');
console.warn('   Starting unified application from src/index.ts...\n');

// Redirect to the unified application
import './index';
