# The devnet's way in for a browser on another computer (server.mjs): a proxy to nginx and
# the PAC file that points at it, on one port. No dependencies, Node's own net and http.
FROM node:22-alpine
WORKDIR /app
COPY server.mjs ./
USER node
EXPOSE 1080
CMD ["node", "server.mjs"]
