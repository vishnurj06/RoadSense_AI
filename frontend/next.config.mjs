/** @type {import('next').NextConfig} */
const nextConfig = {
  // The floating dev badge sits bottom-left, exactly where the login's
  // instrument readout lives — it covered the numbers in every screenshot.
  // Dev-only chrome; hiding it changes nothing about the build.
  devIndicators: false,
};

export default nextConfig;
