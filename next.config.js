/** @type {import('next').NextConfig} */
const nextConfig = {
    api: {
        bodyParser: false,
    },
    webpack: (config, { isServer }) => {
        if (!isServer) {
            config.resolve.fallback = {
                fs: false,
                path: false,
                crypto: false,
            };
        }

        config.module.rules.push({
            test: /\.wasm$/,
            type: 'asset/resource',
        });

        return config;
    },
    async headers() {
        return [
            {
                source: '/(.*)',
                headers: [
                    {
                        key: 'Cross-Origin-Opener-Policy',
                        value: 'same-origin',
                    },
                    {
                        key: 'Cross-Origin-Embedder-Policy',
                        value: 'require-corp',
                    },
                ],
            },
        ];
    },
}

module.exports = nextConfig
