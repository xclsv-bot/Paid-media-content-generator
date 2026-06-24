import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Video uploads go browser -> Supabase Storage directly via signed URLs,
  // so we never proxy large bodies through Next API routes (Vercel's ~4.5MB limit).
  experimental: {},
};

export default nextConfig;
