module.exports = {
  apps: [{
    name: 'mochi',
    script: './bot.js',
    cwd: __dirname,
    watch: false,
    autorestart: true,
    max_restarts: 20,
    min_uptime: '10s',
    restart_delay: 5000,
    max_memory_restart: '600M',
    env_file: './.env',
    out_file: './logs/out.log',
    error_file: './logs/err.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
  }]
};
