import type { NextConfig } from 'next';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';

const webDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(webDir, '..');

// Root .env holds DATABASE_URL, AUTH_*, and ANALYST_GITHUB_USERS for local/VPS.
loadEnv({ path: path.join(rootDir, '.env') });
loadEnv({ path: path.join(webDir, '.env.local'), override: true });

const nextConfig: NextConfig = {
  // Allow importing the shared catalogue seam from ../src
  experimental: {
    externalDir: true,
  },
  outputFileTracingRoot: rootDir,
  serverExternalPackages: ['pg'],
  webpack: (config) => {
    // Parent package uses NodeNext ".js" import specifiers that point at .ts sources.
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },
};

export default nextConfig;
