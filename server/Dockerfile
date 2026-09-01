# Sue Chef recipe server — container build (Render/Fly/Railway all accept this)
FROM ghcr.io/puppeteer/puppeteer:23.11.1

# CHROME_PATH is a hint, not a promise: index.js verifies it exists and
# probes /usr/bin/google-chrome[-stable] and /usr/bin/chromium* as fallbacks.
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    CHROME_PATH=/usr/bin/google-chrome-stable \
    NODE_ENV=production

# The base image ends as USER pptruser — switch to root for the build steps so
# /app is creatable, then hand ownership back before running.
USER root
WORKDIR /app
COPY package.json ./
# --omit=optional: @sparticuz/chromium is only for serverless hosts without a
# system chrome; this image ships google-chrome-stable, so skip the ~70MB dep.
RUN npm install --omit=dev --omit=optional --no-audit --no-fund && \
    chown -R pptruser:pptruser /app
COPY --chown=pptruser:pptruser index.js ./

EXPOSE 8787
USER pptruser
CMD ["node", "index.js"]
