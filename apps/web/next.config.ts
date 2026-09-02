import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  images: {
    // GitHub avatar images shown in the app shell (Section 5) -- the only
    // remote image source in the product.
    remotePatterns: [{ protocol: 'https', hostname: 'avatars.githubusercontent.com' }],
  },
};

export default nextConfig;
