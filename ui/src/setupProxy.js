const createProxyMiddleware = require("http-proxy-middleware");

// Use dim container as backend (package.json proxy handles this, but we keep explicit config)
const API_TARGET = process.env.REACT_APP_API_URL || "http://dim:8000";

module.exports = function (app) {
  app.use(
    "/api",
    createProxyMiddleware({
      target: API_TARGET,
      changeOrigin: true,
    })
  );

  app.use(
    "/images",
    createProxyMiddleware({
      target: API_TARGET,
      changeOrigin: true,
    })
  );

  app.use(
    "/ws",
    createProxyMiddleware({
      target: API_TARGET,
      ws: true,
      changeOrigin: true,
    })
  );
};
