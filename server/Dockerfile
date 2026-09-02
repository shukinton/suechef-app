# Sue Chef recipe server — container build (Render/Fly/Railway all accept this)
FROM ghcr.io/puppeteer/puppeteer:23.11.1

# NOTE (field outage, Sep 2): puppeteer docker images v20+ do NOT ship
# /usr/bin/google-chrome-stable — Chrome lives in the puppeteer cache dir
# (/home/pptruser/.cache/puppeteer/chrome/<ver>/chrome-linux64/chrome).
# We symlink it into the classic path AND index.js probes the cache directly,
# so either mechanism alone keeps the server alive.
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    CHROME_PATH=/usr/bin/google-chrome-stable \
    NODE_ENV=production

# The base image ends as USER pptruser — switch to root for the build steps so
# /app is creatable, then hand ownership back before running.
USER root
RUN CH=$(find /home/pptruser/.cache/puppeteer -type f -name chrome 2>/dev/null | head -1) && \
    if [ -n "$CH" ]; then ln -sf "$CH" /usr/bin/google-chrome-stable; \
    else echo "WARNING: no chrome binary found in the puppeteer cache" >&2; fi
WORKDIR /app
COPY package.json ./
# --omit=optional: @sparticuz/chromium is only for serverless hosts without a
# system chrome; this image ships Chrome (via the puppeteer cache), so skip the ~70MB dep.
RUN npm install --omit=dev --omit=optional --no-audit --no-fund && \
    chown -R pptruser:pptruser /app
COPY --chown=pptruser:pptruser index.js ./

EXPOSE 8787
USER pptruser
CMD ["node", "index.js"]
