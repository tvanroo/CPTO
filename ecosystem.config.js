module.exports = {
  apps: [
    {
      name: 'cpto',
      script: './build/index.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'development',
        LOG_LEVEL: 'info'
      },
      env_production: {
        NODE_ENV: 'production',
        LOG_LEVEL: 'warn'
      },
      error_file: './logs/cpto-error.log',
      out_file: './logs/cpto-out.log',
      log_file: './logs/cpto-combined.log',
      time: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      // Restart policy
      min_uptime: '10s',
      max_restarts: 5,
      restart_delay: 4000,
      // Advanced options
      kill_timeout: 5000,
      listen_timeout: 8000,
      // Environment variables
      node_args: '--max-old-space-size=1024'
    }
  ]
};