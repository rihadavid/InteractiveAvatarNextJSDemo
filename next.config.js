/** @type {import('next').NextConfig} */
const nextConfig = {
    // ...
    plugins: [
        // ...
        new CopyPlugin({
            patterns: [
                // ...
                {
                    from: "node_modules/@ricky0123/vad-web/dist/vad.worklet.bundle.min.js",
                    to: "[name][ext]",
                },
                {
                    from: "node_modules/@ricky0123/vad-web/dist/*.onnx",
                    to: "[name][ext]",
                },
                { from: "node_modules/onnxruntime-web/dist/*.wasm", to: "[name][ext]" },
            ],
        }),
    ],
}

module.exports = nextConfig
