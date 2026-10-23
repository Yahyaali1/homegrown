# LiteRT-LM (Gemma), transformers.js (Florence-2 and other ONNX models) and the ONNX runtime files.
set -e
rm -rf legacy/vendor/litertlm.mjs legacy/vendor/wasm legacy/vendor/transformers.mjs legacy/vendor/ort
npx esbuild node_modules/@litert-lm/core/dist/index.js --bundle --format=esm --outfile=legacy/vendor/litertlm.mjs --log-level=warning
cp -r node_modules/@litert-lm/core/wasm legacy/vendor/wasm
npx esbuild node_modules/@huggingface/transformers/dist/transformers.web.js --bundle --format=esm --outfile=legacy/vendor/transformers.mjs --log-level=error
mkdir -p legacy/vendor/ort
cp node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.* node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.* legacy/vendor/ort/
rm -f legacy/vendor/ort/*.map
