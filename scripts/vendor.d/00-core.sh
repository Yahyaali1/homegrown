# LiteRT-LM (Gemma), transformers.js (Florence-2 and other ONNX models) and the ONNX runtime files.
set -e
rm -rf extension/vendor/litertlm.mjs extension/vendor/wasm extension/vendor/transformers.mjs extension/vendor/ort
npx esbuild node_modules/@litert-lm/core/dist/index.js --bundle --format=esm --outfile=extension/vendor/litertlm.mjs --log-level=warning
cp -r node_modules/@litert-lm/core/wasm extension/vendor/wasm
npx esbuild node_modules/@huggingface/transformers/dist/transformers.web.js --bundle --format=esm --outfile=extension/vendor/transformers.mjs --log-level=error
mkdir -p extension/vendor/ort
cp node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.* node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.* extension/vendor/ort/
rm -f extension/vendor/ort/*.map
