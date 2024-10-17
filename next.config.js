const CopyPlugin = require("copy-webpack-plugin");


/** @type {import('next').NextConfig} */
const nextConfig = {
    api: {
        bodyParser: false,
    },
    webpack: (config, { buildId, dev, isServer, defaultLoaders, webpack }) => {
        // Add CopyPlugin to the webpack configuration
        config.plugins.push(
            new CopyPlugin({
                patterns: [
                    {
                        from: "node_modules/@ricky0123/vad-web/dist/vad.worklet.bundle.min.js",
                        to: "static/chunks/[name][ext]",
                    },
                    {
                        from: "node_modules/@ricky0123/vad-web/dist/*.onnx",
                        to: "static/chunks/[name][ext]",
                    },
                    {
                        from: "node_modules/onnxruntime-web/dist/*.wasm",
                        to: "static/chunks/[name][ext]"
                    },
                ],
            })
        );

        // Handle WebAssembly
        config.experiments = {
            ...config.experiments,
            asyncWebAssembly: true,
        };

        // Add rule for .wasm files
        config.module.rules.push({
            test: /\.wasm$/,
            type: 'webassembly/async',
        });

        // Fallback for 'fs' module on client-side
        if (!isServer) {
            config.resolve.fallback = {
                ...config.resolve.fallback,
                fs: false,
            };
        }

        return config;
    },
};

module.exports = nextConfig;