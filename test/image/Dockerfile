ARG PLAYWRIGHT_VERSION=1.62.1
FROM mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble

ARG PLAYWRIGHT_VERSION

WORKDIR /opt/micado-playwright

# The official image contains the browsers and OS libraries. The test runner is
# installed once in this derived image and remains available to mounted tests.
RUN npm init -y \
    && npm install --save-exact --omit=optional \
        "@playwright/test@${PLAYWRIGHT_VERSION}" \
        "pg@8.16.3" \
        "@types/pg@8.15.5" \
    && npm cache clean --force

CMD ["npx", "playwright", "test", "--config=tests/playwright.config.mjs"]
