import { readFileSync } from 'node:fs';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

export const APP_VERSION = packageJson.version;
export const APP_VERSION_LABEL = `v${APP_VERSION}`;
