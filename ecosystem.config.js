module.exports = {
  apps: [{
    name: 'death-switch',
    script: 'src/index.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'development'
    },
    env_production: {
      NODE_ENV: 'production'
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true,
    cron_restart: '0 0 * * *', // Reiniciar diariamente a medianoche
    kill_timeout: 5000,
    wait_ready: true,
    listen_timeout: 10000
  }]
}; 