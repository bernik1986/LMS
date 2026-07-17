module.exports = {
  apps: [
    {
      name: "marine-lms",
      script: "scripts/prod-start.mjs",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "768M",
      env: {
        NODE_ENV: "production",
        HOST: "0.0.0.0",
        PORT: "3000"
      }
    }
  ]
};
